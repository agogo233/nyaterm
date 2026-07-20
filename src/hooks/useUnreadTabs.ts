import { useEffect, useMemo, useState } from "react";
import { collectSessionPanes, findTabBySessionId } from "@/lib/workspaceTabs";
import type { Tab } from "@/types/global";

export interface TabStatusIndicators {
  unreadTabIds: Set<string>;
  disconnectedTabIds: Set<string>;
}

export function useTabStatusIndicators(
  tabs: Tab[],
  activeTabId: string | null,
): TabStatusIndicators {
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(new Set());
  const [disconnectedSessionIds, setDisconnectedSessionIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handler = (event: Event) => {
      const { sessionId } = (event as CustomEvent<{ sessionId: string }>).detail;
      const tab = findTabBySessionId(tabs, sessionId);
      if (tab && tab.id !== activeTabId) {
        setUnreadSessionIds((prev) => {
          if (prev.has(sessionId)) return prev;
          const next = new Set(prev);
          next.add(sessionId);
          return next;
        });
      }
    };

    window.addEventListener("nyaterm:session-output", handler);
    return () => window.removeEventListener("nyaterm:session-output", handler);
  }, [activeTabId, tabs]);

  useEffect(() => {
    const disconnectedHandler = (event: Event) => {
      const { sessionId } = (event as CustomEvent<{ sessionId: string }>).detail;
      if (!sessionId) return;
      setDisconnectedSessionIds((prev) => {
        if (prev.has(sessionId)) return prev;
        const next = new Set(prev);
        next.add(sessionId);
        return next;
      });
    };
    const reconnectedHandler = (event: Event) => {
      const { oldSessionId, newSessionId } = (
        event as CustomEvent<{ oldSessionId: string; newSessionId: string }>
      ).detail;
      setDisconnectedSessionIds((prev) => {
        if (!prev.has(oldSessionId) && !prev.has(newSessionId)) return prev;
        const next = new Set(prev);
        next.delete(oldSessionId);
        next.delete(newSessionId);
        return next;
      });
    };

    window.addEventListener("nyaterm:session-disconnected", disconnectedHandler);
    window.addEventListener("nyaterm:session-reconnected", reconnectedHandler);
    return () => {
      window.removeEventListener("nyaterm:session-disconnected", disconnectedHandler);
      window.removeEventListener("nyaterm:session-reconnected", reconnectedHandler);
    };
  }, []);

  useEffect(() => {
    if (!activeTabId) return;

    const tab = tabs.find((item) => item.id === activeTabId);
    if (!tab) return;

    const paneSessionIds = new Set(collectSessionPanes(tab.root).map((pane) => pane.sessionId));
    setUnreadSessionIds((prev) => {
      const hasUnreadPane = [...prev].some((id) => paneSessionIds.has(id));
      if (!hasUnreadPane) return prev;

      const next = new Set(prev);
      for (const id of paneSessionIds) {
        next.delete(id);
      }
      return next;
    });
  }, [activeTabId, tabs]);

  useEffect(() => {
    const liveSessionIds = new Set(
      tabs.flatMap((tab) => collectSessionPanes(tab.root).map((pane) => pane.sessionId)),
    );
    setUnreadSessionIds((prev) => {
      const next = new Set([...prev].filter((id) => liveSessionIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setDisconnectedSessionIds((prev) => {
      const next = new Set([...prev].filter((id) => liveSessionIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [tabs]);

  return useMemo(() => {
    const unreadTabIds = new Set<string>();
    for (const sessionId of unreadSessionIds) {
      const tab = findTabBySessionId(tabs, sessionId);
      if (tab) unreadTabIds.add(tab.id);
    }
    const disconnectedTabIds = new Set<string>();
    for (const sessionId of disconnectedSessionIds) {
      const tab = findTabBySessionId(tabs, sessionId);
      if (tab) disconnectedTabIds.add(tab.id);
    }
    for (const tab of tabs) {
      if (collectSessionPanes(tab.root).some((pane) => !!pane.connectError)) {
        disconnectedTabIds.add(tab.id);
      }
    }
    return { unreadTabIds, disconnectedTabIds };
  }, [disconnectedSessionIds, unreadSessionIds, tabs]);
}

export function useUnreadTabs(tabs: Tab[], activeTabId: string | null) {
  return useTabStatusIndicators(tabs, activeTabId).unreadTabIds;
}
