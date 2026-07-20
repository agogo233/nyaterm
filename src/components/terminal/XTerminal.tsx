import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import MultiLinePasteDialog from "@/components/dialog/terminal/MultiLinePasteDialog";
import ExternalFileDropOverlay from "@/components/ExternalFileDropOverlay";
import type { ResolvedLocalDropPathEntry } from "@/components/panel/file-explorer/model";
import { useTerminalAppSettings } from "@/context/AppContext";
import { useTheme } from "@/context/ThemeContext";
import { useTransfer } from "@/context/TransferContext";
import { useActionLinks } from "@/hooks/useActionLinks";
import { useCommandHistory } from "@/hooks/useCommandHistory";
import { useCredentialAutofill } from "@/hooks/useCredentialAutofill";
import { useKeywordHighlighter } from "@/hooks/useKeywordHighlighter";
import { useShellIntegration } from "@/hooks/useShellIntegration";
import { resolveShortcutKeys } from "@/hooks/useShortcutMap";
import { useTerminalFileDrop } from "@/hooks/useTerminalFileDrop";
import { useTerminalSearch } from "@/hooks/useTerminalSearch";
import { useTerminalSettings } from "@/hooks/useTerminalSettings";
import { emitAIErrorDetected } from "@/lib/aiEvents";
import { renderAiCommandEnd, renderAiCommandStart } from "@/lib/aiTerminalRenderer";
import { buildTerminalThemeColors, isTerminalTransparencyEnabled } from "@/lib/backgroundImage";
import {
  readClipboardPathPayload,
  readClipboardText,
  uploadClipboardImageToSsh,
  writeClipboardText,
} from "@/lib/clipboard";
import {
  commandStartsSuggestionSuppressingProgram,
  isPagerSearchOrCommandInput,
  isPagerSingleKeyInput,
} from "@/lib/commandSuggestionSuppression";
import { detectCredentialPromptKind } from "@/lib/credentialAutofill";
import { invoke } from "@/lib/invoke";
import { hexLuminance } from "@/lib/keywordHighlightPresets";
import { logger } from "@/lib/logger";
import { isMacOS } from "@/lib/platform";
import { openSendCommandPanel } from "@/lib/sendCommandPanelEvents";
import {
  buildTerminalCommandInput,
  listenSessionInputPreview,
  normalizeTerminalCommandInput,
  type SendSessionInputOptions,
  type SessionInputPreview,
  sendSessionInput,
  sendSessionInputWithSync,
} from "@/lib/sessionInput";
import {
  isModifierOnlyKeyEvent,
  matchesKeyEvent,
  resolveIndexedKeys,
} from "@/lib/shortcutRegistry";
import { registerTerminalContextProvider } from "@/lib/terminalContext";
import { sendTerminalClearInput } from "@/lib/terminalControlInput";
import { getTerminalDropOverlayCopy, handleTerminalFileDrop } from "@/lib/terminalFileDrop";
import { resolveTerminalFontSize } from "@/lib/terminalFontSize";
import {
  applyTerminalInputData,
  applyTerminalInputPreview,
  canSuggestFromTracker,
  createTerminalInputState,
  deleteTerminalInputRange,
  getTrackedSubmissionCommand,
  resyncFromTerminalLine,
} from "@/lib/terminalInputTracker";
import {
  consumePreservedTerminalReconnectContent,
  registerTerminalReconnectCapture,
} from "@/lib/terminalReconnectHistory";
import { TERMINAL_SEARCH_VISIBLE_MATCH_LIMIT } from "@/lib/terminalSearch";
import { XTERM_PERFORMANCE_CONFIG } from "@/lib/xtermPerformance";
import type { AiCaptureEvent, SessionType } from "@/types/global";
import ActionLinkMenu from "./ActionLinkMenu";
import ActionLinkTooltip from "./ActionLinkTooltip";
import CommandSuggestions from "./CommandSuggestions";
import CredentialSuggestions from "./CredentialSuggestions";
import { installRemoteColorOscGuard } from "./remoteColorOscGuard";
import SyncActionOverlay from "./SyncActionOverlay";
import TerminalContextMenu from "./TerminalContextMenu";
import TerminalGutter from "./TerminalGutter";
import TerminalSearchBar from "./TerminalSearchBar";
import {
  getInputIndexAtBufferPosition,
  getMouseBufferPosition,
  getSelectedInputRange,
  hasErrorKeyword,
  type InputSelectionRange,
  isMultiLineText,
  isShiftInsertPasteEvent,
  readCurrentInputLine,
  readRecentOutput,
} from "./terminalInputSelection";
import { createTerminalLinkHandlers } from "./terminalLinkHandlers";
import type { PerformanceMode, XTerminalProps } from "./xterminalTypes";
import { createZmodemEventHandler, type ZmodemEventPayload } from "./zmodemTerminalEvents";
import "@xterm/xterm/css/xterm.css";

const BACKSPACE_INPUT = "\x7f";
const OSC52_MAX_DECODED_BYTES = 1024 * 1024;
const LEGACY_CTRL_KEYS = new Set([" ", "@", "[", "\\", "]", "^", "_", "?"]);

interface XTermInternalTrimSource {
  _core?: {
    _bufferService?: {
      buffers?: {
        normal?: {
          lines?: {
            onTrim?: (listener: (amount: number) => void) => {
              dispose: () => void;
            };
          };
        };
      };
    };
  };
}

function isWindowsPlatform() {
  return /win/i.test(navigator.platform || "");
}

function quotePastedPath(path: string) {
  if (isWindowsPlatform()) {
    return `"${path.replace(/"/g, '\\"')}"`;
  }
  return quotePosixPath(path);
}

