import { memo, useMemo, useRef } from "react";
import ResizeHandle from "@/components/layout/ResizeHandle";
import {
  isTerminalWindowSplit,
  type TerminalWindowLeaf,
  type TerminalWindowNode,
  type TerminalWindowSplit,
} from "@/lib/tabWindows";
import type { PaneSplitDirection, SavedConnection, Tab } from "@/types/global";
import PaneWorkspace from "./PaneWorkspace";
import TabBar from "./TabBar";

interface TabWindowsWorkspaceProps {
  layout: TerminalWindowNode | null;
  tabsById: Map<string, Tab>;
  focusedTabId?: string | null;
  unreadTabIds?: Set<string>;
  onSelectTab: (leafId: string, tabId: string) => void;
  onAddTab: (leafId: string) => void;
  onConnectConnection: (leafId: string, connection: SavedConnection) => void | Promise<void>;
  onTabClose: (tab: Tab) => void | Promise<void>;
  onDuplicateSession: (tab: Tab) => void | Promise<void>;
  onReconnectSession: (tab: Tab) => void | Promise<void>;
  onDisconnectSession: (tab: Tab) => void | Promise<void>;
  onSplitSession: (tab: Tab, direction: PaneSplitDirection) => void | Promise<void>;
  onUnsplit?: () => void;
  onCloseSession: (tab: Tab) => void | Promise<void>;
  onCloseAll: () => void | Promise<void>;
  onCloseInactive: (keepTabId: string) => void | Promise<void>;
  onCloseRight: (tabId: string) => void | Promise<void>;
  onSessionInfo: (tab: Tab) => void | Promise<void>;
  onReorderTabs: (leafId: string, fromTabId: string, toIndex: number) => void;
  onMoveTabToLeaf?: (fromTabId: string, targetLeafId: string, toIndex: number) => void;
  onActivatePane: (tabId: string, paneId: string) => void;
  onUpdatePaneSplitRatio: (tabId: string, splitId: string, ratio: number) => void;
  onUpdateWindowSplitRatio: (splitId: string, ratio: number) => void;
  onReconnectPane?: (tabId: string, paneId: string) => void | Promise<void>;
  onReconnected?: (oldSessionId: string, newSessionId: string) => void;
}

function SplitWindow({
  split,
  tabsById,
  focusedTabId,
  unreadTabIds,
  onSelectTab,
  onAddTab,
  onConnectConnection,
  onTabClose,
  onDuplicateSession,
  onReconnectSession,
  onDisconnectSession,
  onSplitSession,
  onUnsplit,
  onCloseSession,
  onCloseAll,
  onCloseInactive,
  onCloseRight,
  onSessionInfo,
  onReorderTabs,
  onMoveTabToLeaf,
  onActivatePane,
  onUpdatePaneSplitRatio,
  onUpdateWindowSplitRatio,
  onReconnectPane,
  onReconnected,
}: {
  split: TerminalWindowSplit;
} & Omit<TabWindowsWorkspaceProps, "layout">) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isHorizontal = split.direction === "horizontal";

  const handleResize = (delta: number) => {
    const size = isHorizontal
      ? (containerRef.current?.clientHeight ?? 0)
      : (containerRef.current?.clientWidth ?? 0);
    if (size <= 0) return;
    onUpdateWindowSplitRatio(split.id, split.ratio + delta / size);
  };

  return (
    <div
      ref={containerRef}
      className={`flex h-full w-full min-h-0 min-w-0 ${isHorizontal ? "flex-col" : "flex-row"}`}
    >
      <div
        className="min-h-0 min-w-0"
        style={{ flexBasis: `${split.ratio * 100}%`, flexGrow: 0, flexShrink: 0 }}
      >
        <WindowNodeView
          node={split.first}
          tabsById={tabsById}
          focusedTabId={focusedTabId}
          unreadTabIds={unreadTabIds}
          onSelectTab={onSelectTab}
          onAddTab={onAddTab}
          onConnectConnection={onConnectConnection}
          onTabClose={onTabClose}
          onDuplicateSession={onDuplicateSession}
          onReconnectSession={onReconnectSession}
          onDisconnectSession={onDisconnectSession}
          onSplitSession={onSplitSession}
          onUnsplit={onUnsplit}
          onCloseSession={onCloseSession}
          onCloseAll={onCloseAll}
          onCloseInactive={onCloseInactive}
          onCloseRight={onCloseRight}
          onSessionInfo={onSessionInfo}
          onReorderTabs={onReorderTabs}
          onMoveTabToLeaf={onMoveTabToLeaf}
          onActivatePane={onActivatePane}
          onUpdatePaneSplitRatio={onUpdatePaneSplitRatio}
          onUpdateWindowSplitRatio={onUpdateWindowSplitRatio}
          onReconnectPane={onReconnectPane}
          onReconnected={onReconnected}
        />
      </div>
      <ResizeHandle direction={isHorizontal ? "vertical" : "horizontal"} onResize={handleResize} />
      <div className="min-h-0 min-w-0 flex-1">
        <WindowNodeView
          node={split.second}
          tabsById={tabsById}
          focusedTabId={focusedTabId}
          unreadTabIds={unreadTabIds}
          onSelectTab={onSelectTab}
          onAddTab={onAddTab}
          onConnectConnection={onConnectConnection}
          onTabClose={onTabClose}
          onDuplicateSession={onDuplicateSession}
          onReconnectSession={onReconnectSession}
          onDisconnectSession={onDisconnectSession}
          onSplitSession={onSplitSession}
          onUnsplit={onUnsplit}
          onCloseSession={onCloseSession}
          onCloseAll={onCloseAll}
          onCloseInactive={onCloseInactive}
          onCloseRight={onCloseRight}
          onSessionInfo={onSessionInfo}
          onReorderTabs={onReorderTabs}
          onMoveTabToLeaf={onMoveTabToLeaf}
          onActivatePane={onActivatePane}
          onUpdatePaneSplitRatio={onUpdatePaneSplitRatio}
          onUpdateWindowSplitRatio={onUpdateWindowSplitRatio}
          onReconnectPane={onReconnectPane}
          onReconnected={onReconnected}
        />
      </div>
    </div>
  );
}

