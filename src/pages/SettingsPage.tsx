import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MdMouse,
  MdPalette,
  MdSearch,
  MdSecurity,
  MdSettings,
  MdSwapHoriz,
  MdTerminal,
  MdTranslate,
} from "react-icons/md";
import ChildWindowHeader from "@/components/layout/ChildWindowHeader";
import { AppearanceTab } from "@/components/settings/AppearanceTab";
import { GeneralTab } from "@/components/settings/GeneralTab";
import { InteractionTab } from "@/components/settings/InteractionTab";
import { SearchTab } from "@/components/settings/SearchTab";
import { SecurityTab } from "@/components/settings/SecurityTab";
import { TerminalTab } from "@/components/settings/TerminalTab";
import { TransferTab } from "@/components/settings/TransferTab";
import { TranslationTab } from "@/components/settings/TranslationTab";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";

export default function SettingsPage() {
  const { t } = useTranslation();
  const { appSettings } = useApp();

  const params = new URLSearchParams(window.location.search);
  const initialTab = params.get("tab") || "general";
  const [activeTab, setActiveTab] = useState(initialTab);

  const tabs = [
    { id: "general", label: t("settings.general"), icon: "settings", Component: GeneralTab },
    {
      id: "appearance",
      label: t("settings.appearance"),
      icon: "palette",
      Component: AppearanceTab,
    },
    { id: "transfer", label: t("settings.transfer"), icon: "swap_horiz", Component: TransferTab },
    { id: "search", label: t("settings.search"), icon: "search", Component: SearchTab },
    {
      id: "translation",
      label: t("settings.translation"),
      icon: "translate",
      Component: TranslationTab,
    },
    { id: "security", label: t("settings.security"), icon: "security", Component: SecurityTab },
    { id: "terminal", label: t("settings.terminal"), icon: "terminal", Component: TerminalTab },
    {
      id: "interaction",
      label: t("settings.interaction"),
      icon: "mouse",
      Component: InteractionTab,
    },
  ];

  const ActiveComponent = tabs.find((t) => t.id === activeTab)?.Component;

  const iconMap: Record<string, React.ElementType> = {
    settings: MdSettings,
    palette: MdPalette,
    swap_horiz: MdSwapHoriz,
    search: MdSearch,
    translate: MdTranslate,
    security: MdSecurity,
    terminal: MdTerminal,
    mouse: MdMouse,
  };

  function DynamicIcon({ name, className }: { name: string; className?: string }) {
    const Icon = iconMap[name];
    if (!Icon) return null;
    return <Icon className={className} />;
  }

  const handleClose = () => getCurrentWindow().close();

  return (
    <div
      className="h-full min-h-0 flex flex-col overflow-hidden"
      style={{ fontFamily: appSettings.appearance.font_family }}
    >
      <ChildWindowHeader
        title={t("settings.title")}
        icon={<MdSettings className="text-base" />}
        onClose={handleClose}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
        {/* Sidebar */}
        <div className="flex w-14 shrink-0 flex-col border-r border-border/70 bg-muted/20 sm:w-48 lg:w-56">
          <div
            className="flex items-center justify-center gap-3 border-b border-border/70 px-3 py-4 sm:justify-start sm:px-4 sm:py-5"
            data-tauri-drag-region
          >
            <MdSettings className="shrink-0 text-2xl text-primary" />
            <h1 className="hidden text-lg font-semibold sm:block lg:text-xl">
              {t("settings.title")}
            </h1>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3 sm:px-3 sm:py-4">
            <div className="flex flex-col gap-1.5">
              {tabs.map((tab) => (
                <Button
                  key={tab.id}
                  variant="ghost"
                  onClick={() => setActiveTab(tab.id)}
                  title={tab.label}
                  className={`h-auto w-full justify-center gap-3 rounded-xl border px-2 py-2.5 text-sm font-medium transition-colors sm:justify-start sm:px-3 ${
                    activeTab === tab.id
                      ? "border-primary/20 bg-primary/12 text-foreground shadow-xs hover:bg-primary/16"
                      : "border-transparent text-muted-foreground hover:border-border/70 hover:bg-background hover:text-foreground"
                  }`}
                >
                  <DynamicIcon
                    name={tab.icon}
                    className={`shrink-0 text-[1.125rem] ${
                      activeTab === tab.id ? "text-primary" : ""
                    }`}
                  />
                  <span className="hidden truncate sm:inline">{tab.label}</span>
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 min-h-0 min-w-0 flex flex-col">
          <div
            className="flex shrink-0 items-center justify-between border-b border-border/70 bg-background/90 px-4 py-4 backdrop-blur sm:px-6 sm:py-5"
            data-tauri-drag-region
          >
            <h3 className="text-lg font-semibold sm:text-2xl">
              {tabs.find((t) => t.id === activeTab)?.label}
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto bg-gradient-to-b from-background via-background to-muted/10 px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
            <div className="mx-auto w-full max-w-5xl space-y-5 text-base sm:space-y-6">
              {ActiveComponent && <ActiveComponent />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
