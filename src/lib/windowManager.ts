import { emit } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import i18n from "../i18n";
import { isMacOS } from "./platform";

interface ChildWindowOptions {
  label: string;
  title: string;
  url: string;
  width?: number;
  height?: number;
  resizable?: boolean;
}

const MAIN_WINDOW_LABEL = "main";
const AUTO_UPLOAD_WINDOW_PREFIX = "auto-upload-";
const MODAL_CHILD_LABELS = new Set(["settings", "new-session", "quick-command"]);

export function isModalChildLabel(label: string) {
  return MODAL_CHILD_LABELS.has(label) || label.startsWith(AUTO_UPLOAD_WINDOW_PREFIX);
}

function needsAlwaysOnTop(label: string) {
  return label.startsWith(AUTO_UPLOAD_WINDOW_PREFIX);
}

async function getMainWindow() {
  return (await WebviewWindow.getByLabel(MAIN_WINDOW_LABEL)) ?? getCurrentWindow();
}

async function getOpenModalChildWindows() {
  const windows = await WebviewWindow.getAll();
  return windows.filter(
    (window) => window.label !== MAIN_WINDOW_LABEL && isModalChildLabel(window.label),
  );
}

async function applyModalWindowState(excludedLabel?: string) {
  const [mainWindow, modalWindows] = await Promise.all([
    getMainWindow(),
    getOpenModalChildWindows(),
  ]);
  const remainingModalWindows = excludedLabel
    ? modalWindows.filter((window) => window.label !== excludedLabel)
    : modalWindows;
  const hasModalChild = remainingModalWindows.length > 0;

  await mainWindow.setEnabled(!hasModalChild).catch(() => {});
  await mainWindow.setFocusable(!hasModalChild).catch(() => {});

  if (hasModalChild) {
    const topModalWindow = remainingModalWindows[remainingModalWindows.length - 1];
    await topModalWindow.show().catch(() => {});
    await topModalWindow.setAlwaysOnTop(needsAlwaysOnTop(topModalWindow.label)).catch(() => {});
    await topModalWindow.setFocus().catch(() => {});
    return;
  }

  await mainWindow.show().catch(() => {});
  await mainWindow.setFocus().catch(() => {});
}

export async function syncMainWindowModalState() {
  await applyModalWindowState();
}

export async function prepareForModalChildClose(closingLabel: string) {
  await applyModalWindowState(closingLabel);
}

export async function bounceTopModalWindow() {
  const modalWindows = await getOpenModalChildWindows();
  const topModalWindow = modalWindows[modalWindows.length - 1];
  if (!topModalWindow) return;

  await topModalWindow.requestUserAttention(UserAttentionType.Critical).catch(() => {});
  await topModalWindow.setAlwaysOnTop(needsAlwaysOnTop(topModalWindow.label)).catch(() => {});
  await topModalWindow.setFocus().catch(() => {});
}

export async function openChildWindow(opts: ChildWindowOptions) {
  const existing = await WebviewWindow.getByLabel(opts.label);
  if (existing) {
    await existing.setTitle(opts.title).catch(() => {});
    await existing.show().catch(() => {});
    await existing.setAlwaysOnTop(needsAlwaysOnTop(opts.label)).catch(() => {});
    await existing.setFocus().catch(() => {});
    await syncMainWindowModalState().catch(() => {});
    return existing;
  }
  const parentWindow = await getMainWindow();
  const win = new WebviewWindow(opts.label, {
    url: opts.url,
    title: opts.title,
    width: opts.width ?? 720,
    height: opts.height ?? 560,
    visible: false,
    center: true,
    decorations: isMacOS,
    titleBarStyle: isMacOS ? "overlay" : undefined,
    hiddenTitle: isMacOS || undefined,
    resizable: opts.resizable ?? true,
    alwaysOnTop: needsAlwaysOnTop(opts.label),
    parent: parentWindow,
  });
  win.once("tauri://created", () => {
    emit("child-window-opened", { label: opts.label });
    void win.setAlwaysOnTop(needsAlwaysOnTop(opts.label)).catch(() => {});
    void win.setFocus().catch(() => {});
    void syncMainWindowModalState();
  });
  win.once("tauri://destroyed", () => {
    emit("child-window-closed", { label: opts.label });
    void syncMainWindowModalState();
  });
  win.once("tauri://error", () => {
    void syncMainWindowModalState();
  });
  return win;
}

export function openSettings(tab?: string) {
  const url = tab
    ? `index.html?window=settings&tab=${encodeURIComponent(tab)}`
    : "index.html?window=settings";
  return openChildWindow({
    label: "settings",
    title: i18n.t("settings.title"),
    url,
    width: 800,
    height: 560,
  });
}

export interface NewSessionTarget {
  targetLeafId?: string;
  anchorTabId?: string | null;
  sourceTabId?: string;
  sourcePaneId?: string;
}

export function openNewSession(editId?: string, autoConnect?: boolean, target?: NewSessionTarget) {
  return openNewSessionWithTarget(editId, autoConnect, target);
}

export function openNewSessionWithTarget(
  editId?: string,
  autoConnect?: boolean,
  target?: NewSessionTarget,
) {
  let url = editId
    ? `index.html?window=new-session&edit=${encodeURIComponent(editId)}`
    : "index.html?window=new-session";
  if (autoConnect) url += "&autoConnect=1";
  if (target?.targetLeafId) {
    url += `&targetLeafId=${encodeURIComponent(target.targetLeafId)}`;
  }
  if (target?.anchorTabId) {
    url += `&anchorTabId=${encodeURIComponent(target.anchorTabId)}`;
  }
  if (target?.sourceTabId) {
    url += `&sourceTabId=${encodeURIComponent(target.sourceTabId)}`;
  }
  if (target?.sourcePaneId) {
    url += `&sourcePaneId=${encodeURIComponent(target.sourcePaneId)}`;
  }
  return openChildWindow({
    label: "new-session",
    title: i18n.t(editId ? "dialog.editConnection" : "dialog.newConnection"),
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
    title: i18n.t(editJson ? "quickCommands.editCommand" : "quickCommands.addCommand"),
    url,
    width: 540,
    height: 640,
  });
}

export function openAutoUpload(data: { sessionId: string; localPath: string; remotePath: string }) {
  // Use a unique label for each upload dialog so multiple files modifying simultaneously don't conflict
  // We use the local path base64 (or just random) to make it unique per file
  const safePath = btoa(encodeURIComponent(data.localPath)).replace(/[^a-zA-Z0-9]/g, "");
  const label = `auto-upload-${safePath}`;
  const url = `index.html?window=auto-upload&data=${encodeURIComponent(JSON.stringify(data))}`;
  return openChildWindow({
    label,
    title: i18n.t("fileExplorer.fileModified"),
    url,
    width: 440,
    height: 240,
    resizable: false,
  });
}