function LeafWindow({
  leaf,
  tabsById,
  focusedTabId,
  unreadTabIds,
  onSelectTab,
  onAddTab,
  onConnectConnection,
  onTabClose,
  onDuplicateSession,
  onReconnectSession,
  onDisconnectSession,
  onSplitSession,
  onUnsplit,
  onCloseSession,
  onCloseAll,
  onCloseInactive,
  onCloseRight,
  onSessionInfo,
  onReorderTabs,
  onMoveTabToLeaf,
  onActivatePane,
  onUpdatePaneSplitRatio,
  onReconnectPane,
  onReconnected,
}: {
  leaf: TerminalWindowLeaf;
} & Omit<TabWindowsWorkspaceProps, "layout" | "onUpdateWindowSplitRatio">) {
  const tabs = useMemo(
    () => leaf.tabIds.map((tabId) => tabsById.get(tabId)).filter((tab): tab is Tab => !!tab),
    [leaf.tabIds, tabsById],
  );
  const contentTabs = useMemo(
    () => Array.from(tabsById.values()).filter((tab) => leaf.tabIds.includes(tab.id)),
    [leaf.tabIds, tabsById],
  );
  const activeTab =
    (leaf.activeTabId ? tabs.find((tab) => tab.id === leaf.activeTabId) : null) ?? tabs[0] ?? null;

  return (
    <div
      className="nyaterm-wallpaper-transparent-surface flex h-full min-h-0 min-w-0 flex-col overflow-hidden border"
      style={{
        borderColor: "var(--df-border)",
        backgroundColor: "var(--df-bg-terminal)",
      }}
      onMouseDown={() => {
        if (activeTab) {
          onSelectTab(leaf.id, activeTab.id);
        }
      }}
    >
      <TabBar
        tabs={tabs}
        activeTabId={activeTab?.id ?? null}
        focusedTabId={focusedTabId}
        unreadTabIds={unreadTabIds}
        onTabChange={(tabId) => onSelectTab(leaf.id, tabId)}
        onTabClose={onTabClose}
        onAddTab={() => onAddTab(leaf.id)}
        onConnectConnection={(connection) => onConnectConnection(leaf.id, connection)}
        onDuplicateSession={onDuplicateSession}
        onReconnectSession={onReconnectSession}
        onDisconnectSession={onDisconnectSession}
        onSplitSession={onSplitSession}
        onUnsplit={onUnsplit}
        onCloseSession={onCloseSession}
        onCloseAll={onCloseAll}
        onCloseInactive={onCloseInactive}
        onCloseRight={onCloseRight}
        onSessionInfo={onSessionInfo}
        onReorderTabs={(fromTabId, toIndex) => onReorderTabs(leaf.id, fromTabId, toIndex)}
        onMoveTabHere={
          onMoveTabToLeaf
            ? (fromTabId, toIndex) => onMoveTabToLeaf(fromTabId, leaf.id, toIndex)
            : undefined
        }
      />

      <div className="relative flex-1 overflow-hidden">
        {contentTabs.map((tab) => (
          <PaneWorkspace
            key={tab.id}
            tab={tab}
            visible={activeTab?.id === tab.id}
            onActivatePane={(paneId) => {
              onSelectTab(leaf.id, tab.id);
              onActivatePane(tab.id, paneId);
            }}
            onUpdateSplitRatio={(splitId, ratio) => onUpdatePaneSplitRatio(tab.id, splitId, ratio)}
            onReconnectPane={onReconnectPane}
            onReconnected={onReconnected}
          />
        ))}
      </div>
    </div>
  );
}

