import type { SessionInputPreview } from "@/lib/sessionInput";
import { extractCommandFromRenderedLine, sanitizeTerminalCommand } from "@/lib/terminalCommand";

export interface TerminalInputState {
  value: string;
  cursor: number;
  desynced: boolean;
  desyncReason: "tab" | "terminal" | null;
  lineRewriteRequired: boolean;
  multiline: boolean;
}

export function createTerminalInputState(): TerminalInputState {
  return {
    value: "",
    cursor: 0,
    desynced: false,
    desyncReason: null,
    lineRewriteRequired: false,
    multiline: false,
  };
}

function resetState(multiline = false): TerminalInputState {
  return {
    value: "",
    cursor: 0,
    desynced: false,
    desyncReason: null,
    lineRewriteRequired: false,
    multiline,
  };
}

function insertText(state: TerminalInputState, text: string): TerminalInputState {
  if (!text) {
    return state;
  }

  return {
    ...state,
    value: `${state.value.slice(0, state.cursor)}${text}${state.value.slice(state.cursor)}`,
    cursor: state.cursor + text.length,
  };
}

function deleteLeft(state: TerminalInputState): TerminalInputState {
  if (state.cursor === 0) {
    return state;
  }

  return {
    ...state,
    value: `${state.value.slice(0, state.cursor - 1)}${state.value.slice(state.cursor)}`,
    cursor: state.cursor - 1,
  };
}

function deleteRight(state: TerminalInputState): TerminalInputState {
  if (state.cursor >= state.value.length) {
    return state;
  }

  return {
    ...state,
    value: `${state.value.slice(0, state.cursor)}${state.value.slice(state.cursor + 1)}`,
  };
}

function deletePreviousWord(state: TerminalInputState): TerminalInputState {
  if (state.cursor === 0) {
    return state;
  }

  let start = state.cursor;
  while (start > 0 && /\s/u.test(state.value[start - 1] ?? "")) {
    start -= 1;
  }
  while (start > 0 && !/\s/u.test(state.value[start - 1] ?? "")) {
    start -= 1;
  }

  return {
    ...state,
    value: `${state.value.slice(0, start)}${state.value.slice(state.cursor)}`,
    cursor: start,
  };
}

function markDesynced(
  state: TerminalInputState,
  reason: "tab" | "terminal",
  multiline = false,
): TerminalInputState {
  return {
    ...state,
    desynced: true,
    desyncReason: reason,
    lineRewriteRequired: state.lineRewriteRequired || reason === "tab",
    multiline,
  };
}

function replaceValue(value: string): TerminalInputState {
  return {
    value,
    cursor: value.length,
    desynced: false,
    desyncReason: null,
    lineRewriteRequired: false,
    multiline: false,
  };
}

export function syncTerminalInputFromRenderedLine(renderedLine: string): TerminalInputState {
  const value = extractCommandFromRenderedLine(renderedLine);
  return {
    value,
    cursor: value.length,
    desynced: false,
    desyncReason: null,
    lineRewriteRequired: false,
    multiline: false,
  };
}

export function applyTerminalInputData(
  state: TerminalInputState,
  data: string,
): TerminalInputState {
  if (!data) {
    return state;
  }

  switch (data) {
    case "\r":
      return resetState();
    case "\u0003":
      return resetState();
    case "\u0001":
      return { ...state, cursor: 0 };
    case "\u0005":
      return { ...state, cursor: state.value.length };
    case "\u0015":
      return { ...state, value: state.value.slice(state.cursor), cursor: 0 };
    case "\u0017":
      return deletePreviousWord(state);
    case "\u000b":
      return { ...state, value: state.value.slice(0, state.cursor) };
    case "\u000c":
      return state;
    case "\u007f":
    case "\b":
      return deleteLeft(state);
    case "\x1b[D":
    case "\x1bOD":
      return { ...state, cursor: Math.max(0, state.cursor - 1) };
    case "\x1b[C":
    case "\x1bOC":
      return { ...state, cursor: Math.min(state.value.length, state.cursor + 1) };
    case "\x1b[H":
    case "\x1bOH":
      return { ...state, cursor: 0 };
    case "\x1b[F":
    case "\x1bOF":
      return { ...state, cursor: state.value.length };
    case "\x1b[3~":
      return deleteRight(state);
    case "\t":
      return markDesynced(state, "tab");
  }

  if (data.includes("\n") || data.includes("\r")) {
    return resetState(true);
  }

  if (data.startsWith("\x1b")) {
    return markDesynced(state, "terminal");
  }

  if (/[\x00-\x1f\x7f]/u.test(data)) {
    return markDesynced(state, "terminal");
  }

  if (state.desynced && state.desyncReason === "tab") {
    // Tab completion can change the visible prompt text without a reliable echo we can parse.
    // Once the user resumes typing plain text, treat the tracker as synchronized again so
    // suggestions recover for the current line instead of staying disabled until Enter/Ctrl+C.
    return insertText(
      {
        ...state,
        desynced: false,
        desyncReason: null,
        lineRewriteRequired: true,
      },
      data,
    );
  }

  return insertText(state, data);
}

export function applyTerminalInputPreview(
  state: TerminalInputState,
  preview: SessionInputPreview,
): TerminalInputState {
  switch (preview.kind) {
    case "data":
      return applyTerminalInputData(state, preview.data);
    case "replace":
      return replaceValue(preview.value);
    case "replace-and-execute":
      return resetState();
    case "reset":
      return resetState();
  }
}

export function getTrackedCommand(state: TerminalInputState): string {
  if (state.desynced || state.multiline) {
    return "";
  }
  return sanitizeTerminalCommand(state.value);
}

export function canSuggestFromTracker(state: TerminalInputState): boolean {
  return (
    !state.desynced &&
    !state.multiline &&
    state.cursor === state.value.length &&
    getTrackedCommand(state).length > 0
  );
}
