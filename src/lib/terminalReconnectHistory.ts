export interface TerminalReconnectSnapshot {
  content: string;
  lineTimestamps: Array<[number, number]>;
  captureStartLine: number;
  captureEndLine: number;
}

interface TerminalReconnectHistoryStore {
  captureHandlers: Map<string, () => TerminalReconnectSnapshot>;
  preservedContent: Map<string, TerminalReconnectSnapshot>;
}

const store = (() => {
  const globalStore = globalThis as typeof globalThis & {
    __nyatermTerminalReconnectHistory?: TerminalReconnectHistoryStore;
  };

  globalStore.__nyatermTerminalReconnectHistory ??= {
    captureHandlers: new Map<string, () => TerminalReconnectSnapshot>(),
    preservedContent: new Map<string, TerminalReconnectSnapshot>(),
  };

  return globalStore.__nyatermTerminalReconnectHistory;
})() as TerminalReconnectHistoryStore;

export function registerTerminalReconnectCapture(
  sessionId: string,
  capture: () => TerminalReconnectSnapshot,
) {
  store.captureHandlers.set(sessionId, capture);

  return () => {
    if (store.captureHandlers.get(sessionId) === capture) {
      store.captureHandlers.delete(sessionId);
    }
  };
}

export function captureTerminalReconnectContent(sessionId: string) {
  return store.captureHandlers.get(sessionId)?.() ?? null;
}

export function preserveTerminalReconnectContent(
  sessionId: string,
  content: TerminalReconnectSnapshot | null,
) {
  if (content !== null) {
    store.preservedContent.set(sessionId, content);
  }
}

export function consumePreservedTerminalReconnectContent(sessionId: string) {
  const content = store.preservedContent.get(sessionId) ?? null;
  store.preservedContent.delete(sessionId);
  return content;
}
