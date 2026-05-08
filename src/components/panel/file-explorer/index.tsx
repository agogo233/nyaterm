import { emit, listen } from "@tauri-apps/api/event";
import { downloadDir, join, tempDir } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  type ComponentProps,
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  MdArrowUpward,
  MdContentCopy,
  MdCreateNewFolder,
  MdDelete,
  MdDownload,
  MdDriveFolderUpload,
  MdFolderOff,
  MdInfo,
  MdLink,
  MdNoteAdd,
  MdRefresh,
  MdSend,
  MdSync,
  MdSyncLock,
  MdUpload,
} from "react-icons/md";
import { toast } from "sonner";
import DeleteDialog, {
  type DeleteDialogData,
  type DeleteDialogItem,
} from "@/components/dialog/file-explorer/DeleteDialog";
import MoveDialog, { type MoveDialogData } from "@/components/dialog/file-explorer/MoveDialog";
import NewItemDialog, {
  type NewItemDialogData,
} from "@/components/dialog/file-explorer/NewItemDialog";
import NewSymlinkDialog, {
  type NewSymlinkDialogData,
} from "@/components/dialog/file-explorer/NewSymlinkDialog";
import PropertiesDialog, {
  type PropertiesDialogData,
} from "@/components/dialog/file-explorer/PropertiesDialog";
import RenameDialog, {
  type RenameDialogData,
} from "@/components/dialog/file-explorer/RenameDialog";
import PanelHeader from "@/components/layout/PanelHeader";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useApp } from "@/context/AppContext";
import { openAIAssistant } from "@/lib/aiEvents";
import { getErrorMessage } from "@/lib/errors";
import { invoke } from "@/lib/invoke";
import { logger } from "@/lib/logger";
import { sendSessionInput } from "@/lib/sessionInput";
import { formatSize } from "@/lib/utils";
import { openAutoUpload } from "@/lib/windowManager";
import type {
  AICustomActionConfig,
  FileEntry,
  FileExplorerProps,
  SessionInfo,
} from "@/types/global";
import { FileListItem } from "./FileListItem";

interface TransferEventPayload {
  session_id: string;
  direction: string;
  status: string;
  remote_path?: string;
}

interface ResolvedLocalDropPathEntry {
  path: string;
  isDir: boolean;
}

interface RemoteTextFile {
  path: string;
  content: string;
  size: number;
}

interface ExternalFileDropEventPayload {
  kind: "enter" | "over" | "leave" | "drop";
  paths: string[];
  position: {
    x: number;
    y: number;
  };
}

const EXTERNAL_FILE_DROP_MESSAGE_KIND = "external-file-drop";

type WebView2Bridge = {
  postMessageWithAdditionalObjects: (
    message: unknown,
    additionalObjects: ArrayLike<unknown>,
  ) => void;
};

type DataTransferItemWithFileSystemHandle = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<unknown>;
};

declare global {
  interface Window {
    chrome?: {
      webview?: WebView2Bridge;
    };
  }
}

function getLocalPathName(path: string, fallback: string) {
  return path.split(/[\\/]/).pop() || fallback;
}

function buildRemoteUploadPath(remoteDir: string, name: string) {
  return remoteDir === "/" ? `/${name}` : `${remoteDir}/${name}`;
}

function isDropPositionInsideElement(
  position: { x: number; y: number },
  element: HTMLElement | null,
) {
  if (!element) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const scale = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const candidates =
    scale === 1 ? [position] : [position, { x: position.x / scale, y: position.y / scale }];

  return candidates.some(
    ({ x, y }) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
  );
}

function isExternalFileDragEvent(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function getDragEventPosition(event: DragEvent) {
  return {
    x: event.clientX,
    y: event.clientY,
  };
}

function getExternalFileDropBridge() {
  return window.chrome?.webview;
}

function createExternalFileDropBridgeMessage(position: { x: number; y: number }) {
  return JSON.stringify({
    kind: EXTERNAL_FILE_DROP_MESSAGE_KIND,
    position,
  });
}

async function collectExternalDropAdditionalObjects(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) {
    return [];
  }

  const fileItems = Array.from(dataTransfer.items ?? []).filter((item) => item.kind === "file");
  if (fileItems.length === 0 && dataTransfer.files.length > 0) {
    return Array.from(dataTransfer.files);
  }

  const additionalObjects: unknown[] = [];
  for (const item of fileItems) {
    const file = item.getAsFile();
    if (file) {
      additionalObjects.push(file);
      continue;
    }

    const itemWithHandle = item as DataTransferItemWithFileSystemHandle;
    if (typeof itemWithHandle.getAsFileSystemHandle === "function") {
      try {
        const handle = await itemWithHandle.getAsFileSystemHandle();
        if (handle) {
          additionalObjects.push(handle);
        }
      } catch {
        // Fall back to File objects if the runtime cannot expose FileSystemHandle.
      }
    }
  }

  return additionalObjects;
}