function quotePosixPath(path: string) {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

function buildClipboardPathPasteText(
  payload: Awaited<ReturnType<typeof readClipboardPathPayload>>,
) {
  if (!payload) return null;
  if (payload.kind === "image_file") {
    return payload.path ? quotePastedPath(payload.path) : null;
  }

  const paths = payload.paths.map((path) => path.trim()).filter((path) => !!path);
  if (paths.length === 0) return null;
  return paths.map(quotePastedPath).join(" ");
}

function decodeOsc52ClipboardText(data: string): string | null {
  const separatorIndex = data.indexOf(";");
  if (separatorIndex === -1) return null;

  const payload = data.slice(separatorIndex + 1).replace(/\s/g, "");
  if (payload === "?") return null;

  let binary = "";
  try {
    binary = atob(payload);
  } catch {
    return null;
  }

  if (binary.length > OSC52_MAX_DECODED_BYTES) return null;

  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function getCtrlPrintableCsiuInput(e: KeyboardEvent): string | null {
  if (!e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return null;

  const codePoint = e.key.codePointAt(0);
  if (!codePoint || codePoint < 0x20 || codePoint > 0x7e) return null;

  if (/^[a-z]$/i.test(e.key) || /^[2-8]$/.test(e.key) || LEGACY_CTRL_KEYS.has(e.key)) {
    return null;
  }

  const modifier = 1 + 4 + (e.shiftKey ? 1 : 0);
  return `\x1b[${codePoint};${modifier}u`;
}

interface SessionCommandAcceptedEvent {
  sessionId: string;
  command: string;
}

interface TerminalOutputPayload {
  data: string;
  bytes: number;
  droppedBytes?: number;
}

interface QueuedOutputChunk {
  data: string;
  bytes: number;
}

function serializeTerminalText(terminal: Terminal): string {
  const buffer = terminal.buffer.active;
  const lastLine = Math.min(buffer.length - 1, buffer.baseY + buffer.cursorY);
  if (lastLine < 0) return "";

  const lines: string[] = [];
  for (let lineIndex = 0; lineIndex <= lastLine; lineIndex += 1) {
    const line = buffer.getLine(lineIndex);
    lines.push(line?.translateToString(true) ?? "");
  }

  return lines.join("\r\n");
}

function isLocalBackspaceEvent(event: KeyboardEvent, sessionType: SessionType): boolean {
  if (sessionType !== "Local" || event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }

  return event.key === "Backspace" || (event.key === "Delete" && event.code === "Backspace");
}

/**
 * xterm.js terminal for a session. Handles OSC 133 shell integration (or fallback prompt
 * detection), fuzzy command history suggestions, and resize/fit. Key props: sessionId, active.
 */
export default function XTerminal({
  sessionId,
  active,
  visible = true,
  sessionType,
  connectionId,
  onReconnected,
  onDisconnectedCloseRequested,
  onConnectionError,
  syncPeerSessionIds,
  syncOverlay,
}: XTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [terminalInstance, setTerminalInstance] = useState<Terminal | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);
  const [performanceMode, setPerformanceMode] = useState<PerformanceMode>("normal");
  const [multiLinePasteText, setMultiLinePasteText] = useState<string | null>(null);
  const [isExternalDropActive, setIsExternalDropActive] = useState(false);
  const aiCapturingRef = useRef(false);

  const { terminalTheme } = useTheme();
  const { t } = useTranslation();
  const { upsertExternalTransferProgress, completeExternalTransfer, failExternalTransfer } =
    useTransfer();
  const terminalAppSettings = useTerminalAppSettings();
  const { appearance, interaction, terminal: terminalSettings } = terminalAppSettings;
  const terminalThemeColors = useMemo(
    () => buildTerminalThemeColors(terminalTheme.colors.terminal, appearance),
    [appearance, terminalTheme.colors.terminal],
  );
  const terminalTransparencyEnabled = isTerminalTransparencyEnabled(appearance);
  const terminalLifecycleStateRef = useRef({
    sessionId,
    terminalTransparencyEnabled,
  });
  terminalLifecycleStateRef.current = {
    sessionId,
    terminalTransparencyEnabled,
  };
  const showLineNumbers = terminalSettings.show_line_numbers;
  const showTimestamps = terminalSettings.show_timestamps;
  const showTimestampMilliseconds = terminalSettings.show_timestamp_milliseconds ?? false;
  const showWorkspacePadding = terminalSettings.show_workspace_padding ?? false;
  const showGutter = showLineNumbers || showTimestamps;
  const showContentPadding = showWorkspacePadding && !showGutter;
  const commandSuggestionsEnabled = interaction.command_suggestions_enabled;
  const commandSuggestionMinChars = interaction.command_suggestion_min_chars;
  const commandSuggestionMaxChars = interaction.command_suggestion_max_chars;

  const inputStateRef = useRef(createTerminalInputState());
  const terminalAppSettingsRef = useRef(terminalAppSettings);
  const tRef = useRef(t);
  const doFindRef = useRef<(selection?: string) => void>(() => {});
  const pasteTextRef = useRef<(text: string, options?: { skipDialog?: boolean }) => void>(() => {});
  const disconnectedRef = useRef(false);
  const disconnectedNoticeShownRef = useRef(false);
  const disconnectedCloseRequestedRef = useRef(false);
  const reconnectingRef = useRef(false);
  const preservedReconnectContentRef = useRef<string | null>(null);
  const outputWriteQueueRef = useRef(Promise.resolve());
  const outputWriteInFlightRef = useRef(false);
  const lineTimestampsRef = useRef<Map<number, number>>(new Map());
  const gutterLineOffsetRef = useRef(0);
  const sessionTypeRef = useRef(sessionType);
  const connectionIdRef = useRef(connectionId);
  const onReconnectedRef = useRef(onReconnected);
  const onDisconnectedCloseRequestedRef = useRef(onDisconnectedCloseRequested);
  const onConnectionErrorRef = useRef(onConnectionError);
  const sessionIdRef = useRef(sessionId);
  const syncPeerSessionIdsRef = useRef(syncPeerSessionIds);
  const visibleRef = useRef(visible);
  const activeRef = useRef(active);
  const performanceModeRef = useRef<PerformanceMode>("normal");
  const queuedOutputChunksRef = useRef<QueuedOutputChunk[]>([]);
  const queuedOutputBytesRef = useRef(0);
  const writingOutputBytesRef = useRef(0);
  const backendUnackedOutputBytesRef = useRef(0);
  const pendingOutputAckBytesRef = useRef(0);
  const outputAckTimerRef = useRef<number | null>(null);
  const pendingOutputFlushRef = useRef<number | null>(null);
  const pendingOutputMicrotaskRef = useRef(false);
  const pendingOutputFlushTimerRef = useRef<number | null>(null);
  const lastAlternateScreenWriteAtRef = useRef(0);
  const handleVisibilityChangeRef = useRef<(() => void) | null>(null);
  const replaceInputCommandRef = useRef<((command: string) => void) | null>(null);
  const lastErrorNoticeAtRef = useRef(0);
  const credentialPromptBufferRef = useRef("");
  const credentialPromptInputUntilRef = useRef(0);
  const commandSuggestionSuppressedRef = useRef(false);

  const pasteClipboard = useCallback(async () => {
    const pasteImageAsPathEnabled =
      terminalAppSettingsRef.current?.terminal?.paste_image_as_path ?? true;
    const currentSessionType = sessionTypeRef.current;

    if (pasteImageAsPathEnabled && currentSessionType === "Local") {
      try {
        const payload = await readClipboardPathPayload();
        const pathText = buildClipboardPathPasteText(payload);
        if (pathText) {
          pasteTextRef.current(pathText, { skipDialog: true });
          return;
        }
      } catch {
        /* fall back to text clipboard */
      }
    }

    if (pasteImageAsPathEnabled && currentSessionType === "SSH") {
      try {
        const payload = await uploadClipboardImageToSsh(sessionIdRef.current);
        if (payload?.remote_path) {
          const quotedRemotePath = quotePosixPath(payload.remote_path);
          await sendSessionInput(sessionIdRef.current, quotedRemotePath, {
            preview: { kind: "data", data: quotedRemotePath },
            registerSubmission: null,
          });
          return;
        }
      } catch {
        /* fall back to text clipboard */
      }
    }

    const text = await readClipboardText();
    pasteTextRef.current(text);
  }, []);

  const getGutterLineOffset = useCallback(() => gutterLineOffsetRef.current, []);

  useEffect(() => {
    sessionTypeRef.current = sessionType;
  }, [sessionType]);

  useEffect(() => {
    connectionIdRef.current = connectionId;
  }, [connectionId]);

  useEffect(() => {
    onReconnectedRef.current = onReconnected;
  }, [onReconnected]);

  useEffect(() => {
    onDisconnectedCloseRequestedRef.current = onDisconnectedCloseRequested;
  }, [onDisconnectedCloseRequested]);

  useEffect(() => {
    onConnectionErrorRef.current = onConnectionError;
  }, [onConnectionError]);

  useEffect(() => {
    syncPeerSessionIdsRef.current = syncPeerSessionIds;
  }, [syncPeerSessionIds]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    visibleRef.current = visible;
    handleVisibilityChangeRef.current?.();
  }, [visible]);

  useEffect(() => {
    terminalAppSettingsRef.current = terminalAppSettings;
  }, [terminalAppSettings]);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const enterOverloadedMode = useCallback(() => {
    performanceModeRef.current = "overloaded";
    setPerformanceMode("overloaded");
  }, []);

  const setOutputPressureMode = useCallback((mode: PerformanceMode) => {
    if (performanceModeRef.current === mode) return;
    performanceModeRef.current = mode;
    setPerformanceMode(mode);
  }, []);

  const exitOverloadedMode = useCallback((nextMode: PerformanceMode = "normal") => {
    performanceModeRef.current = nextMode;
    setPerformanceMode(nextMode);
  }, []);

  // Search Addon state and handlers
  const {
    registerSearchAddon,
    showSearchBar,
    setShowSearchBar,
    searchQuery,
    setSearchQuery,
    searchState,
    searchFlags,
    setSearchFlag,
    activeMode,
    setActiveMode,
    historyState,
    handleSearchNext,
    handleSearchPrev,
    handleCloseSearch,
  } = useTerminalSearch(terminalRef, {
    terminal: terminalInstance,
    sessionId,
    visible: visible && active,
    performanceMode: performanceMode === "strained" ? "busy" : performanceMode,
  });

  // Shell integration state
  const { shellIntegrationRef } = useShellIntegration();
  const canShowCommandSuggestions = useCallback(() => {
    if (credentialPromptInputUntilRef.current > Date.now()) {
      return false;
    }
    credentialPromptInputUntilRef.current = 0;

    const terminal = terminalRef.current;
    if (terminal?.buffer.active.type === "alternate") {
      return false;
    }

    const shellIntegration = shellIntegrationRef.current;
    if (shellIntegration.enabled && shellIntegration.commandRunning) {
      return false;
    }

    const inputState = inputStateRef.current;
    if (commandSuggestionSuppressedRef.current) {
      return false;
    }
    if (isPagerSearchOrCommandInput(inputState.value)) {
      return false;
    }

    return canSuggestFromTracker(inputState);
  }, [shellIntegrationRef]);

  const applySuggestion = useCallback(
    (command: string, execute: boolean) => {
      const trackedState = inputStateRef.current;
      const replaceCurrentLine = trackedState.lineRewriteRequired;
      const input = replaceCurrentLine
        ? `\u0005\u0015${command}`
        : `${"\x7f".repeat(trackedState.value.length)}${command}`;
      const data = buildTerminalCommandInput(input, execute);
      const options: SendSessionInputOptions = {
        preview: execute
          ? { kind: "replace-and-execute", value: command }
          : { kind: "replace", value: command },
        registerSubmission: execute ? command : null,
      };
      const peers = syncPeerSessionIdsRef.current ?? [];
      const sendInput =
        peers.length > 0
          ? sendSessionInputWithSync(sessionId, data, peers, options)
          : sendSessionInput(sessionId, data, options);
      void sendInput.catch(() => {});
      if (execute && commandStartsSuggestionSuppressingProgram(command)) {
        commandSuggestionSuppressedRef.current = true;
      }
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
    handleDeleteSuggestion,
  } = useCommandHistory(
    terminalRef,
    inputStateRef,
    applySuggestion,
    canShowCommandSuggestions,
    commandSuggestionsEnabled,
    commandSuggestionMinChars,
    commandSuggestionMaxChars,
  );

  const {
    panelState: credentialPanelState,
    selectedIndex: credentialSelectedIndex,
    setSelectedIndex: setCredentialSelectedIndex,
    cursorPosition: credentialCursorPosition,
    showPanelRef: credentialShowPanelRef,
    matchesRef: credentialMatchesRef,
    selectedIndexRef: credentialSelectedIndexRef,
    feedOutput: feedCredentialOutput,
    handleSelect: handleCredentialSelect,
    dismiss: dismissCredentialPanel,
    reset: resetCredentialAutofill,
  } = useCredentialAutofill(terminalRef, sessionIdRef, activeRef, visibleRef, performanceModeRef);

  // Create and setup terminal
  // biome-ignore lint/correctness/useExhaustiveDependencies: terminal lifecycle is intentionally scoped to session changes.
  useEffect(() => {
    if (!containerRef.current) return;
    setTerminalReady(false);
    lineTimestampsRef.current = new Map();
    gutterLineOffsetRef.current = 0;
    queuedOutputChunksRef.current = [];
    queuedOutputBytesRef.current = 0;
    writingOutputBytesRef.current = 0;
    backendUnackedOutputBytesRef.current = 0;
    pendingOutputAckBytesRef.current = 0;
    lastAlternateScreenWriteAtRef.current = 0;
    outputWriteInFlightRef.current = false;
    outputWriteQueueRef.current = Promise.resolve();
    pendingOutputMicrotaskRef.current = false;
    disconnectedRef.current = false;
    disconnectedNoticeShownRef.current = false;
    disconnectedCloseRequestedRef.current = false;
    reconnectingRef.current = false;
    performanceModeRef.current = "normal";
    resetCredentialAutofill();
    setPerformanceMode("normal");
    let disposed = false;

    const terminal = new Terminal({
      scrollback: terminalSettings.scrollback_lines,
      cursorBlink: appearance.cursor_blink,
      cursorStyle: appearance.cursor_style as "block" | "underline" | "bar",
      fontSize: resolveTerminalFontSize(appearance.font_size, terminalSettings.font_size_delta),
      fontFamily: appearance.font_family,
      fontWeight: appearance.font_weight,
      fontWeightBold: appearance.font_weight_bold,
      minimumContrastRatio: appearance.minimum_contrast_ratio,
      wordSeparator: interaction.word_separators,
      macOptionIsMeta: interaction.alt_as_meta,
      scrollOnEraseInDisplay: true,
      theme: { ...terminalThemeColors },
      allowTransparency: terminalTransparencyEnabled,
      allowProposedApi: true,
      vtExtensions: { kittyKeyboard: true },
    });

    const fitAddon = new FitAddon();
    const {
      oscLinkHandler,
      webLinksAddon,
      removePopup: removeLinkPopup,
    } = createTerminalLinkHandlers(terminal, tRef);
    const searchAddon = new SearchAddon({
      highlightLimit: TERMINAL_SEARCH_VISIBLE_MATCH_LIMIT,
    });
    const unicodeGraphemesAddon = new UnicodeGraphemesAddon();
    const zmodemHandler = createZmodemEventHandler(
      terminal,
      sessionId,
      () => tRef.current,
      () => terminalAppSettingsRef.current?.transfer.duplicate_strategy ?? "ask",
      {
        upsertProgress: upsertExternalTransferProgress,
        complete: completeExternalTransfer,
        fail: failExternalTransfer,
      },
    );

    terminal.options.linkHandler = oscLinkHandler;
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(unicodeGraphemesAddon);
    terminal.open(containerRef.current);

    const trimDisposable = (
      terminal as Terminal & XTermInternalTrimSource
    )._core?._bufferService?.buffers?.normal?.lines?.onTrim?.((amount) => {
      if (amount <= 0) return;
      gutterLineOffsetRef.current += amount;
    });

    registerSearchAddon(searchAddon);

    terminalRef.current = terminal;
    setTerminalInstance(terminal);
    fitAddonRef.current = fitAddon;
    inputStateRef.current = createTerminalInputState();
    credentialPromptBufferRef.current = "";
    credentialPromptInputUntilRef.current = 0;
    shellIntegrationRef.current.enabled = false;
    shellIntegrationRef.current.commandRunning = false;
    const preservedReconnectContent =
      preservedReconnectContentRef.current ?? consumePreservedTerminalReconnectContent(sessionId);
    preservedReconnectContentRef.current = null;
    if (preservedReconnectContent) {
      terminal.write(preservedReconnectContent);
    }
    const unregisterReconnectCapture = registerTerminalReconnectCapture(sessionId, () =>
      serializeTerminalText(terminal),
    );
    const isTerminalAlive = () => !disposed && terminalRef.current === terminal;
    const syncSuggestionsWithInputState = () => {
      if (canShowCommandSuggestions()) {
        triggerSearch();
      } else {
        dismissSuggestions();
      }
    };

    const sendRawInput = (data: string, command: string | null) => {
      const peers = syncPeerSessionIdsRef.current;
      if (peers && peers.length > 0) {
        return sendSessionInputWithSync(sessionId, data, peers, {
          preview: null,
          registerSubmission: command,
        }).catch(() => {});
      } else {
        return sendSessionInput(sessionId, data, {
          preview: null,
          registerSubmission: command,
        }).catch(() => {});
      }
    };

    const canReconnectDisconnectedSession = () =>
      sessionTypeRef.current === "Local" || !!connectionIdRef.current;

    const createReconnectedSession = () => {
      const connectionId = connectionIdRef.current;

      switch (sessionTypeRef.current) {
        case "Local":
          return invoke<string>("create_local_session", {
            connectionId: connectionId || null,
          });
        case "Telnet":
          return invoke<string>("create_telnet_session", { connectionId });
        case "Serial":
          return invoke<string>("create_serial_session", { connectionId });
        default:
          return invoke<string>("create_ssh_session", { connectionId });
      }
    };

    const buildReplaceInputData = (command: string) => {
      const trackedState = inputStateRef.current;
      if (
        trackedState.value.length === 0 &&
        !trackedState.lineRewriteRequired &&
        !trackedState.desynced &&
        !trackedState.multiline
      ) {
        return command;
      }
      return `\u0005\u0015${command}`;
    };

    const replaceInputCommand = (command: string) => {
      const input = buildReplaceInputData(command);
      void sendSessionInput(sessionId, normalizeTerminalCommandInput(input), {
        preview: { kind: "replace", value: command },
        registerSubmission: null,
      }).catch(() => {});
    };

    const executeInputCommand = async (command: string) => {
      const input = buildReplaceInputData(command);
      await sendSessionInput(sessionId, normalizeTerminalCommandInput(input), {
        preview: { kind: "replace-and-execute", value: command },
        registerSubmission: null,
      });
      inputStateRef.current = applyTerminalInputData(inputStateRef.current, "\r");
      syncSuggestionsWithInputState();
      await sendSessionInput(sessionId, "\r", {
        preview: null,
        registerSubmission: command,
      });
    };

    replaceInputCommandRef.current = replaceInputCommand;

    const unregisterTerminalContext = registerTerminalContextProvider(sessionId, {
      getRecentOutput: (lineLimit) => readRecentOutput(terminal, lineLimit),
      getSelectedText: () => terminal.getSelection(),
      getInputBuffer: () => inputStateRef.current.value,
      insertCommand: async (command) => {
        const input = buildReplaceInputData(command);
        await sendSessionInput(sessionId, normalizeTerminalCommandInput(input), {
          preview: { kind: "replace", value: command },
          registerSubmission: null,
        });
      },
      executeCommand: async (command) => {
        await executeInputCommand(command);
      },
      focus: () => terminal.focus(),
    });

    const handleInputPreview = (preview: SessionInputPreview) => {
      inputStateRef.current = applyTerminalInputPreview(inputStateRef.current, preview);
      syncSuggestionsWithInputState();
    };

    const isCredentialPromptInputMode = () => {
      if (credentialPromptInputUntilRef.current > Date.now()) {
        return true;
      }
      credentialPromptInputUntilRef.current = 0;
      return false;
    };

    const canUseSmartCursor = (state = inputStateRef.current) => {
      if (disconnectedRef.current || aiCapturingRef.current) return false;
      if (terminal.buffer.active.type === "alternate") return false;
      if (isCredentialPromptInputMode()) return false;

      const shellIntegration = shellIntegrationRef.current;
      if (shellIntegration.enabled && shellIntegration.commandRunning) return false;

      if (state.desynced || state.lineRewriteRequired || state.pasteMode || state.multiline) {
        return false;
      }

      return !syncPeerSessionIdsRef.current?.length;
    };

    const getSmartCursorSelectedInputRange = () => {
      const state = inputStateRef.current;
      if (!canUseSmartCursor(state)) return null;
      return getSelectedInputRange(terminal, state);
    };

    const isPlainTextInputData = (data: string) => {
      if (!data || data.startsWith("\x1b")) return false;
      return !/[\x00-\x1f\x7f]/u.test(data);
    };

    const pasteText = (text: string, options: { skipDialog?: boolean } = {}) => {
      if (!text) return;
      terminal.focus();
      const showMultiLinePasteDialog =
        terminalAppSettingsRef.current?.terminal?.show_multi_line_paste_dialog ?? true;
      if (
        !options.skipDialog &&
        showMultiLinePasteDialog &&
        sessionTypeRef.current !== "Serial" &&
        isMultiLineText(text)
      ) {
        setMultiLinePasteText(text);
        return;
      }

      const selectedInputRange = getSmartCursorSelectedInputRange();
      let pendingSelectionDelete: Promise<void> | null = null;
      if (selectedInputRange) {
        const currentCursor = inputStateRef.current.cursor;
        const moveToSelectionEnd = buildMoveInputCursorData(currentCursor, selectedInputRange.end);
        const deleteSelection = "\u007f".repeat(selectedInputRange.end - selectedInputRange.start);
        inputStateRef.current = deleteTerminalInputRange(
          inputStateRef.current,
          selectedInputRange.start,
          selectedInputRange.end,
        );
        terminal.clearSelection();
        syncSuggestionsWithInputState();
        if (moveToSelectionEnd || deleteSelection) {
          pendingSelectionDelete = sendRawInput(`${moveToSelectionEnd}${deleteSelection}`, null);
        }
      }

      const runPaste = () => {
        terminal.paste(text);
        terminal.focus();
        requestAnimationFrame(() => {
          if (!isTerminalAlive()) return;
          terminal.focus();
        });
      };
      if (pendingSelectionDelete) {
        pendingSelectionDelete.then(runPaste);
      } else {
        runPaste();
      }
    };
    pasteTextRef.current = pasteText;

    let lastSelection = "";
    let primaryMouseDown: { x: number; y: number } | null = null;

    const resetTerminalPointerState = (options: { clearSelection?: boolean } = {}) => {
      primaryMouseDown = null;
      if (options.clearSelection && isTerminalAlive()) {
        terminal.clearSelection();
      }
    };

    const buildMoveInputCursorData = (currentCursor: number, targetCursor: number) => {
      if (targetCursor === currentCursor) return "";
      return targetCursor > currentCursor
        ? "\x1b[C".repeat(targetCursor - currentCursor)
        : "\x1b[D".repeat(currentCursor - targetCursor);
    };

    const moveInputCursor = (targetCursor: number) => {
      const currentState = inputStateRef.current;
      if (!canUseSmartCursor(currentState)) return;
      const nextCursor = Math.max(0, Math.min(currentState.value.length, targetCursor));
      const input = buildMoveInputCursorData(currentState.cursor, nextCursor);
      if (!input) return;

      inputStateRef.current = { ...currentState, cursor: nextCursor };
      syncSuggestionsWithInputState();
      sendRawInput(input, null);
    };

    const collapseInputSelection = (
      selectedInputRange: InputSelectionRange,
      edge: "start" | "end",
    ) => {
      const currentState = inputStateRef.current;
      if (!canUseSmartCursor(currentState)) return;
      const targetCursor = edge === "start" ? selectedInputRange.start : selectedInputRange.end;
      const input = buildMoveInputCursorData(currentState.cursor, targetCursor);

      inputStateRef.current = { ...currentState, cursor: targetCursor };
      terminal.clearSelection();
      syncSuggestionsWithInputState();
      if (input) sendRawInput(input, null);
    };

    const deleteInputSelection = (selectedInputRange: InputSelectionRange) => {
      if (!canUseSmartCursor()) return;
      const currentCursor = inputStateRef.current.cursor;
      const moveToSelectionEnd = buildMoveInputCursorData(currentCursor, selectedInputRange.end);
      const deleteSelection = "\u007f".repeat(selectedInputRange.end - selectedInputRange.start);

      inputStateRef.current = deleteTerminalInputRange(
        inputStateRef.current,
        selectedInputRange.start,
        selectedInputRange.end,
      );
      terminal.clearSelection();
      syncSuggestionsWithInputState();
      sendRawInput(`${moveToSelectionEnd}${deleteSelection}`, null);
    };

    const replaceInputSelection = (selectedInputRange: InputSelectionRange, data: string) => {
      if (!canUseSmartCursor()) return;
      const currentCursor = inputStateRef.current.cursor;
      const moveToSelectionEnd = buildMoveInputCursorData(currentCursor, selectedInputRange.end);
      const deleteSelection = "\u007f".repeat(selectedInputRange.end - selectedInputRange.start);
      const stateAfterDelete = deleteTerminalInputRange(
        inputStateRef.current,
        selectedInputRange.start,
        selectedInputRange.end,
      );

      inputStateRef.current = applyTerminalInputData(stateAfterDelete, data);
      terminal.clearSelection();
      syncSuggestionsWithInputState();
      sendRawInput(`${moveToSelectionEnd}${deleteSelection}${data}`, null);
    };

    const getDirectInputDataFromKeyEvent = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return null;
      if (e.key === "Dead" || e.key === "Process" || e.key === "Unidentified") return null;
      if (Array.from(e.key).length !== 1) return null;
      if (/[\x00-\x1f\x7f]/u.test(e.key)) return null;
      return e.key;
    };

    const moveCredentialSelection = (direction: 1 | -1) => {
      if (!credentialShowPanelRef.current || credentialMatchesRef.current.length === 0) {
        return false;
      }

      const cur = credentialSelectedIndexRef.current;
      const len = credentialMatchesRef.current.length;
      const next =
        direction > 0 ? (cur < 0 || cur >= len - 1 ? 0 : cur + 1) : cur <= 0 ? len - 1 : cur - 1;

      credentialSelectedIndexRef.current = next;
      setCredentialSelectedIndex(next);
      return true;
    };

    const isCredentialPanelActive = () =>
      credentialShowPanelRef.current && credentialMatchesRef.current.length > 0;

    const moveCommandSuggestionSelection = (direction: 1 | -1) => {
      if (!showSuggestionsRef.current || suggestionsRef.current.length === 0) {
        return false;
      }

      const cur = selectedIndexRef.current;
      const len = suggestionsRef.current.length;
      const next =
        direction > 0
          ? cur === -1
            ? 0
            : cur >= len - 1
              ? -1
              : cur + 1
          : cur === -1
            ? len - 1
            : cur <= 0
              ? -1
              : cur - 1;

      selectedIndexRef.current = next;
      setSelectedIndex(next);
      return true;
    };

    const acceptCommandSuggestion = (execute: boolean) => {
      if (!showSuggestionsRef.current || suggestionsRef.current.length === 0) {
        return false;
      }

      const selected = suggestionsRef.current[selectedIndexRef.current];
      if (!selected) {
        return false;
      }

      applySuggestion(selected.command, execute);
      dismissSuggestions();
      return true;
    };

    const moveInputCursorAfterSelection = (
      selectedInputRange: InputSelectionRange,
      targetCursor: number,
    ) => {
      const nextCursor = Math.max(
        selectedInputRange.start,
        Math.min(selectedInputRange.end, targetCursor),
      );
      moveInputCursor(nextCursor);
    };

    terminal.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;

      if (isModifierOnlyKeyEvent(e)) {
        e.preventDefault();
        return false;
      }

      const kb = terminalAppSettingsRef.current.keybindings;

      if (
        disconnectedRef.current &&
        e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.shiftKey &&
        e.code === "KeyD"
      ) {
        e.preventDefault();
        onDisconnectedCloseRequestedRef.current?.();
        return false;
      }

      if (isShiftInsertPasteEvent(e)) {
        e.preventDefault();
        pasteClipboard().catch(() => {});
        return false;
      }

      if (
        e.key === "Tab" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        moveCredentialSelection(e.shiftKey ? -1 : 1)
      ) {
        e.preventDefault();
        return false;
      }

      if (
        !isCredentialPanelActive() &&
        showSuggestionsRef.current &&
        suggestionsRef.current.length > 0 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          moveCommandSuggestionSelection(-1);
          return false;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          moveCommandSuggestionSelection(1);
          return false;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          dismissSuggestions();
          return false;
        }
        if (e.key === "Enter" && acceptCommandSuggestion(true)) {
          e.preventDefault();
          return false;
        }
        if (e.key === "Tab" && acceptCommandSuggestion(false)) {
          e.preventDefault();
          return false;
        }
      }

      if (isLocalBackspaceEvent(e, sessionTypeRef.current)) {
        e.preventDefault();
        if (isCredentialPromptInputMode()) {
          sendRawInput(BACKSPACE_INPUT, null);
          return false;
        }

        const selectedInputRange = getSmartCursorSelectedInputRange();
        if (selectedInputRange) {
          deleteInputSelection(selectedInputRange);
          return false;
        }

        inputStateRef.current = applyTerminalInputData(inputStateRef.current, BACKSPACE_INPUT);
        syncSuggestionsWithInputState();
        sendRawInput(BACKSPACE_INPUT, null);
        return false;
      }

      // Smart cursor selection: preserve editing behavior for command-line input
      if (
        (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        const selectedInputRange = getSmartCursorSelectedInputRange();
        if (selectedInputRange) {
          e.preventDefault();
          collapseInputSelection(selectedInputRange, e.key === "ArrowLeft" ? "start" : "end");
          return false;
        }
      }

      if ((e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const selectedInputRange = getSmartCursorSelectedInputRange();
        if (selectedInputRange) {
          e.preventDefault();
          deleteInputSelection(selectedInputRange);
          return false;
        }
      }

      const directInputData = getDirectInputDataFromKeyEvent(e);
      if (directInputData) {
        const selectedInputRange = getSmartCursorSelectedInputRange();
        if (selectedInputRange) {
          e.preventDefault();
          replaceInputSelection(selectedInputRange, directInputData);
          return false;
        }
      }

      // Normal selection: preserve selection for ALL key presses - only clear on mouse click
      // If there's a selection that's NOT a smart cursor selection,
      // send the key input without triggering xterm's clearSelection
      if (terminal.hasSelection() && !getSmartCursorSelectedInputRange()) {
        if (directInputData) {
          e.preventDefault();
          terminal.input(directInputData, false);
          return false;
        }
        // Handle Backspace/Delete - send control char without clearing selection
        if (
          (e.key === "Backspace" || e.key === "Delete") &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey
        ) {
          e.preventDefault();
          terminal.input("\x7f", false);
          return false;
        }
        // Handle Enter - send newline without clearing selection
        if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          terminal.input("\r", false);
          return false;
        }
        // Handle arrow keys - send ANSI escape sequences without clearing selection
        if (e.key === "ArrowLeft" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
          e.preventDefault();
          terminal.input("\x1b[D", false);
          return false;
        }
        if (e.key === "ArrowRight" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
          e.preventDefault();
          terminal.input("\x1b[C", false);
          return false;
        }
        if (e.key === "ArrowUp" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
          e.preventDefault();
          terminal.input("\x1b[A", false);
          return false;
        }
        if (e.key === "ArrowDown" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
          e.preventDefault();
          terminal.input("\x1b[B", false);
          return false;
        }
        // Handle Ctrl key combinations - send control characters without clearing selection
        if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
          const ctrlCharMap: Record<string, string> = {
            a: "\x01",
            b: "\x02",
            c: "\x03",
            d: "\x04",
            e: "\x05",
            f: "\x06",
            g: "\x07",
            h: "\x08",
            i: "\x09",
            j: "\x0a",
            k: "\x0b",
            l: "\x0c",
            m: "\x0d",
            n: "\x0e",
            o: "\x0f",
            p: "\x10",
            q: "\x11",
            r: "\x12",
            s: "\x13",
            t: "\x14",
            u: "\x15",
            v: "\x16",
            w: "\x17",
            x: "\x18",
            y: "\x19",
            z: "\x1a",
          };
          const keyLower = e.key.toLowerCase();
          if (ctrlCharMap[keyLower]) {
            e.preventDefault();
            terminal.input(ctrlCharMap[keyLower], false);
            return false;
          }
          // Ctrl+Arrow keys (word navigation)
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            terminal.input("\x1b[1;5D", false);
            return false;
          }
          if (e.key === "ArrowRight") {
            e.preventDefault();
            terminal.input("\x1b[1;5C", false);
            return false;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            terminal.input("\x1b[1;5A", false);
            return false;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            terminal.input("\x1b[1;5B", false);
            return false;
          }
        }
        // Handle Alt/Meta key combinations
        if ((e.altKey || e.metaKey) && !e.ctrlKey && !e.shiftKey) {
          // Alt+Arrow keys (word navigation on some shells)
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            terminal.input("\x1b[1;3D", false);
            return false;
          }
          if (e.key === "ArrowRight") {
            e.preventDefault();
            terminal.input("\x1b[1;3C", false);
            return false;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            terminal.input("\x1b[1;3A", false);
            return false;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            terminal.input("\x1b[1;3B", false);
            return false;
          }
          // Alt+b, Alt+f (word navigation shortcuts in bash)
          const keyLower = e.key.toLowerCase();
          if (keyLower === "b") {
            e.preventDefault();
            terminal.input("\x1bb", false);
            return false;
          }
          if (keyLower === "f") {
            e.preventDefault();
            terminal.input("\x1bf", false);
            return false;
          }
          // Alt+d (delete word forward)
          if (keyLower === "d") {
            e.preventDefault();
            terminal.input("\x1bd", false);
            return false;
          }
        }
      }

      if (matchesKeyEvent(resolveShortcutKeys("terminal.copy", kb), e)) {
        e.preventDefault();
        const sel = terminal.getSelection();
        if (sel) writeClipboardText(sel).catch(() => {});
        return false;
      }
      if (matchesKeyEvent(resolveShortcutKeys("terminal.paste", kb), e)) {
        e.preventDefault();
        pasteClipboard().catch(() => {});
        return false;
      }
      if (matchesKeyEvent(resolveShortcutKeys("terminal.find", kb), e)) {
        e.preventDefault();
        doFindRef.current();
        return false;
      }
      if (matchesKeyEvent(resolveShortcutKeys("terminal.clear", kb), e)) {
        e.preventDefault();
        sendTerminalClearInput(terminal);
        return false;
      }
      if (matchesKeyEvent(resolveShortcutKeys("terminal.pasteSelected", kb), e)) {
        e.preventDefault();
        const sel = terminal.getSelection() || lastSelection;
        pasteText(sel);
        return false;
      }
      if (matchesKeyEvent(resolveShortcutKeys("terminal.selectAll", kb), e)) {
        e.preventDefault();
        terminal.selectAll();
        return false;
      }

      const swallowIds = [
        "tab.newSession",
        "tab.close",
        "tab.next",
        "tab.prev",
        "tab.newLocalTerminal",
        "view.toggleLeftSidebar",
        "view.toggleRightSidebar",
        "view.zoomIn",
        "view.zoomOut",
        "view.resetZoom",
        "view.openSettings",
        "terminal.manageSyncGroups",
        "special.lockScreen",
      ];
      for (const sid of swallowIds) {
        if (matchesKeyEvent(resolveShortcutKeys(sid, kb), e)) {
          e.preventDefault();
          return false;
        }
      }
      for (let tabNumber = 1; tabNumber <= 9; tabNumber += 1) {
        if (
          matchesKeyEvent(resolveIndexedKeys(resolveShortcutKeys("tab.switchTo", kb), tabNumber), e)
        ) {
          return false;
        }
      }

      const ctrlPrintableInput = getCtrlPrintableCsiuInput(e);
      if (ctrlPrintableInput) {
        e.preventDefault();
        terminal.input(ctrlPrintableInput, false);
        return false;
      }

      return true;
    });

    const blockedColorOscIds = new Set<number>();
    const remoteColorOscGuardDisposable = installRemoteColorOscGuard(
      terminal,
      sessionTypeRef.current,
      (oscId) => {
        if (blockedColorOscIds.has(oscId)) return;
        blockedColorOscIds.add(oscId);

        logger.debug({
          domain: "terminal.input",
          event: "serial.remote_color_osc_blocked",
          message: "Blocked remote color OSC for serial session",
          ids: { session_id: sessionId },
          data: {
            session_type: sessionTypeRef.current,
            osc_id: oscId,
          },
        });
      },
    );

    const oscDisposable = terminal.parser.registerOscHandler(133, (data) => {
      const si = shellIntegrationRef.current;

      if (data.startsWith("A")) {
        si.enabled = true;
        return false;
      }

      if (data.startsWith("B")) {
        si.enabled = true;
        resetCommandSuggestionSuppression();
        return false;
      }

      if (data.startsWith("C")) {
        si.enabled = true;
        si.commandRunning = true;
        inputStateRef.current = createTerminalInputState();
        resetCommandSuggestionSuppression();
        dismissSuggestions();
        return false;
      }

      if (data.startsWith("D")) {
        si.enabled = true;
        si.commandRunning = false;
        resetCommandSuggestionSuppression();
        return false;
      }

      return false;
    });

    const clipboardOscDisposable = terminal.parser.registerOscHandler(52, (data) => {
      if (!terminalAppSettingsRef.current?.interaction?.allow_osc52_clipboard_write) {
        return true;
      }

      const text = decodeOsc52ClipboardText(data);
      if (text === null) return true;

      void writeClipboardText(text).catch(() => {});
      return true;
    });

    const writeParsedDisposable = terminal.onWriteParsed(() => {
      if (terminal.buffer.active.type === "alternate") {
        dismissSuggestions();
      }
      const terminalSettings = terminalAppSettingsRef.current?.terminal;
      if (
        performanceModeRef.current === "normal" &&
        (terminalSettings?.show_line_numbers || terminalSettings?.show_timestamps)
      ) {
        window.dispatchEvent(new CustomEvent("nyaterm:refresh-gutter", { detail: { sessionId } }));
      }
    });

    let outputUnlisten: UnlistenFn | null = null;
    let errorUnlisten: UnlistenFn | null = null;
    let closedUnlisten: UnlistenFn | null = null;
    let focusUnlisten: UnlistenFn | null = null;
    let captureUnlisten: UnlistenFn | null = null;
    let zmodemUnlisten: UnlistenFn | null = null;
    let commandAcceptedUnlisten: UnlistenFn | null = null;

    const clearCredentialPromptInputMode = () => {
      credentialPromptBufferRef.current = "";
      credentialPromptInputUntilRef.current = 0;
    };

    const updateCredentialPromptInputMode = (payload: string) => {
      credentialPromptBufferRef.current = `${credentialPromptBufferRef.current}${payload}`.slice(
        -4096,
      );

      if (detectCredentialPromptKind(credentialPromptBufferRef.current)) {
        credentialPromptInputUntilRef.current = Date.now() + 120_000;
        dismissSuggestions();
        return;
      }

      if (/[\r\n]/u.test(payload)) {
        credentialPromptInputUntilRef.current = 0;
      }
    };

    const setCommandSuggestionSuppressed = (suppressed: boolean) => {
      if (commandSuggestionSuppressedRef.current === suppressed) return;
      commandSuggestionSuppressedRef.current = suppressed;
      if (suppressed) {
        dismissSuggestions();
      }
    };

    const noteShellCommand = (command: string) => {
      setCommandSuggestionSuppressed(commandStartsSuggestionSuppressingProgram(command));
    };

    const resetCommandSuggestionSuppression = () => {
      setCommandSuggestionSuppressed(false);
    };

    const refreshGutter = () => {
      if (!isTerminalAlive()) return;
      if (performanceModeRef.current !== "normal") return;
      const terminalSettings = terminalAppSettingsRef.current?.terminal;
      if (!terminalSettings?.show_line_numbers && !terminalSettings?.show_timestamps) return;
      window.dispatchEvent(new CustomEvent("nyaterm:refresh-gutter", { detail: { sessionId } }));
    };

    const stampWrittenLines = (from: number, to: number, ts: number) => {
      if (!terminalAppSettingsRef.current?.terminal?.show_timestamps) return;
      if (terminal.buffer.active.type === "alternate") return;

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

      if (performanceModeRef.current === "normal") {
        refreshGutter();
      }
    };

    const utf8Encoder = new TextEncoder();
    const outputAckBatchBytes = 64 * 1024;
    const outputAckDebounceMs = 16;

    const isAlternateScreenActive = () => terminal.buffer.active.type === "alternate";

    const getBacklogCapBytes = () => {
      if (!visibleRef.current) {
        return XTERM_PERFORMANCE_CONFIG.output.hiddenBacklogCapBytes;
      }
      return isAlternateScreenActive()
        ? XTERM_PERFORMANCE_CONFIG.output.alternateScreenBacklogCapBytes
        : XTERM_PERFORMANCE_CONFIG.output.visibleBacklogCapBytes;
    };

    const getWriteChunkBytes = () =>
      isAlternateScreenActive()
        ? XTERM_PERFORMANCE_CONFIG.output.alternateScreenWriteChunkBytes
        : XTERM_PERFORMANCE_CONFIG.output.writeChunkBytes;

    const getAlternateScreenWriteIntervalMs = () =>
      1000 / XTERM_PERFORMANCE_CONFIG.output.alternateScreenMaxWriteFps;

    const shouldThrottleAlternateScreenWrite = () =>
      isAlternateScreenActive() &&
      queuedOutputBytesRef.current >
        XTERM_PERFORMANCE_CONFIG.output.alternateScreenThrottleBacklogBytes;

    const getRecoveryThresholdBytes = () =>
      visibleRef.current
        ? XTERM_PERFORMANCE_CONFIG.output.visibleRecoveryThresholdBytes
        : XTERM_PERFORMANCE_CONFIG.output.hiddenRecoveryThresholdBytes;

    const getPendingOutputBytes = () =>
      queuedOutputBytesRef.current +
      writingOutputBytesRef.current +
      pendingOutputAckBytesRef.current;

    const getNonOverloadedPressureMode = (): PerformanceMode =>
      getPendingOutputBytes() >= XTERM_PERFORMANCE_CONFIG.output.strainedBacklogBytes
        ? "strained"
        : "normal";

    const refreshOutputPressureMode = () => {
      if (performanceModeRef.current === "overloaded") return;
      setOutputPressureMode(getNonOverloadedPressureMode());
    };

    const noteSkippedOutput = (count: number) => {
      if (count <= 0) return;
      enterOverloadedMode();
    };

    const sendOutputAck = (bytes: number) => {
      if (bytes <= 0) return;
      const ackBytes = Math.min(bytes, backendUnackedOutputBytesRef.current);
      if (ackBytes <= 0) return;
      backendUnackedOutputBytesRef.current = Math.max(
        0,
        backendUnackedOutputBytesRef.current - ackBytes,
      );
      tauriInvoke("ack_session_output", { sessionId, bytes: ackBytes }).catch(() => {});
    };

    const clearOutputAckTimer = () => {
      if (outputAckTimerRef.current !== null) {
        window.clearTimeout(outputAckTimerRef.current);
        outputAckTimerRef.current = null;
      }
    };

    const clearPendingOutputFlushTimer = () => {
      if (pendingOutputFlushTimerRef.current !== null) {
        window.clearTimeout(pendingOutputFlushTimerRef.current);
        pendingOutputFlushTimerRef.current = null;
      }
    };

    const scheduleOutputAckFlush = () => {
      if (outputAckTimerRef.current !== null) return;
      outputAckTimerRef.current = window.setTimeout(() => {
        outputAckTimerRef.current = null;
        flushPendingOutputAck(true);
      }, outputAckDebounceMs);
    };

    const flushPendingOutputAck = (force = false) => {
      const bytes = pendingOutputAckBytesRef.current;
      if (bytes <= 0) {
        if (force) {
          clearOutputAckTimer();
        }
        return;
      }
      if (!force && bytes < outputAckBatchBytes) {
        scheduleOutputAckFlush();
        return;
      }
      clearOutputAckTimer();
      pendingOutputAckBytesRef.current = 0;
      sendOutputAck(bytes);
    };

    const splitOutputChunk = (chunk: QueuedOutputChunk, maxBytes: number): QueuedOutputChunk[] => {
      if (chunk.bytes <= maxBytes) {
        return [chunk, { data: "", bytes: 0 }];
      }

      let index = 0;
      let bytes = 0;
      for (const char of chunk.data) {
        const charBytes = utf8Encoder.encode(char).length;
        if (bytes > 0 && bytes + charBytes > maxBytes) {
          break;
        }
        index += char.length;
        bytes += charBytes;
        if (bytes >= maxBytes) {
          break;
        }
      }

      if (index <= 0) {
        const [firstChar = ""] = chunk.data;
        index = firstChar.length;
        bytes = utf8Encoder.encode(firstChar).length;
      }

      return [
        { data: chunk.data.slice(0, index), bytes },
        {
          data: chunk.data.slice(index),
          bytes: Math.max(0, chunk.bytes - bytes),
        },
      ];
    };

    const trimQueuedOutput = (maxBytes: number) => {
      let dropped = 0;

      while (queuedOutputBytesRef.current > maxBytes && queuedOutputChunksRef.current.length > 0) {
        const overflow = queuedOutputBytesRef.current - maxBytes;
        const chunk = queuedOutputChunksRef.current[0];
        if (!chunk) break;

        if (chunk.bytes <= overflow) {
          queuedOutputChunksRef.current.shift();
          queuedOutputBytesRef.current -= chunk.bytes;
          dropped += chunk.bytes;
          continue;
        }

        const [head, tail] = splitOutputChunk(chunk, overflow);
        queuedOutputChunksRef.current[0] = tail;
        queuedOutputBytesRef.current -= head.bytes;
        dropped += head.bytes;
      }

      sendOutputAck(dropped);
      return dropped;
    };

    const dequeueOutputChunk = (maxBytes: number): QueuedOutputChunk | null => {
      if (maxBytes <= 0 || queuedOutputChunksRef.current.length === 0) {
        return null;
      }

      let remaining = maxBytes;
      const parts: string[] = [];
      let bytes = 0;

      while (remaining > 0 && queuedOutputChunksRef.current.length > 0) {
        const chunk = queuedOutputChunksRef.current[0];
        if (!chunk) break;

        if (chunk.bytes <= remaining) {
          parts.push(chunk.data);
          queuedOutputChunksRef.current.shift();
          queuedOutputBytesRef.current -= chunk.bytes;
          remaining -= chunk.bytes;
          bytes += chunk.bytes;
          continue;
        }

        const [head, tail] = splitOutputChunk(chunk, remaining);
        parts.push(head.data);
        queuedOutputChunksRef.current[0] = tail;
        queuedOutputBytesRef.current -= head.bytes;
        bytes += head.bytes;
        remaining -= head.bytes;
      }

      return parts.length > 0 ? { data: parts.join(""), bytes } : null;
    };

    const maybeRecoverPerformanceMode = () => {
      if (!isTerminalAlive()) return;
      if (performanceModeRef.current !== "overloaded") return;
      if (getPendingOutputBytes() > getRecoveryThresholdBytes()) return;
      exitOverloadedMode(getNonOverloadedPressureMode());
    };

    const shouldUseLowLatencyFlush = () =>
      visibleRef.current &&
      !isAlternateScreenActive() &&
      performanceModeRef.current !== "overloaded" &&
      getPendingOutputBytes() <= XTERM_PERFORMANCE_CONFIG.output.lowLatencyFlushBacklogBytes;

    const writeChunkToTerminal = (payload: QueuedOutputChunk) => {
      writingOutputBytesRef.current += payload.bytes;
      outputWriteInFlightRef.current = true;
      outputWriteQueueRef.current = outputWriteQueueRef.current
        .catch(() => {})
        .then(
          () =>
            new Promise<void>((resolve) => {
              if (!isTerminalAlive()) {
                writingOutputBytesRef.current = Math.max(
                  0,
                  writingOutputBytesRef.current - payload.bytes,
                );
                outputWriteInFlightRef.current = false;
                resolve();
                return;
              }

              const ts = Date.now();
              const beforeOffset = gutterLineOffsetRef.current;
              const beforeLine =
                beforeOffset + terminal.buffer.active.baseY + terminal.buffer.active.cursorY;

              try {
                terminal.write(payload.data, () => {
                  writingOutputBytesRef.current = Math.max(
                    0,
                    writingOutputBytesRef.current - payload.bytes,
                  );
                  pendingOutputAckBytesRef.current += payload.bytes;
                  outputWriteInFlightRef.current = false;

                  if (!isTerminalAlive()) {
                    resolve();
                    return;
                  }

                  const afterOffset = gutterLineOffsetRef.current;
                  const afterLine =
                    afterOffset + terminal.buffer.active.baseY + terminal.buffer.active.cursorY;

                  stampWrittenLines(beforeLine, afterLine, ts);

                  flushPendingOutputAck(queuedOutputBytesRef.current === 0);
                  maybeRecoverPerformanceMode();
                  refreshOutputPressureMode();
                  resolve();

                  if (
                    visibleRef.current &&
                    isTerminalAlive() &&
                    queuedOutputBytesRef.current > 0 &&
                    pendingOutputFlushRef.current === null &&
                    !pendingOutputMicrotaskRef.current
                  ) {
                    schedulePendingOutputFlush();
                  }
                });
              } catch {
                writingOutputBytesRef.current = Math.max(
                  0,
                  writingOutputBytesRef.current - payload.bytes,
                );
                pendingOutputAckBytesRef.current += payload.bytes;
                outputWriteInFlightRef.current = false;
                noteSkippedOutput(payload.bytes);
                flushPendingOutputAck(true);
                maybeRecoverPerformanceMode();
                refreshOutputPressureMode();
                resolve();
              }
            }),
        );
    };

    const writeTerminalTextAfterOutputQueue = (data: string) => {
      outputWriteQueueRef.current = outputWriteQueueRef.current
        .catch(() => {})
        .then(
          () =>
            new Promise<void>((resolve) => {
              if (!isTerminalAlive()) {
                resolve();
                return;
              }

              try {
                terminal.write(data, () => resolve());
              } catch {
                resolve();
              }
            }),
        );
      return outputWriteQueueRef.current;
    };

    const flushQueuedOutputBeforeStatusNotice = async () => {
      if (pendingOutputFlushRef.current !== null) {
        cancelAnimationFrame(pendingOutputFlushRef.current);
        pendingOutputFlushRef.current = null;
      }
      clearPendingOutputFlushTimer();

      const dropped = trimQueuedOutput(getBacklogCapBytes());
      noteSkippedOutput(dropped);

      while (queuedOutputChunksRef.current.length > 0) {
        const payload = dequeueOutputChunk(getWriteChunkBytes());
        if (!payload) break;
        writeChunkToTerminal(payload);
      }

      await outputWriteQueueRef.current.catch(() => {});
      flushPendingOutputAck(true);
      maybeRecoverPerformanceMode();
      refreshOutputPressureMode();
    };

    const resetDisconnectedInputState = () => {
      inputStateRef.current = createTerminalInputState();
      clearCredentialPromptInputMode();
      resetCommandSuggestionSuppression();
      dismissSuggestions();
    };

    const enterDisconnectedState = ({
      title,
      message,
      titleColor,
      showReconnectPrompt,
    }: {
      title: string;
      message?: string;
      titleColor: "31" | "36";
      showReconnectPrompt: boolean;
    }) => {
      disconnectedRef.current = true;
      resetDisconnectedInputState();

      if (disconnectedNoticeShownRef.current) return;
      disconnectedNoticeShownRef.current = true;
      window.dispatchEvent(
        new CustomEvent("nyaterm:session-disconnected", {
          detail: { sessionId },
        }),
      );

      void (async () => {
        await flushQueuedOutputBeforeStatusNotice();
        if (!isTerminalAlive()) return;

        await writeTerminalTextAfterOutputQueue(`\r\n\x1b[${titleColor}m[${title}]\x1b[0m\r\n`);
        if (message) {
          await writeTerminalTextAfterOutputQueue(`\x1b[31m${message}\x1b[0m\r\n`);
        }
        if (showReconnectPrompt && canReconnectDisconnectedSession()) {
          await writeTerminalTextAfterOutputQueue(
            `\x1b[33m[${tRef.current("terminal.pressEnterToReconnect")}]\x1b[0m\r\n`,
          );
        }
      })();
    };

    const flushPendingOutput = () => {
      pendingOutputFlushRef.current = null;
      if (!visibleRef.current || !isTerminalAlive() || outputWriteInFlightRef.current) {
        refreshOutputPressureMode();
        return;
      }

      const dropped = trimQueuedOutput(getBacklogCapBytes());
      noteSkippedOutput(dropped);
      refreshOutputPressureMode();

      if (shouldThrottleAlternateScreenWrite()) {
        const now = Date.now();
        const intervalMs = getAlternateScreenWriteIntervalMs();
        const elapsedMs = now - lastAlternateScreenWriteAtRef.current;
        if (lastAlternateScreenWriteAtRef.current > 0 && elapsedMs < intervalMs) {
          clearPendingOutputFlushTimer();
          pendingOutputFlushTimerRef.current = window.setTimeout(
            () => {
              pendingOutputFlushTimerRef.current = null;
              schedulePendingOutputFlush();
            },
            Math.max(1, intervalMs - elapsedMs),
          );
          return;
        }
      }

      const payload = dequeueOutputChunk(getWriteChunkBytes());

      if (!payload) {
        flushPendingOutputAck(true);
        maybeRecoverPerformanceMode();
        refreshOutputPressureMode();
        return;
      }

      if (isAlternateScreenActive()) {
        lastAlternateScreenWriteAtRef.current = Date.now();
      }
      writeChunkToTerminal(payload);
    };

    const schedulePendingOutputFlush = (preferImmediate = false) => {
      if (!visibleRef.current || !isTerminalAlive()) return;
      if (
        outputWriteInFlightRef.current ||
        pendingOutputFlushRef.current !== null ||
        pendingOutputFlushTimerRef.current !== null ||
        pendingOutputMicrotaskRef.current
      ) {
        return;
      }

      if (preferImmediate || shouldUseLowLatencyFlush()) {
        pendingOutputMicrotaskRef.current = true;
        queueMicrotask(() => {
          pendingOutputMicrotaskRef.current = false;
          flushPendingOutput();
        });
        return;
      }

      pendingOutputFlushRef.current = requestAnimationFrame(flushPendingOutput);
    };

    const repaintVisibleTerminal = () => {
      if (!visibleRef.current || !isTerminalAlive()) return;
      requestAnimationFrame(() => {
        if (!visibleRef.current || !isTerminalAlive()) return;
        terminal.clearTextureAtlas();
        terminal.refresh(0, Math.max(0, terminal.rows - 1));
        requestAnimationFrame(() => {
          if (!visibleRef.current || !isTerminalAlive()) return;
          terminal.refresh(0, Math.max(0, terminal.rows - 1));
        });
      });
    };

    const applyVisibilityPolicy = () => {
      if (!isTerminalAlive()) return;

      if (!visibleRef.current && pendingOutputFlushRef.current !== null) {
        cancelAnimationFrame(pendingOutputFlushRef.current);
        pendingOutputFlushRef.current = null;
      }
      if (!visibleRef.current) {
        clearPendingOutputFlushTimer();
      }

      const dropped = trimQueuedOutput(getBacklogCapBytes());
      noteSkippedOutput(dropped);
      flushPendingOutputAck(!visibleRef.current);
      maybeRecoverPerformanceMode();
      refreshOutputPressureMode();

      if (visibleRef.current) {
        flushPendingOutput();
        schedulePendingOutputFlush();
        repaintVisibleTerminal();
      }
    };

    handleVisibilityChangeRef.current = applyVisibilityPolicy;

    const setupListeners = async () => {
      const nextOutputUnlisten = await listen<TerminalOutputPayload>(
        `terminal-output-${sessionId}`,
        (event) => {
          if (!isTerminalAlive()) return;
          const payload = event.payload;
          if (!payload.data || payload.bytes <= 0) {
            noteSkippedOutput(payload.droppedBytes ?? 0);
            return;
          }

          queuedOutputChunksRef.current.push({
            data: payload.data,
            bytes: payload.bytes,
          });
          queuedOutputBytesRef.current += payload.bytes;
          backendUnackedOutputBytesRef.current += payload.bytes;

          const recentPayload =
            payload.data.length > 4096 ? payload.data.slice(-4096) : payload.data;
          updateCredentialPromptInputMode(recentPayload);
          feedCredentialOutput(recentPayload);
          if (visibleRef.current && hasErrorKeyword(recentPayload)) {
            const now = Date.now();
            if (now - lastErrorNoticeAtRef.current > 30_000) {
              lastErrorNoticeAtRef.current = now;
              emitAIErrorDetected({
                sessionId,
                output: recentPayload.slice(-4000),
              });
            }
          }

          noteSkippedOutput(payload.droppedBytes ?? 0);

          if (!visibleRef.current) {
            const dropped = trimQueuedOutput(getBacklogCapBytes());
            noteSkippedOutput(dropped);
            flushPendingOutputAck(true);
            maybeRecoverPerformanceMode();
            refreshOutputPressureMode();
            window.dispatchEvent(
              new CustomEvent("nyaterm:session-output", {
                detail: { sessionId },
              }),
            );
            return;
          }

          const dropped = trimQueuedOutput(getBacklogCapBytes());
          noteSkippedOutput(dropped);
          refreshOutputPressureMode();
          schedulePendingOutputFlush();
        },
      );
      if (disposed) {
        nextOutputUnlisten();
        return;
      }
      outputUnlisten = nextOutputUnlisten;

      const nextCommandAcceptedUnlisten = await listen<SessionCommandAcceptedEvent>(
        "session-command-accepted",
        (event) => {
          if (!isTerminalAlive()) return;
          if (event.payload.sessionId !== sessionIdRef.current) return;
          noteShellCommand(event.payload.command);
        },
      );
      if (disposed) {
        nextCommandAcceptedUnlisten();
        return;
      }
      commandAcceptedUnlisten = nextCommandAcceptedUnlisten;

      const nextErrorUnlisten = await listen<string>(`session-error-${sessionId}`, (event) => {
        if (!isTerminalAlive()) return;
        const message = String(event.payload || tRef.current("terminal.connectionFailed"));
        enterDisconnectedState({
          title: tRef.current("terminal.connectionFailed"),
          message,
          titleColor: "31",
          showReconnectPrompt: false,
        });
        toast.error(message);
        onConnectionErrorRef.current?.(sessionIdRef.current, message);
      });
      if (disposed) {
        nextErrorUnlisten();
        return;
      }
      errorUnlisten = nextErrorUnlisten;

      const nextClosedUnlisten = await listen<void>(`session-closed-${sessionId}`, () => {
        if (!isTerminalAlive()) return;
        enterDisconnectedState({
          title: tRef.current("terminal.sessionDisconnected"),
          titleColor: "31",
          showReconnectPrompt: true,
        });
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

      const nextCaptureUnlisten = await listen<AiCaptureEvent>(
        `ai-capture-${sessionId}`,
        (event) => {
          const payload = event.payload;
          if (payload.type === "commandStart") {
            aiCapturingRef.current = true;
            inputStateRef.current = createTerminalInputState();
            clearCredentialPromptInputMode();
            dismissSuggestions();
            if (isTerminalAlive()) {
              terminal.write(renderAiCommandStart(payload));
            }
          } else if (payload.type === "commandEnd") {
            aiCapturingRef.current = false;
            if (isTerminalAlive()) {
              terminal.write(renderAiCommandEnd(payload));
            }
          }
        },
      );
      if (disposed) {
        nextCaptureUnlisten();
        return;
      }
      captureUnlisten = nextCaptureUnlisten;

      const nextZmodemUnlisten = await listen<ZmodemEventPayload>(
        `zmodem-event-${sessionId}`,
        (event) => {
          if (!isTerminalAlive()) return;
          zmodemHandler.handle(event.payload);
        },
      );
      if (disposed) {
        nextZmodemUnlisten();
        return;
      }
      zmodemUnlisten = nextZmodemUnlisten;

      try {
        await invoke("attach_session", { sessionId });
      } catch {
        // The session may already be gone during mount/unmount races.
      }
    };
    void setupListeners();

    const removePreviewListener = listenSessionInputPreview(sessionId, handleInputPreview);

    const dataDisposable = terminal.onData((data) => {
      if (aiCapturingRef.current) return;

      if (disconnectedRef.current) {
        if (data === "\r" && canReconnectDisconnectedSession() && !reconnectingRef.current) {
          reconnectingRef.current = true;
          terminal.write(`\r\n\x1b[36m[${tRef.current("terminal.reconnecting")}]\x1b[0m\r\n`);
          createReconnectedSession()
            .then((newSessionId) => {
              preservedReconnectContentRef.current = serializeTerminalText(terminal);
              const oldSessionId = sessionIdRef.current;
              disconnectedRef.current = false;
              disconnectedNoticeShownRef.current = false;
              disconnectedCloseRequestedRef.current = false;
              reconnectingRef.current = false;
              window.dispatchEvent(
                new CustomEvent("nyaterm:session-reconnected", {
                  detail: { oldSessionId, newSessionId },
                }),
              );
              onReconnectedRef.current?.(oldSessionId, newSessionId);
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
        if (
          data === "\x04" &&
          sessionTypeRef.current === "Local" &&
          !reconnectingRef.current &&
          !disconnectedCloseRequestedRef.current
        ) {
          disconnectedCloseRequestedRef.current = true;
          onDisconnectedCloseRequestedRef.current?.();
        }
        return;
      }

      if (credentialShowPanelRef.current && credentialMatchesRef.current.length > 0) {
        if (data === "\x1b[A") {
          moveCredentialSelection(-1);
          return;
        }
        if (data === "\x1b[B") {
          moveCredentialSelection(1);
          return;
        }
        if (data === "\t") {
          moveCredentialSelection(1);
          return;
        }
        if (data === "\x1b[Z") {
          moveCredentialSelection(-1);
          return;
        }
        if (data === "\r" && credentialSelectedIndexRef.current >= 0) {
          const selected = credentialMatchesRef.current[credentialSelectedIndexRef.current];
          if (selected) void handleCredentialSelect(selected);
          return;
        }
        if (data === "\x1b") {
          dismissCredentialPanel();
          return;
        }
        dismissCredentialPanel();
      }

      if (isCredentialPromptInputMode()) {
        if (data === "\r" || data === "\u0003") {
          clearCredentialPromptInputMode();
          inputStateRef.current = createTerminalInputState();
        }
        dismissSuggestions();
        sendRawInput(data, null);
        return;
      }

      if (
        canShowCommandSuggestions() &&
        showSuggestionsRef.current &&
        suggestionsRef.current.length > 0
      ) {
        if (data === "\t" && acceptCommandSuggestion(false)) {
          return;
        }

        if (data === "\x1b[A" || data === "\x1bOA") {
          moveCommandSuggestionSelection(-1);
          return;
        }

        if (data === "\x1b[B" || data === "\x1bOB") {
          moveCommandSuggestionSelection(1);
          return;
        }

        if (data === "\x1b") {
          dismissSuggestions();
          return;
        }

        if (data === "\r" && acceptCommandSuggestion(true)) {
          return;
        }
      }

      if (
        data !== "\t" &&
        inputStateRef.current.desynced &&
        inputStateRef.current.desyncReason === "tab"
      ) {
        const recovered = resyncFromTerminalLine(
          inputStateRef.current,
          readCurrentInputLine(terminal),
        );
        if (recovered) {
          inputStateRef.current = recovered;
        }
      }

      if (commandSuggestionSuppressedRef.current) {
        dismissSuggestions();
        if (data === "\u0003" || data === "q") {
          resetCommandSuggestionSuppression();
          inputStateRef.current = createTerminalInputState();
        }
        sendRawInput(data, null);
        return;
      }

      if (isPlainTextInputData(data)) {
        const selectedInputRange = getSmartCursorSelectedInputRange();
        if (selectedInputRange) {
          replaceInputSelection(selectedInputRange, data);
          return;
        }
      }

      const command = data === "\r" ? getTrackedSubmissionCommand(inputStateRef.current) : "";
      inputStateRef.current = applyTerminalInputData(inputStateRef.current, data);
      if (data === "\r" || data === "\u0003") {
        clearCredentialPromptInputMode();
      }
      if (data === "\r" && command) {
        noteShellCommand(command);
        dismissSuggestions();
      } else if (
        isPagerSingleKeyInput(data) ||
        isPagerSearchOrCommandInput(inputStateRef.current.value)
      ) {
        dismissSuggestions();
      } else {
        syncSuggestionsWithInputState();
      }
      sendRawInput(data, data === "\r" && command ? command : null);
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
      if (terminalAppSettingsRef.current?.interaction?.copy_on_select) {
        if (text) {
          writeClipboardText(text).catch(() => {});
        }
      }
    });

    const handleTerminalMouseDown = (e: MouseEvent) => {
      removeLinkPopup();

      if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        primaryMouseDown = { x: e.clientX, y: e.clientY };
      } else {
        primaryMouseDown = null;
      }

      if (e.button === 1) e.preventDefault(); // Prevent auto-scroll mechanism
    };

    const handleTerminalMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        const down = primaryMouseDown;
        primaryMouseDown = null;
        const isPlainPrimaryMouseUp =
          down &&
          !disconnectedRef.current &&
          !aiCapturingRef.current &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          !e.shiftKey;
        const isStationaryMouseUp =
          !!down && Math.abs(e.clientX - down.x) <= 4 && Math.abs(e.clientY - down.y) <= 4;

        if (isPlainPrimaryMouseUp && terminal.hasSelection()) {
          const selectedInputRange = getSmartCursorSelectedInputRange();
          if (selectedInputRange) {
            if (e.detail >= 2 || isStationaryMouseUp) {
              moveInputCursorAfterSelection(selectedInputRange, selectedInputRange.end);
            } else {
              const position = getMouseBufferPosition(terminal, e);
              const targetCursor = position
                ? getInputIndexAtBufferPosition(terminal, inputStateRef.current, position)
                : null;
              if (targetCursor !== null) {
                moveInputCursorAfterSelection(selectedInputRange, targetCursor);
              }
            }
          }
        } else if (isPlainPrimaryMouseUp && isStationaryMouseUp) {
          const state = inputStateRef.current;
          if (canUseSmartCursor(state)) {
            const position = getMouseBufferPosition(terminal, e);
            if (position) {
              const targetCursor = getInputIndexAtBufferPosition(terminal, state, position);
              if (targetCursor !== null) {
                moveInputCursor(targetCursor);
              }
            }
          }
        }

        if (terminalAppSettingsRef.current?.interaction?.copy_on_select) {
          const sel = terminal.getSelection();
          if (sel) writeClipboardText(sel).catch(() => {});
        }
        return;
      }

      if (e.button !== 1) return;
      e.preventDefault();
      const sel = terminal.getSelection();
      if (sel) {
        pasteText(sel);
      } else {
        pasteClipboard().catch(() => {});
      }
    };

    const handleMacReleasedMouseMove = (e: MouseEvent) => {
      if (!isMacOS || !primaryMouseDown || e.buttons !== 0) return;

      primaryMouseDown = null;
      e.stopImmediatePropagation();

      // WKWebView can miss mouseup after a trackpad tap when three-finger drag is enabled.
      // xterm listens on document while selecting, so synthesize the release there.
      const syntheticMouseUp = new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 0,
        clientX: e.clientX,
        clientY: e.clientY,
        screenX: e.screenX,
        screenY: e.screenY,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
      });
      document.dispatchEvent(syntheticMouseUp);
    };

    const handleTerminalPointerCancel = () => {
      resetTerminalPointerState({ clearSelection: true });
    };

    const handleTerminalMouseLeave = () => {
      resetTerminalPointerState();
    };

    const handleTerminalDragStart = () => {
      resetTerminalPointerState();
    };

    const handleTerminalWindowBlur = () => {
      resetTerminalPointerState({ clearSelection: true });
    };

    const handleTerminalVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        resetTerminalPointerState({ clearSelection: true });
      }
    };

    containerRef.current.addEventListener("mousedown", handleTerminalMouseDown);
    containerRef.current.addEventListener("mouseup", handleTerminalMouseUp);
    containerRef.current.addEventListener("pointercancel", handleTerminalPointerCancel);
    containerRef.current.addEventListener("mouseleave", handleTerminalMouseLeave);
    containerRef.current.addEventListener("dragstart", handleTerminalDragStart);
    if (isMacOS) {
      document.addEventListener("mousemove", handleMacReleasedMouseMove, true);
    }
    window.addEventListener("blur", handleTerminalWindowBlur);
    document.addEventListener("visibilitychange", handleTerminalVisibilityChange);
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
      containerEl.removeEventListener("mousedown", handleTerminalMouseDown);
      containerEl.removeEventListener("mouseup", handleTerminalMouseUp);
      containerEl.removeEventListener("pointercancel", handleTerminalPointerCancel);
      containerEl.removeEventListener("mouseleave", handleTerminalMouseLeave);
      containerEl.removeEventListener("dragstart", handleTerminalDragStart);
      if (isMacOS) {
        document.removeEventListener("mousemove", handleMacReleasedMouseMove, true);
      }
      window.removeEventListener("blur", handleTerminalWindowBlur);
      document.removeEventListener("visibilitychange", handleTerminalVisibilityChange);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      inputStateRef.current = createTerminalInputState();
      clearCredentialPromptInputMode();
      shellIntegrationRef.current.enabled = false;
      shellIntegrationRef.current.commandRunning = false;
      replaceInputCommandRef.current = null;
      pasteTextRef.current = () => {};
      resetCredentialAutofill();

      oscDisposable.dispose();
      remoteColorOscGuardDisposable.dispose();
      clipboardOscDisposable.dispose();
      writeParsedDisposable.dispose();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      scrollDisposable.dispose();
      selectionDisposable.dispose();
      trimDisposable?.dispose();
      removeLinkPopup();
      removePreviewListener();
      unregisterTerminalContext();
      unregisterReconnectCapture();

      observer.disconnect();
      if (outputUnlisten) outputUnlisten();
      if (errorUnlisten) errorUnlisten();
      if (closedUnlisten) closedUnlisten();
      if (focusUnlisten) focusUnlisten();
      if (captureUnlisten) captureUnlisten();
      if (zmodemUnlisten) zmodemUnlisten();
      if (commandAcceptedUnlisten) commandAcceptedUnlisten();
      zmodemHandler.dispose();
      if (pendingOutputFlushRef.current !== null) {
        cancelAnimationFrame(pendingOutputFlushRef.current);
        pendingOutputFlushRef.current = null;
      }
      clearPendingOutputFlushTimer();
      pendingOutputMicrotaskRef.current = false;
      flushPendingOutputAck(true);
      sendOutputAck(backendUnackedOutputBytesRef.current);
      queuedOutputChunksRef.current = [];
      queuedOutputBytesRef.current = 0;
      writingOutputBytesRef.current = 0;
      pendingOutputAckBytesRef.current = 0;
      backendUnackedOutputBytesRef.current = 0;
      lastAlternateScreenWriteAtRef.current = 0;
      outputWriteInFlightRef.current = false;
      outputWriteQueueRef.current = Promise.resolve();
      pendingOutputMicrotaskRef.current = false;
      const latestLifecycleState = terminalLifecycleStateRef.current;
      if (
        latestLifecycleState.sessionId === sessionId &&
        latestLifecycleState.terminalTransparencyEnabled !== terminalTransparencyEnabled
      ) {
        preservedReconnectContentRef.current = serializeTerminalText(terminal);
      }
      terminal.dispose();
      terminalRef.current = null;
      setTerminalInstance(null);
      fitAddonRef.current = null;
      registerSearchAddon(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, terminalTransparencyEnabled]);

  // Appearance, theme, and interaction settings sync.
  // Declared AFTER the terminal creation effect so effects from these hooks
  // run after terminalRef.current is already set on initial mount.
  useTerminalSettings(
    terminalRef,
    fitAddonRef,
    terminalThemeColors,
    appearance,
    terminalSettings,
    interaction,
    visible && active,
    terminalInstance,
    sessionId,
  );

  // isDark is derived from the terminal theme background so built-in rule colors
  // switch automatically when the user changes themes.
  const isDark = hexLuminance(terminalTheme.colors.terminal.background) < 0.5;
  useKeywordHighlighter(
    terminalInstance,
    terminalSettings,
    sessionId,
    isDark,
    performanceMode !== "normal" || !visible,
  );

  const { tooltipState, menuState, closeMenu } = useActionLinks(
    terminalInstance,
    terminalSettings,
    sessionId,
    replaceInputCommandRef,
    performanceMode !== "normal" || !visible,
  );

  useEffect(() => {
    if (terminalReady && fitAddonRef.current && terminalRef.current) {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
        terminalRef.current?.refresh(0, Math.max(0, terminalRef.current.rows - 1));
        if (showGutter && performanceMode === "normal") {
          window.dispatchEvent(
            new CustomEvent("nyaterm:refresh-gutter", {
              detail: { sessionId },
            }),
          );
        }
      });
    }
  }, [performanceMode, sessionId, showGutter, terminalReady]);

  useEffect(() => {
    const paddingEnabled = showContentPadding;
    if (!terminalReady || !fitAddonRef.current || !terminalRef.current) return;

    requestAnimationFrame(() => {
      if (paddingEnabled !== ((terminalSettings.show_workspace_padding ?? false) && !showGutter)) {
        return;
      }
      fitAddonRef.current?.fit();
      terminalRef.current?.refresh(0, Math.max(0, terminalRef.current.rows - 1));
    });
  }, [showContentPadding, showGutter, terminalReady, terminalSettings.show_workspace_padding]);

  // Re-fit and focus when tab becomes active
  useEffect(() => {
    if (active && visible && terminalReady && fitAddonRef.current && terminalRef.current) {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
        const terminal = terminalRef.current;
        if (!terminal) return;
        terminal.clearTextureAtlas();
        terminal.refresh(0, Math.max(0, terminal.rows - 1));
        terminal.focus();
      });
    }
  }, [active, terminalReady, visible]);

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

    window.addEventListener("nyaterm:refresh-terminals", handleRefresh);
    return () => {
      window.removeEventListener("nyaterm:refresh-terminals", handleRefresh);
    };
  }, [active, visible]);

  useEffect(() => {
    const handleClear = () => {
      const terminal = terminalRef.current;
      if (!active || !terminal) return;
      sendTerminalClearInput(terminal, { focus: active });
    };

    window.addEventListener("nyaterm:clear-terminal", handleClear);
    return () => {
      window.removeEventListener("nyaterm:clear-terminal", handleClear);
    };
  }, [active]);

  const doFind = useCallback(
    (selection?: string) => {
      setShowSearchBar(true);
      if (selection) {
        setSearchQuery(selection);
        handleSearchNext(selection);
      }
    },
    [handleSearchNext, setShowSearchBar, setSearchQuery],
  );

  const handlePasteText = useCallback((text: string) => {
    pasteTextRef.current(text);
  }, []);

  const handleDirectMultiLinePaste = useCallback((text: string) => {
    if (!text) return;
    setMultiLinePasteText(null);
    requestAnimationFrame(() => {
      pasteTextRef.current(text, { skipDialog: true });
    });
  }, []);

  const handleSendMultiLinePasteByLine = useCallback(
    (text: string) => {
      if (!text) return;
      openSendCommandPanel({
        text,
        sourceSessionId: sessionId,
        sourceSessionType: sessionType,
        dataType: "text",
        sendMode: "line",
        count: 1,
        intervalSeconds: 1,
        target: "current",
      });
      setMultiLinePasteText(null);
    },
    [sessionId, sessionType],
  );

  useEffect(() => {
    doFindRef.current = doFind;
  }, [doFind]);

  const resetExternalDropHover = useCallback(() => {
    setIsExternalDropActive(false);
  }, []);

  const resolveLocalDropPaths = useCallback(async (paths: string[]) => {
    const uniquePaths = Array.from(
      new Set(paths.map((path) => path.trim()).filter((path) => !!path)),
    );
    if (uniquePaths.length === 0) {
      return [];
    }

    return invoke<ResolvedLocalDropPathEntry[]>("resolve_local_drop_paths", {
      paths: uniquePaths,
    });
  }, []);

  const processTerminalDropPaths = useCallback(
    async (dropPaths: string[]) => {
      try {
        const resolvedLocalEntries = await resolveLocalDropPaths(dropPaths);
        if (resolvedLocalEntries.length === 0) {
          logger.warn({
            domain: "ui.error",
            event: "terminal.external_drop_paths_unresolved",
            message: "Native terminal drop did not resolve to usable local paths",
            ids: { session_id: sessionId },
            data: { path_count: dropPaths.length },
          });
          toast.error(t("terminal.dropPathsRequired"));
          return;
        }

        await handleTerminalFileDrop({
          sessionId,
          sessionType,
          entries: resolvedLocalEntries,
          t,
          duplicateStrategy: terminalAppSettings.transfer.duplicate_strategy,
        });
      } catch (error) {
        logger.error({
          domain: "ui.error",
          event: "terminal.external_drop_failed",
          message: "Failed to process terminal file drop",
          ids: { session_id: sessionId },
          data: { path_count: dropPaths.length },
          error,
        });
        toast.error(String(error));
      }
    },
    [
      resolveLocalDropPaths,
      sessionId,
      sessionType,
      t,
      terminalAppSettings.transfer.duplicate_strategy,
    ],
  );

  useTerminalFileDrop({
    sessionId,
    sessionType,
    enabled: visible,
    containerRef,
    resetExternalDropHover,
    setIsExternalDropActive,
    processDropPaths: processTerminalDropPaths,
    externalDropPathsRequiredMessage: t("terminal.dropPathsRequired"),
  });

  const dropOverlayCopy = useMemo(
    () => getTerminalDropOverlayCopy(sessionType, t),
    [sessionType, t],
  );

  const terminalBackground = "var(--df-terminal-bg, var(--df-bg-terminal))";

  return (
    <div
      className="nyaterm-wallpaper-transparent-surface h-full w-full relative flex"
      style={{
        display: visible ? "flex" : "none",
        backgroundColor: terminalBackground,
      }}
    >
      {showGutter && terminalReady && (
        <TerminalGutter
          terminalRef={terminalRef}
          showLineNumbers={showLineNumbers}
          showTimestamps={showTimestamps}
          showTimestampMilliseconds={showTimestampMilliseconds}
          lineTimestamps={lineTimestampsRef.current}
          getLineOffset={getGutterLineOffset}
          sessionId={sessionId}
          suspended={performanceMode !== "normal" || !visible}
        />
      )}
      <div
        className="nyaterm-wallpaper-transparent-surface flex-1 min-w-0 h-full relative"
        style={{ backgroundColor: terminalBackground }}
      >
        <TerminalContextMenu
          terminalRef={terminalRef}
          onFind={doFind}
          onPasteText={handlePasteText}
          onPasteClipboard={pasteClipboard}
        >
          <div
            className={`nyaterm-wallpaper-transparent-surface h-full w-full ${
              showContentPadding ? "pl-2" : ""
            }`}
            style={{ backgroundColor: terminalBackground }}
          >
            <div
              ref={containerRef}
              data-terminal-root="true"
              className="nyaterm-wallpaper-transparent-surface h-full w-full"
              style={{ backgroundColor: terminalBackground }}
            />
          </div>
        </TerminalContextMenu>

        {isExternalDropActive && (
          <ExternalFileDropOverlay title={dropOverlayCopy.title} hint={dropOverlayCopy.hint} />
        )}

        {syncOverlay && <SyncActionOverlay overlay={syncOverlay} />}

        <TerminalSearchBar
          show={showSearchBar}
          searchQuery={searchQuery}
          searchState={searchState}
          searchFlags={searchFlags}
          activeMode={activeMode}
          historyState={historyState}
          setSearchQuery={setSearchQuery}
          onModeChange={setActiveMode}
          onSearchFlagChange={setSearchFlag}
          onNext={handleSearchNext}
          onPrev={handleSearchPrev}
          onClose={handleCloseSearch}
        />

        <CommandSuggestions
          suggestions={suggestions}
          visible={commandSuggestionsEnabled && showSuggestions && canShowCommandSuggestions()}
          selectedIndex={selectedIndex}
          cursorPosition={cursorPosition}
          onSelect={handleSelectSuggestion}
          onDismiss={dismissSuggestions}
          onDeleteHistory={handleDeleteSuggestion}
        />

        <CredentialSuggestions
          panelState={credentialPanelState}
          selectedIndex={credentialSelectedIndex}
          cursorPosition={credentialCursorPosition}
          onSelect={(credential) => void handleCredentialSelect(credential)}
          onDismiss={dismissCredentialPanel}
        />

        <ActionLinkTooltip state={tooltipState} />
        <ActionLinkMenu state={menuState} onClose={closeMenu} />

        <MultiLinePasteDialog
          open={multiLinePasteText !== null}
          text={multiLinePasteText}
          onClose={() => setMultiLinePasteText(null)}
          onDirectPaste={handleDirectMultiLinePaste}
          onSendLineByLine={handleSendMultiLinePasteByLine}
        />
      </div>
    </div>
  );
}
