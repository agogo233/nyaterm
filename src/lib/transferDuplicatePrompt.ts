export type TransferDuplicateChoice = "skip" | "overwrite";
export type TransferDuplicatePromptChoice = TransferDuplicateChoice | "overwriteAllForTask";

export interface TransferDuplicateRequest {
  requestId: string;
  sessionId: string;
  remotePath: string;
  fileName: string;
  isDirectory: boolean;
  targetWindowLabel?: string | null;
  respondViaBackend?: boolean;
  allowApplyToTask?: boolean;
  unverified?: boolean;
}

type TransferDuplicateListener = (request: TransferDuplicateRequest | null) => void;

let activeRequest: TransferDuplicateRequest | null = null;
let localResolver: ((choice: TransferDuplicatePromptChoice) => void) | null = null;
const listeners = new Set<TransferDuplicateListener>();

function notifyListeners() {
  for (const listener of listeners) {
    listener(activeRequest);
  }
}

export function subscribeTransferDuplicatePrompt(listener: TransferDuplicateListener) {
  listeners.add(listener);
  listener(activeRequest);
  return () => {
    listeners.delete(listener);
  };
}

export function showTransferDuplicatePrompt(
  request: TransferDuplicateRequest,
): Promise<TransferDuplicatePromptChoice> {
  if (localResolver) {
    localResolver("skip");
  }

  return new Promise((resolve) => {
    localResolver = resolve;
    activeRequest = { ...request, respondViaBackend: request.respondViaBackend ?? false };
    notifyListeners();
  });
}

export function resolveTransferDuplicatePrompt(choice: TransferDuplicatePromptChoice) {
  const resolver = localResolver;
  localResolver = null;
  activeRequest = null;
  notifyListeners();
  resolver?.(choice);
}

export function setBackendTransferDuplicatePrompt(request: TransferDuplicateRequest | null) {
  if (request) {
    activeRequest = { ...request, respondViaBackend: true, allowApplyToTask: false };
    notifyListeners();
    return;
  }

  if (activeRequest?.respondViaBackend) {
    activeRequest = null;
    notifyListeners();
  }
}

export function getActiveTransferDuplicatePrompt() {
  return activeRequest;
}