function getParentPath(path: string) {
  const normalized = path !== "/" && path.endsWith("/") ? path.slice(0, -1) : path;
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

function normalizeDirectoryPath(path: string) {
  if (!path || path === "/") return path;
  const normalized = path.replace(/\/+$/, "");
  return normalized || "/";
}

function ToolbarDivider() {
  return (
    <span
      aria-hidden="true"
      className="mx-1 h-3 w-px shrink-0 rounded-full"
      style={{ backgroundColor: "var(--df-border)" }}
    />
  );
}

const MemoizedFileExplorer = memo(FileExplorer);

export default MemoizedFileExplorer;

type ToolbarIconButtonProps = ComponentProps<typeof Button> & {
  label: string;
};

function ToolbarIconButton({ label, children, ...props }: ToolbarIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} type="button" {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

type FileExplorerSessionCache = {
  files: FileEntry[];
  currentPath: string;
  homeDir: string;
  history: string[];
  historyIndex: number;
};

type LoadDirectoryOptions = {
  history?: "push" | "preserve";
};

// Keep per-session explorer state alive when the panel is unmounted and shown again.
const fileExplorerSessionCacheStore = new Map<string, FileExplorerSessionCache>();
const FILE_LIST_ITEM_HEIGHT = 30;
const FILE_LIST_OVERSCAN = 8;
const PARENT_DIRECTORY_ENTRY_NAME = "..";
const PARENT_DIRECTORY_ENTRY: FileEntry = {
  name: PARENT_DIRECTORY_ENTRY_NAME,
  is_dir: true,
  is_symlink: false,
  size: 0,
  permissions: "",
};

function isParentDirectoryEntry(entry: FileEntry) {
  return entry.name === PARENT_DIRECTORY_ENTRY_NAME;
}

function buildSessionCacheSnapshot(
  files: FileEntry[],
  currentPath: string,
  homeDir: string,
  history: string[],
  historyIndex: number,
): FileExplorerSessionCache | null {
  const normalizedCurrentPath = normalizeDirectoryPath(currentPath);
  const normalizedHomeDir = normalizeDirectoryPath(homeDir);
  const normalizedHistory = history
    .map((entry) => normalizeDirectoryPath(entry))
    .filter((entry): entry is string => !!entry);

  if (!normalizedCurrentPath) {
    return null;
  }

  const nextHistory = normalizedHistory.length > 0 ? normalizedHistory : [normalizedCurrentPath];
  const nextHistoryIndex = Math.min(Math.max(historyIndex, 0), nextHistory.length - 1);

  return {
    files,
    currentPath: normalizedCurrentPath,
    homeDir: normalizedHomeDir || normalizedCurrentPath,
    history: nextHistory,
    historyIndex: nextHistoryIndex,
  };
}

/** Remote file browser for active SSH session. Lists dirs/files, supports navigation. */
function FileExplorer({ activeSessionId, activeSessionType }: FileExplorerProps) {
  const { t } = useTranslation();
  const { appSettings } = useApp();
  const canBrowseFiles = !!activeSessionId && activeSessionType === "SSH";
  const hasUnsupportedSession =
    !!activeSessionId && !!activeSessionType && activeSessionType !== "SSH";

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [homeDir, setHomeDir] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const lastSelectedRef = useRef<string | null>(null);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathInputText, setPathInputText] = useState("");
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [renameDialogData, setRenameDialogData] = useState<RenameDialogData | null>(null);
  const [deleteDialogData, setDeleteDialogData] = useState<DeleteDialogData | null>(null);
  const [moveDialogData, setMoveDialogData] = useState<MoveDialogData | null>(null);
  const [newItemDialogData, setNewItemDialogData] = useState<NewItemDialogData | null>(null);
  const [newSymlinkDialogData, setNewSymlinkDialogData] = useState<NewSymlinkDialogData | null>(
    null,
  );
  const [propertiesDialogData, setPropertiesDialogData] = useState<PropertiesDialogData | null>(
    null,
  );
  const [autoSyncCwd, setAutoSyncCwd] = useState(false);
  const [cwdTrackingActive, setCwdTrackingActive] = useState(false);
  const alwaysUploadFilesRef = useRef<Set<string>>(new Set());
  const filesRef = useRef<FileEntry[]>([]);
  const currentPathRef = useRef("");
  const homeDirRef = useRef("");
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const pathInputRef = useRef<HTMLInputElement | null>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const dragSelectionRef = useRef<{
    anchor: string;
    baseSelection: Set<string>;
    additive: boolean;
  } | null>(null);

  const sessionCacheRef = useRef(fileExplorerSessionCacheStore);
  const prevSessionIdRef = useRef<string | null>(null);
  const pendingManualRefreshUploadsRef = useRef<Set<string>>(new Set());
  const [isExternalDropActive, setIsExternalDropActive] = useState(false);
  const [listScrollTop, setListScrollTop] = useState(0);
  const [listViewportHeight, setListViewportHeight] = useState(0);

  filesRef.current = files;
  currentPathRef.current = currentPath;
  homeDirRef.current = homeDir;

  const resetExternalDropHover = useCallback(() => {
    setIsExternalDropActive(false);
  }, []);
  const listScrollResetKey = `${activeSessionId ?? ""}:${currentPath}`;

  useEffect(() => {
    const container = listContainerRef.current;
    if (!container) {
      setListScrollTop(0);
      setListViewportHeight(0);
      return;
    }

    let scrollFrame = 0;
    const updateMetrics = () => {
      setListScrollTop(container.scrollTop);
      setListViewportHeight(container.clientHeight);
    };
    const handleScroll = () => {
      if (scrollFrame !== 0) {
        return;
      }

      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        setListScrollTop(container.scrollTop);
      });
    };

    updateMetrics();
    container.addEventListener("scroll", handleScroll, { passive: true });

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            updateMetrics();
          });
    resizeObserver?.observe(container);

    return () => {
      container.removeEventListener("scroll", handleScroll);
      resizeObserver?.disconnect();
      if (scrollFrame !== 0) {
        window.cancelAnimationFrame(scrollFrame);
      }
    };
  }, []);

  useEffect(() => {
    if (!listScrollResetKey && !listContainerRef.current) {
      setListScrollTop(0);
      return;
    }

    const container = listContainerRef.current;
    if (container) {
      container.scrollTop = 0;
    }
    setListScrollTop(0);
  }, [listScrollResetKey]);

  const resolveUploadTarget = useCallback(() => {
    if (!activeSessionId) return null;

    return {
      sessionId: activeSessionId,
      remoteDir: normalizeDirectoryPath(currentPathRef.current) || homeDirRef.current || "/",
    };
  }, [activeSessionId]);

  useEffect(() => {
    return () => {
      if (!activeSessionId) return;
      const snapshot = buildSessionCacheSnapshot(
        filesRef.current,
        currentPathRef.current,
        homeDirRef.current,
        historyRef.current,
        historyIndexRef.current,
      );
      if (snapshot) {
        sessionCacheRef.current.set(activeSessionId, snapshot);
      }
    };
  }, [activeSessionId]);

  useEffect(() => {
    const handleMouseUp = () => {
      dragSelectionRef.current = null;
    };

    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // Resolve whether backend terminal-path tracking is available for this session.
  useEffect(() => {
    if (!canBrowseFiles || !activeSessionId) {
      setCwdTrackingActive(false);
      setAutoSyncCwd(false);
      return;
    }
    invoke<SessionInfo[]>("list_sessions")
      .then((sessions) => {
        const s = sessions.find((s) => s.id === activeSessionId);
        const active = s?.injection_active ?? false;
        setCwdTrackingActive(active);
        if (!active) setAutoSyncCwd(false);
      })
      .catch(() => {
        setCwdTrackingActive(false);
        setAutoSyncCwd(false);
      });
  }, [activeSessionId, canBrowseFiles]);

  useEffect(() => {
    const unlisten = listen<{ session_id: string; local_path: string; remote_path: string }>(
      "file-modified",
      (e) => {
        const { session_id, local_path, remote_path } = e.payload;
        const watchKey = `${session_id}:${local_path}`;

        if (alwaysUploadFilesRef.current.has(watchKey)) {
          // File was marked "Always list", just upload silently
          invoke("upload_local_file", {
            sessionId: session_id,
            localPath: local_path,
            remotePath: remote_path,
          }).catch((err) =>
            logger.error({
              domain: "watcher.sync",
              event: "auto_upload.failed",
              message: "Auto upload failed",
              ids: { session_id },
              error: err,
            }),
          );
        } else {
          // Trigger the window
          openAutoUpload({
            sessionId: session_id,
            localPath: local_path,
            remotePath: remote_path,
          });
        }
      },
    );

    const unlistenDecision = listen<{ sessionId: string; localPath: string; always: boolean }>(
      "auto-upload-decision",
      (e) => {
        const { sessionId, localPath, always } = e.payload;
        if (always) {
          alwaysUploadFilesRef.current.add(`${sessionId}:${localPath}`);
        }
      },
    );

    return () => {
      unlisten.then((fn) => fn());
      unlistenDecision.then((fn) => fn());
    };
  }, []);

  const pushDirectoryHistory = useCallback((path: string) => {
    const normalizedPath = normalizeDirectoryPath(path);
    const currentIndex = historyIndexRef.current;
    const currentEntry = currentIndex >= 0 ? historyRef.current[currentIndex] : null;
    if (currentEntry === normalizedPath) {
      return;
    }

    const nextHistory = historyRef.current.slice(0, currentIndex + 1);
    nextHistory.push(normalizedPath);
    historyRef.current = nextHistory;
    historyIndexRef.current = nextHistory.length - 1;
  }, []);

  const loadDirectory = useCallback(
    async (path: string, options?: LoadDirectoryOptions) => {
      if (!canBrowseFiles || !activeSessionId) return false;
      const normalizedPath = normalizeDirectoryPath(path);
      if (!normalizedPath) return false;
      const historyMode = options?.history ?? "push";
      setDirectoryLoading(true);
      setError(null);

      try {
        const entries = await invoke<FileEntry[]>("list_remote_dir", {
          sessionId: activeSessionId,
          path: normalizedPath,
        });
        entries.sort((a, b) => {
          if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

        const pathChanged = normalizeDirectoryPath(currentPathRef.current) !== normalizedPath;
        if (historyMode === "push") {
          pushDirectoryHistory(normalizedPath);
        }

        startTransition(() => {
          setFiles(entries);
          setCurrentPath(normalizedPath);
          setSelectedFiles((prev) => {
            if (pathChanged) {
              lastSelectedRef.current = null;
              return new Set();
            }

            const entryNames = new Set(entries.map((entry) => entry.name));
            const next = new Set([...prev].filter((name) => entryNames.has(name)));
            if (lastSelectedRef.current && !entryNames.has(lastSelectedRef.current)) {
              lastSelectedRef.current = null;
            }
            return next;
          });
        });

        const cached = sessionCacheRef.current.get(activeSessionId);
        const snapshot = buildSessionCacheSnapshot(
          entries,
          normalizedPath,
          cached?.homeDir ?? homeDirRef.current,
          historyRef.current,
          historyIndexRef.current,
        );
        if (snapshot) {
          sessionCacheRef.current.set(activeSessionId, snapshot);
        }
        return true;
      } catch (e) {
        const msg = String(e);
        if (filesRef.current.length > 0) {
          toast.error(msg);
        } else {
          setError(msg);
        }
        return false;
      } finally {
        setDirectoryLoading(false);
      }
    },
    [activeSessionId, canBrowseFiles, pushDirectoryHistory],
  );

  const refreshCurrentDirectory = useCallback(() => {
    const targetPath =
      normalizeDirectoryPath(currentPathRef.current) || normalizeDirectoryPath(homeDirRef.current);
    if (!targetPath) return Promise.resolve(false);
    return loadDirectory(targetPath);
  }, [loadDirectory]);

  const uploadLocalEntriesToTarget = useCallback(
    async (
      target: { sessionId: string; remoteDir: string },
      entries: Array<{ path: string; isDir: boolean }>,
    ) => {
      if (entries.length === 0) return;

      let refreshAfterUpload = false;

      for (const entry of entries) {
        if (!entry.path) continue;

        if (entry.isDir) {
          const folderName = getLocalPathName(entry.path, "uploaded_folder");
          const remotePath = buildRemoteUploadPath(target.remoteDir, folderName);

          try {
            await invoke("upload_local_directory", {
              sessionId: target.sessionId,
              localPath: entry.path,
              remotePath,
            });
            refreshAfterUpload = true;
          } catch (error) {
            logger.error({
              domain: "transfer.lifecycle",
              event: "upload.folder_failed",
              message: "Upload folder failed",
              ids: { session_id: target.sessionId },
              data: {
                local_path: entry.path,
                remote_path: remotePath,
              },
              error,
            });
          }

          continue;
        }

        const fileName = getLocalPathName(entry.path, "uploaded_file");
        const remotePath = buildRemoteUploadPath(target.remoteDir, fileName);
        const uploadKey = `${target.sessionId}:${remotePath}`;

        pendingManualRefreshUploadsRef.current.add(uploadKey);
        try {
          await invoke("upload_local_file", {
            sessionId: target.sessionId,
            localPath: entry.path,
            remotePath,
          });
        } catch (error) {
          logger.error({
            domain: "transfer.lifecycle",
            event: "upload.failed",
            message: "Upload failed",
            ids: { session_id: target.sessionId },
            data: {
              local_path: entry.path,
              remote_path: remotePath,
            },
            error,
          });
          pendingManualRefreshUploadsRef.current.delete(uploadKey);
        }
      }

      if (
        refreshAfterUpload &&
        activeSessionId === target.sessionId &&
        normalizeDirectoryPath(currentPathRef.current) === normalizeDirectoryPath(target.remoteDir)
      ) {
        void refreshCurrentDirectory();
      }
    },
    [activeSessionId, refreshCurrentDirectory],
  );

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

  const processExternalDropPaths = useCallback(
    async (target: { sessionId: string; remoteDir: string }, dropPaths: string[]) => {
      try {
        const resolvedLocalEntries = await resolveLocalDropPaths(dropPaths);
        if (resolvedLocalEntries.length === 0) {
          logger.warn({
            domain: "ui.error",
            event: "file_explorer.external_drop_paths_unresolved",
            message: "Native external drop did not resolve to usable local paths",
            ids: { session_id: target.sessionId },
            data: {
              remote_dir: target.remoteDir,
              path_count: dropPaths.length,
            },
          });
          toast.error(t("fileExplorer.externalDropPathsRequired"));
          return;
        }

        await uploadLocalEntriesToTarget(
          target,
          resolvedLocalEntries.map((entry) => ({
            path: entry.path,
            isDir: entry.isDir,
          })),
        );
      } catch (error) {
        logger.error({
          domain: "ui.error",
          event: "file_explorer.external_drop_failed",
          message: "Failed to process native external drop paths",
          ids: { session_id: target.sessionId },
          data: {
            remote_dir: target.remoteDir,
            path_count: dropPaths.length,
          },
          error,
        });
        toast.error(String(error));
      }
    },
    [resolveLocalDropPaths, t, uploadLocalEntriesToTarget],
  );

  useEffect(() => {
    resetExternalDropHover();
    const cache = sessionCacheRef.current;
    const prevId = prevSessionIdRef.current;

    if (prevId && prevId !== activeSessionId) {
      const snapshot = buildSessionCacheSnapshot(
        filesRef.current,
        currentPathRef.current,
        homeDirRef.current,
        historyRef.current,
        historyIndexRef.current,
      );
      if (snapshot) {
        cache.set(prevId, snapshot);
      }
    }
    prevSessionIdRef.current = activeSessionId;

    if (!canBrowseFiles || !activeSessionId) {
      setFiles([]);
      setCurrentPath("");
      setHomeDir("");
      setError(null);
      setSelectedFiles(new Set());
      historyRef.current = [];
      historyIndexRef.current = -1;
      lastSelectedRef.current = null;
      return;
    }

    const cached = cache.get(activeSessionId);
    if (cached?.currentPath) {
      setFiles(cached.files);
      setCurrentPath(cached.currentPath);
      setHomeDir(cached.homeDir);
      setSelectedFiles(new Set());
      setError(null);
      historyRef.current = [...cached.history];
      historyIndexRef.current = cached.historyIndex;
      lastSelectedRef.current = null;
      return;
    }

    historyRef.current = [];
    historyIndexRef.current = -1;
    lastSelectedRef.current = null;
    setSelectedFiles(new Set());

    let cancelled = false;
    (async () => {
      try {
        const cachedHome = normalizeDirectoryPath(cached?.homeDir ?? "");
        if (cachedHome) {
          homeDirRef.current = cachedHome;
          setHomeDir(cachedHome);
          await loadDirectory(cachedHome);
          return;
        }

        const home = await invoke<string>("get_home_dir", { sessionId: activeSessionId });
        if (cancelled) return;
        homeDirRef.current = home;
        setHomeDir(home);
        await loadDirectory(home);
      } catch {
        if (cancelled) return;
        await loadDirectory("~");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, canBrowseFiles, loadDirectory, resetExternalDropHover]);

  useEffect(() => {
    if (isEditingPath) {
      pathInputRef.current?.focus();
    }
  }, [isEditingPath]);

  useEffect(() => {
    if (!canBrowseFiles || !activeSessionId || !currentPath) return;

    const unlisten = listen<TransferEventPayload>("transfer-event", (event) => {
      const { session_id, direction, status, remote_path } = event.payload;
      const uploadKey = remote_path ? `${session_id}:${remote_path}` : null;

      if (
        session_id !== activeSessionId ||
        direction !== "upload" ||
        !remote_path ||
        !uploadKey ||
        !pendingManualRefreshUploadsRef.current.has(uploadKey)
      ) {
        return;
      }

      if (status === "completed" || status === "error" || status === "cancelled") {
        pendingManualRefreshUploadsRef.current.delete(uploadKey);
      }

      if (status === "completed" && getParentPath(remote_path) === currentPath) {
        void refreshCurrentDirectory();
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [activeSessionId, canBrowseFiles, currentPath, refreshCurrentDirectory]);

  useEffect(() => {
    const bridge = getExternalFileDropBridge();
    if (!bridge?.postMessageWithAdditionalObjects) {
      return;
    }

    const updateExternalDropState = (event: DragEvent) => {
      if (!isExternalFileDragEvent(event)) {
        return;
      }

      event.preventDefault();
      const isOverDropTarget = isDropPositionInsideElement(
        getDragEventPosition(event),
        listContainerRef.current,
      );
      const isActive = canBrowseFiles && !!activeSessionId && isOverDropTarget;

      setIsExternalDropActive(isActive);
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = isActive ? "copy" : "none";
      }
    };

    const handleWindowDragLeave = (event: DragEvent) => {
      if (!isExternalFileDragEvent(event)) {
        return;
      }

      event.preventDefault();

      const leftWindow =
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight;

      if (
        leftWindow ||
        !isDropPositionInsideElement(getDragEventPosition(event), listContainerRef.current)
      ) {
        resetExternalDropHover();
      }
    };

    const handleWindowDrop = (event: DragEvent) => {
      if (!isExternalFileDragEvent(event)) {
        return;
      }

      event.preventDefault();
      const dropPosition = getDragEventPosition(event);
      const isOverDropTarget = isDropPositionInsideElement(dropPosition, listContainerRef.current);
      resetExternalDropHover();

      if (!canBrowseFiles || !activeSessionId || !isOverDropTarget) {
        return;
      }

      const dataTransfer = event.dataTransfer;
      if (dataTransfer?.files && dataTransfer.files.length > 0) {
        try {
          bridge.postMessageWithAdditionalObjects(
            createExternalFileDropBridgeMessage(dropPosition),
            dataTransfer.files,
          );
        } catch (error) {
          logger.error({
            domain: "ui.error",
            event: "file_explorer.external_drop_filelist_bridge_failed",
            message:
              "Failed to bridge external file drop FileList through WebView2 additional objects",
            ids: { session_id: activeSessionId },
            data: {
              remote_dir:
                normalizeDirectoryPath(currentPathRef.current) || homeDirRef.current || "/",
              file_count: dataTransfer.files.length,
            },
            error,
          });
          toast.error(String(error));
        }
        return;
      }

      void (async () => {
        try {
          const additionalObjects = await collectExternalDropAdditionalObjects(dataTransfer);
          if (additionalObjects.length === 0) {
            logger.warn({
              domain: "ui.error",
              event: "file_explorer.external_drop_objects_unavailable",
              message: "External file drop did not expose any transferable WebView2 objects",
              ids: { session_id: activeSessionId },
              data: {
                remote_dir:
                  normalizeDirectoryPath(currentPathRef.current) || homeDirRef.current || "/",
                item_count: dataTransfer?.items.length ?? 0,
                file_count: dataTransfer?.files.length ?? 0,
              },
            });
            toast.error(t("fileExplorer.externalDropPathsRequired"));
            return;
          }

          bridge.postMessageWithAdditionalObjects(
            createExternalFileDropBridgeMessage(dropPosition),
            additionalObjects,
          );
        } catch (error) {
          logger.error({
            domain: "ui.error",
            event: "file_explorer.external_drop_bridge_failed",
            message: "Failed to bridge external file drop through WebView2 additional objects",
            ids: { session_id: activeSessionId },
            data: {
              remote_dir:
                normalizeDirectoryPath(currentPathRef.current) || homeDirRef.current || "/",
            },
            error,
          });
          toast.error(String(error));
        }
      })();
    };

    const handleWindowBlur = () => {
      resetExternalDropHover();
    };

    window.addEventListener("dragenter", updateExternalDropState);
    window.addEventListener("dragover", updateExternalDropState);
    window.addEventListener("dragleave", handleWindowDragLeave);
    window.addEventListener("drop", handleWindowDrop);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      resetExternalDropHover();
      window.removeEventListener("dragenter", updateExternalDropState);
      window.removeEventListener("dragover", updateExternalDropState);
      window.removeEventListener("dragleave", handleWindowDragLeave);
      window.removeEventListener("drop", handleWindowDrop);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [activeSessionId, canBrowseFiles, resetExternalDropHover, t]);

  useEffect(() => {
    const bridge = getExternalFileDropBridge();
    if (!bridge?.postMessageWithAdditionalObjects) {
      return;
    }

    let cancelled = false;

    const unlistenPromise = listen<ExternalFileDropEventPayload>("external-file-drop", (event) => {
      if (cancelled) {
        return;
      }

      if (event.payload.kind !== "drop") {
        return;
      }

      resetExternalDropHover();

      const isOverDropTarget = isDropPositionInsideElement(
        event.payload.position,
        listContainerRef.current,
      );

      if (!canBrowseFiles || !activeSessionId || !isOverDropTarget) {
        return;
      }

      const target = resolveUploadTarget();
      if (!target) {
        return;
      }
      const dropPaths = event.payload.paths;

      void processExternalDropPaths(target, dropPaths);
    });

    return () => {
      cancelled = true;
      resetExternalDropHover();
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [
    activeSessionId,
    canBrowseFiles,
    processExternalDropPaths,
    resetExternalDropHover,
    resolveUploadTarget,
  ]);

  useEffect(() => {
    const bridge = getExternalFileDropBridge();
    if (bridge?.postMessageWithAdditionalObjects) {
      return;
    }

    let cancelled = false;

    const handleWindowBlur = () => {
      resetExternalDropHover();
    };

    window.addEventListener("blur", handleWindowBlur);

    const unlistenPromise = getCurrentWebview().onDragDropEvent((event) => {
      if (cancelled) {
        return;
      }

      const payload = event.payload;
      if (payload.type === "leave") {
        resetExternalDropHover();
        return;
      }

      const isOverDropTarget = isDropPositionInsideElement(
        payload.position,
        listContainerRef.current,
      );
      const isActive = canBrowseFiles && !!activeSessionId && isOverDropTarget;

      if (payload.type === "enter" || payload.type === "over") {
        setIsExternalDropActive(isActive);
        return;
      }

      resetExternalDropHover();

      if (!isActive) {
        return;
      }

      const target = resolveUploadTarget();
      if (!target) {
        return;
      }

      void processExternalDropPaths(target, payload.paths);
    });

    return () => {
      cancelled = true;
      resetExternalDropHover();
      window.removeEventListener("blur", handleWindowBlur);
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [
    activeSessionId,
    canBrowseFiles,
    processExternalDropPaths,
    resetExternalDropHover,
    resolveUploadTarget,
  ]);

  const getRangeSelection = useCallback(
    (
      anchorName: string,
      targetName: string,
      baseSelection = new Set<string>(),
      additive = false,
    ) => {
      const names = files.map((file) => file.name);
      const anchorIndex = names.indexOf(anchorName);
      const targetIndex = names.indexOf(targetName);
      if (anchorIndex < 0 || targetIndex < 0) {
        return additive ? new Set(baseSelection) : new Set<string>();
      }

      const [start, end] =
        anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
      const next = additive ? new Set(baseSelection) : new Set<string>();
      for (let index = start; index <= end; index += 1) {
        next.add(names[index]);
      }
      return next;
    },
    [files],
  );

  const handleSelectionStart = useCallback(
    (entry: FileEntry, event: ReactMouseEvent) => {
      if (event.button !== 0) return;

      listContainerRef.current?.focus();
      if (isParentDirectoryEntry(entry)) {
        dragSelectionRef.current = null;
        lastSelectedRef.current = null;
        setSelectedFiles(new Set([PARENT_DIRECTORY_ENTRY_NAME]));
        return;
      }

      const additive = event.ctrlKey || event.metaKey;
      setSelectedFiles((prev) => {
        const hasRangeAnchor = event.shiftKey && !!lastSelectedRef.current;
        const anchor = hasRangeAnchor ? (lastSelectedRef.current ?? entry.name) : entry.name;
        const baseSelection = additive ? new Set(prev) : new Set<string>();
        baseSelection.delete(PARENT_DIRECTORY_ENTRY_NAME);
        let next: Set<string>;

        if (hasRangeAnchor) {
          next = getRangeSelection(anchor, entry.name, baseSelection, additive);
        } else if (additive) {
          next = new Set(prev);
          next.delete(PARENT_DIRECTORY_ENTRY_NAME);
          if (next.has(entry.name)) {
            next.delete(entry.name);
          } else {
            next.add(entry.name);
          }
        } else {
          next = new Set([entry.name]);
        }

        dragSelectionRef.current = {
          anchor,
          baseSelection,
          additive,
        };
        lastSelectedRef.current = entry.name;
        return next;
      });
    },
    [getRangeSelection],
  );

  const handleSelectionDrag = useCallback(
    (entry: FileEntry, event: ReactMouseEvent) => {
      if (isParentDirectoryEntry(entry)) {
        return;
      }

      const dragSelection = dragSelectionRef.current;
      if (!dragSelection || (event.buttons & 1) !== 1) {
        return;
      }

      setSelectedFiles(
        getRangeSelection(
          dragSelection.anchor,
          entry.name,
          dragSelection.baseSelection,
          dragSelection.additive,
        ),
      );
      lastSelectedRef.current = entry.name;
    },
    [getRangeSelection],
  );

  const handleContextMenuSelection = useCallback((entry: FileEntry, _event: ReactMouseEvent) => {
    listContainerRef.current?.focus();
    if (isParentDirectoryEntry(entry)) {
      dragSelectionRef.current = null;
      lastSelectedRef.current = null;
      setSelectedFiles(new Set([PARENT_DIRECTORY_ENTRY_NAME]));
      return;
    }

    setSelectedFiles((prev) => {
      if (prev.has(entry.name)) {
        return prev;
      }
      lastSelectedRef.current = entry.name;
      return new Set([entry.name]);
    });
  }, []);

  const navigateHistory = useCallback(
    async (direction: -1 | 1) => {
      const nextIndex = historyIndexRef.current + direction;
      const nextPath = historyRef.current[nextIndex];
      if (!nextPath) {
        return;
      }

      const previousIndex = historyIndexRef.current;
      historyIndexRef.current = nextIndex;
      const loaded = await loadDirectory(nextPath, { history: "preserve" });
      if (!loaded) {
        historyIndexRef.current = previousIndex;
      }
    },
    [loadDirectory],
  );

  const handleItemClick = (entry: FileEntry) => {
    if (isParentDirectoryEntry(entry)) {
      handleGoUp();
      return;
    }

    if (entry.is_dir) {
      const newPath = currentPath === "/" ? `/${entry.name}` : `${currentPath}/${entry.name}`;
      loadDirectory(newPath);
    } else {
      setSelectedFiles(new Set([entry.name]));
      lastSelectedRef.current = entry.name;
    }
  };

  const handleNewFile = () => {
    if (!activeSessionId) return;
    setNewItemDialogData({
      sessionId: activeSessionId,
      currentDirPath: currentPath,
      type: "file",
    });
  };

  const handleNewFolder = () => {
    if (!activeSessionId) return;
    setNewItemDialogData({
      sessionId: activeSessionId,
      currentDirPath: currentPath,
      type: "folder",
    });
  };

  const handleNewSymlink = () => {
    if (!activeSessionId) return;
    setNewSymlinkDialogData({ sessionId: activeSessionId, currentDirPath: currentPath });
  };

  const handleCurrentDirProperties = () => {
    if (!activeSessionId || !currentPath) return;
    const name = currentPath.split("/").filter(Boolean).pop() || currentPath;
    setPropertiesDialogData({
      sessionId: activeSessionId,
      fullPath: currentPath,
      name,
      is_dir: true,
    });
  };

  const handleCopyCurrentPath = () => {
    navigator.clipboard.writeText(currentPath);
  };

  const handleSendCurrentPathToTerminal = () => {
    if (!activeSessionId) return;
    sendSessionInput(activeSessionId, currentPath).catch(() => {});
    emit(`focus-terminal-${activeSessionId}`).catch(() => {});
  };

  const selectedRealFiles = useMemo(
    () => files.filter((file) => selectedFiles.has(file.name)),
    [files, selectedFiles],
  );
  const fileAiActions = useMemo(
    () =>
      appSettings.ai.enabled
        ? appSettings.ai.file_ai_actions.filter((action) => action.enabled && action.name.trim())
        : [],
    [appSettings.ai.enabled, appSettings.ai.file_ai_actions],
  );

  const handleDeleteSelected = () => {
    if (selectedRealFiles.length === 0) return;
    openDeleteDialog(selectedRealFiles);
  };

  const handleListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT")
    ) {
      return;
    }

    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "a"
    ) {
      event.preventDefault();
      event.stopPropagation();
      const nextSelection = new Set(files.map((entry) => entry.name));
      setSelectedFiles(nextSelection);
      lastSelectedRef.current = files[0]?.name ?? null;
      return;
    }

    if (
      event.key !== "Delete" ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      selectedRealFiles.length === 0 ||
      deleteDialogData
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    handleDeleteSelected();
  };

  const handleGoUp = () => {
    if (!currentPath || currentPath === "/") return;
    const parts = currentPath.split("/");
    parts.pop();
    void loadDirectory(parts.join("/") || "/");
  };

  const handlePanelMouseDownCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.button === 3 || event.button === 4) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  const handlePanelMouseUpCapture = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!canBrowseFiles) return;

      if (event.button === 3) {
        event.preventDefault();
        event.stopPropagation();
        void navigateHistory(-1);
      } else if (event.button === 4) {
        event.preventDefault();
        event.stopPropagation();
        void navigateHistory(1);
      }
    },
    [canBrowseFiles, navigateHistory],
  );

  const handleSyncCwd = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      const cwd = await invoke<string>("get_terminal_cwd", { sessionId: activeSessionId });
      const normalizedCwd = normalizeDirectoryPath(cwd);
      if (normalizedCwd && normalizedCwd !== normalizeDirectoryPath(currentPathRef.current)) {
        loadDirectory(normalizedCwd);
      }
    } catch (e) {
      toast.error(`${t("fileExplorer.syncFailed")}: ${e}`);
    }
  }, [activeSessionId, loadDirectory, t]);

  useEffect(() => {
    if (!autoSyncCwd || !activeSessionId) return;
    const unlisten = listen<string>(`cwd-changed-${activeSessionId}`, (event) => {
      const newCwd = normalizeDirectoryPath(event.payload);
      if (newCwd && newCwd !== normalizeDirectoryPath(currentPathRef.current)) {
        loadDirectory(newCwd);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [autoSyncCwd, activeSessionId, loadDirectory]);

  const getEntryFullPath = (entry: FileEntry) => {
    return currentPath === "/" ? `/${entry.name}` : `${currentPath}/${entry.name}`;
  };

  const getEntryAiActions = (entry: FileEntry) => {
    if (entry.is_dir || entry.size > appSettings.ai.max_ai_file_size_bytes) {
      return [];
    }
    return fileAiActions;
  };

  const handleFileAIAction = async (entry: FileEntry, action: AICustomActionConfig) => {
    if (!activeSessionId) return;
    const filePath = getEntryFullPath(entry);
    try {
      const result = await invoke<RemoteTextFile>("read_remote_file_text", {
        sessionId: activeSessionId,
        path: filePath,
        maxBytes: appSettings.ai.max_ai_file_size_bytes,
      });
      openAIAssistant({
        action: "custom_file_action",
        userInput: action.prompt,
        selectedText: result.content,
        metadata: {
          actionId: action.id,
          actionName: action.name,
          filePath,
          fileSize: result.size,
        },
      });
    } catch (error) {
      toast.error(getErrorMessage(error) || t("ai.fileUnsupported"));
    }
  };

  const handleCopyPath = (entry: FileEntry, mode: "dir" | "name" | "full") => {
    let text = "";
    if (mode === "dir") text = currentPath;
    else if (mode === "name") text = entry.name;
    else text = getEntryFullPath(entry);
    navigator.clipboard.writeText(text);
  };

  const handleSendToTerminal = (entry: FileEntry, mode: "dir" | "name" | "full") => {
    if (!activeSessionId) return;
    let text = "";
    if (mode === "dir") text = currentPath;
    else if (mode === "name") text = entry.name;
    else text = getEntryFullPath(entry);

    sendSessionInput(activeSessionId, text).catch(() => {});
    emit(`focus-terminal-${activeSessionId}`).catch(() => {});
  };

  const buildDeleteItems = (entries: FileEntry[]): DeleteDialogItem[] => {
    return entries.map((entry) => ({
      path: getEntryFullPath(entry),
      name: entry.name,
    }));
  };

  const getContextMenuEntries = (entry: FileEntry) => {
    if (isParentDirectoryEntry(entry)) {
      return [];
    }

    if (selectedFiles.size > 1 && selectedFiles.has(entry.name)) {
      return files.filter((file) => selectedFiles.has(file.name));
    }
    return [entry];
  };

  const openDeleteDialog = (entries: FileEntry[]) => {
    if (!activeSessionId || entries.length === 0) return;
    setDeleteDialogData({
      sessionId: activeSessionId,
      items: buildDeleteItems(entries),
    });
  };

  const handleDeleteFromContextMenu = (entry: FileEntry) => {
    openDeleteDialog(getContextMenuEntries(entry));
  };

  const resolveDownloadDir = async (): Promise<string> => {
    const configured = appSettings.transfer.download_path;
    if (configured) return configured;
    return downloadDir();
  };

  const downloadEntries = async (entries: FileEntry[]) => {
    if (!activeSessionId || entries.length === 0) return;

    try {
      const askEach = appSettings.transfer.ask_save_location;

      if (askEach) {
        for (const entry of entries) {
          if (entry.is_dir) {
            const localDir = await openDialog({ directory: true });
            if (!localDir || typeof localDir !== "string") continue;
            const localPath = await join(localDir, entry.name);
            await invoke("download_remote_directory", {
              sessionId: activeSessionId,
              remotePath: getEntryFullPath(entry),
              localPath,
            });
          } else {
            const localPath = await saveDialog({ defaultPath: entry.name });
            if (!localPath) continue;
            await invoke("download_remote_file", {
              sessionId: activeSessionId,
              remotePath: getEntryFullPath(entry),
              localPath,
            });
          }
        }
        return;
      }

      const defaultDir = await resolveDownloadDir();

      for (const entry of entries) {
        const localPath = await join(defaultDir, entry.name);
        if (entry.is_dir) {
          await invoke("download_remote_directory", {
            sessionId: activeSessionId,
            remotePath: getEntryFullPath(entry),
            localPath,
          });
        } else {
          await invoke("download_remote_file", {
            sessionId: activeSessionId,
            remotePath: getEntryFullPath(entry),
            localPath,
          });
        }
      }
    } catch (e) {
      logger.error({
        domain: "transfer.lifecycle",
        event: "download.failed",
        message: "Download failed",
        ids: activeSessionId ? { session_id: activeSessionId } : undefined,
        error: e,
      });
    }
  };

  const handleDownloadSelected = async () => {
    if (selectedRealFiles.length === 0) return;
    await downloadEntries(selectedRealFiles);
  };

  const handleDownload = async (entry: FileEntry) => {
    await downloadEntries([entry]);
  };

  const handleDownloadFromContextMenu = async (entry: FileEntry) => {
    if (selectedFiles.size > 1 && selectedFiles.has(entry.name)) {
      const selected = getContextMenuEntries(entry);
      await downloadEntries(selected);
      return;
    }

    await handleDownload(entry);
  };

  const handleUploadFiles = async () => {
    const target = resolveUploadTarget();
    if (!target) return;

    try {
      const localPaths = await openDialog({ multiple: true, directory: false });
      if (!localPaths) return;
      const pathList = (Array.isArray(localPaths) ? localPaths : [localPaths]).filter(
        (localPath): localPath is string => typeof localPath === "string",
      );
      await uploadLocalEntriesToTarget(
        target,
        pathList.map((path) => ({
          path,
          isDir: false,
        })),
      );
    } catch (error) {
      logger.error({
        domain: "transfer.lifecycle",
        event: "upload.selection_failed",
        message: "Upload selection failed",
        ids: { session_id: target.sessionId },
        error,
      });
    }
  };

  const handleUploadFolder = async () => {
    const target = resolveUploadTarget();
    if (!target) return;

    try {
      const localDir = await openDialog({ directory: true });
      if (!localDir || typeof localDir !== "string") return;
      await uploadLocalEntriesToTarget(target, [{ path: localDir, isDir: true }]);
    } catch (error) {
      logger.error({
        domain: "transfer.lifecycle",
        event: "upload.folder_failed",
        message: "Upload folder failed",
        ids: { session_id: target.sessionId },
        error,
      });
    }
  };

  const handleOpenDefault = async (entry: FileEntry) => {
    if (!activeSessionId || entry.is_dir) return;
    let localPath: string;
    try {
      const tDir = await tempDir();
      const downloadTimestamp = Date.now().toString();
      localPath = await join(tDir, "nyaterm", activeSessionId, downloadTimestamp, entry.name);
      await invoke("download_remote_file", {
        sessionId: activeSessionId,
        remotePath: getEntryFullPath(entry),
        localPath,
      });
    } catch (e) {
      logger.error({
        domain: "transfer.lifecycle",
        event: "download.open_failed",
        message: "Download for open failed",
        ids: { session_id: activeSessionId },
        error: e,
      });
      return;
    }

    try {
      await invoke("start_file_watch", {
        sessionId: activeSessionId,
        localPath,
        remotePath: getEntryFullPath(entry),
      });

      await openPath(localPath, appSettings.transfer.default_editor || undefined);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const displayPath = (() => {
    if (!homeDir || !currentPath) return currentPath || "~";
    if (currentPath === homeDir) return "~";
    if (currentPath.startsWith(`${homeDir}/`)) return `~${currentPath.slice(homeDir.length)}`;
    return currentPath;
  })();

  const displayEntries = useMemo(() => {
    if (!currentPath || currentPath === "/") {
      return files;
    }

    return [PARENT_DIRECTORY_ENTRY, ...files];
  }, [currentPath, files]);

  const visibleEntries = useMemo(() => {
    if (displayEntries.length === 0) {
      return displayEntries;
    }

    const viewportHeight = listViewportHeight > 0 ? listViewportHeight : FILE_LIST_ITEM_HEIGHT * 12;
    const visibleCount = Math.max(1, Math.ceil(viewportHeight / FILE_LIST_ITEM_HEIGHT));
    const startIndex = Math.max(
      0,
      Math.floor(listScrollTop / FILE_LIST_ITEM_HEIGHT) - FILE_LIST_OVERSCAN,
    );
    const endIndex = Math.min(
      displayEntries.length,
      startIndex + visibleCount + FILE_LIST_OVERSCAN * 2,
    );

    return displayEntries.slice(startIndex, endIndex);
  }, [displayEntries, listScrollTop, listViewportHeight]);

  const virtualListPadding = useMemo(() => {
    if (visibleEntries.length === 0) {
      return { top: 0, bottom: 0 };
    }

    const startIndex = displayEntries.indexOf(visibleEntries[0]);
    const top = startIndex * FILE_LIST_ITEM_HEIGHT;
    const bottom = Math.max(
      0,
      (displayEntries.length - startIndex - visibleEntries.length) * FILE_LIST_ITEM_HEIGHT,
    );

    return { top, bottom };
  }, [displayEntries, visibleEntries]);

  return (
    <aside
      className="h-full flex flex-col overflow-hidden"
      style={{ backgroundColor: "var(--df-bg-panel)" }}
      onMouseDownCapture={handlePanelMouseDownCapture}
      onMouseUpCapture={handlePanelMouseUpCapture}
    >
      <PanelHeader title={t("panel.fileExplorer")} />

      {canBrowseFiles && (
        <div
          className="flex items-center px-1.5 py-1 border-b gap-0.5"
          style={{ backgroundColor: "var(--df-bg-panel)", borderColor: "var(--df-border)" }}
        >
          <ToolbarIconButton
            label={t("fileExplorer.newFile")}
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
            onClick={handleNewFile}
          >
            <MdNoteAdd className="h-4 w-4" />
          </ToolbarIconButton>
          <ToolbarIconButton
            label={t("fileExplorer.newFolder")}
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
            onClick={handleNewFolder}
          >
            <MdCreateNewFolder className="h-4 w-4" />
          </ToolbarIconButton>

          <ToolbarDivider />

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label={t("fileExplorer.upload")}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
                  >
                    <MdUpload className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="top">{t("fileExplorer.upload")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="min-w-44">
              <DropdownMenuItem onClick={handleUploadFiles}>
                <MdUpload className="mr-2 h-4 w-4" />
                {t("fileExplorer.upload")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleUploadFolder}>
                <MdDriveFolderUpload className="mr-2 h-4 w-4" />
                {t("fileExplorer.uploadFolder")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ToolbarIconButton
            label={t("fileExplorer.downloadSelected")}
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
            onClick={handleDownloadSelected}
            disabled={selectedRealFiles.length === 0}
          >
            <MdDownload className="h-4 w-4" />
          </ToolbarIconButton>
          <ToolbarIconButton
            label={t("fileExplorer.delete")}
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md text-muted-foreground hover:text-destructive"
            onClick={handleDeleteSelected}
            disabled={selectedRealFiles.length === 0}
          >
            <MdDelete className="h-4 w-4" />
          </ToolbarIconButton>

          <ToolbarDivider />

          <ToolbarIconButton
            label={t("fileExplorer.goUp")}
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
            onClick={handleGoUp}
          >
            <MdArrowUpward className="h-4 w-4" />
          </ToolbarIconButton>
          <ToolbarIconButton
            label={t("fileExplorer.refresh")}
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
            onClick={() => void refreshCurrentDirectory()}
          >
            <MdRefresh className="h-4 w-4" />
          </ToolbarIconButton>
        </div>
      )}

      {canBrowseFiles && (
        <div
          className="px-2 py-1 border-b flex items-center"
          style={{ borderColor: "var(--df-border)", minHeight: "26px" }}
        >
          {isEditingPath ? (
            <input
              ref={pathInputRef}
              className="w-full text-[0.625rem] font-mono bg-transparent outline-none m-0 p-0"
              style={{ color: "var(--df-text)" }}
              value={pathInputText}
              onChange={(e) => setPathInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  let p = pathInputText.trim();
                  if (p) {
                    if (p.startsWith("~/") && homeDir) {
                      p = homeDir + p.substring(1);
                    } else if (p === "~" && homeDir) {
                      p = homeDir;
                    }
                    void loadDirectory(p);
                  }
                  setIsEditingPath(false);
                } else if (e.key === "Escape") {
                  setIsEditingPath(false);
                }
              }}
              onBlur={() => setIsEditingPath(false)}
            />
          ) : (
            <div
              className="text-[0.625rem] font-mono truncate cursor-text transition-colors flex-1"
              style={{ color: "var(--df-text-dimmed)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--df-text)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--df-text-dimmed)")}
              onClick={() => {
                setPathInputText(currentPath || homeDir);
                setIsEditingPath(true);
              }}
              title={t("fileExplorer.editPath")}
            >
              {displayPath}
            </div>
          )}
        </div>
      )}

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="relative min-h-0 flex-1">
            {isExternalDropActive && canBrowseFiles && (
              <div
                className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-lg border-2 border-dashed px-4 text-center text-xs font-medium"
                style={{
                  borderColor: "var(--df-primary)",
                  backgroundColor: "rgba(59, 130, 246, 0.12)",
                  color: "var(--df-text)",
                }}
              >
                {t("fileExplorer.externalDropOverlay")}
              </div>
            )}
            <div
              ref={listContainerRef}
              className="h-full overflow-y-auto p-2 text-sm terminal-scroll outline-none"
              tabIndex={canBrowseFiles ? 0 : -1}
              onMouseDown={() => {
                if (canBrowseFiles) {
                  listContainerRef.current?.focus();
                }
              }}
              onKeyDown={handleListKeyDown}
            >
              {!activeSessionId ? (
                <div
                  className="text-center py-8 text-xs"
                  style={{ color: "var(--df-text-dimmed)" }}
                >
                  <MdFolderOff className="text-xl block mx-auto mb-2" />
                  <div className="text-sm block mb-2">{t("fileExplorer.connectToSession")}</div>
                </div>
              ) : hasUnsupportedSession ? (
                <div
                  className="text-center py-8 text-xs"
                  style={{ color: "var(--df-text-dimmed)" }}
                >
                  <MdFolderOff className="text-xl block mx-auto mb-2" />
                  <div className="text-sm block mb-2">{t("fileExplorer.unsupportedSession")}</div>
                  <div>{t("fileExplorer.unsupportedSessionDesc")}</div>
                </div>
              ) : directoryLoading ? (
                <div
                  className="text-center py-4 text-xs"
                  style={{ color: "var(--df-text-dimmed)" }}
                >
                  {t("fileExplorer.loading")}
                </div>
              ) : error ? (
                <div className="text-center text-red-400 py-4 text-xs">{error}</div>
              ) : displayEntries.length === 0 ? (
                <div
                  className="text-center py-4 text-xs"
                  style={{ color: "var(--df-text-dimmed)" }}
                >
                  {t("fileExplorer.emptyDirectory")}
                </div>
              ) : (
                <ul
                  style={{
                    paddingTop: virtualListPadding.top,
                    paddingBottom: virtualListPadding.bottom,
                  }}
                >
                  {visibleEntries.map((entry) => (
                    <FileListItem
                      key={entry.name}
                      entry={entry}
                      isSelected={selectedFiles.has(entry.name)}
                      isParentDirectoryEntry={isParentDirectoryEntry(entry)}
                      activeSessionId={activeSessionId}
                      onSelectionStart={handleSelectionStart}
                      onSelectionDrag={handleSelectionDrag}
                      onContextMenuSelect={handleContextMenuSelection}
                      onItemClick={handleItemClick}
                      onOpenDefault={handleOpenDefault}
                      onRefresh={() => void refreshCurrentDirectory()}
                      onUpload={handleUploadFiles}
                      onUploadFolder={handleUploadFolder}
                      onDownload={handleDownloadFromContextMenu}
                      onRename={(entry) => {
                        if (activeSessionId)
                          setRenameDialogData({
                            sessionId: activeSessionId,
                            oldPath: getEntryFullPath(entry),
                            name: entry.name,
                            currentDirPath: currentPath,
                          });
                      }}
                      onMove={(entry) => {
                        if (activeSessionId)
                          setMoveDialogData({
                            sessionId: activeSessionId,
                            oldPath: getEntryFullPath(entry),
                            name: entry.name,
                          });
                      }}
                      onDelete={handleDeleteFromContextMenu}
                      onCopyPath={handleCopyPath}
                      onSendToTerminal={handleSendToTerminal}
                      onProperties={(entry) => {
                        if (activeSessionId) {
                          setPropertiesDialogData({
                            sessionId: activeSessionId,
                            fullPath: getEntryFullPath(entry),
                            name: entry.name,
                            is_dir: entry.is_dir,
                          });
                        }
                      }}
                      aiActions={getEntryAiActions(entry)}
                      onAIAction={(entry, action) => void handleFileAIAction(entry, action)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </ContextMenuTrigger>
        {canBrowseFiles && (
          <ContextMenuContent className="w-52">
            <ContextMenuItem onClick={() => void refreshCurrentDirectory()}>
              <MdRefresh className="mr-2 h-4 w-4" />
              {t("fileExplorer.refresh")}
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <MdUpload className="mr-2 h-4 w-4" />
                {t("fileExplorer.cmUpload")}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-48">
                <ContextMenuItem onClick={handleUploadFiles}>
                  <MdUpload className="mr-2 h-4 w-4" />
                  {t("fileExplorer.upload")}
                </ContextMenuItem>
                <ContextMenuItem onClick={handleUploadFolder}>
                  <MdDriveFolderUpload className="mr-2 h-4 w-4" />
                  {t("fileExplorer.uploadFolder")}
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={handleNewFile}>
              <MdNoteAdd className="mr-2 h-4 w-4" />
              {t("fileExplorer.newFile")}
            </ContextMenuItem>
            <ContextMenuItem onClick={handleNewFolder}>
              <MdCreateNewFolder className="mr-2 h-4 w-4" />
              {t("fileExplorer.newFolder")}
            </ContextMenuItem>
            <ContextMenuItem onClick={handleNewSymlink}>
              <MdLink className="mr-2 h-4 w-4" />
              {t("fileExplorer.newSymlink")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={handleCopyCurrentPath}>
              <MdContentCopy className="mr-2 h-4 w-4" />
              {t("fileExplorer.copyDirPath")}
            </ContextMenuItem>
            <ContextMenuItem onClick={handleSendCurrentPathToTerminal}>
              <MdSend className="mr-2 h-4 w-4" />
              {t("fileExplorer.sendDirPathToTerminal")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={handleCurrentDirProperties}>
              <MdInfo className="mr-2 h-4 w-4" />
              {t("fileExplorer.properties")}
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>

      {canBrowseFiles && (
        <div
          className="px-2 py-1.5 text-[0.6875rem] border-t flex items-center justify-between shrink-0"
          style={{
            color: "var(--df-text-dimmed)",
            borderColor: "var(--df-border)",
            backgroundColor: "var(--df-bg-panel)",
          }}
        >
          <div className="flex gap-4">
            {!directoryLoading && !error && files.length > 0 && (
              <>
                <span>{t("fileExplorer.totalItems", { count: files.length })}</span>
                {files.some((f) => !f.is_dir) && (
                  <span>
                    {formatSize(files.filter((f) => !f.is_dir).reduce((sum, f) => sum + f.size, 0))}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={handleSyncCwd}
                    disabled={!cwdTrackingActive}
                  >
                    <MdSync className="h-[0.875rem] w-[0.875rem]" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {cwdTrackingActive
                  ? t("fileExplorer.syncTerminalPath")
                  : t("fileExplorer.cwdTrackingUnavailable")}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-6 w-6 rounded-md disabled:opacity-40 disabled:cursor-not-allowed ${
                      cwdTrackingActive
                        ? autoSyncCwd
                          ? "text-primary"
                          : "text-muted-foreground hover:text-foreground"
                        : "text-muted-foreground"
                    }`}
                    onClick={() => setAutoSyncCwd((v) => !v)}
                    disabled={!cwdTrackingActive}
                  >
                    <MdSyncLock className="h-[0.875rem] w-[0.875rem]" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {cwdTrackingActive
                  ? t("fileExplorer.autoSyncTerminalPath")
                  : t("fileExplorer.cwdTrackingUnavailable")}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      if (activeSessionId && currentPath) {
                        sendSessionInput(activeSessionId, currentPath).catch(() => {});
                        emit(`focus-terminal-${activeSessionId}`).catch(() => {});
                      }
                    }}
                  >
                    <MdSend className="h-[0.875rem] w-[0.875rem]" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">{t("fileExplorer.sendToTerminal")}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}

      {renameDialogData && (
        <RenameDialog
          data={renameDialogData}
          onClose={() => setRenameDialogData(null)}
          onSuccess={() => void refreshCurrentDirectory()}
        />
      )}

      {deleteDialogData && (
        <DeleteDialog
          data={deleteDialogData}
          onClose={() => setDeleteDialogData(null)}
          onSuccess={() => {
            setSelectedFiles(new Set());
            lastSelectedRef.current = null;
            void refreshCurrentDirectory();
          }}
        />
      )}

      {moveDialogData && (
        <MoveDialog
          data={moveDialogData}
          onClose={() => setMoveDialogData(null)}
          onSuccess={() => void refreshCurrentDirectory()}
        />
      )}

      {newItemDialogData && (
        <NewItemDialog
          data={newItemDialogData}
          onClose={() => setNewItemDialogData(null)}
          onSuccess={async (result) => {
            await refreshCurrentDirectory();
            if (result.openAfterCreate) {
              const mockEntry: FileEntry = {
                name: result.name,
                is_dir: result.is_dir,
                is_symlink: false,
                size: 0,
                permissions: "",
              };
              if (result.is_dir) {
                handleItemClick(mockEntry);
              } else {
                handleOpenDefault(mockEntry);
              }
            }
          }}
        />
      )}

      {propertiesDialogData && (
        <PropertiesDialog
          data={propertiesDialogData}
          onClose={() => setPropertiesDialogData(null)}
        />
      )}

      {newSymlinkDialogData && (
        <NewSymlinkDialog
          data={newSymlinkDialogData}
          onClose={() => setNewSymlinkDialogData(null)}
          onSuccess={() => void refreshCurrentDirectory()}
        />
      )}
    </aside>
  );
}
