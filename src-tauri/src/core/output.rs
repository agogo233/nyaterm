use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::time::{Duration, sleep};

use super::SessionCommand;

const OUTPUT_FLUSH_INTERVAL_MS: u64 = 4;
const OUTPUT_NORMAL_BATCH_BYTES: usize = 64 * 1024;
const OUTPUT_FLOOD_BATCH_BYTES: usize = 128 * 1024;
const OUTPUT_PAUSE_HIGH_WATERMARK_BYTES: usize = 1024 * 1024;
const OUTPUT_RESUME_LOW_WATERMARK_BYTES: usize = 128 * 1024;
const OUTPUT_MAX_PENDING_BYTES: usize = 8 * 1024 * 1024;
const OUTPUT_CLOSE_FLUSH_MAX_BYTES: usize = 1024 * 1024;
const ALT_SCREEN_ENTER: &str = "\x1b[?1049h";
const ALT_SCREEN_EXIT: &str = "\x1b[?1049l";

type OutputSink = dyn Fn(TerminalOutputPayload) + Send + Sync + 'static;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputPayload {
    pub data: String,
    pub bytes: usize,
    pub dropped_bytes: usize,
}

#[derive(Default)]
struct OutputState {
    attached: bool,
    pending: VecDeque<String>,
    pending_bytes: usize,
    unacked_bytes: usize,
    dropped_bytes: usize,
    alt_screen_prefix: Option<&'static str>,
    next_flush_id: u64,
    scheduled_flush_id: Option<u64>,
    flow_paused: bool,
}

struct FlushResult {
    payload: Option<TerminalOutputPayload>,
    flow_change: Option<bool>,
    reschedule: bool,
}

/// Shared session-output coalescer used by all terminal backends.
///
/// It batches output before emitting it to the webview, tracks bytes emitted
/// but not yet acknowledged by xterm, and pauses the terminal source while the
/// renderer/IPC backlog is too high.
pub struct SessionOutputCoalescer {
    sink: Arc<OutputSink>,
    flow_control_tx: Option<mpsc::UnboundedSender<SessionCommand>>,
    state: Mutex<OutputState>,
}

impl SessionOutputCoalescer {
    pub fn for_app(
        app: AppHandle,
        output_event: String,
        flow_control_tx: mpsc::UnboundedSender<SessionCommand>,
    ) -> Arc<Self> {
        Self::with_flow_sink(flow_control_tx, move |payload| {
            let _ = app.emit(&output_event, &payload);
        })
    }

    #[cfg(test)]
    pub fn with_sink<F>(sink: F) -> Arc<Self>
    where
        F: Fn(TerminalOutputPayload) + Send + Sync + 'static,
    {
        Arc::new(Self {
            sink: Arc::new(sink),
            flow_control_tx: None,
            state: Mutex::new(OutputState::default()),
        })
    }

    pub fn with_flow_sink<F>(
        flow_control_tx: mpsc::UnboundedSender<SessionCommand>,
        sink: F,
    ) -> Arc<Self>
    where
        F: Fn(TerminalOutputPayload) + Send + Sync + 'static,
    {
        Arc::new(Self {
            sink: Arc::new(sink),
            flow_control_tx: Some(flow_control_tx),
            state: Mutex::new(OutputState::default()),
        })
    }

    pub fn push(self: &Arc<Self>, text: impl AsRef<str>) {
        self.push_owned(text.as_ref().to_string());
    }