function WindowNodeView({
  node,
  tabsById,
  focusedTabId,
  unreadTabIds,
  onSelectTab,
  onAddTab,
  onConnectConnection,
  onTabClose,
  onDuplicateSession,
  onReconnectSession,
  onDisconnectSession,
  onSplitSession,
  onUnsplit,
  onCloseSession,
  onCloseAll,
  onCloseInactive,
  onCloseRight,
  onSessionInfo,
  onReorderTabs,
  onMoveTabToLeaf,
  onActivatePane,
  onUpdatePaneSplitRatio,
  onUpdateWindowSplitRatio,
  onReconnectPane,
  onReconnected,
}: {
  node: TerminalWindowNode;
} & Omit<TabWindowsWorkspaceProps, "layout">) {
  if (isTerminalWindowSplit(node)) {
    return (
      <SplitWindow
        split={node}
        tabsById={tabsById}
        focusedTabId={focusedTabId}
        unreadTabIds={unreadTabIds}
        onSelectTab={onSelectTab}
        onAddTab={onAddTab}
        onConnectConnection={onConnectConnection}
        onTabClose={onTabClose}
        onDuplicateSession={onDuplicateSession}
        onReconnectSession={onReconnectSession}
        onDisconnectSession={onDisconnectSession}
        onSplitSession={onSplitSession}
        onUnsplit={onUnsplit}
        onCloseSession={onCloseSession}
        onCloseAll={onCloseAll}
        onCloseInactive={onCloseInactive}
        onCloseRight={onCloseRight}
        onSessionInfo={onSessionInfo}
        onReorderTabs={onReorderTabs}
        onMoveTabToLeaf={onMoveTabToLeaf}
        onActivatePane={onActivatePane}
        onUpdatePaneSplitRatio={onUpdatePaneSplitRatio}
        onUpdateWindowSplitRatio={onUpdateWindowSplitRatio}
        onReconnectPane={onReconnectPane}
        onReconnected={onReconnected}
      />
    );
  }

  return (
    <LeafWindow
      leaf={node}
      tabsById={tabsById}
      focusedTabId={focusedTabId}
      unreadTabIds={unreadTabIds}
      onSelectTab={onSelectTab}
      onAddTab={onAddTab}
      onConnectConnection={onConnectConnection}
      onTabClose={onTabClose}
      onDuplicateSession={onDuplicateSession}
      onReconnectSession={onReconnectSession}
      onDisconnectSession={onDisconnectSession}
      onSplitSession={onSplitSession}
      onUnsplit={onUnsplit}
      onCloseSession={onCloseSession}
      onCloseAll={onCloseAll}
      onCloseInactive={onCloseInactive}
      onCloseRight={onCloseRight}
      onSessionInfo={onSessionInfo}
      onReorderTabs={onReorderTabs}
      onMoveTabToLeaf={onMoveTabToLeaf}
      onActivatePane={onActivatePane}
      onUpdatePaneSplitRatio={onUpdatePaneSplitRatio}
      onReconnectPane={onReconnectPane}
      onReconnected={onReconnected}
    />
  );
}

function TabWindowsWorkspace({ layout, ...props }: TabWindowsWorkspaceProps) {
  if (!layout) return null;

  return <WindowNodeView node={layout} {...props} />;
}

export default memo(TabWindowsWorkspace);
