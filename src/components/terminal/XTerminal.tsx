import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { type ILinkHandler, Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApp } from "@/context/AppContext";
import { useTheme } from "@/context/ThemeContext";
import { useActionLinks } from "@/hooks/useActionLinks";
import { useCommandHistory } from "@/hooks/useCommandHistory";
import { useKeywordHighlighter } from "@/hooks/useKeywordHighlighter";
import { useShellIntegration } from "@/hooks/useShellIntegration";
import { useTerminalSearch } from "@/hooks/useTerminalSearch";
import { useTerminalSettings } from "@/hooks/useTerminalSettings";
import { readClipboardText } from "@/lib/clipboard";
import { invoke } from "@/lib/invoke";
import { hexLuminance } from "@/lib/keywordHighlightPresets";
import { logger } from "@/lib/logger";
import {
  listenSessionInputPreview,
  type SessionInputPreview,
  sendSessionInput,
} from "@/lib/sessionInput";
import {
  applyTerminalInputData,
  applyTerminalInputPreview,
  canSuggestFromTracker,
  createTerminalInputState,
  getTrackedCommand,
} from "@/lib/terminalInputTracker";
import { XTERM_PERFORMANCE_CONFIG } from "@/lib/xtermPerformance";
import ActionLinkMenu from "./ActionLinkMenu";
import ActionLinkTooltip from "./ActionLinkTooltip";
import CommandSuggestions from "./CommandSuggestions";
import TerminalContextMenu from "./TerminalContextMenu";
import TerminalGutter from "./TerminalGutter";
import TerminalSearchBar from "./TerminalSearchBar";
import "@xterm/xterm/css/xterm.css";

interface XTerminalProps {
  sessionId: string;
  active: boolean;
  visible?: boolean;
  connectionId?: string;
  onReconnected?: (oldSessionId: string, newSessionId: string) => void;
}

type PerformanceMode = "normal" | "overloaded";
type PerformanceOverlayState = "overloaded" | "recovered" | null;

/**
 * xterm.js terminal for a session. Handles OSC 133 shell integration (or fallback prompt
 * detection), fuzzy command history suggestions, and resize/fit. Key props: sessionId, active.
 */