    pub fn push_owned(self: &Arc<Self>, text: String) {
        if text.is_empty() {
            return;
        }

        let mut schedule_timer = None;
        let mut flush_now = false;
        let flow_change = {
            let mut state = self.state.lock().unwrap();
            let was_empty = state.pending.is_empty();
            state.pending_bytes = state.pending_bytes.saturating_add(text.len());
            state.pending.push_back(text);
            trim_pending(&mut state);

            let flow_change = update_flow_state(&mut state);
            if state.attached && state.pending_bytes >= batch_limit(&state) {
                state.next_flush_id = state.next_flush_id.wrapping_add(1);
                state.scheduled_flush_id = None;
                flush_now = true;
            } else if state.attached && was_empty && state.scheduled_flush_id.is_none() {
                state.next_flush_id = state.next_flush_id.wrapping_add(1);
                let flush_id = state.next_flush_id;
                state.scheduled_flush_id = Some(flush_id);
                schedule_timer = Some(flush_id);
            }
            flow_change
        };

        self.send_flow_change(flow_change);

        if let Some(flush_id) = schedule_timer {
            self.schedule_flush(flush_id);
        }

        if flush_now {
            self.flush_pending();
        }
    }

    pub fn ack(self: &Arc<Self>, bytes: usize) {
        if bytes == 0 {
            return;
        }

        let (flow_change, schedule_timer) = {
            let mut state = self.state.lock().unwrap();
            state.unacked_bytes = state.unacked_bytes.saturating_sub(bytes);
            let flow_change = update_flow_state(&mut state);
            let schedule_timer = if state.attached
                && !state.pending.is_empty()
                && state.scheduled_flush_id.is_none()
            {
                state.next_flush_id = state.next_flush_id.wrapping_add(1);
                let flush_id = state.next_flush_id;
                state.scheduled_flush_id = Some(flush_id);
                Some(flush_id)
            } else {
                None
            };
            (flow_change, schedule_timer)
        };

        self.send_flow_change(flow_change);
        if let Some(flush_id) = schedule_timer {
            self.schedule_flush(flush_id);
        }
    }

    pub fn attach(self: &Arc<Self>) {
        let result = {
            let mut state = self.state.lock().unwrap();
            state.attached = true;
            state.unacked_bytes = 0;
            state.next_flush_id = state.next_flush_id.wrapping_add(1);
            state.scheduled_flush_id = None;
            flush_from_state(&mut state)
        };

        self.apply_flush_result(result);
    }

    pub fn detach(self: &Arc<Self>) {
        let flow_change = {
            let mut state = self.state.lock().unwrap();
            state.attached = false;
            state.unacked_bytes = 0;
            state.next_flush_id = state.next_flush_id.wrapping_add(1);
            state.scheduled_flush_id = None;
            update_flow_state(&mut state)
        };

        self.send_flow_change(flow_change);
    }

    pub fn close(self: &Arc<Self>) {
        let result = {
            let mut state = self.state.lock().unwrap();
            state.next_flush_id = state.next_flush_id.wrapping_add(1);
            state.scheduled_flush_id = None;
            flush_all_from_state(&mut state)
        };

        self.apply_flush_result(result);
    }

    fn schedule_flush(self: &Arc<Self>, flush_id: u64) {
        let output = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            sleep(Duration::from_millis(OUTPUT_FLUSH_INTERVAL_MS)).await;
            output.flush_if_scheduled(flush_id);
        });
    }

    fn flush_if_scheduled(self: &Arc<Self>, flush_id: u64) {
        let result = {
            let mut state = self.state.lock().unwrap();
            if state.scheduled_flush_id != Some(flush_id) {
                return;
            }

            state.scheduled_flush_id = None;
            if !state.attached {
                return;
            }

            flush_from_state(&mut state)
        };

        self.apply_flush_result(result);
    }

    fn flush_pending(self: &Arc<Self>) {
        let result = {
            let mut state = self.state.lock().unwrap();
            if !state.attached {
                return;
            }

            state.next_flush_id = state.next_flush_id.wrapping_add(1);
            state.scheduled_flush_id = None;
            flush_from_state(&mut state)
        };

        self.apply_flush_result(result);
    }

    fn apply_flush_result(self: &Arc<Self>, result: FlushResult) {
        if let Some(payload) = result.payload {
            (self.sink)(payload);
        }
        self.send_flow_change(result.flow_change);
        if result.reschedule {
            let flush_id = {
                let mut state = self.state.lock().unwrap();
                if !state.attached || state.pending.is_empty() || state.scheduled_flush_id.is_some()
                {
                    None
                } else {
                    state.next_flush_id = state.next_flush_id.wrapping_add(1);
                    let flush_id = state.next_flush_id;
                    state.scheduled_flush_id = Some(flush_id);
                    Some(flush_id)
                }
            };
            if let Some(flush_id) = flush_id {
                self.schedule_flush(flush_id);
            }
        }
    }

    fn send_flow_change(&self, flow_change: Option<bool>) {
        let Some(paused) = flow_change else {
            return;
        };
        let Some(tx) = &self.flow_control_tx else {
            return;
        };
        let command = if paused {
            SessionCommand::PauseOutput
        } else {
            SessionCommand::ResumeOutput
        };
        let _ = tx.send(command);
    }
}

