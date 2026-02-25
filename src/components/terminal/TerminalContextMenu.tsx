import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Terminal } from "@xterm/xterm";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MdClearAll,
  MdContentCopy,
  MdContentPaste,
  MdContentPasteGo,
  MdCopyAll,
  MdDeleteSweep,
  MdSearch,
  MdSelectAll,
  MdTravelExplore,
} from "react-icons/md";
import { useApp } from "@/context/AppContext";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";

interface TerminalContextMenuProps {
  children: React.ReactNode;
  sessionId: string;
  terminalRef: React.MutableRefObject<Terminal | null>;
  onFind: (selection?: string) => void;
  readCommandFromBuffer: () => string;
}

export default function TerminalContextMenu({
  children,
  sessionId,
  terminalRef,
  onFind,
  readCommandFromBuffer,
}: TerminalContextMenuProps) {
  const { t } = useTranslation();
  const { appSettings } = useApp();

  const [ctxSelection, setCtxSelection] = useState({ text: "", hasSelection: false });

  // Right-click context menu: capture selection state
  const handleContextMenu = (e: React.MouseEvent) => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const selection = terminal.getSelection();
    const hasSelection = selection.length > 0;

    // When right_click_paste is on and nothing is selected, paste directly
    // and prevent the Radix ContextMenu from opening.
    if (appSettings?.interaction?.right_click_paste && !hasSelection) {
      e.preventDefault();
      e.stopPropagation();
      (async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text) {
            invoke("write_to_session", { sessionId, data: text }).catch(() => {});
          }
        } catch {
          /* clipboard access denied */
        }
        terminal.focus();
      })();
      return;
    }

    setCtxSelection({ text: selection, hasSelection });
  };

  const doPaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        invoke("write_to_session", { sessionId, data: text }).catch(() => {});
      }
    } catch {
      /* clipboard access denied */
    }
    terminalRef.current?.focus();
  }, [sessionId, terminalRef]);

  const doCopy = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text);
      terminalRef.current?.focus();
    },
    [terminalRef],
  );

  const doCopyCommand = useCallback(() => {
    const cmd = readCommandFromBuffer();
    navigator.clipboard.writeText(cmd || ctxSelection.text);
    terminalRef.current?.focus();
  }, [readCommandFromBuffer, ctxSelection.text, terminalRef]);

  const doSearchOnline = useCallback(
    (text: string) => {
      const searchSettings = appSettings?.search;
      let url = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
      if (searchSettings) {
        const engine =
          searchSettings.custom_engines.find((e) => e.name === searchSettings.default_engine) ||
          searchSettings.custom_engines[0];
        if (engine?.url_template) {
          url = engine.url_template.replace("%s", encodeURIComponent(text));
        }
      }
      openUrl(url);
      terminalRef.current?.focus();
    },
    [appSettings?.search, terminalRef],
  );

  const doPasteSelected = useCallback(() => {
    if (ctxSelection.text) {
      invoke("write_to_session", { sessionId, data: ctxSelection.text }).catch(() => {});
    }
    terminalRef.current?.focus();
  }, [sessionId, ctxSelection.text, terminalRef]);

  const doClearScreen = useCallback(() => {
    terminalRef.current?.clear();
    terminalRef.current?.focus();
  }, [terminalRef]);

  const doClearAll = useCallback(() => {
    terminalRef.current?.reset();
    terminalRef.current?.focus();
  }, [terminalRef]);

  const doSelectAll = useCallback(() => {
    terminalRef.current?.selectAll();
    terminalRef.current?.focus();
  }, [terminalRef]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="h-full w-full" onContextMenu={handleContextMenu}>
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[200px]">
        {ctxSelection.hasSelection ? (
          <>
            <ContextMenuItem onClick={() => doCopy(ctxSelection.text)}>
              <MdContentCopy className="text-[14px] text-muted-foreground mr-2" />
              {t("terminalCtx.copy")}
            </ContextMenuItem>
            <ContextMenuItem onClick={doCopyCommand}>
              <MdCopyAll className="text-[14px] text-muted-foreground mr-2" />
              {t("terminalCtx.copyCommand")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onFind(ctxSelection.text)}>
              <MdSearch className="text-[14px] text-muted-foreground mr-2" />
              {t("terminalCtx.find")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => doSearchOnline(ctxSelection.text)}>
              <MdTravelExplore className="text-[14px] text-muted-foreground mr-2" />
              {t("terminalCtx.searchOnline")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={doPaste}>
              <MdContentPaste className="text-[14px] text-muted-foreground mr-2" />
              {t("terminalCtx.paste")}
            </ContextMenuItem>
            <ContextMenuItem onClick={doPasteSelected}>
              <MdContentPasteGo className="text-[14px] text-muted-foreground mr-2" />
              {t("terminalCtx.pasteSelectedText")}
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onClick={doPaste}>
              <span className="material-icons text-[14px] text-muted-foreground">
                content_paste
              </span>
              {t("terminalCtx.paste")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onFind()}>
              <MdSearch className="text-[14px] text-muted-foreground mr-2" />
              {t("terminalCtx.find")}
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={doClearScreen}>
          <MdClearAll className="text-[14px] text-muted-foreground mr-2" />
          {t("terminalCtx.clearScreen")}
        </ContextMenuItem>
        <ContextMenuItem onClick={doClearAll}>
          <MdDeleteSweep className="text-[14px] text-muted-foreground mr-2" />
          {t("terminalCtx.clearAll")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={doSelectAll}>
          <MdSelectAll className="text-[14px] text-muted-foreground mr-2" />
          {t("terminalCtx.selectAll")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
