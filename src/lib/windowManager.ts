import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

interface ChildWindowOptions {
  label: string;
  title: string;
  url: string;
  width?: number;
  height?: number;
}

export async function openChildWindow(opts: ChildWindowOptions) {
  const existing = await WebviewWindow.getByLabel(opts.label);
  if (existing) {
    await existing.setFocus();
    return existing;
  }
  return new WebviewWindow(opts.label, {
    url: opts.url,
    title: opts.title,
    width: opts.width ?? 720,
    height: opts.height ?? 560,
    visible: false,
    center: true,
    resizable: true,
  });
}

export function openSettings() {
  return openChildWindow({
    label: "settings",
    title: "Settings",
    url: "index.html?window=settings",
    width: 800,
    height: 560,
  });
}

export function openNewSession(editId?: string, autoConnect?: boolean) {
  let url = editId
    ? `index.html?window=new-session&edit=${encodeURIComponent(editId)}`
    : "index.html?window=new-session";
  if (autoConnect) url += "&autoConnect=1";
  return openChildWindow({
    label: "new-session",
    title: "New Session",
    url,
    width: 520,
    height: 620,
  });
}

export function openQuickCommand(editJson?: string) {
  const url = editJson
    ? `index.html?window=quick-command&data=${encodeURIComponent(editJson)}`
    : "index.html?window=quick-command";
  return openChildWindow({
    label: "quick-command",
    title: "Quick Command",
    url,
    width: 540,
    height: 640,
  });
}
