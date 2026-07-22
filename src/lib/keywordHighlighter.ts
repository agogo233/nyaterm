import type {
  IBufferCell,
  IBufferLine,
  IDecoration,
  IDisposable,
  IMarker,
  Terminal as XTerm,
} from "@xterm/xterm";
import type { ResolvedHighlightRule } from "./keywordHighlightPresets";
import { getKeywordHighlightPerformanceConfig, XTERM_PERFORMANCE_CONFIG } from "./xtermPerformance";

interface CompiledRule {
  regex: RegExp;
  color: string;
}

interface CachedDecoration {
  decoration: IDecoration;
  marker: IMarker;
}

interface LogicalLineSegment {
  line: IBufferLine;
  lineY: number;
  text: string;
  startIndex: number;
  endIndex: number;
  cellMap: number[] | null;
}

type KeywordHighlightPerformanceConfig = ReturnType<typeof getKeywordHighlightPerformanceConfig>;

interface RefreshBudget {
  createdDecorations: number;
  deadlineMs: number;
  hitLimit: boolean;
  hitTotalDecorationLimit: boolean;
}

/**
 * Manages terminal decorations for keyword highlighting.
 *
 * Optimizations over a naive implementation:
 * - Overscan buffer: keeps decorations alive for configured rows above/below the
 *   viewport, eliminating highlight loss when scrolling back to recently-visited rows.
 * - Scanned-line memoization: scrollback content is immutable once written, so each line
 *   or fully-scrollback wrapped logical line is regex-matched exactly once. Subsequent
 *   passes just copy existing keys into requiredKeys without re-running regex/cell scans.
 * - Fast ASCII path: skips building the wide-char cell map for lines with only ASCII chars.
 * - Deduplicates scroll/render events: onRender viewport-Y check replaces the redundant onScroll.
 * - Auto-invalidation: each decoration subscribes to its own onDispose so the cache and the
 *   per-line index stay consistent when xterm evicts lines from the scrollback buffer.
 * - Alternate buffer guard: clears decorations immediately when TUI apps (vim, htop) take over.
 */
export class KeywordHighlighter implements IDisposable {
  private term: XTerm;
  private compiledRules: CompiledRule[] = [];
  private decorationCache = new Map<string, CachedDecoration>();
  /** Maps absolute buffer line index → decoration keys on that line. */
  private lineToKeys = new Map<number, string[]>();
  /** Lines that have been fully scanned and whose results are memoized in lineToKeys. */
  private scannedLines = new Set<number>();
  private writeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  private resumeRefreshFrame: number | null = null;
  private continuationRefreshFrame: number | null = null;
  private scrollThrottlePending = false;
  private enabled = false;
  private suspended = false;
  private highlightAcrossWrappedLines = false;
  private disposables: IDisposable[] = [];
  private lastViewportY = -1;

  /** Marker anchored at buffer line 0 to detect scrollback trimming. */
  private sentinelMarker: IMarker | null = null;
  private sentinelDisposable: IDisposable | null = null;
  private bufferTrimmed = false;

  private static readonly MAX_LOGICAL_LINE_SCAN_CHARS = 16 * 1024;

  constructor(term: XTerm) {
    this.term = term;

    this.disposables.push(
      this.term.onWriteParsed(() => this.triggerWriteRefresh()),
      this.term.onResize(() => {
        this.clearAllDecorations();
        this.lastViewportY = -1;
        this.triggerWriteRefresh();
      }),
      this.term.onRender(() => {
        const currentViewportY = this.term.buffer.active?.viewportY ?? 0;
        if (currentViewportY !== this.lastViewportY) {
          this.lastViewportY = currentViewportY;
          this.triggerScrollRefresh();
        }
      }),
    );
  }

