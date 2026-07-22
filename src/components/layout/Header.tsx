import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BiExport, BiImport } from "react-icons/bi";
import { GrUpgrade } from "react-icons/gr";
import {
  MdAccessTime,
  MdAdd,
  MdArticle,
  MdCellTower,
  MdComputer,
  MdContentCopy,
  MdContentPaste,
  MdDashboard,
  MdDeleteSweep,
  MdDns,
  MdDownload,
  MdFitScreen,
  MdInfo,
  MdKeyboardArrowDown,
  MdMemory,
  MdMenu,
  MdMenuBook,
  MdMerge,
  MdPalette,
  MdRestartAlt,
  MdSearch,
  MdSelectAll,
  MdSettings,
  MdSpeed,
  MdSplitscreen,
  MdSwapHoriz,
  MdSwapVert,
  MdSync,
  MdTerminal,
  MdTranslate,
  MdUpdate,
  MdUpload,
  MdViewSidebar,
  MdZoomIn,
  MdZoomOut,
} from "react-icons/md";
import {
  VscChromeClose,
  VscChromeMaximize,
  VscChromeMinimize,
  VscChromeRestore,
} from "react-icons/vsc";
import packageJson from "@/../package.json";
import QuitConfirmDialog from "@/components/dialog/app/QuitConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/context/AppContext";
import { useTheme } from "@/context/ThemeContext";
import { useConfigTransfer } from "@/hooks/useConfigTransfer";
import type { RemoteStatsState } from "@/hooks/useRemoteStats";
import { resolveDisplayKeys } from "@/hooks/useShortcutMap";
import { AVAILABLE_LANGUAGES } from "@/i18n";
import { invoke } from "@/lib/invoke";
import { logger } from "@/lib/logger";
import { isMacOS } from "@/lib/platform";
import {
  decreaseTerminalFontSizeDelta,
  increaseTerminalFontSizeDelta,
  resetTerminalFontSizeDelta,
} from "@/lib/terminalFontSize";
import { getActivePane, getTabDisplayName } from "@/lib/workspaceTabs";
import type { HeaderStatusMode, SavedConnection, Tab } from "@/types/global";
import ImportDialog from "../dialog/connections/ImportDialog";
import { resolveConnectionIcon } from "../icons";
import NyaTermLogo from "../NyaTermLogo";
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarPortal,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "../ui/menubar";

const iconMap: Record<string, React.ElementType> = {
  add: MdAdd,
  content_copy: MdContentCopy,
  content_paste: MdContentPaste,
  select_all: MdSelectAll,
  palette: MdPalette,
  translate: MdTranslate,
  zoom_in: MdZoomIn,
  zoom_out: MdZoomOut,
  restart_alt: MdRestartAlt,
  menu_book: MdMenuBook,
  update: MdUpdate,
  upgrade: GrUpgrade,
  article: MdArticle,
  info: MdInfo,
  menu: MdMenu,
  view_sidebar: MdViewSidebar,
  settings: MdSettings,
  file_export: BiExport,
  file_import: BiImport,
  splitscreen: MdSplitscreen,
  merge: MdMerge,
  dashboard: MdDashboard,
  swap_horiz: MdSwapHoriz,
  swap_vert: MdSwapVert,
  sync: MdSync,
  cell_tower: MdCellTower,
  delete_sweep: MdDeleteSweep,
  fit_screen: MdFitScreen,
  terminal: MdTerminal,
  search: MdSearch,
};

function DynamicIcon({ name, className }: { name: string; className?: string }) {
  const Icon = iconMap[name];
  if (!Icon) return null;
  return <Icon className={className} />;
}