fn flush_from_state(state: &mut OutputState) -> FlushResult {
    let payload = take_pending_batch(state);
    let flow_change = update_flow_state(state);
    FlushResult {
        payload,
        flow_change,
        reschedule: state.attached && !state.pending.is_empty(),
    }
}

fn flush_all_from_state(state: &mut OutputState) -> FlushResult {
    trim_pending_to_max(state, OUTPUT_CLOSE_FLUSH_MAX_BYTES);
    let payload = take_all_pending(state);
    let flow_change = update_flow_state(state);
    FlushResult {
        payload,
        flow_change,
        reschedule: false,
    }
}

fn take_pending_batch(state: &mut OutputState) -> Option<TerminalOutputPayload> {
    if state.pending.is_empty() && state.alt_screen_prefix.is_none() {
        return None;
    }

    let mut remaining = batch_limit(state);
    let mut data = String::new();
    if let Some(prefix) = state.alt_screen_prefix.take() {
        data.push_str(prefix);
    }

    while remaining > 0 {
        let Some(front) = state.pending.pop_front() else {
            break;
        };

        if front.len() <= remaining {
            remaining -= front.len();
            state.pending_bytes = state.pending_bytes.saturating_sub(front.len());
            data.push_str(&front);
            continue;
        }

        let split_at = byte_boundary_at_or_before(&front, remaining);
        let (head, tail) = front.split_at(split_at);
        data.push_str(head);
        state.pending.push_front(tail.to_string());
        state.pending_bytes = state.pending_bytes.saturating_sub(head.len());
        break;
    }

    if data.is_empty() {
        return None;
    }

    Some(payload_from_data(state, data))
}

fn take_all_pending(state: &mut OutputState) -> Option<TerminalOutputPayload> {
    if state.pending.is_empty() && state.alt_screen_prefix.is_none() {
        return None;
    }

    let mut data = String::new();
    if let Some(prefix) = state.alt_screen_prefix.take() {
        data.push_str(prefix);
    }
    while let Some(chunk) = state.pending.pop_front() {
        state.pending_bytes = state.pending_bytes.saturating_sub(chunk.len());
        data.push_str(&chunk);
    }

    if data.is_empty() {
        None
    } else {
        Some(payload_from_data(state, data))
    }
}

fn payload_from_data(state: &mut OutputState, data: String) -> TerminalOutputPayload {
    let bytes = data.len();
    state.unacked_bytes = state.unacked_bytes.saturating_add(bytes);
    let dropped_bytes = std::mem::take(&mut state.dropped_bytes);
    TerminalOutputPayload {
        data,
        bytes,
        dropped_bytes,
    }
}

fn trim_pending(state: &mut OutputState) {
    trim_pending_to_max(state, OUTPUT_MAX_PENDING_BYTES);
}

