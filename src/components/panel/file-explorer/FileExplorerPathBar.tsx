import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  MdBookmarkAdd,
  MdBookmarkAdded,
  MdBookmarkBorder,
  MdBookmarkRemove,
  MdCheck,
  MdKeyboardArrowRight,
  MdMoreHoriz,
  MdRefresh,
  MdSearch,
} from "react-icons/md";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { FileEntry } from "@/types/global";
import {
  type BreadcrumbSegment,
  buildBreadcrumbSegments,
  type ChildrenMenuState,
  type DirectoryChild,
  type FileExplorerBackendKind,
  formatExplorerPathFromHome,
  joinExplorerPath,
  type LoadDirectoryOptions,
  normalizeExplorerPath,
  PARENT_DIRECTORY_ENTRY_NAME,
  pathStartsWithDirectory,
} from "./model";

interface FileExplorerPathBarProps {
  isEditingPath: boolean;
  pathInputText: string;
  pathInputRef: RefObject<HTMLInputElement | null>;
  backend: FileExplorerBackendKind;
  displayPath: string;
  currentPath: string;
  homeDir: string;
  sessionId: string;
  currentDirectoryEntries: FileEntry[];
  showHiddenFiles: boolean;
  directoryHistory: string[];
  favoriteDirectories: string[];
  onPathInputTextChange: (value: string) => void;
  onEditingPathChange: (editing: boolean) => void;
  onLoadDirectory: (path: string, options?: LoadDirectoryOptions) => void;
  onNavigate: (path: string, options?: LoadDirectoryOptions) => Promise<boolean> | undefined;
  onListChildDirectories: (path: string) => Promise<DirectoryChild[]>;
  onSelectHistoryPath: (path: string) => void;
  onAddCurrentDirectoryToFavorites: () => void;
  onSelectFavoritePath: (path: string) => void;
  onRemoveFavoritePath: (path: string) => void;
}

type DirectoryChildrenCacheEntry = {
  items: DirectoryChild[];
  loadedAt: number;
};

const HISTORY_ROW_HEIGHT = 24;
const HISTORY_VISIBLE_ROWS = 5;
const DIRECTORY_CHILDREN_CACHE_TTL = 15_000;
const MENU_ITEM_HEIGHT = 28;
const MENU_OVERSCAN = 5;
const MENU_MAX_HEIGHT = 308;
const MENU_VIRTUALIZE_THRESHOLD = 200;
const MENU_SEARCH_THRESHOLD = 100;
const BREADCRUMB_COLLAPSE_BUFFER = 28;

const directoryChildrenCache = new Map<string, DirectoryChildrenCacheEntry>();
const pendingDirectoryChildrenRequests = new Map<string, Promise<DirectoryChild[]>>();

export function clearDirectoryChildrenCacheForSession(sessionId: string | null | undefined) {
  if (!sessionId) return;
  for (const key of [...directoryChildrenCache.keys()]) {
    if (key.startsWith(`${sessionId}:`)) {
      directoryChildrenCache.delete(key);
    }
  }
  for (const key of [...pendingDirectoryChildrenRequests.keys()]) {
    if (key.startsWith(`${sessionId}:`)) {
      pendingDirectoryChildrenRequests.delete(key);
    }
  }
}

export function clearDirectoryChildrenCacheForPath(
  sessionId: string | null | undefined,
  backend: FileExplorerBackendKind,
  path: string,
) {
  if (!sessionId) return;
  const normalizedPath = normalizeExplorerPath(path, backend);
  if (!normalizedPath) return;
  const prefix = `${sessionId}:${backend}:${normalizedPath}:`;
  for (const key of [...directoryChildrenCache.keys()]) {
    if (key.startsWith(prefix)) {
      directoryChildrenCache.delete(key);
    }
  }
  for (const key of [...pendingDirectoryChildrenRequests.keys()]) {
    if (key.startsWith(prefix)) {
      pendingDirectoryChildrenRequests.delete(key);
    }
  }
}

function directoryChildrenCacheKey(
  sessionId: string,
  backend: FileExplorerBackendKind,
  path: string,
  showHiddenFiles: boolean,
) {
  return `${sessionId}:${backend}:${normalizeExplorerPath(path, backend)}:${showHiddenFiles}`;
}