function HeaderStatusPart({
  icon,
  children,
  color = "var(--df-text-muted)",
  iconColor = "var(--df-text-dimmed)",
  className,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  color?: string;
  iconColor?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1 whitespace-nowrap ${className ?? ""}`}
      style={{ color }}
    >
      <span
        className="inline-flex shrink-0 text-[0.875rem]"
        style={{ color: iconColor, opacity: 0.78 }}
      >
        {icon}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

function HeaderStatusDivider() {
  return (
    <span className="px-0.5 font-sans" style={{ color: "var(--df-text-dimmed)" }}>
      -
    </span>
  );
}

const HEADER_STATUS_MODES: HeaderStatusMode[] = ["session", "resources", "host"];

function normalizeHeaderStatusMode(value?: string): HeaderStatusMode {
  return HEADER_STATUS_MODES.includes(value as HeaderStatusMode)
    ? (value as HeaderStatusMode)
    : "session";
}

function formatPct(value: number): string {
  return `${Math.round(Math.min(100, Math.max(0, value)))}%`;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / 1024 ** i;
  return `${val < 10 ? val.toFixed(1) : val < 100 ? val.toFixed(1) : val.toFixed(0)} ${units[i]}`;
}

function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

function getPressureColor(usagePercent: number): string | undefined {
  if (usagePercent >= 90) return "#f87171";
  if (usagePercent >= 75) return "#f59e0b";
  return undefined;
}

function formatUptimeShort(
  seconds: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (seconds >= 86400) {
    return t("headerStatus.uptimeDays", { count: Math.floor(seconds / 86400) });
  }
  if (seconds >= 3600) {
    return t("headerStatus.uptimeHours", { count: Math.floor(seconds / 3600) });
  }
  return t("headerStatus.uptimeMinutes", { count: Math.max(1, Math.floor(seconds / 60)) });
}

interface HeaderProps {
  onNewSession: () => void;
  onToggleLeft?: () => void;
  onToggleRight?: () => void;
  onAbout: () => void;
  onCheckForUpdates: () => void;
  hasUpdate?: boolean;
  showUpdateDot?: boolean;
  onHelpMenuOpen?: () => void;
  activeTab?: Tab | null;
  savedConnections?: SavedConnection[];
  remoteStatsEnabled?: boolean;
  remoteStats?: RemoteStatsState;
  onSmartSplit?: (mode: "auto" | "horizontal" | "vertical") => void;
  onUnsplit?: () => void;
  canUnsplit?: boolean;
  onManageSyncGroups?: () => void;
  onBroadcastToAll?: () => void;
  broadcastToAll?: boolean;
  onOpenCommandPalette?: () => void;
  onClearTerminal?: () => void;
  onRefitTerminals?: () => void;
}

interface MenuItem {
  label: string;
  action?: () => void;
  separator?: boolean;
  submenu?: MenuItem[];
  checked?: boolean;
  disabled?: boolean;
  icon?: string;
  shortcut?: string;
}

/** Top bar with File/Edit/View/Terminal/Help menus, theme picker, and mobile toggles. */
export default function Header({
  onNewSession,
  onToggleLeft,
  onToggleRight,
  onAbout,
  onCheckForUpdates,
  hasUpdate,
  showUpdateDot,
  onHelpMenuOpen,
  activeTab,
  savedConnections,
  remoteStatsEnabled = true,
  remoteStats,
  onSmartSplit,
  onUnsplit,
  canUnsplit,
  onManageSyncGroups,
  onBroadcastToAll,
  broadcastToAll,
  onOpenCommandPalette,
  onClearTerminal,
  onRefitTerminals,
}: HeaderProps) {
  const [appWindow] = useState(() => getCurrentWindow());
  const { themeName, setTheme, themeNames } = useTheme();
  const { updateAppSettings, updateUi, appSettings, tabs } = useApp();
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const { t, i18n } = useTranslation();
  const { handleExport, passwordAlert } = useConfigTransfer();

  const activePane = activeTab ? getActivePane(activeTab) : null;
  const activeConnection = activePane?.connectionId
    ? savedConnections?.find((c) => c.id === activePane.connectionId)
    : undefined;
  const activeDisplayName = activeTab ? getTabDisplayName(activeTab) : "NyaTerm";
  const terminalZoomEnabled = appSettings.interaction.terminal_zoom_enabled;
  const headerStatusMode = normalizeHeaderStatusMode(appSettings.ui.header_status_mode);

  useEffect(() => {
    let mounted = true;

    const syncMaximizedState = async () => {
      const maximized = await appWindow.isMaximized().catch(() => false);
      if (mounted) {
        setIsMaximized(maximized);
      }
    };

    void syncMaximizedState();

    let unlistenResized: (() => void) | undefined;
    appWindow
      .onResized(() => {
        void syncMaximizedState();
      })
      .then((unlisten) => {
        unlistenResized = unlisten;
      })
      .catch(() => {});

    return () => {
      mounted = false;
      unlistenResized?.();
    };
  }, [appWindow]);

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
    updateUi({ language: lng });
    void invoke("save_app_language", { language: lng }).catch(() => {});
  };

  const handleZoom = (delta: number) => {
    if (!terminalZoomEnabled) return;
    updateAppSettings((prev) => ({
      terminal: {
        ...prev.terminal,
        font_size_delta:
          delta > 0
            ? increaseTerminalFontSizeDelta(
                prev.appearance.font_size,
                prev.terminal.font_size_delta,
              )
            : decreaseTerminalFontSizeDelta(
                prev.appearance.font_size,
                prev.terminal.font_size_delta,
              ),
      },
    }));
  };

  const handleResetZoom = () => {
    if (!terminalZoomEnabled) return;
    updateAppSettings((prev) => ({
      terminal: { ...prev.terminal, font_size_delta: resetTerminalFontSizeDelta() },
    }));
  };

  const menuKeys = [
    { key: "file", label: t("menu.file") },
    { key: "view", label: t("menu.view") },
    { key: "terminal", label: t("menu.terminal") },
    { key: "help", label: t("menu.help") },
  ];

  const dk = (id: string) => resolveDisplayKeys(id, appSettings.keybindings);

  const menus: Record<string, MenuItem[]> = {
    file: [
      {
        label: t("menu.newSession"),
        action: onNewSession,
        icon: "add",
        shortcut: dk("tab.newSession"),
      },
      { label: "separator", separator: true },
      {
        label: t("settings.importConfig"),
        action: () => setShowImportDialog(true),
        icon: "file_import",
      },
      {
        label: t("settings.exportConfig"),
        action: handleExport,
        icon: "file_export",
      },
    ],
    view: [
      {
        label: t("menu.theme"),
        icon: "palette",
        submenu: themeNames.map((th) => ({
          label: th.name,
          checked: themeName === th.id,
          action: () => setTheme(th.id),
        })),
      },
      {
        label: t("menu.language"),
        icon: "translate",
        submenu: AVAILABLE_LANGUAGES.map((l) => ({
          label: l.name,
          checked: i18n.language === l.id,
          action: () => changeLanguage(l.id),
        })),
      },
      { label: "separator", separator: true },
      {
        label: t("menu.zoomIn"),
        action: () => handleZoom(0.1),
        icon: "zoom_in",
        shortcut: dk("view.zoomIn"),
        disabled: !terminalZoomEnabled,
      },
      {
        label: t("menu.zoomOut"),
        action: () => handleZoom(-0.1),
        icon: "zoom_out",
        shortcut: dk("view.zoomOut"),
        disabled: !terminalZoomEnabled,
      },
      {
        label: t("menu.resetZoom"),
        action: handleResetZoom,
        icon: "restart_alt",
        shortcut: dk("view.resetZoom"),
        disabled: !terminalZoomEnabled,
      },
    ],
    terminal: [
      {
        label: t("menu.commandPalette"),
        icon: "search",
        action: () => onOpenCommandPalette?.(),
        shortcut: dk("tab.quickSwitch"),
      },
      { label: "separator", separator: true },
      {
        label: t("menu.smartSplit"),
        icon: "splitscreen",
        submenu: [
          {
            label: t("menu.autoTile"),
            icon: "dashboard",
            action: () => onSmartSplit?.("auto"),
          },
          {
            label: t("menu.tileHorizontally"),
            icon: "swap_horiz",
            action: () => onSmartSplit?.("horizontal"),
          },
          {
            label: t("menu.tileVertically"),
            icon: "swap_vert",
            action: () => onSmartSplit?.("vertical"),
          },
        ],
      },
      {
        label: t("menu.unsplit"),
        icon: "merge",
        action: () => onUnsplit?.(),
        disabled: !canUnsplit,
      },
      { label: "separator", separator: true },
      {
        label: t("menu.syncInput"),
        icon: "sync",
        submenu: [
          {
            label: t("menu.manageGroups"),
            icon: "settings",
            action: () => onManageSyncGroups?.(),
            shortcut: dk("terminal.manageSyncGroups"),
          },
        ],
      },
      { label: "separator", separator: true },
      {
        label: t("menu.broadcastToAll"),
        icon: "cell_tower",
        action: () => onBroadcastToAll?.(),
        checked: broadcastToAll,
      },
      { label: "separator", separator: true },
      {
        label: t("menu.clearTerminal"),
        icon: "delete_sweep",
        action: () => onClearTerminal?.(),
        shortcut: dk("terminal.clear"),
      },
      {
        label: t("menu.refitTerminals"),
        icon: "fit_screen",
        action: () => onRefitTerminals?.(),
      },
    ],
    help: [
      {
        label: t("menu.documentation"),
        icon: "menu_book",
        action: () => openUrl(`${packageJson.docspage}`),
      },
      {
        label: t("menu.checkForUpdates"),
        icon: hasUpdate ? "upgrade" : "update",
        action: onCheckForUpdates,
      },
      {
        label: t("menu.viewLogs"),
        icon: "article",
        action: async () => {
          try {
            await invoke("open_log_dir");
          } catch (error) {
            logger.error({
              domain: "ui.error",
              event: "logs.open_failed",
              message: "Failed to open logs",
              error,
            });
          }
        },
      },
      { label: "separator", separator: true },
      { label: t("menu.about"), action: onAbout, icon: "info" },
    ],
  };

  const renderMenuItem = (item: MenuItem, idx: number) => {
    if (item.separator) {
      return <MenubarSeparator key={`sep-${idx}`} />;
    }

    if (item.submenu) {
      return (
        <MenubarSub key={item.label}>
          <MenubarSubTrigger disabled={item.disabled} className="gap-2">
            {item.icon && (
              <DynamicIcon name={item.icon} className="text-[1rem] text-[var(--df-text-muted)]" />
            )}
            <span className="flex-1">{item.label}</span>
          </MenubarSubTrigger>
          <MenubarPortal>
            <MenubarSubContent>
              {item.submenu.map((sub, i) => renderMenuItem(sub, i))}
            </MenubarSubContent>
          </MenubarPortal>
        </MenubarSub>
      );
    }

    if (item.checked !== undefined) {
      return (
        <MenubarCheckboxItem
          key={item.label}
          checked={item.checked}
          disabled={item.disabled}
          onCheckedChange={() => {
            item.action?.();
          }}
        >
          <span className="flex-1">{item.label}</span>
          {item.shortcut && <MenubarShortcut>{item.shortcut}</MenubarShortcut>}
        </MenubarCheckboxItem>
      );
    }

    return (
      <MenubarItem
        key={item.label}
        disabled={item.disabled}
        onClick={() => {
          item.action?.();
        }}
      >
        {item.icon && (
          <DynamicIcon
            name={item.icon}
            className={`text-[1rem] ${item.icon === "upgrade" ? "text-green-500" : "text-[var(--df-text-muted)]"}`}
          />
        )}
        <span className="flex-1">{item.label}</span>
        {item.icon === "upgrade" && (
          <span className="ml-2 text-[10px] font-medium text-green-500">
            {t("updater.hasNewVersion")}
          </span>
        )}
        {item.shortcut && <MenubarShortcut>{item.shortcut}</MenubarShortcut>}
      </MenubarItem>
    );
  };

  const handleMinimizeWindow = () => {
    appWindow.minimize().catch(() => {});
  };

  const handleToggleMaximizeWindow = () => {
    appWindow.toggleMaximize().catch(() => {});
  };

  const handleCloseWindow = () => {
    if (
      !appSettings.general.minimize_to_tray &&
      tabs.length > 0 &&
      appSettings.general.confirm_on_close !== false
    ) {
      setShowCloseConfirm(true);
    } else {
      appWindow.close().catch(() => {});
    }
  };

  const handleConfirmClose = () => {
    setShowCloseConfirm(false);
    appWindow.close().catch(() => {});
  };

  const hasActiveStatsSession = Boolean(
    activePane && activePane.type === "SSH" && !activePane.connecting && !activePane.connectError,
  );

  const sessionStatus = useMemo(() => {
    if (!activeTab || !activePane) {
      return {
        icon: null,
        text: "NyaTerm",
        title: "NyaTerm",
      };
    }

    const getSessionIcon = () => {
      if (activePane.type === "SSH" && activeConnection) {
        const def = resolveConnectionIcon(activeConnection.icon);
        const IconComp = def.icon;
        return <IconComp className="text-sm shrink-0" style={{ color: def.color }} />;
      }

      if (activeConnection?.icon) {
        const def = resolveConnectionIcon(activeConnection.icon);
        const IconComp = def.icon;
        return <IconComp className="text-sm shrink-0" style={{ color: def.color }} />;
      }

      if (activePane.type === "Telnet") {
        return <MdDns className="text-sm shrink-0" />;
      }

      if (activePane.type === "Serial") {
        return <MdCellTower className="text-sm shrink-0" />;
      }

      return <MdTerminal className="text-sm shrink-0" />;
    };

    if (activePane.type === "SSH" && activeConnection && !activeTab.customName) {
      const icon = getSessionIcon();
      const text = `${activeConnection.name} - ${activeConnection.username}@${activeConnection.host}:${activeConnection.port}`;
      return {
        icon,
        text,
        title: text,
      };
    }

    if (activePane.type === "SSH") {
      return {
        icon: getSessionIcon(),
        text: activeDisplayName,
        title: activeDisplayName,
      };
    }

    return {
      icon: getSessionIcon(),
      text: activeDisplayName,
      title: activeDisplayName,
    };
  }, [activeConnection, activeDisplayName, activePane, activeTab]);

  const remoteStatusFallback = useMemo(() => {
    if (!hasActiveStatsSession) return t("panel.resourceMonitorNoSession");
    if (!remoteStatsEnabled) return t("panel.resourceMonitorDisabled");
    if (remoteStats?.stats) return null;
    if (remoteStats?.error) return t("panel.resourceMonitorError");
    return t("common.loading");
  }, [hasActiveStatsSession, remoteStats?.error, remoteStats?.stats, remoteStatsEnabled, t]);

  const headerStatus = useMemo(() => {
    if (headerStatusMode === "session") {
      return {
        icon: sessionStatus.icon,
        text: sessionStatus.text,
        title: sessionStatus.title,
      };
    }

    const stats = remoteStats?.stats;
    if (remoteStatusFallback || !stats) {
      return {
        icon: null,
        text: remoteStatusFallback ?? t("common.loading"),
        title: remoteStatusFallback ?? t("common.loading"),
      };
    }

    if (headerStatusMode === "host") {
      const uptime = formatUptimeShort(stats.system.uptime_sec, t);
      const text = `${stats.system.hostname} - ${stats.system.os}/${stats.system.arch} - ${uptime}`;
      return {
        icon: null,
        text: (
          <span className="flex min-w-0 items-center gap-1.5">
            <HeaderStatusPart icon={<MdDns />} iconColor="#38bdf8">
              {stats.system.hostname}
            </HeaderStatusPart>
            <HeaderStatusDivider />
            <HeaderStatusPart icon={<MdComputer />} iconColor="#a78bfa">
              {stats.system.os}/{stats.system.arch}
            </HeaderStatusPart>
            <HeaderStatusDivider />
            <HeaderStatusPart icon={<MdAccessTime />} iconColor="#34d399">
              {uptime}
            </HeaderStatusPart>
          </span>
        ),
        title: text,
      };
    }

    const memTotal = stats.memory.used + stats.memory.available;
    const memoryUsedText = formatBytes(stats.memory.used);
    const memoryTotalText = formatBytes(memTotal);
    const memoryText = `${memoryUsedText}/${memoryTotalText}`;
    const cpuColor = getPressureColor(stats.cpu.usage);
    const memoryUsagePercent = memTotal > 0 ? (stats.memory.used / memTotal) * 100 : 0;
    const memoryColor = getPressureColor(memoryUsagePercent);
    const txText = formatRate(stats.network_summary.tx_bytes_per_sec);
    const rxText = formatRate(stats.network_summary.rx_bytes_per_sec);
    const text = `CPU ${formatPct(stats.cpu.usage)} - RAM ${memoryText} - NET ↑ ${txText} ↓ ${rxText}`;
    return {
      icon: null,
      text: (
        <span className="flex min-w-0 items-center gap-1.5 font-mono tabular-nums">
          <HeaderStatusPart icon={<MdSpeed />} iconColor="#38bdf8">
            CPU{" "}
            <span style={cpuColor ? { color: cpuColor } : undefined}>
              {formatPct(stats.cpu.usage)}
            </span>
          </HeaderStatusPart>
          <HeaderStatusDivider />
          <HeaderStatusPart icon={<MdMemory />} iconColor="#a78bfa">
            RAM{" "}
            <span style={memoryColor ? { color: memoryColor } : undefined}>{memoryUsedText}</span>
            /{memoryTotalText}
          </HeaderStatusPart>
          <HeaderStatusDivider />
          <HeaderStatusPart icon={<MdUpload />} iconColor="#f59e0b">
            {txText}
          </HeaderStatusPart>
          <HeaderStatusPart icon={<MdDownload />} iconColor="#34d399">
            {rxText}
          </HeaderStatusPart>
        </span>
      ),
      title: text,
    };
  }, [headerStatusMode, remoteStats?.stats, remoteStatusFallback, sessionStatus, t]);

  return (
    <header
      className="h-10 border-b flex items-center gap-2 px-2 select-none shrink-0"
      style={{ backgroundColor: "var(--df-bg-panel)", borderColor: "var(--df-border)" }}
    >
      <div className={`flex items-center gap-2 shrink-0${isMacOS ? " pl-[70px]" : ""}`}>
        {!isMacOS && (
          <NyaTermLogo className="h-5 w-5 shrink-0" onDoubleClick={handleToggleMaximizeWindow} />
        )}

        {!isMacOS && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="lg:hidden text-[var(--df-text-muted)] hover:bg-[color-mix(in_srgb,var(--df-text-muted)_10%,transparent)] hover:text-[var(--df-text-muted)]"
            onClick={onToggleLeft}
          >
            <MdMenu className="text-base" />
          </Button>
        )}

        <Menubar className="border-none bg-transparent h-auto p-0 gap-1 shadow-none">
          {menuKeys.map(({ key, label }) => (
            <MenubarMenu key={key}>
              <MenubarTrigger
                className="relative cursor-default px-2.5 py-1 text-xs font-medium rounded-md transition-colors text-[var(--df-text-muted)] data-[state=open]:text-[var(--df-primary)] data-[state=open]:bg-[color-mix(in_srgb,var(--df-primary)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--df-text-muted)_10%,transparent)] focus:bg-[color-mix(in_srgb,var(--df-text-muted)_10%,transparent)] focus:text-[var(--df-text-muted)] data-[state=open]:focus:bg-[color-mix(in_srgb,var(--df-primary)_10%,transparent)] data-[state=open]:focus:text-[var(--df-primary)] outline-none"
                {...(key === "help" && showUpdateDot ? { onClick: onHelpMenuOpen } : {})}
              >
                {label}
                {key === "help" && showUpdateDot && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                  </span>
                )}
              </MenubarTrigger>
              <MenubarContent align="start" className="min-w-[180px]">
                {menus[key].map((item, idx) => renderMenuItem(item, idx))}
              </MenubarContent>
            </MenubarMenu>
          ))}
        </Menubar>
      </div>

      <div className="flex-1 min-w-0 h-full flex items-center justify-center gap-2 px-2">
        <div className="h-full min-w-0 flex-1" data-tauri-drag-region />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="group flex max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-[color-mix(in_srgb,var(--df-text-muted)_10%,transparent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--df-primary)]"
              style={{ color: "var(--df-text-muted)" }}
              title={headerStatus.title}
              aria-label={t("headerStatus.select")}
            >
              {headerStatus.icon}
              <span className="flex min-w-0 items-center overflow-hidden whitespace-nowrap">
                {headerStatus.text}
              </span>
              <MdKeyboardArrowDown className="text-sm shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="min-w-[190px]">
            <DropdownMenuRadioGroup
              value={headerStatusMode}
              onValueChange={(value) => {
                updateUi({ header_status_mode: normalizeHeaderStatusMode(value) });
              }}
            >
              {HEADER_STATUS_MODES.map((mode) => (
                <DropdownMenuRadioItem key={mode} value={mode}>
                  {t(`headerStatus.${mode}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="h-full min-w-0 flex-1" data-tauri-drag-region />
      </div>

      <div className="flex items-center gap-1 shrink-0" style={{ color: "var(--df-text-muted)" }}>
        {!isMacOS && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="md:hidden text-[var(--df-text-muted)] hover:bg-[color-mix(in_srgb,var(--df-text-muted)_10%,transparent)] hover:text-[var(--df-text-muted)]"
            onClick={onToggleRight}
          >
            <MdViewSidebar className="text-base" />
          </Button>
        )}

        {!isMacOS && (
          <div className="flex items-center h-full -mr-2 ml-1">
            <Button
              type="button"
              variant="ghost"
              className="rounded-none h-10 w-[46px] px-0 text-[var(--df-text-muted)] transition-colors hover:!bg-[color-mix(in_srgb,var(--df-text)_10%,transparent)] hover:!text-[var(--df-text)]"
              aria-label={t("menu.minimize")}
              onClick={handleMinimizeWindow}
            >
              <VscChromeMinimize className="text-base" />
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="rounded-none h-10 w-[46px] px-0 text-[var(--df-text-muted)] transition-colors hover:!bg-[color-mix(in_srgb,var(--df-text)_10%,transparent)] hover:!text-[var(--df-text)]"
              aria-label={isMaximized ? t("menu.restore") : t("menu.maximize")}
              onClick={handleToggleMaximizeWindow}
            >
              {isMaximized ? (
                <VscChromeRestore className="text-base" />
              ) : (
                <VscChromeMaximize className="text-base" />
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="rounded-none h-10 w-[46px] px-0 text-[var(--df-text-muted)] transition-colors hover:!bg-[#e81123] hover:!text-white"
              aria-label={t("common.close")}
              onClick={handleCloseWindow}
            >
              <VscChromeClose className="text-base" />
            </Button>
          </div>
        )}
      </div>
      <ImportDialog open={showImportDialog} onClose={() => setShowImportDialog(false)} />
      {passwordAlert}

      <QuitConfirmDialog
        open={showCloseConfirm}
        onOpenChange={setShowCloseConfirm}
        onConfirm={handleConfirmClose}
      />
    </header>
  );
}