export default function XTerminal({
  sessionId,
  active,
  visible = true,
  connectionId,
  onReconnected,
}: XTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);
  const [performanceMode, setPerformanceMode] = useState<PerformanceMode>("normal");
  const [performanceOverlay, setPerformanceOverlay] = useState<PerformanceOverlayState>(null);
  const [skippedOutputChars, setSkippedOutputChars] = useState(0);

  const { terminalTheme } = useTheme();
  const { t } = useTranslation();
  const { appSettings } = useApp();
  const showLineNumbers = appSettings.terminal.show_line_numbers;
  const showTimestamps = appSettings.terminal.show_timestamps;
  const showGutter = showLineNumbers || showTimestamps;
  const commandSuggestionsEnabled = appSettings.interaction.command_suggestions_enabled;

  const inputStateRef = useRef(createTerminalInputState());
  const appSettingsRef = useRef(appSettings);
  const tRef = useRef(t);
  const doFindRef = useRef<(selection?: string) => void>(() => {});
  const sendInputRef = useRef<((data: string) => void) | null>(null);
  const disconnectedRef = useRef(false);
  const reconnectingRef = useRef(false);
  const outputWriteQueueRef = useRef(Promise.resolve());
  const outputWriteInFlightRef = useRef(false);
  const lineTimestampsRef = useRef<Map<number, number>>(new Map());
  const connectionIdRef = useRef(connectionId);
  const onReconnectedRef = useRef(onReconnected);
  const sessionIdRef = useRef(sessionId);
  const visibleRef = useRef(visible);
  const performanceModeRef = useRef<PerformanceMode>("normal");
  const performanceOverlayTimerRef = useRef<number | null>(null);
  const skippedOutputCharsRef = useRef(0);
  const queuedOutputChunksRef = useRef<string[]>([]);
  const queuedOutputCharsRef = useRef(0);
  const pendingOutputFlushRef = useRef<number | null>(null);
  const handleVisibilityChangeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    connectionIdRef.current = connectionId;
  }, [connectionId]);

  useEffect(() => {
    onReconnectedRef.current = onReconnected;
  }, [onReconnected]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    visibleRef.current = visible;
    handleVisibilityChangeRef.current?.();
  }, [visible]);

  useEffect(() => {
    appSettingsRef.current = appSettings;
  }, [appSettings]);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const clearPerformanceOverlayTimer = useCallback(() => {
    if (performanceOverlayTimerRef.current !== null) {
      window.clearTimeout(performanceOverlayTimerRef.current);
      performanceOverlayTimerRef.current = null;
    }
  }, []);

  const enterOverloadedMode = useCallback(() => {
    clearPerformanceOverlayTimer();
    performanceModeRef.current = "overloaded";
    setPerformanceMode("overloaded");
    setPerformanceOverlay("overloaded");
  }, [clearPerformanceOverlayTimer]);

  const exitOverloadedMode = useCallback(() => {
    clearPerformanceOverlayTimer();
    performanceModeRef.current = "normal";
    setPerformanceMode("normal");
    setPerformanceOverlay("recovered");
    performanceOverlayTimerRef.current = window.setTimeout(() => {
      setPerformanceOverlay((current) => (current === "recovered" ? null : current));
      performanceOverlayTimerRef.current = null;
    }, XTERM_PERFORMANCE_CONFIG.output.recoveryNoticeMs);
  }, [clearPerformanceOverlayTimer]);

  const formatSkippedCount = useCallback(
    (value: number) => new Intl.NumberFormat().format(value),
    [],
  );

  // Search Addon state and handlers
  const {
    searchAddonRef,
    showSearchBar,
    setShowSearchBar,
    searchQuery,
    setSearchQuery,
    handleSearchNext,
    handleSearchPrev,
    handleCloseSearch,
  } = useTerminalSearch(terminalRef);

  // Shell integration state
  const { shellIntegrationRef } = useShellIntegration();

  const applySuggestion = useCallback(
    (command: string, execute: boolean) => {
      const trackedState = inputStateRef.current;
      const replaceCurrentLine = trackedState.lineRewriteRequired;
      const input = replaceCurrentLine
        ? `\u0005\u0015${command}`
        : `${"\x7f".repeat(trackedState.value.length)}${command}`;
      void sendSessionInput(sessionId, execute ? `${input}\r` : input, {
        preview: execute
          ? { kind: "replace-and-execute", value: command }
          : { kind: "replace", value: command },
        registerSubmission: execute ? command : null,
      }).catch(() => {});
    },
    [sessionId],
  );

  // Command history & fuzzy search UI
  const {
    suggestions,
    selectedIndex,
    setSelectedIndex,
    showSuggestions,
    cursorPosition,
    suggestionsRef,
    selectedIndexRef,
    showSuggestionsRef,
    searchTimerRef,
    triggerSearch,
    dismissSuggestions,
    handleSelectSuggestion,
  } = useCommandHistory(terminalRef, inputStateRef, applySuggestion, commandSuggestionsEnabled);

  // Create and setup terminal
  useEffect(() => {
    if (!containerRef.current) return;
    setTerminalReady(false);
    lineTimestampsRef.current = new Map();
    queuedOutputChunksRef.current = [];
    queuedOutputCharsRef.current = 0;
    skippedOutputCharsRef.current = 0;
    outputWriteInFlightRef.current = false;
    outputWriteQueueRef.current = Promise.resolve();
    performanceModeRef.current = "normal";
    setPerformanceMode("normal");
    setPerformanceOverlay(null);
    setSkippedOutputChars(0);
    clearPerformanceOverlayTimer();
    let disposed = false;

    const terminal = new Terminal({
      scrollback: appSettings.terminal.scrollback_lines,
      cursorBlink: appSettings.appearance.cursor_blink,
      cursorStyle: appSettings.appearance.cursor_style as "block" | "underline" | "bar",
      fontSize: appSettings.appearance.font_size,
      fontFamily: appSettings.appearance.font_family,
      wordSeparator: appSettings.interaction.word_separators,
      theme: { ...terminalTheme.colors.terminal },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const isMacPlatform = () =>
      typeof navigator !== "undefined" &&
      /(Mac|iPhone|iPad|iPod)/i.test(`${navigator.platform} ${navigator.userAgent}`);
    const modifierLabel = isMacPlatform() ? "Cmd" : "Ctrl";
    const allowedLinkProtocols = new Set(["http:", "https:", "mailto:"]);
    const linkPopupDelayMs = 350;
    let linkPopup: HTMLDivElement | null = null;
    let linkPopupTimer: number | null = null;

    const clearLinkPopupTimer = () => {
      if (linkPopupTimer !== null) {
        window.clearTimeout(linkPopupTimer);
        linkPopupTimer = null;
      }
    };

    const destroyLinkPopup = () => {
      linkPopup?.remove();
      linkPopup = null;
    };

    const removeLinkPopup = () => {
      clearLinkPopupTimer();
      destroyLinkPopup();
    };

    const positionLinkPopup = (popup: HTMLDivElement, clientX: number, clientY: number) => {
      const terminalEl = terminal.element;
      if (!terminalEl) return;

      const hostRect = terminalEl.getBoundingClientRect();
      const margin = 8;
      const offset = 16;

      let left = clientX - hostRect.left + offset;
      let top = clientY - hostRect.top + offset;

      if (left + popup.offsetWidth + margin > terminalEl.clientWidth) {
        left = terminalEl.clientWidth - popup.offsetWidth - margin;
      }

      if (top + popup.offsetHeight + margin > terminalEl.clientHeight) {
        top = clientY - hostRect.top - popup.offsetHeight - offset;
      }

      popup.style.left = `${Math.max(margin, left)}px`;
      popup.style.top = `${Math.max(margin, top)}px`;
    };

    const showLinkPopup = (text: string, clientX: number, clientY: number) => {
      const terminalEl = terminal.element;
      if (!terminalEl) return;

      destroyLinkPopup();

      const popup = document.createElement("div");
      popup.className = "xterm-link-popup xterm-hover";

      const urlLine = document.createElement("div");
      urlLine.className = "xterm-link-popup__url";
      urlLine.textContent = text;
      popup.appendChild(urlLine);

      const hintLine = document.createElement("div");
      hintLine.className = "xterm-link-popup__hint";
      hintLine.textContent = tRef.current("terminal.linkOpenHint", { modifier: modifierLabel });
      popup.appendChild(hintLine);

      terminalEl.appendChild(popup);
      positionLinkPopup(popup, clientX, clientY);
      linkPopup = popup;
    };

    const scheduleLinkPopup = (event: MouseEvent, text: string) => {
      clearLinkPopupTimer();
      destroyLinkPopup();

      const { clientX, clientY } = event;
      linkPopupTimer = window.setTimeout(() => {
        showLinkPopup(text, clientX, clientY);
        linkPopupTimer = null;
      }, linkPopupDelayMs);
    };

    const hasRequiredModifier = (event: MouseEvent) =>
      isMacPlatform() ? event.metaKey : event.ctrlKey;

    const isAllowedLinkUri = (uri: string) => {
      try {
        return allowedLinkProtocols.has(new URL(uri).protocol);
      } catch {
        return false;
      }
    };

    const handleLinkActivation = (event: MouseEvent, uri: string) => {
      if (!hasRequiredModifier(event)) return;
      if (!isAllowedLinkUri(uri)) return;

      removeLinkPopup();
      openUrl(uri).catch((err: unknown) =>
        logger.error({
          domain: "ui.error",
          event: "terminal.link_open_failed",
          message: "Failed to open link",
          error: err,
        }),
      );
    };

    const oscLinkHandler: ILinkHandler = {
      activate: handleLinkActivation,
      hover: (event, text) => scheduleLinkPopup(event, text),
      leave: () => removeLinkPopup(),
      allowNonHttpProtocols: true,
    };

    const webLinksAddon = new WebLinksAddon(handleLinkActivation, {
      hover: (event, text) => scheduleLinkPopup(event, text),
      leave: () => removeLinkPopup(),
    });
    const searchAddon = new SearchAddon();

    terminal.options.linkHandler = oscLinkHandler;
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(searchAddon);
    terminal.open(containerRef.current);

    searchAddonRef.current = searchAddon;

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    inputStateRef.current = createTerminalInputState();
    const isTerminalAlive = () => !disposed && terminalRef.current === terminal;
    const syncSuggestionsWithInputState = () => {
      if (canSuggestFromTracker(inputStateRef.current)) {
        triggerSearch();
      } else {
        dismissSuggestions();
      }
    };

    const handleInputPreview = (preview: SessionInputPreview) => {
      inputStateRef.current = applyTerminalInputPreview(inputStateRef.current, preview);
      syncSuggestionsWithInputState();
    };

    sendInputRef.current = (data: string) => {
      void sendSessionInput(sessionId, data).catch(() => {});
    };
    const pasteText = (text: string) => {
      if (text) terminal.paste(text);
    };

    let lastSelection = "";

    terminal.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      if (ctrl && shift) {
        switch (e.code) {
          case "KeyC": {
            e.preventDefault();
            const sel = terminal.getSelection();
            if (sel) navigator.clipboard.writeText(sel).catch(() => {});
            return false;
          }
          case "KeyV":
            e.preventDefault();
            readClipboardText()
              .then((text) => {
                pasteText(text);
              })
              .catch(() => {});
            return false;
          case "KeyF":
            e.preventDefault();
            doFindRef.current();
            return false;
          case "KeyK":
            e.preventDefault();
            terminal.clear();
            return false;
          case "KeyX": {
            e.preventDefault();
            const sel = terminal.getSelection() || lastSelection;
            pasteText(sel);
            return false;
          }
          case "KeyA":
            e.preventDefault();
            terminal.selectAll();
            return false;
          case "KeyN":
          case "KeyW":
          case "KeyE":
          case "KeyB":
          case "KeyL":
          case "Tab":
            return false;
        }
      }

      if (ctrl && !shift) {
        switch (e.code) {
          case "Tab":
          case "Digit1":
          case "Digit2":
          case "Digit3":
          case "Digit4":
          case "Digit5":
          case "Digit6":
          case "Digit7":
          case "Digit8":
          case "Digit9":
          case "Digit0":
          case "Equal":
          case "Minus":
          case "Backquote":
          case "Comma":
            return false;
        }
      }
      return true;
    });

    const oscDisposable = terminal.parser.registerOscHandler(133, (data) => {
      const si = shellIntegrationRef.current;

      if (data.startsWith("A")) {
        si.enabled = true;
        return false;
      }

      if (data.startsWith("B")) {
        si.enabled = true;
        return false;
      }

      if (data.startsWith("C")) {
        si.enabled = true;
        inputStateRef.current = createTerminalInputState();
        dismissSuggestions();
        return false;
      }

      if (data.startsWith("D")) {
        si.enabled = true;
        return false;
      }

      return false;
    });

    const writeParsedDisposable = terminal.onWriteParsed(() => {
      const terminalSettings = appSettingsRef.current?.terminal;
      if (
        performanceModeRef.current !== "overloaded" &&
        (terminalSettings?.show_line_numbers || terminalSettings?.show_timestamps)
      ) {
        window.dispatchEvent(
          new CustomEvent("dragonfly:refresh-gutter", { detail: { sessionId } }),
        );
      }
    });

    let outputUnlisten: UnlistenFn | null = null;
    let closedUnlisten: UnlistenFn | null = null;
    let focusUnlisten: UnlistenFn | null = null;

    const refreshGutter = () => {
      if (!isTerminalAlive()) return;
      if (performanceModeRef.current === "overloaded") return;
      const terminalSettings = appSettingsRef.current?.terminal;
      if (!terminalSettings?.show_line_numbers && !terminalSettings?.show_timestamps) return;
      window.dispatchEvent(new CustomEvent("dragonfly:refresh-gutter", { detail: { sessionId } }));
    };

    const stampWrittenLines = (from: number, to: number, ts: number) => {
      if (!appSettingsRef.current?.terminal?.show_timestamps) return;

      const map = lineTimestampsRef.current;
      const start = Math.min(from, to);
      const end = Math.max(from, to);

      for (let y = start; y <= end; y += 1) {
        if (!map.has(y)) {
          map.set(y, ts);
        }
      }

      const keepFrom = Math.max(0, start - 3000);
      for (const key of Array.from(map.keys())) {
        if (key < keepFrom) {
          map.delete(key);
        }
      }

      if (performanceModeRef.current !== "overloaded") {
        refreshGutter();
      }
    };

    const getBacklogCap = () =>
      visibleRef.current
        ? XTERM_PERFORMANCE_CONFIG.output.visibleBacklogCap
        : XTERM_PERFORMANCE_CONFIG.output.hiddenBacklogCap;

    const getRecoveryThreshold = () =>
      visibleRef.current
        ? XTERM_PERFORMANCE_CONFIG.output.visibleRecoveryThreshold
        : XTERM_PERFORMANCE_CONFIG.output.hiddenRecoveryThreshold;

    const noteSkippedOutput = (count: number) => {
      if (count <= 0) return;
      skippedOutputCharsRef.current += count;
      setSkippedOutputChars(skippedOutputCharsRef.current);
      enterOverloadedMode();
    };

    const trimQueuedOutput = (maxChars: number) => {
      let dropped = 0;

      while (queuedOutputCharsRef.current > maxChars && queuedOutputChunksRef.current.length > 0) {
        const overflow = queuedOutputCharsRef.current - maxChars;
        const chunk = queuedOutputChunksRef.current[0];
        if (!chunk) break;

        if (chunk.length <= overflow) {
          queuedOutputChunksRef.current.shift();
          queuedOutputCharsRef.current -= chunk.length;
          dropped += chunk.length;
          continue;
        }

        queuedOutputChunksRef.current[0] = chunk.slice(overflow);
        queuedOutputCharsRef.current -= overflow;
        dropped += overflow;
      }

      return dropped;
    };

    const dequeueOutputChunk = (maxChars: number) => {
      if (maxChars <= 0 || queuedOutputChunksRef.current.length === 0) {
        return "";
      }

      let remaining = maxChars;
      const parts: string[] = [];

      while (remaining > 0 && queuedOutputChunksRef.current.length > 0) {
        const chunk = queuedOutputChunksRef.current[0];
        if (!chunk) break;

        if (chunk.length <= remaining) {
          parts.push(chunk);
          queuedOutputChunksRef.current.shift();
          queuedOutputCharsRef.current -= chunk.length;
          remaining -= chunk.length;
          continue;
        }

        parts.push(chunk.slice(0, remaining));
        queuedOutputChunksRef.current[0] = chunk.slice(remaining);
        queuedOutputCharsRef.current -= remaining;
        remaining = 0;
      }

      return parts.join("");
    };

    const maybeRecoverPerformanceMode = () => {
      if (!isTerminalAlive()) return;
      if (performanceModeRef.current !== "overloaded") return;
      if (queuedOutputCharsRef.current > getRecoveryThreshold()) return;
      exitOverloadedMode();
    };

    const writeChunkToTerminal = (payload: string) => {
      outputWriteInFlightRef.current = true;
      outputWriteQueueRef.current = outputWriteQueueRef.current
        .catch(() => {})
        .then(
          () =>
            new Promise<void>((resolve) => {
              if (!isTerminalAlive()) {
                outputWriteInFlightRef.current = false;
                resolve();
                return;
              }

              const ts = Date.now();
              const beforeLine = terminal.buffer.active.baseY + terminal.buffer.active.cursorY;

              try {
                terminal.write(payload, () => {
                  outputWriteInFlightRef.current = false;

                  if (!isTerminalAlive()) {
                    resolve();
                    return;
                  }

                  const afterLine = terminal.buffer.active.baseY + terminal.buffer.active.cursorY;

                  stampWrittenLines(beforeLine, afterLine, ts);

                  maybeRecoverPerformanceMode();
                  resolve();

                  if (
                    visibleRef.current &&
                    isTerminalAlive() &&
                    queuedOutputCharsRef.current > 0 &&
                    pendingOutputFlushRef.current === null
                  ) {
                    pendingOutputFlushRef.current = requestAnimationFrame(flushPendingOutput);
                  }
                });
              } catch {
                outputWriteInFlightRef.current = false;
                maybeRecoverPerformanceMode();
                resolve();
              }
            }),
        );
    };

    const flushPendingOutput = () => {
      pendingOutputFlushRef.current = null;
      if (!visibleRef.current || !isTerminalAlive() || outputWriteInFlightRef.current) {
        return;
      }

      const deadline = performance.now() + XTERM_PERFORMANCE_CONFIG.output.frameBudgetMs;
      let payload = "";
      while (!payload && performance.now() < deadline) {
        payload = dequeueOutputChunk(XTERM_PERFORMANCE_CONFIG.output.writeChunkChars);
        if (!payload) break;
      }

      if (!payload) {
        maybeRecoverPerformanceMode();
        return;
      }

      writeChunkToTerminal(payload);
    };

    const schedulePendingOutputFlush = () => {
      if (!visibleRef.current || !isTerminalAlive()) return;
      if (outputWriteInFlightRef.current || pendingOutputFlushRef.current !== null) return;
      pendingOutputFlushRef.current = requestAnimationFrame(flushPendingOutput);
    };

    const applyVisibilityPolicy = () => {
      if (!isTerminalAlive()) return;

      if (!visibleRef.current && pendingOutputFlushRef.current !== null) {
        cancelAnimationFrame(pendingOutputFlushRef.current);
        pendingOutputFlushRef.current = null;
      }

      const dropped = trimQueuedOutput(getBacklogCap());
      noteSkippedOutput(dropped);
      maybeRecoverPerformanceMode();

      if (visibleRef.current) {
        schedulePendingOutputFlush();
      }
    };

    handleVisibilityChangeRef.current = applyVisibilityPolicy;

    const setupListeners = async () => {
      const nextOutputUnlisten = await listen<string>(`terminal-output-${sessionId}`, (event) => {
        if (!isTerminalAlive()) return;
        queuedOutputChunksRef.current.push(event.payload);
        queuedOutputCharsRef.current += event.payload.length;

        const dropped = trimQueuedOutput(getBacklogCap());
        noteSkippedOutput(dropped);

        if (!visibleRef.current) {
          window.dispatchEvent(
            new CustomEvent("dragonfly:session-output", { detail: { sessionId } }),
          );
          return;
        }

        schedulePendingOutputFlush();
      });
      if (disposed) {
        nextOutputUnlisten();
        return;
      }
      outputUnlisten = nextOutputUnlisten;

      const nextClosedUnlisten = await listen<void>(`session-closed-${sessionId}`, () => {
        if (!isTerminalAlive()) return;
        disconnectedRef.current = true;
        terminal.write(`\r\n\x1b[31m[${tRef.current("terminal.sessionDisconnected")}]\x1b[0m\r\n`);
        if (connectionIdRef.current) {
          terminal.write(`\x1b[33m[${tRef.current("terminal.pressEnterToReconnect")}]\x1b[0m\r\n`);
        }
        inputStateRef.current = createTerminalInputState();
        dismissSuggestions();
      });
      if (disposed) {
        nextClosedUnlisten();
        return;
      }
      closedUnlisten = nextClosedUnlisten;

      const nextFocusUnlisten = await listen<void>(`focus-terminal-${sessionId}`, () => {
        if (!isTerminalAlive()) return;
        terminal.focus();
      });
      if (disposed) {
        nextFocusUnlisten();
        return;
      }
      focusUnlisten = nextFocusUnlisten;

      try {
        await invoke("attach_session", { sessionId });
      } catch {
        // The session may already be gone during mount/unmount races.
      }
    };
    void setupListeners();

    const removePreviewListener = listenSessionInputPreview(sessionId, handleInputPreview);

    const dataDisposable = terminal.onData((data) => {
      if (disconnectedRef.current) {
        if (data === "\r" && connectionIdRef.current && !reconnectingRef.current) {
          reconnectingRef.current = true;
          terminal.write(`\r\n\x1b[36m[${tRef.current("terminal.reconnecting")}]\x1b[0m\r\n`);
          invoke<string>("create_ssh_session", { connectionId: connectionIdRef.current })
            .then((newSessionId) => {
              disconnectedRef.current = false;
              reconnectingRef.current = false;
              onReconnectedRef.current?.(sessionIdRef.current, newSessionId);
            })
            .catch((err) => {
              reconnectingRef.current = false;
              terminal.write(
                `\r\n\x1b[31m[${tRef.current("terminal.reconnectFailed")}: ${err}]\x1b[0m\r\n`,
              );
              terminal.write(
                `\x1b[33m[${tRef.current("terminal.pressEnterToReconnect")}]\x1b[0m\r\n`,
              );
            });
        }
        return;
      }

      if (showSuggestionsRef.current && suggestionsRef.current.length > 0) {
        if (data === "\t" && selectedIndexRef.current >= 0) {
          const selected = suggestionsRef.current[selectedIndexRef.current];
          if (selected) {
            applySuggestion(selected.command, false);
            dismissSuggestions();
          }
          return;
        }

        if (data === "\x1b[A") {
          const cur = selectedIndexRef.current;
          const newIdx = cur === -1 ? suggestionsRef.current.length - 1 : cur === 0 ? -1 : cur - 1;
          selectedIndexRef.current = newIdx;
          setSelectedIndex(newIdx);
          return;
        }

        if (data === "\x1b[B") {
          const cur = selectedIndexRef.current;
          const newIdx = cur === -1 ? 0 : cur === suggestionsRef.current.length - 1 ? -1 : cur + 1;
          selectedIndexRef.current = newIdx;
          setSelectedIndex(newIdx);
          return;
        }

        if (data === "\x1b") {
          dismissSuggestions();
          return;
        }

        if (data === "\r" && selectedIndexRef.current >= 0) {
          const selected = suggestionsRef.current[selectedIndexRef.current];
          if (selected) {
            applySuggestion(selected.command, true);
            dismissSuggestions();
          }
          return;
        }
      }

      const command = data === "\r" ? getTrackedCommand(inputStateRef.current) : "";
      inputStateRef.current = applyTerminalInputData(inputStateRef.current, data);
      syncSuggestionsWithInputState();

      void sendSessionInput(sessionId, data, {
        preview: null,
        registerSubmission: data === "\r" && command ? command : null,
      }).catch(() => {});
    });

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      invoke("resize_session", { sessionId, cols, rows }).catch(() => {});
      refreshGutter();
    });

    const scrollDisposable = terminal.onScroll(() => {
      removeLinkPopup();
      refreshGutter();
    });

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || entry.contentRect.width === 0 || entry.contentRect.height === 0) return;
      requestAnimationFrame(() => {
        fitAddon.fit();
      });
    });
    observer.observe(containerRef.current);

    const selectionDisposable = terminal.onSelectionChange(() => {
      const text = terminal.getSelection();
      if (text) {
        lastSelection = text;
      }
      if (appSettingsRef.current?.interaction?.copy_on_select) {
        if (text) {
          navigator.clipboard.writeText(text).catch(() => {});
        }
      }
    });

    const handleMiddleMouseDown = (e: MouseEvent) => {
      removeLinkPopup();
      if (e.button === 1) e.preventDefault(); // Prevent auto-scroll mechanism
    };

    const handleMiddleClick = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const sel = terminal.getSelection();
      if (sel) {
        pasteText(sel);
      } else {
        readClipboardText()
          .then((text) => {
            pasteText(text);
          })
          .catch(() => {});
      }
    };

    containerRef.current.addEventListener("mousedown", handleMiddleMouseDown);
    containerRef.current.addEventListener("mouseup", handleMiddleClick);
    const containerEl = containerRef.current;

    requestAnimationFrame(() => {
      if (!isTerminalAlive()) return;
      fitAddon.fit();
      requestAnimationFrame(() => {
        if (!isTerminalAlive()) return;
        terminal.refresh(0, Math.max(0, terminal.rows - 1));
        setTerminalReady(true);
        refreshGutter();
      });
    });

    return () => {
      disposed = true;
      handleVisibilityChangeRef.current = null;
      setTerminalReady(false);
      containerEl.removeEventListener("mousedown", handleMiddleMouseDown);
      containerEl.removeEventListener("mouseup", handleMiddleClick);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      inputStateRef.current = createTerminalInputState();
      sendInputRef.current = null;

      oscDisposable.dispose();
      writeParsedDisposable.dispose();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      scrollDisposable.dispose();
      selectionDisposable.dispose();
      removeLinkPopup();
      removePreviewListener();

      observer.disconnect();
      if (outputUnlisten) outputUnlisten();
      if (closedUnlisten) closedUnlisten();
      if (focusUnlisten) focusUnlisten();
      if (pendingOutputFlushRef.current !== null) {
        cancelAnimationFrame(pendingOutputFlushRef.current);
        pendingOutputFlushRef.current = null;
      }
      clearPerformanceOverlayTimer();
      queuedOutputChunksRef.current = [];
      queuedOutputCharsRef.current = 0;
      skippedOutputCharsRef.current = 0;
      outputWriteInFlightRef.current = false;
      outputWriteQueueRef.current = Promise.resolve();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Appearance, theme, and interaction settings sync.
  // Declared AFTER the terminal creation effect so effects from these hooks
  // run after terminalRef.current is already set on initial mount.
  useTerminalSettings(terminalRef, fitAddonRef, terminalTheme, appSettings);

  // isDark is derived from the terminal theme background so built-in rule colors
  // switch automatically when the user changes themes.
  const isDark = hexLuminance(terminalTheme.colors.terminal.background) < 0.5;
  useKeywordHighlighter(
    terminalRef,
    appSettings,
    sessionId,
    isDark,
    performanceMode === "overloaded",
  );

  const { tooltipState, menuState, closeMenu } = useActionLinks(
    terminalRef,
    appSettings,
    sessionId,
    sendInputRef,
    performanceMode === "overloaded",
  );

  useEffect(() => {
    if (terminalReady && fitAddonRef.current && terminalRef.current) {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
        terminalRef.current?.refresh(0, Math.max(0, terminalRef.current.rows - 1));
        if (showGutter && performanceMode !== "overloaded") {
          window.dispatchEvent(
            new CustomEvent("dragonfly:refresh-gutter", { detail: { sessionId } }),
          );
        }
      });
    }
  }, [performanceMode, sessionId, showGutter, terminalReady]);

  // Re-fit and focus when tab becomes active
  useEffect(() => {
    if (active && visible && fitAddonRef.current && terminalRef.current) {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
        terminalRef.current?.refresh(0, Math.max(0, terminalRef.current.rows - 1));
        terminalRef.current?.focus();
      });
    }
  }, [active, visible]);

  useEffect(() => {
    const handleRefresh = () => {
      if (!visible || !fitAddonRef.current || !terminalRef.current) return;

      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
        terminalRef.current?.refresh(0, Math.max(0, terminalRef.current.rows - 1));
        if (active) {
          terminalRef.current?.focus();
        }
      });
    };

    window.addEventListener("dragonfly:refresh-terminals", handleRefresh);
    return () => {
      window.removeEventListener("dragonfly:refresh-terminals", handleRefresh);
    };
  }, [active, visible]);

  const doFind = useCallback(
    (selection?: string) => {
      if (selection) {
        setSearchQuery(selection);
        setTimeout(() => searchAddonRef.current?.findNext(selection), 50);
      }
      setShowSearchBar(true);
      terminalRef.current?.focus();
    },
    [setShowSearchBar, setSearchQuery, searchAddonRef],
  );

  useEffect(() => {
    doFindRef.current = doFind;
  }, [doFind]);

  return (
    <div className="h-full w-full relative flex" style={{ display: visible ? "flex" : "none" }}>
      {showGutter && terminalReady && (
        <TerminalGutter
          terminalRef={terminalRef}
          showLineNumbers={showLineNumbers}
          showTimestamps={showTimestamps}
          lineTimestamps={lineTimestampsRef.current}
          sessionId={sessionId}
          suspended={performanceMode === "overloaded"}
        />
      )}
      <div className="flex-1 min-w-0 h-full relative">
        <TerminalContextMenu terminalRef={terminalRef} onFind={doFind}>
          <div ref={containerRef} className="h-full w-full" />
        </TerminalContextMenu>

        {performanceOverlay && (
          <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex justify-end">
            <div
              className="max-w-sm rounded-md border px-3 py-2 text-xs shadow-lg"
              style={{
                borderColor: "var(--df-border)",
                backgroundColor: "var(--df-bg-panel)",
                color: "var(--df-text)",
              }}
            >
              <div className="font-medium">
                {performanceOverlay === "overloaded"
                  ? t("terminal.largeOutputProtectionActive")
                  : t("terminal.largeOutputProtectionRecovered")}
              </div>
              <div className="mt-1 leading-5" style={{ color: "var(--df-text-dimmed)" }}>
                {t(
                  performanceOverlay === "overloaded"
                    ? "terminal.largeOutputProtectionActiveDetail"
                    : "terminal.largeOutputProtectionRecoveredDetail",
                  { skipped: formatSkippedCount(skippedOutputChars) },
                )}
              </div>
            </div>
          </div>
        )}

        <TerminalSearchBar
          show={showSearchBar}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onNext={handleSearchNext}
          onPrev={handleSearchPrev}
          onClose={handleCloseSearch}
        />

        <CommandSuggestions
          suggestions={suggestions}
          visible={commandSuggestionsEnabled && showSuggestions}
          selectedIndex={selectedIndex}
          cursorPosition={cursorPosition}
          onSelect={handleSelectSuggestion}
          onDismiss={dismissSuggestions}
        />

        <ActionLinkTooltip state={tooltipState} />
        <ActionLinkMenu state={menuState} onClose={closeMenu} />
      </div>
    </div>
  );
}