  public setRules(
    rules: ResolvedHighlightRule[],
    enabled: boolean,
    highlightAcrossWrappedLines = false,
  ): void {
    this.enabled = enabled;
    this.highlightAcrossWrappedLines = highlightAcrossWrappedLines;

    this.compiledRules = [];
    for (const rule of rules) {
      if (!rule.enabled || rule.patterns.length === 0) continue;
      const validAlts: string[] = [];
      for (const pattern of rule.patterns) {
        const trimmed = pattern.trim();
        if (!trimmed) continue;
        try {
          new RegExp(trimmed, "gi");
          validAlts.push(trimmed);
        } catch {
          // silently skip invalid regex
        }
      }
      if (validAlts.length === 0) continue;
      const combined =
        validAlts.length === 1 ? validAlts[0] : validAlts.map((p) => `(?:${p})`).join("|");
      try {
        this.compiledRules.push({ regex: new RegExp(combined, "gi"), color: rule.color });
      } catch {
        // fallback: compile each pattern individually
        for (const alt of validAlts) {
          try {
            this.compiledRules.push({ regex: new RegExp(alt, "gi"), color: rule.color });
          } catch {
            // skip
          }
        }
      }
    }

    this.clearAllDecorations();
    if (this.enabled && this.compiledRules.length > 0) {
      this.triggerWriteRefresh();
    }
  }

  public setSuspended(suspended: boolean): void {
    if (this.suspended === suspended) return;
    this.suspended = suspended;

    if (suspended) {
      this.clearAllTimers();
      return;
    }

    if (this.enabled && this.compiledRules.length > 0) {
      this.lastViewportY = -1;
      this.triggerResumeRefresh();
    }
  }

  public releaseCaches(): void {
    this.clearAllDecorations();
    this.lastViewportY = -1;
  }

  public dispose(): void {
    this.clearAllDecorations();
    this.disposables.forEach((d) => {
      d.dispose();
    });
    this.disposables = [];
  }

  private clearAllTimers(): void {
    if (this.writeDebounceTimer) {
      clearTimeout(this.writeDebounceTimer);
      this.writeDebounceTimer = null;
    }
    if (this.scrollThrottleTimer) {
      clearTimeout(this.scrollThrottleTimer);
      this.scrollThrottleTimer = null;
    }
    if (this.resumeRefreshFrame !== null) {
      cancelAnimationFrame(this.resumeRefreshFrame);
      this.resumeRefreshFrame = null;
    }
    if (this.continuationRefreshFrame !== null) {
      cancelAnimationFrame(this.continuationRefreshFrame);
      this.continuationRefreshFrame = null;
    }
    this.scrollThrottlePending = false;
  }

  /**
   * Place a marker at buffer line 0. When xterm trims the scrollback (buffer
   * full), this line is evicted and the marker is disposed, letting us detect
   * the shift and invalidate all index-based caches.
   */
  private installSentinel(): void {
    this.disposeSentinel();
    const buffer = this.term.buffer.active;
    if (!buffer || buffer.length === 0) return;

    const cursorAbsoluteY = buffer.baseY + buffer.cursorY;
    const marker = this.term.registerMarker(-cursorAbsoluteY);
    if (!marker || marker.line < 0) return;

    this.sentinelMarker = marker;
    this.sentinelDisposable = marker.onDispose(() => {
      this.bufferTrimmed = true;
      this.sentinelMarker = null;
      this.sentinelDisposable = null;
    });
  }

  private disposeSentinel(): void {
    this.sentinelDisposable?.dispose();
    this.sentinelMarker?.dispose();
    this.sentinelMarker = null;
    this.sentinelDisposable = null;
  }

  private canRefresh(): boolean {
    if (!this.enabled || this.suspended || this.compiledRules.length === 0) return false;
    if (this.term.buffer.active.type === "alternate") {
      this.clearAllDecorations();
      return false;
    }
    return true;
  }

  /** Debounced refresh for write/resize events (batches rapid output). */
  private triggerWriteRefresh(): void {
    if (!this.canRefresh()) return;
    if (this.writeDebounceTimer) clearTimeout(this.writeDebounceTimer);
    this.writeDebounceTimer = setTimeout(() => {
      this.writeDebounceTimer = null;
      this.refreshViewport();
    }, XTERM_PERFORMANCE_CONFIG.highlighting.debounceMs);
  }