function naturalCompare(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function getCurrentDirectoryChildren(
  currentPath: string,
  currentDirectoryEntries: FileEntry[],
  backend: FileExplorerBackendKind,
  showHiddenFiles: boolean,
): DirectoryChild[] {
  const normalizedCurrentPath = normalizeExplorerPath(currentPath, backend);
  return currentDirectoryEntries
    .filter(
      (entry) =>
        entry.is_dir &&
        entry.name !== PARENT_DIRECTORY_ENTRY_NAME &&
        (showHiddenFiles || !entry.name.startsWith(".")),
    )
    .map((entry) => ({
      name: entry.name,
      path: joinExplorerPath(normalizedCurrentPath, entry.name, backend),
      isSymlink: entry.is_symlink,
      rawPathToken: entry.raw_path_token,
    }))
    .sort((left, right) => naturalCompare(left.name, right.name));
}

export function FileExplorerPathBar({
  isEditingPath,
  pathInputText,
  pathInputRef,
  backend,
  displayPath,
  currentPath,
  homeDir,
  sessionId,
  currentDirectoryEntries,
  showHiddenFiles,
  directoryHistory,
  favoriteDirectories,
  onPathInputTextChange,
  onEditingPathChange,
  onLoadDirectory,
  onNavigate,
  onListChildDirectories,
  onSelectHistoryPath,
  onAddCurrentDirectoryToFavorites,
  onSelectFavoritePath,
  onRemoveFavoritePath,
}: FileExplorerPathBarProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const breadcrumbViewportRef = useRef<HTMLDivElement | null>(null);
  const segmentRefs = useRef(new Map<string, HTMLDivElement>());
  const [availableWidth, setAvailableWidth] = useState(0);
  const [segmentWidths, setSegmentWidths] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!isEditingPath) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        onEditingPathChange(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isEditingPath, onEditingPathChange]);

  useLayoutEffect(() => {
    const viewport = breadcrumbViewportRef.current;
    if (!viewport) return;

    const updateWidth = () => {
      setAvailableWidth(viewport.clientWidth);
    };
    updateWidth();

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateWidth);
    resizeObserver?.observe(viewport);
    return () => resizeObserver?.disconnect();
  }, []);

  const segments = useMemo(
    () => buildBreadcrumbSegments(currentPath, homeDir, backend),
    [backend, currentPath, homeDir],
  );

  useLayoutEffect(() => {
    const nextWidths: Record<string, number> = {};
    for (const [id, element] of segmentRefs.current) {
      nextWidths[id] = element.offsetWidth;
    }
    if (Object.keys(nextWidths).length === 0) return;
    setSegmentWidths((prev) => {
      const merged = { ...prev, ...nextWidths };
      return Object.entries(merged).some(([key, value]) => prev[key] !== value) ? merged : prev;
    });
  });

  const { visibleSegments, overflowSegments } = useMemo(() => {
    if (segments.length <= 2 || availableWidth <= 0) {
      return { visibleSegments: segments, overflowSegments: [] };
    }

    const estimatedWidth = (segment: BreadcrumbSegment) =>
      segmentWidths[segment.id] ?? Math.max(52, segment.label.length * 7 + 34);
    const overflowButtonWidth = 34;
    const visibleIndexes = new Set(segments.map((_, index) => index));
    const currentIndex = segments.length - 1;
    const required = new Set([currentIndex, Math.max(0, currentIndex - 1)]);
    let total = segments.reduce((sum, segment) => sum + estimatedWidth(segment), 0);

    const removeIndex = (index: number) => {
      if (!visibleIndexes.delete(index)) return;
      total -= estimatedWidth(segments[index]);
    };

    const shouldCollapse = () =>
      total + overflowButtonWidth + BREADCRUMB_COLLAPSE_BUFFER > availableWidth;

    for (let index = 1; shouldCollapse() && index < currentIndex - 1; index += 1) {
      if (!required.has(index)) {
        removeIndex(index);
      }
    }

    if (shouldCollapse() && !required.has(0) && visibleIndexes.size > 1) {
      removeIndex(0);
    }

    const hidden = segments.filter((_, index) => !visibleIndexes.has(index));
    return {
      visibleSegments: segments.filter((_, index) => visibleIndexes.has(index)),
      overflowSegments: hidden,
    };
  }, [availableWidth, segmentWidths, segments]);

  const normalizedCurrentPath = normalizeExplorerPath(currentPath || homeDir, backend);
  const hasFavoriteDirectories = favoriteDirectories.length > 0;
  const isCurrentFavorite = favoriteDirectories.includes(normalizedCurrentPath);
  const FavoriteIcon = isCurrentFavorite ? MdBookmarkAdded : MdBookmarkBorder;

  const formatHistoryPath = useCallback(
    (path: string) => {
      if (!homeDir) return path;
      return formatExplorerPathFromHome(path, homeDir, backend);
    },
    [backend, homeDir],
  );

  const beginPathEditing = useCallback(() => {
    onPathInputTextChange(currentPath || homeDir);
    onEditingPathChange(true);
    window.requestAnimationFrame(() => pathInputRef.current?.select());
  }, [currentPath, homeDir, onEditingPathChange, onPathInputTextChange, pathInputRef]);

  const navigateTo = useCallback(
    (path: string, options?: LoadDirectoryOptions) => {
      const normalizedPath = normalizeExplorerPath(path, backend);
      if (!normalizedPath || normalizedPath === normalizedCurrentPath) {
        return;
      }
      void onNavigate(normalizedPath, options);
    },
    [backend, normalizedCurrentPath, onNavigate],
  );

  const showHistory = isEditingPath && directoryHistory.length > 0;

  return (
    <div
      ref={containerRef}
      className="relative flex items-center border-b px-2 py-1"
      style={{ borderColor: "var(--df-border)", minHeight: "26px" }}
      onKeyDown={(event) => {
        if (
          !isEditingPath &&
          (event.ctrlKey || event.metaKey) &&
          !event.altKey &&
          !event.shiftKey &&
          event.key.toLowerCase() === "l"
        ) {
          event.preventDefault();
          event.stopPropagation();
          beginPathEditing();
        }
      }}
    >
      {isEditingPath ? (
        <input
          ref={pathInputRef}
          type="text"
          className="m-0 min-w-0 flex-1 bg-transparent p-0 font-mono text-[0.625rem] outline-none"
          style={{ color: "var(--df-text)" }}
          value={pathInputText}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => onPathInputTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              let path = pathInputText.trim();
              if (path) {
                if ((path.startsWith("~/") || path.startsWith("~\\")) && homeDir) {
                  path = homeDir + path.substring(1);
                } else if (path === "~" && homeDir) {
                  path = homeDir;
                }
                onLoadDirectory(path);
              }
              onEditingPathChange(false);
            } else if (event.key === "Escape") {
              onEditingPathChange(false);
            }
          }}
        />
      ) : (
        <div
          ref={breadcrumbViewportRef}
          className="flex min-w-0 flex-1 items-center overflow-hidden"
          title={displayPath}
          onDoubleClick={(event) => {
            if (event.target === event.currentTarget) {
              beginPathEditing();
            }
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && event.detail === 1) {
              event.currentTarget.focus();
            }
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              beginPathEditing();
            }
          }}
        >
          <div className="flex min-w-0 items-center">
            {overflowSegments.length > 0 && (
              <BreadcrumbOverflowMenu segments={overflowSegments} onNavigate={navigateTo} />
            )}
            {visibleSegments.map((segment, index) => {
              const segmentIndex = segments.findIndex((item) => item.id === segment.id);
              const branchChild = segments[segmentIndex + 1];
              return (
                <BreadcrumbSegmentView
                  key={segment.id}
                  refCallback={(element) => {
                    if (element) {
                      segmentRefs.current.set(segment.id, element);
                    } else {
                      segmentRefs.current.delete(segment.id);
                    }
                  }}
                  segment={segment}
                  currentPath={normalizedCurrentPath}
                  branchChildPath={branchChild?.path}
                  backend={backend}
                  sessionId={sessionId}
                  showHiddenFiles={showHiddenFiles}
                  currentDirectoryEntries={currentDirectoryEntries}
                  isLastVisible={index === visibleSegments.length - 1}
                  onNavigate={navigateTo}
                  onListChildDirectories={onListChildDirectories}
                  onEditCurrent={beginPathEditing}
                />
              );
            })}
          </div>
        </div>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title={t("fileExplorer.favorites")}
            aria-label={t("fileExplorer.favorites")}
          >
            <FavoriteIcon className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem onClick={onAddCurrentDirectoryToFavorites}>
            <MdBookmarkAdd className="h-4 w-4" />
            <span className="min-w-0 truncate">{t("fileExplorer.addCurrentDirToFavorites")}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {hasFavoriteDirectories ? (
            favoriteDirectories.map((path) => {
              const isCurrent = path === normalizedCurrentPath;
              return (
                <DropdownMenuItem
                  key={path}
                  className="gap-1 pr-1"
                  title={path}
                  onClick={() => onSelectFavoritePath(path)}
                >
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-[0.625rem]"
                    style={{ color: isCurrent ? "var(--df-primary)" : undefined }}
                  >
                    {formatHistoryPath(path)}
                  </span>
                  <button
                    type="button"
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    title={t("fileExplorer.removeFavorite")}
                    aria-label={t("fileExplorer.removeFavorite")}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onRemoveFavoritePath(path);
                    }}
                  >
                    <MdBookmarkRemove className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuItem>
              );
            })
          ) : (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("fileExplorer.noFavorites")}
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {showHistory && (
        <div
          role="listbox"
          className="terminal-scroll absolute inset-x-0 top-full z-30 mt-px overflow-y-auto rounded-b-md border shadow-lg"
          style={{
            backgroundColor: "var(--df-bg-panel)",
            borderColor: "var(--df-border)",
            maxHeight: `${HISTORY_ROW_HEIGHT * HISTORY_VISIBLE_ROWS}px`,
          }}
          aria-label={t("fileExplorer.directoryHistory")}
        >
          {directoryHistory.map((path) => {
            const isCurrent = path === normalizedCurrentPath;
            return (
              <button
                key={path}
                type="button"
                className="flex w-full items-center truncate px-2 text-left font-mono text-[0.625rem] transition-colors"
                style={{
                  height: `${HISTORY_ROW_HEIGHT}px`,
                  color: isCurrent ? "var(--df-primary)" : "var(--df-text)",
                }}
                title={path}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={(event) => {
                  event.currentTarget.style.backgroundColor = "var(--df-bg-hover)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.backgroundColor = "transparent";
                }}
                onClick={() => {
                  onEditingPathChange(false);
                  onSelectHistoryPath(path);
                }}
              >
                <span className="truncate">{formatHistoryPath(path)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BreadcrumbOverflowMenu({
  segments,
  onNavigate,
}: {
  segments: BreadcrumbSegment[];
  onNavigate: (path: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="mr-0.5 inline-flex h-5 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          title={t("fileExplorer.breadcrumbOverflow")}
          aria-label={t("fileExplorer.breadcrumbOverflow")}
        >
          <MdMoreHoriz className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {segments.map((segment) => (
          <DropdownMenuItem
            key={segment.id}
            title={segment.path}
            onClick={() => onNavigate(segment.path)}
          >
            <span className="min-w-0 truncate font-mono text-[0.625rem]">{segment.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BreadcrumbSegmentView({
  refCallback,
  segment,
  currentPath,
  branchChildPath,
  backend,
  sessionId,
  showHiddenFiles,
  currentDirectoryEntries,
  isLastVisible,
  onNavigate,
  onListChildDirectories,
  onEditCurrent,
}: {
  refCallback: (element: HTMLDivElement | null) => void;
  segment: BreadcrumbSegment;
  currentPath: string;
  branchChildPath?: string;
  backend: FileExplorerBackendKind;
  sessionId: string;
  showHiddenFiles: boolean;
  currentDirectoryEntries: FileEntry[];
  isLastVisible: boolean;
  onNavigate: (path: string, options?: LoadDirectoryOptions) => void;
  onListChildDirectories: (path: string) => Promise<DirectoryChild[]>;
  onEditCurrent: () => void;
}) {
  const isCurrent = normalizeExplorerPath(segment.path, backend) === currentPath;

  return (
    <div ref={refCallback} className="flex shrink-0 items-center">
      <button
        type="button"
        className={cn(
          "h-5 max-w-32 truncate rounded-l px-1.5 font-mono text-[0.625rem] transition-colors",
          isCurrent
            ? "text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
        title={segment.path}
        onClick={() => {
          if (!isCurrent) {
            onNavigate(segment.path);
          }
        }}
        onDoubleClick={() => {
          if (isCurrent) {
            onEditCurrent();
          }
        }}
      >
        {segment.label}
      </button>
      <DirectoryChildrenMenu
        segment={segment}
        currentPath={currentPath}
        branchChildPath={branchChildPath}
        backend={backend}
        sessionId={sessionId}
        showHiddenFiles={showHiddenFiles}
        currentDirectoryEntries={currentDirectoryEntries}
        onNavigate={onNavigate}
        onListChildDirectories={onListChildDirectories}
      />
      {!isLastVisible && <span className="mx-0.5 text-[0.625rem] text-muted-foreground/50" />}
    </div>
  );
}

function DirectoryChildrenMenu({
  segment,
  currentPath,
  branchChildPath,
  backend,
  sessionId,
  showHiddenFiles,
  currentDirectoryEntries,
  onNavigate,
  onListChildDirectories,
}: {
  segment: BreadcrumbSegment;
  currentPath: string;
  branchChildPath?: string;
  backend: FileExplorerBackendKind;
  sessionId: string;
  showHiddenFiles: boolean;
  currentDirectoryEntries: FileEntry[];
  onNavigate: (path: string, options?: LoadDirectoryOptions) => void;
  onListChildDirectories: (path: string) => Promise<DirectoryChild[]>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ChildrenMenuState>({ status: "idle" });
  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const requestIdRef = useRef(0);
  const normalizedSegmentPath = normalizeExplorerPath(segment.path, backend);
  const isCurrentDirectory = normalizedSegmentPath === currentPath;

  const loadChildren = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setState({ status: "loading", path: normalizedSegmentPath });
    setQuery("");
    setScrollTop(0);

    try {
      let items: DirectoryChild[];
      if (isCurrentDirectory) {
        items = getCurrentDirectoryChildren(
          currentPath,
          currentDirectoryEntries,
          backend,
          showHiddenFiles,
        );
      } else {
        const key = directoryChildrenCacheKey(
          sessionId,
          backend,
          normalizedSegmentPath,
          showHiddenFiles,
        );
        const cached = directoryChildrenCache.get(key);
        if (cached && Date.now() - cached.loadedAt < DIRECTORY_CHILDREN_CACHE_TTL) {
          items = cached.items;
        } else {
          let pending = pendingDirectoryChildrenRequests.get(key);
          if (!pending) {
            pending = onListChildDirectories(normalizedSegmentPath);
            pendingDirectoryChildrenRequests.set(key, pending);
          }
          items = await pending;
          pendingDirectoryChildrenRequests.delete(key);
          directoryChildrenCache.set(key, { items, loadedAt: Date.now() });
        }
      }

      if (requestId === requestIdRef.current) {
        setState({ status: "success", path: normalizedSegmentPath, items });
      }
    } catch (error) {
      if (requestId === requestIdRef.current) {
        setState({
          status: "error",
          path: normalizedSegmentPath,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }, [
    backend,
    currentDirectoryEntries,
    currentPath,
    isCurrentDirectory,
    normalizedSegmentPath,
    onListChildDirectories,
    sessionId,
    showHiddenFiles,
  ]);

  useEffect(() => {
    if (open) {
      void loadChildren();
    }
  }, [loadChildren, open]);

  const items = state.status === "success" ? state.items : [];
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return items;
    return items.filter((item) => item.name.toLocaleLowerCase().includes(normalizedQuery));
  }, [items, query]);
  const showSearch = items.length > MENU_SEARCH_THRESHOLD;
  const shouldVirtualize = filteredItems.length > MENU_VIRTUALIZE_THRESHOLD;
  const viewportHeight = Math.min(MENU_MAX_HEIGHT, filteredItems.length * MENU_ITEM_HEIGHT);
  const visibleRange = useMemo(() => {
    if (!shouldVirtualize) {
      return { start: 0, end: filteredItems.length };
    }
    const visibleCount = Math.ceil(MENU_MAX_HEIGHT / MENU_ITEM_HEIGHT);
    const start = Math.max(0, Math.floor(scrollTop / MENU_ITEM_HEIGHT) - MENU_OVERSCAN);
    const end = Math.min(filteredItems.length, start + visibleCount + MENU_OVERSCAN * 2);
    return { start, end };
  }, [filteredItems.length, scrollTop, shouldVirtualize]);
  const visibleItems = filteredItems.slice(visibleRange.start, visibleRange.end);
  const topPadding = shouldVirtualize ? visibleRange.start * MENU_ITEM_HEIGHT : 0;
  const bottomPadding = shouldVirtualize
    ? Math.max(0, (filteredItems.length - visibleRange.end) * MENU_ITEM_HEIGHT)
    : 0;

  const isBranchChild = useCallback(
    (path: string) => {
      const normalizedPath = normalizeExplorerPath(path, backend);
      if (branchChildPath) {
        return normalizedPath === normalizeExplorerPath(branchChildPath, backend);
      }
      return (
        pathStartsWithDirectory(currentPath, normalizedPath, backend) &&
        currentPath !== normalizedPath
      );
    },
    [backend, branchChildPath, currentPath],
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-5 w-4 shrink-0 items-center justify-center rounded-r text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          title={t("fileExplorer.showChildDirectories", { path: segment.path })}
          aria-label={t("fileExplorer.showChildDirectories", { path: segment.path })}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <MdKeyboardArrowRight className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)] min-w-44 p-1">
        {state.status === "loading" && (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            {t("fileExplorer.loadingChildDirectories")}
          </div>
        )}
        {state.status === "error" && (
          <div className="space-y-2 px-2 py-2 text-xs">
            <div className="font-medium text-destructive">
              {t("fileExplorer.childDirectoriesFailed")}
            </div>
            <div className="max-w-72 whitespace-pre-wrap break-words text-muted-foreground">
              {state.message}
            </div>
            <button
              type="button"
              className="inline-flex h-6 items-center gap-1 rounded px-2 text-xs text-primary hover:bg-accent"
              onClick={() => void loadChildren()}
            >
              <MdRefresh className="h-3.5 w-3.5" />
              {t("common.retry")}
            </button>
          </div>
        )}
        {state.status === "success" && (
          <>
            {showSearch && (
              <div
                className="mb-1 flex h-7 items-center gap-1 rounded border px-2"
                style={{ borderColor: "var(--df-border)" }}
              >
                <MdSearch className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                  value={query}
                  placeholder={t("fileExplorer.searchChildDirectories")}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setScrollTop(0);
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                />
              </div>
            )}
            {filteredItems.length === 0 ? (
              <div className="px-2 py-2 text-xs text-muted-foreground">
                {query ? t("fileExplorer.noSearchResults") : t("fileExplorer.noChildDirectories")}
              </div>
            ) : (
              <div
                className="terminal-scroll overflow-y-auto"
                style={{
                  maxHeight: MENU_MAX_HEIGHT,
                  height: shouldVirtualize ? MENU_MAX_HEIGHT : viewportHeight,
                }}
                onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
              >
                <div style={{ paddingTop: topPadding, paddingBottom: bottomPadding }}>
                  {visibleItems.map((item) => {
                    const checked = isBranchChild(item.path);
                    return (
                      <button
                        key={`${item.path}:${item.rawPathToken ?? ""}`}
                        type="button"
                        className="flex w-full items-center gap-2 rounded px-2 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                        style={{ height: MENU_ITEM_HEIGHT }}
                        title={item.path}
                        onClick={() => {
                          setOpen(false);
                          onNavigate(item.path, { rawPathToken: item.rawPathToken });
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                        {checked && <MdCheck className="h-3.5 w-3.5 shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