fn trim_pending_to_max(state: &mut OutputState, max_bytes: usize) {
    if state.pending_bytes <= max_bytes {
        return;
    }

    let mut bytes_to_drop = state.pending_bytes - max_bytes;
    let mut dropped_text = String::new();
    while bytes_to_drop > 0 {
        let Some(front) = state.pending.pop_front() else {
            break;
        };

        if front.len() <= bytes_to_drop {
            bytes_to_drop -= front.len();
            state.pending_bytes = state.pending_bytes.saturating_sub(front.len());
            state.dropped_bytes = state.dropped_bytes.saturating_add(front.len());
            dropped_text.push_str(&front);
            continue;
        }

        let split_at = byte_boundary_at_or_before(&front, bytes_to_drop);
        let (dropped, kept) = front.split_at(split_at);
        state.pending.push_front(kept.to_string());
        state.pending_bytes = state.pending_bytes.saturating_sub(dropped.len());
        state.dropped_bytes = state.dropped_bytes.saturating_add(dropped.len());
        dropped_text.push_str(dropped);
        break;
    }

    if let Some(active) = last_alt_screen_state(&dropped_text) {
        state.alt_screen_prefix = Some(if active {
            ALT_SCREEN_ENTER
        } else {
            ALT_SCREEN_EXIT
        });
    }
}

fn update_flow_state(state: &mut OutputState) -> Option<bool> {
    let backlog = state.pending_bytes.saturating_add(state.unacked_bytes);
    if !state.flow_paused && backlog >= OUTPUT_PAUSE_HIGH_WATERMARK_BYTES {
        state.flow_paused = true;
        Some(true)
    } else if state.flow_paused && backlog <= OUTPUT_RESUME_LOW_WATERMARK_BYTES {
        state.flow_paused = false;
        Some(false)
    } else {
        None
    }
}

fn batch_limit(state: &OutputState) -> usize {
    let backlog = state.pending_bytes.saturating_add(state.unacked_bytes);
    if state.flow_paused || backlog >= OUTPUT_PAUSE_HIGH_WATERMARK_BYTES {
        OUTPUT_FLOOD_BATCH_BYTES
    } else {
        OUTPUT_NORMAL_BATCH_BYTES
    }
}

fn byte_boundary_at_or_before(text: &str, max_bytes: usize) -> usize {
    if max_bytes >= text.len() {
        return text.len();
    }
    let mut index = max_bytes;
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    if index == 0 {
        text.char_indices()
            .nth(1)
            .map(|(next, _)| next)
            .unwrap_or(text.len())
    } else {
        index
    }
}