  /**
   * Leading+trailing throttle for scroll events. Fires immediately on the
   * first scroll, then at most once per throttle interval during continuous
   * scrolling, with a trailing call after scrolling stops.
   */
  private triggerScrollRefresh(): void {
    if (!this.canRefresh()) return;
    if (this.scrollThrottleTimer !== null) {
      this.scrollThrottlePending = true;
      return;
    }
    this.refreshViewport();
    this.scrollThrottleTimer = setTimeout(() => {
      this.scrollThrottleTimer = null;
      if (this.scrollThrottlePending) {
        this.scrollThrottlePending = false;
        this.triggerScrollRefresh();
      }
    }, XTERM_PERFORMANCE_CONFIG.highlighting.throttleMs);
  }

  /**
   * Let the visible terminal's first fit/refresh/output frame complete before
   * doing highlight work after a tab becomes visible again.
   */
  private triggerResumeRefresh(): void {
    if (!this.canRefresh()) return;
    if (this.resumeRefreshFrame !== null) return;

    this.resumeRefreshFrame = requestAnimationFrame(() => {
      this.resumeRefreshFrame = requestAnimationFrame(() => {
        this.resumeRefreshFrame = null;
        this.refreshViewport();
      });
    });
  }

  private triggerContinuationRefresh(): void {
    if (!this.canRefresh()) return;
    if (this.continuationRefreshFrame !== null) return;

    this.continuationRefreshFrame = requestAnimationFrame(() => {
      this.continuationRefreshFrame = null;
      this.refreshViewport();
    });
  }

  /**
   * Clear map before disposing so the per-decoration onDispose callbacks find
   * an empty map and become no-ops, avoiding re-entrant mutation.
   * Also resets the scanned-line memoization so all lines are re-scanned after
   * a rule change, and tears down the trim-detection sentinel.
   */
  private clearAllDecorations(): void {
    this.clearAllTimers();
    const entries = [...this.decorationCache.values()];
    this.decorationCache.clear();
    this.lineToKeys.clear();
    this.scannedLines.clear();
    this.disposeSentinel();
    this.bufferTrimmed = false;
    for (const { decoration, marker } of entries) {
      decoration.dispose();
      marker.dispose();
    }
  }

  private buildStringToCellMap(
    line: IBufferLine,
    stringLength: number,
    maxCols: number,
    scratchCell: IBufferCell,
  ): number[] {
    const map: number[] = [];
    let col = 0;
    let cellEndCol = 0;

    // Mirror translateToString's traversal exactly: advance by `width || 1` so that
    // wide-char continuation cells (width=0 placeholder after a 2-wide glyph) are
    // naturally skipped, while NUL cells (also width=0, but emitted as a space by
    // translateToString) still contribute one entry.  The old `col++` loop with an
    // explicit `width === 0 → continue` guard incorrectly skipped both kinds and
    // produced a map shorter than lineText when NUL cells appeared before wide chars.
    while (col < maxCols && map.length < stringLength) {
      const cell = line.getCell(col, scratchCell);
      if (!cell) break;

      const chars = cell.getChars();
      const width = cell.getWidth();
      // translateToString advances by `width || 1`; replicate the same stride so our
      // map index always stays in sync with the returned string.
      const stride = width || 1;

      if (chars.length === 0) {
        // NUL cell: getChars() returns '' but translateToString emits WHITESPACE_CELL_CHAR.
        map.push(col);
      } else {
        for (let i = 0; i < chars.length; i++) {
          map.push(col);
        }
      }
      cellEndCol = col + stride;
      col += stride;
    }

    map.push(cellEndCol); // sentinel: end position
    return map;
  }

  private getLogicalLineBounds(
    buffer: XTerm["buffer"]["active"],
    lineY: number,
    totalLines: number,
  ): { startY: number; endY: number } {
    let startY = lineY;
    while (startY > 0) {
      const currentLine = buffer.getLine(startY);
      if (!currentLine?.isWrapped) break;
      startY--;
    }

    let endY = lineY;
    while (endY + 1 < totalLines) {
      const nextLine = buffer.getLine(endY + 1);
      if (!nextLine?.isWrapped) break;
      endY++;
    }

    return { startY, endY };
  }

  private isBudgetExpired(budget: RefreshBudget): boolean {
    if (performance.now() <= budget.deadlineMs) return false;
    budget.hitLimit = true;
    return true;
  }

  private isBudgetExhausted(budget: RefreshBudget): boolean {
    return budget.hitLimit || this.isBudgetExpired(budget);
  }

