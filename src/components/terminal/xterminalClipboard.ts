import type { ClipboardPathPayload } from "@/lib/clipboard";

const OSC52_MAX_DECODED_BYTES = 1024 * 1024;

function isWindowsPlatform() {
  return /win/i.test(navigator.platform || "");
}

function quotePastedPath(path: string) {
  if (isWindowsPlatform()) {
    return `"${path.replace(/"/g, '\\"')}"`;
  }
  return quotePosixPath(path);
}

export function quotePosixPath(path: string) {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

export function buildClipboardPathPasteText(payload: ClipboardPathPayload | null) {
  if (!payload) return null;
  if (payload.kind === "image_file") {
    return payload.path ? quotePastedPath(payload.path) : null;
  }

  const paths = payload.paths.map((path) => path.trim()).filter((path) => !!path);
  if (paths.length === 0) return null;
  return paths.map(quotePastedPath).join(" ");
}

export function decodeOsc52ClipboardText(data: string): string | null {
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