fn last_alt_screen_state(text: &str) -> Option<bool> {
    let enter = text.rfind(ALT_SCREEN_ENTER);
    let exit = text.rfind(ALT_SCREEN_EXIT);
    match (enter, exit) {
        (Some(enter), Some(exit)) => Some(enter > exit),
        (Some(_), None) => Some(true),
        (None, Some(_)) => Some(false),
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ALT_SCREEN_ENTER, ALT_SCREEN_EXIT, OUTPUT_CLOSE_FLUSH_MAX_BYTES, OUTPUT_FLOOD_BATCH_BYTES,
        OUTPUT_MAX_PENDING_BYTES, OUTPUT_NORMAL_BATCH_BYTES, OUTPUT_PAUSE_HIGH_WATERMARK_BYTES,
        OUTPUT_RESUME_LOW_WATERMARK_BYTES, SessionOutputCoalescer, TerminalOutputPayload,
    };
    use crate::core::SessionCommand;
    use std::sync::{Arc, Mutex};
    use tokio::sync::mpsc;
    use tokio::time::{Duration, sleep};

    fn collect_sink() -> (
        Arc<Mutex<Vec<TerminalOutputPayload>>>,
        impl Fn(TerminalOutputPayload) + Send + Sync + 'static,
    ) {
        let emitted = Arc::new(Mutex::new(Vec::<TerminalOutputPayload>::new()));
        let sink = emitted.clone();
        (emitted, move |payload| {
            sink.lock().unwrap().push(payload);
        })
    }

    async fn wait_for_emitted_bytes(
        emitted: &Arc<Mutex<Vec<TerminalOutputPayload>>>,
        expected: usize,
    ) -> usize {
        for _ in 0..20 {
            let bytes: usize = emitted
                .lock()
                .unwrap()
                .iter()
                .map(|payload| payload.bytes)
                .sum();
            if bytes >= expected {
                return bytes;
            }
            sleep(Duration::from_millis(10)).await;
        }
        emitted
            .lock()
            .unwrap()
            .iter()
            .map(|payload| payload.bytes)
            .sum()
    }

    #[tokio::test]
    async fn timer_flush_batches_pending_output() {
        let (emitted, sink) = collect_sink();
        let output = SessionOutputCoalescer::with_sink(sink);

        output.attach();
        output.push("hello");
        output.push(" world");

        sleep(Duration::from_millis(20)).await;

        let emitted = emitted.lock().unwrap();
        assert_eq!(emitted.len(), 1);
        assert_eq!(emitted[0].data, "hello world");
        assert_eq!(emitted[0].bytes, "hello world".len());
    }

    #[tokio::test]
    async fn size_threshold_flushes_immediately() {
        let (emitted, sink) = collect_sink();
        let output = SessionOutputCoalescer::with_sink(sink);

        output.attach();
        output.push_owned("x".repeat(OUTPUT_NORMAL_BATCH_BYTES));

        let emitted = emitted.lock().unwrap();
        assert_eq!(emitted.len(), 1);
        assert_eq!(emitted[0].bytes, OUTPUT_NORMAL_BATCH_BYTES);
    }

    #[tokio::test]
    async fn emitted_bytes_are_unacked_until_ack() {
        let (emitted, sink) = collect_sink();
        let output = SessionOutputCoalescer::with_sink(sink);

        output.attach();
        output.push_owned("x".repeat(OUTPUT_NORMAL_BATCH_BYTES));
        assert_eq!(emitted.lock().unwrap()[0].bytes, OUTPUT_NORMAL_BATCH_BYTES);

        output.ack(OUTPUT_NORMAL_BATCH_BYTES / 2);
        output.ack(OUTPUT_NORMAL_BATCH_BYTES / 2);

        output.push("ok");
        sleep(Duration::from_millis(20)).await;
        assert_eq!(emitted.lock().unwrap()[1].data, "ok");
    }

    #[tokio::test]
    async fn high_and_low_watermarks_pause_and_resume_once() {
        let (emitted, sink) = collect_sink();
        let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<SessionCommand>();
        let output = SessionOutputCoalescer::with_flow_sink(cmd_tx, sink);

        output.attach();
        output.push_owned("x".repeat(OUTPUT_PAUSE_HIGH_WATERMARK_BYTES));
        assert!(matches!(
            cmd_rx.recv().await,
            Some(SessionCommand::PauseOutput)
        ));
        assert!(cmd_rx.try_recv().is_err());

        let emitted_bytes =
            wait_for_emitted_bytes(&emitted, OUTPUT_PAUSE_HIGH_WATERMARK_BYTES).await;
        assert_eq!(emitted_bytes, OUTPUT_PAUSE_HIGH_WATERMARK_BYTES);
        output.ack(emitted_bytes - OUTPUT_RESUME_LOW_WATERMARK_BYTES);
        assert!(cmd_rx.try_recv().is_err());

        output.ack(OUTPUT_RESUME_LOW_WATERMARK_BYTES);
        assert!(matches!(
            cmd_rx.recv().await,
            Some(SessionCommand::ResumeOutput)
        ));
    }

    #[tokio::test]
    async fn pending_output_has_hard_cap_and_reports_dropped_bytes() {
        let (emitted, sink) = collect_sink();
        let output = SessionOutputCoalescer::with_sink(sink);

        output.push_owned("a".repeat(OUTPUT_MAX_PENDING_BYTES + 16));
        output.attach();

        let emitted = emitted.lock().unwrap();
        assert_eq!(emitted[0].dropped_bytes, 16);
        assert_eq!(emitted[0].data.len(), OUTPUT_FLOOD_BATCH_BYTES);
    }

    #[tokio::test]
    async fn dropped_alternate_screen_state_is_preserved() {
        let (emitted, sink) = collect_sink();
        let output = SessionOutputCoalescer::with_sink(sink);
        let prefix = format!("before{ALT_SCREEN_ENTER}");
        let payload = format!("{}{}", prefix, "x".repeat(OUTPUT_MAX_PENDING_BYTES + 16));

        output.push_owned(payload);
        output.attach();

        let emitted = emitted.lock().unwrap();
        assert!(emitted[0].data.starts_with(ALT_SCREEN_ENTER));
        assert!(emitted[0].dropped_bytes > 0);
    }

    #[tokio::test]
    async fn dropped_alternate_screen_exit_is_preserved() {
        let (emitted, sink) = collect_sink();
        let output = SessionOutputCoalescer::with_sink(sink);
        let prefix = format!("before{ALT_SCREEN_EXIT}");
        let payload = format!("{}{}", prefix, "x".repeat(OUTPUT_MAX_PENDING_BYTES + 16));

        output.push_owned(payload);
        output.attach();

        let emitted = emitted.lock().unwrap();
        assert!(emitted[0].data.starts_with(ALT_SCREEN_EXIT));
    }

    #[tokio::test]
    async fn attach_clears_stale_unacked_bytes() {
        let (emitted, sink) = collect_sink();
        let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<SessionCommand>();
        let output = SessionOutputCoalescer::with_flow_sink(cmd_tx, sink);

        output.attach();
        output.push_owned("x".repeat(OUTPUT_PAUSE_HIGH_WATERMARK_BYTES));
        assert!(matches!(
            cmd_rx.recv().await,
            Some(SessionCommand::PauseOutput)
        ));
        let emitted_bytes =
            wait_for_emitted_bytes(&emitted, OUTPUT_PAUSE_HIGH_WATERMARK_BYTES).await;
        assert_eq!(emitted_bytes, OUTPUT_PAUSE_HIGH_WATERMARK_BYTES);

        output.attach();
        assert!(matches!(
            cmd_rx.recv().await,
            Some(SessionCommand::ResumeOutput)
        ));

        output.push("after");
        sleep(Duration::from_millis(20)).await;
        assert!(
            emitted
                .lock()
                .unwrap()
                .iter()
                .any(|payload| payload.data.contains("after"))
        );
    }

    #[tokio::test]
    async fn detach_stops_emitting_until_attach() {
        let (emitted, sink) = collect_sink();
        let output = SessionOutputCoalescer::with_sink(sink);

        output.attach();
        output.push("visible");
        sleep(Duration::from_millis(20)).await;
        assert_eq!(emitted.lock().unwrap().len(), 1);

        output.detach();
        output.push("hidden");
        sleep(Duration::from_millis(20)).await;
        assert_eq!(emitted.lock().unwrap().len(), 1);

        output.attach();
        sleep(Duration::from_millis(20)).await;
        let emitted = emitted.lock().unwrap();
        assert!(
            emitted
                .iter()
                .any(|payload| payload.data.contains("hidden"))
        );
    }

    #[tokio::test]
    async fn close_flushes_remaining_output() {
        let (emitted, sink) = collect_sink();
        let output = SessionOutputCoalescer::with_sink(sink);

        output.attach();
        output.push("pending");
        output.close();

        assert!(
            emitted
                .lock()
                .unwrap()
                .iter()
                .any(|payload| payload.data == "pending")
        );
    }

    #[tokio::test]
    async fn close_flushes_only_recent_pending_output() {
        let (emitted, sink) = collect_sink();
        let output = SessionOutputCoalescer::with_sink(sink);

        output.push_owned("a".repeat(OUTPUT_CLOSE_FLUSH_MAX_BYTES + 16));
        output.close();

        let emitted = emitted.lock().unwrap();
        assert_eq!(emitted.len(), 1);
        assert_eq!(emitted[0].bytes, OUTPUT_CLOSE_FLUSH_MAX_BYTES);
        assert_eq!(emitted[0].dropped_bytes, 16);
        assert!(emitted[0].data.chars().all(|ch| ch == 'a'));
    }
}