  private canCreateDecoration(
    config: KeywordHighlightPerformanceConfig,
    budget: RefreshBudget,
  ): boolean {
    if (this.decorationCache.size >= config.maxDecorations) {
      budget.hitLimit = true;
      budget.hitTotalDecorationLimit = true;
      return false;
    }
    if (budget.createdDecorations >= config.maxDecorationsPerRefresh) {
      budget.hitLimit = true;
      return false;
    }
    return !this.isBudgetExhausted(budget);
  }

  private hasAnsiForegroundInRange(
    line: IBufferLine,
    start: number,
    end: number,
    cellMap: number[] | null,
    scratchCell: IBufferCell,
  ): boolean {
    for (let i = start; i < end; i++) {
      const cellCol = cellMap ? (cellMap[i] ?? i) : i;
      const cell = line.getCell(cellCol, scratchCell);
      if (cell && !cell.isFgDefault()) return true;
    }
    return false;
  }

  private hasWrappedAnsiForegroundInRange(
    segments: LogicalLineSegment[],
    start: number,
    end: number,
    scratchCell: IBufferCell,
  ): boolean {
    for (const segment of segments) {
      if (segment.endIndex <= start || segment.startIndex >= end) continue;

      const localStart = Math.max(start, segment.startIndex) - segment.startIndex;
      const localEnd = Math.min(end, segment.endIndex) - segment.startIndex;
      if (
        this.hasAnsiForegroundInRange(
          segment.line,
          localStart,
          localEnd,
          segment.cellMap,
          scratchCell,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  private getLineYFromDecorationKey(key: string): number | null {
    const separatorIndex = key.indexOf(":");
    if (separatorIndex <= 0) return null;
    const lineY = Number(key.slice(0, separatorIndex));
    return Number.isFinite(lineY) ? lineY : null;
  }

  private ensureDecoration(
    lineY: number,
    cellStartCol: number,
    cellWidth: number,
    color: string,
    cursorAbsoluteY: number,
    config: KeywordHighlightPerformanceConfig,
    budget: RefreshBudget,
  ): string | null {
    if (cellWidth <= 0) return null;

    const key = `${lineY}:${cellStartCol}:${cellWidth}:${color}`;
    if (this.decorationCache.has(key)) return key;
    if (!this.canCreateDecoration(config, budget)) return null;

    const offset = lineY - cursorAbsoluteY;
    const marker = this.term.registerMarker(offset);
    if (!marker) return null;

    const deco = this.term.registerDecoration({
      marker,
      x: cellStartCol,
      width: cellWidth,
      foregroundColor: color,
    });

    if (!deco) {
      marker.dispose();
      return null;
    }

    deco.onRender((element: HTMLElement) => {
      element.style.pointerEvents = "none";
    });

    // Auto-remove from cache and line index when xterm evicts the line
    deco.onDispose(() => {
      this.decorationCache.delete(key);
      // Remove from line index so the line gets re-scanned if it reappears
      const keys = this.lineToKeys.get(lineY);
      if (keys) {
        const filtered = keys.filter((k) => k !== key);
        if (filtered.length === 0) {
          this.lineToKeys.delete(lineY);
          this.scannedLines.delete(lineY);
        } else {
          this.lineToKeys.set(lineY, filtered);
        }
      }
    });

    this.decorationCache.set(key, { decoration: deco, marker });
    budget.createdDecorations++;
    return key;
  }

  private scanPhysicalLine(
    line: IBufferLine,
    lineY: number,
    cursorAbsoluteY: number,
    requiredKeys: Set<string>,
    scratchCell: IBufferCell,
    config: KeywordHighlightPerformanceConfig,
    budget: RefreshBudget,
  ): string[] {
    const maxCols = Math.min(line.length, this.term.cols);
    const lineText = line.translateToString(true, 0, maxCols);
    if (!lineText) return [];

    // Only build the wide-char map if actually needed (non-ASCII present)
    const hasMultibyte = /[^\u0000-\u00FF]/.test(lineText);
    const cellMap = hasMultibyte
      ? this.buildStringToCellMap(line, lineText.length, maxCols, scratchCell)
      : null;

    // Track occupied characters in the string to prevent multi-rule overlapping
    const occupied = new Uint8Array(lineText.length);

    const lineKeys: string[] = [];

    for (const { regex, color } of this.compiledRules) {
      if (lineKeys.length >= config.maxMatchesPerLine || this.isBudgetExhausted(budget)) break;
      regex.lastIndex = 0;

      while (true) {
        if (lineKeys.length >= config.maxMatchesPerLine || this.isBudgetExhausted(budget)) break;
        const match = regex.exec(lineText);
        if (match === null) break;

        // Avoid infinite loops on empty matches
        if (match[0].length === 0) {
          regex.lastIndex++;
          continue;
        }

        const strStart = match.index;
        const strEnd = strStart + match[0].length;

        // Check for collision with higher-priority matches.
        let isOverlapping = false;
        for (let k = strStart; k < strEnd; k++) {
          if (occupied[k]) {
            isOverlapping = true;
            break;
          }
        }
        if (isOverlapping) continue;

        // Avoid overriding original shell output colors (e.g. from `ls --color`).
        if (this.hasAnsiForegroundInRange(line, strStart, strEnd, cellMap, scratchCell)) continue;

        const cellStartCol = cellMap ? (cellMap[strStart] ?? strStart) : strStart;
        const cellEndCol = cellMap ? (cellMap[strEnd] ?? strEnd) : strEnd;
        const key = this.ensureDecoration(
          lineY,
          cellStartCol,
          cellEndCol - cellStartCol,
          color,
          cursorAbsoluteY,
          config,
          budget,
        );
        if (!key) {
          if (budget.hitLimit) break;
          continue;
        }

        // Mark as occupied only after the highlight has been accepted.
        for (let k = strStart; k < strEnd; k++) {
          occupied[k] = 1;
        }

        requiredKeys.add(key);
        lineKeys.push(key);
      }
    }

    return lineKeys;
  }

  private scanWrappedLogicalLine(
    buffer: XTerm["buffer"]["active"],
    startY: number,
    endY: number,
    scanStart: number,
    scanEnd: number,
    cursorAbsoluteY: number,
    requiredKeys: Set<string>,
    scratchCell: IBufferCell,
    config: KeywordHighlightPerformanceConfig,
    budget: RefreshBudget,
  ): Map<number, string[]> {
    const segments: LogicalLineSegment[] = [];
    let logicalLength = 0;

    for (let currentY = startY; currentY <= endY; currentY++) {
      const line = buffer.getLine(currentY);
      if (!line) continue;

      const maxCols = Math.min(line.length, this.term.cols);
      const text = line.translateToString(currentY === endY, 0, maxCols);
      const startIndex = logicalLength;
      logicalLength += text.length;

      segments.push({
        line,
        lineY: currentY,
        text,
        startIndex,
        endIndex: logicalLength,
        cellMap:
          /[^\u0000-\u00FF]/.test(text) && text.length > 0
            ? this.buildStringToCellMap(line, text.length, maxCols, scratchCell)
            : null,
      });
    }

    if (logicalLength === 0) return new Map();

    const logicalText = segments.map((segment) => segment.text).join("");
    if (logicalText.length > KeywordHighlighter.MAX_LOGICAL_LINE_SCAN_CHARS) {
      return new Map();
    }
    const occupied = new Uint8Array(logicalText.length);

    const lineKeysByLine = new Map<number, string[]>();
    const acceptedMatchesByLine = new Map<number, number>();

    for (const { regex, color } of this.compiledRules) {
      if (this.isBudgetExhausted(budget)) break;
      regex.lastIndex = 0;

      while (true) {
        if (this.isBudgetExhausted(budget)) break;
        const match = regex.exec(logicalText);
        if (match === null) break;

        if (match[0].length === 0) {
          regex.lastIndex++;
          continue;
        }

        const strStart = match.index;
        const strEnd = strStart + match[0].length;

        let isOverlapping = false;
        for (let k = strStart; k < strEnd; k++) {
          if (occupied[k]) {
            isOverlapping = true;
            break;
          }
        }
        if (isOverlapping) continue;
        if (this.hasWrappedAnsiForegroundInRange(segments, strStart, strEnd, scratchCell)) continue;

        const matchedSegments = segments.filter(
          (segment) =>
            segment.lineY >= scanStart &&
            segment.lineY <= scanEnd &&
            segment.endIndex > strStart &&
            segment.startIndex < strEnd,
        );
        if (matchedSegments.length === 0) continue;

        let lineLimitReached = false;
        for (const segment of matchedSegments) {
          const acceptedCount = acceptedMatchesByLine.get(segment.lineY) ?? 0;
          if (acceptedCount >= config.maxMatchesPerLine) {
            lineLimitReached = true;
            break;
          }
        }
        if (lineLimitReached) continue;

        const createdKeys: Array<{ lineY: number; key: string }> = [];
        for (const segment of matchedSegments) {
          const localStart = Math.max(strStart, segment.startIndex) - segment.startIndex;
          const localEnd = Math.min(strEnd, segment.endIndex) - segment.startIndex;
          if (localEnd <= localStart) continue;

          const cellStartCol = segment.cellMap
            ? (segment.cellMap[localStart] ?? localStart)
            : localStart;
          const cellEndCol = segment.cellMap ? (segment.cellMap[localEnd] ?? localEnd) : localEnd;
          const key = this.ensureDecoration(
            segment.lineY,
            cellStartCol,
            cellEndCol - cellStartCol,
            color,
            cursorAbsoluteY,
            config,
            budget,
          );
          if (!key) {
            if (budget.hitLimit) break;
            continue;
          }

          requiredKeys.add(key);
          createdKeys.push({ lineY: segment.lineY, key });

          const lineKeys = lineKeysByLine.get(segment.lineY);
          if (lineKeys) {
            lineKeys.push(key);
          } else {
            lineKeysByLine.set(segment.lineY, [key]);
          }
        }

        if (createdKeys.length === 0) {
          if (budget.hitLimit) break;
          continue;
        }

        for (let k = strStart; k < strEnd; k++) {
          occupied[k] = 1;
        }
        for (const { lineY } of createdKeys) {
          acceptedMatchesByLine.set(lineY, (acceptedMatchesByLine.get(lineY) ?? 0) + 1);
        }
      }
    }

    return lineKeysByLine;
  }

  private refreshViewport(): void {
    if (!this.enabled || this.suspended || this.compiledRules.length === 0) return;
    if (!this.term?.buffer?.active) return;

    if (this.term.buffer.active.type === "alternate") {
      this.clearAllDecorations();
      return;
    }

    // When xterm trims the scrollback, all buffer indices shift and our caches
    // become stale. Detect this via the sentinel marker and wipe everything.
    if (this.bufferTrimmed) {
      const entries = [...this.decorationCache.values()];
      this.decorationCache.clear();
      this.lineToKeys.clear();
      this.scannedLines.clear();
      this.bufferTrimmed = false;
      for (const { decoration, marker } of entries) {
        decoration.dispose();
        marker.dispose();
      }
    }

    if (!this.sentinelMarker) {
      this.installSentinel();
    }

    const buffer = this.term.buffer.active;
    const viewportY = buffer.viewportY;
    const rows = this.term.rows;
    const cursorAbsoluteY = buffer.baseY + buffer.cursorY;
    const totalLines = buffer.length;
    // Lines below this index are in the scrollback and are immutable.
    // Lines on the current screen (>= screenStartY) may still change via escape sequences.
    const screenStartY = buffer.baseY;
    const config = getKeywordHighlightPerformanceConfig();
    const budget: RefreshBudget = {
      createdDecorations: 0,
      deadlineMs: performance.now() + config.maxRefreshTimeMs,
      hitLimit: false,
      hitTotalDecorationLimit: false,
    };

    // Expand the active zone with overscan so decorations survive typical scroll bursts
    // without being destroyed and recreated, eliminating highlight flicker.
    const scanStart = Math.max(0, viewportY - config.resolvedOverscanLines);
    const scanEnd = Math.min(totalLines - 1, viewportY + rows - 1 + config.resolvedOverscanLines);

    const requiredKeys = new Set<string>();
    const processedLines = new Set<number>();
    const scratchCell = buffer.getNullCell();
    const processedLogicalStarts = new Set<number>();

    for (let lineY = scanStart; lineY <= scanEnd; lineY++) {
      if (this.isBudgetExhausted(budget)) break;
      const line = buffer.getLine(lineY);
      if (!line) continue;
      processedLines.add(lineY);

      if (!this.highlightAcrossWrappedLines) {
        if (lineY < screenStartY && this.scannedLines.has(lineY)) {
          const cached = this.lineToKeys.get(lineY);
          if (cached) {
            let stale = false;
            for (const k of cached) {
              if (this.decorationCache.has(k)) {
                requiredKeys.add(k);
              } else {
                stale = true;
              }
            }
            if (!stale) continue;
            this.scannedLines.delete(lineY);
            this.lineToKeys.delete(lineY);
          } else {
            continue;
          }
        }

        const lineKeys = this.scanPhysicalLine(
          line,
          lineY,
          cursorAbsoluteY,
          requiredKeys,
          scratchCell,
          config,
          budget,
        );

        // Only memoize scrollback lines — screen lines remain mutable
        if (lineY < screenStartY) {
          this.scannedLines.add(lineY);
          if (lineKeys.length > 0) {
            this.lineToKeys.set(lineY, lineKeys);
          } else {
            this.lineToKeys.delete(lineY);
          }
        }
        continue;
      }

      const { startY, endY } = this.getLogicalLineBounds(buffer, lineY, totalLines);
      const canMemoize = endY < screenStartY;

      if (canMemoize && this.scannedLines.has(lineY)) {
        const cached = this.lineToKeys.get(lineY);
        if (cached) {
          let stale = false;
          for (const k of cached) {
            if (this.decorationCache.has(k)) {
              requiredKeys.add(k);
            } else {
              stale = true;
            }
          }
          if (!stale) continue;
          this.scannedLines.delete(lineY);
          this.lineToKeys.delete(lineY);
        } else {
          continue;
        }
      }

      // Wrapped-line mode can span multiple physical lines, so a logical line that
      // touches the live screen cannot be memoized by individual scrollback rows.
      if (!canMemoize && processedLogicalStarts.has(startY)) continue;
      if (!canMemoize) {
        processedLogicalStarts.add(startY);
      }
      for (
        let processedY = Math.max(startY, scanStart);
        processedY <= Math.min(endY, scanEnd);
        processedY++
      ) {
        processedLines.add(processedY);
      }

      const lineKeysByLine = this.scanWrappedLogicalLine(
        buffer,
        startY,
        endY,
        scanStart,
        scanEnd,
        cursorAbsoluteY,
        requiredKeys,
        scratchCell,
        config,
        budget,
      );

      if (canMemoize) {
        for (let memoY = Math.max(startY, scanStart); memoY <= Math.min(endY, scanEnd); memoY++) {
          this.scannedLines.add(memoY);
          const lineKeys = lineKeysByLine.get(memoY);
          if (lineKeys && lineKeys.length > 0) {
            this.lineToKeys.set(memoY, lineKeys);
          } else {
            this.lineToKeys.delete(memoY);
          }
        }
      }
    }

    // Evict decorations that have drifted outside the overscan zone. If the refresh
    // hit a time/count budget, keep unprocessed in-zone lines to avoid flicker and churn.
    const staleKeys: string[] = [];
    for (const key of this.decorationCache.keys()) {
      if (requiredKeys.has(key)) continue;
      const lineY = this.getLineYFromDecorationKey(key);
      const isOutsideScanZone = lineY === null || lineY < scanStart || lineY > scanEnd;
      if (isOutsideScanZone || !budget.hitLimit || processedLines.has(lineY)) {
        staleKeys.push(key);
      }
    }
    for (const key of staleKeys) {
      const entry = this.decorationCache.get(key);
      if (entry) {
        this.decorationCache.delete(key); // remove before dispose to silence onDispose no-op
        entry.decoration.dispose();
        entry.marker.dispose();
      }
    }

    // Also evict the line-index entries for lines now outside the zone so they
    // are re-scanned if the user scrolls back to them later.
    for (const lineY of this.scannedLines) {
      if (lineY < scanStart || lineY > scanEnd) {
        this.scannedLines.delete(lineY);
        this.lineToKeys.delete(lineY);
      }
    }

    if (budget.hitLimit && !budget.hitTotalDecorationLimit) {
      this.triggerContinuationRefresh();
    }
  }
}
