import type { PaneSplitDirection } from "@/types/global";
import {
  createTerminalWindowId,
  createTerminalWindowLeaf,
  type TerminalWindowNode,
} from "./tabWindows";

/**
 * Build a balanced binary split tree that moves every tab into its own leaf.
 *
 * For `N` tabs the tree depth is `O(log N)` rather than `O(N)` because we
 * always bisect the list instead of chaining one split after another.
 */
function buildBalancedTree(
  tabIds: string[],
  direction: PaneSplitDirection,
  alternate: boolean,
): TerminalWindowNode {
  if (tabIds.length === 1) {
    return createTerminalWindowLeaf([tabIds[0]], tabIds[0]);
  }

  const mid = Math.ceil(tabIds.length / 2);
  const nextDirection: PaneSplitDirection = alternate
    ? direction === "horizontal"
      ? "vertical"
      : "horizontal"
    : direction;

  return {
    id: createTerminalWindowId("window-split"),
    kind: "split",
    direction,
    ratio: mid / tabIds.length,
    first: buildBalancedTree(tabIds.slice(0, mid), nextDirection, alternate),
    second: buildBalancedTree(tabIds.slice(mid), nextDirection, alternate),
  };
}

/**
 * Auto-split: alternates horizontal / vertical to produce a grid-like layout.
 * 4 tabs → 2×2, 6 tabs → 3×2, etc.
 */
export function autoTileLayout(tabIds: string[]): TerminalWindowNode | null {
  if (tabIds.length === 0) return null;
  return buildBalancedTree(tabIds, "horizontal", true);
}

/** Split every tab using horizontal split nodes. */
export function tileHorizontally(tabIds: string[]): TerminalWindowNode | null {
  if (tabIds.length === 0) return null;
  return buildBalancedTree(tabIds, "horizontal", false);
}

/** Split every tab using vertical split nodes. */
export function tileVertically(tabIds: string[]): TerminalWindowNode | null {
  if (tabIds.length === 0) return null;
  return buildBalancedTree(tabIds, "vertical", false);
}

export type SmartSplitMode = "auto" | "horizontal" | "vertical";

export function buildSmartSplitLayout(
  tabIds: string[],
  mode: SmartSplitMode,
): TerminalWindowNode | null {
  switch (mode) {
    case "auto":
      return autoTileLayout(tabIds);
    case "horizontal":
      return tileHorizontally(tabIds);
    case "vertical":
      return tileVertically(tabIds);
  }
}
