import React from "react";
import { useTranslation } from "react-i18next";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { SelectItem } from "@/components/ui/select";
import { useApp } from "@/context/AppContext";
import { MOD } from "@/hooks/useGlobalShortcuts";
import {
  SettingInput,
  SettingRow,
  SettingSection,
  SettingSelect,
  SettingSwitch,
} from "./SettingFormItems";

export function InteractionTab() {
  const { t } = useTranslation();
  const { appSettings, updateAppSettings } = useApp();

  const shortcutSections = [
    {
      title: t("settings.shortcutCategories.terminal"),
      desc: t("settings.terminalShortcutsDesc"),
      items: [
        { label: t("terminalCtx.copy"), keys: `${MOD}+Shift+C` },
        { label: t("terminalCtx.paste"), keys: `${MOD}+Shift+V` },
        { label: t("terminalCtx.pasteSelectedText"), keys: `${MOD}+Shift+X` },
        { label: t("terminalCtx.find"), keys: `${MOD}+Shift+F` },
        { label: t("terminalCtx.clearScreen"), keys: `${MOD}+Shift+K` },
        { label: t("terminalCtx.selectAll"), keys: `${MOD}+Shift+A` },
      ],
    },
    {
      title: t("settings.shortcutCategories.tab"),
      items: [
        { label: t("settings.shortcutLabels.newSession"), keys: `${MOD}+Shift+N` },
        { label: t("settings.shortcutLabels.newLocalTerminal"), keys: `${MOD}+\`` },
        { label: t("settings.shortcutLabels.closeTab"), keys: `${MOD}+Shift+W` },
        { label: t("settings.shortcutLabels.nextTab"), keys: "Ctrl+Tab" },
        { label: t("settings.shortcutLabels.prevTab"), keys: "Ctrl+Shift+Tab" },
        { label: t("settings.shortcutLabels.switchTab"), keys: `${MOD}+1-9` },
      ],
    },
    {
      title: t("settings.shortcutCategories.view"),
      items: [
        { label: t("settings.shortcutLabels.toggleLeftSidebar"), keys: `${MOD}+Shift+E` },
        { label: t("settings.shortcutLabels.toggleRightSidebar"), keys: `${MOD}+Shift+B` },
        { label: t("settings.shortcutLabels.zoomIn"), keys: `${MOD}+=` },
        { label: t("settings.shortcutLabels.zoomOut"), keys: `${MOD}+-` },
        { label: t("settings.shortcutLabels.resetZoom"), keys: `${MOD}+0` },
        { label: t("settings.shortcutLabels.toggleFullscreen"), keys: "F11" },
      ],
    },
    {
      title: t("settings.shortcutCategories.special"),
      items: [
        { label: t("settings.shortcutLabels.lockScreen"), keys: `${MOD}+Shift+L` },
        { label: t("settings.shortcutLabels.openSettings"), keys: `${MOD}+,` },
      ],
    },
  ];

  return (
    <div className="space-y-5">
      <SettingSection contentClassName="space-y-5">
        <SettingRow label={t("settings.copyOnSelect")} desc={t("settings.copyOnSelectDesc")}>
          <SettingSwitch
            checked={appSettings.interaction.copy_on_select}
            onChange={(v) =>
              updateAppSettings({ interaction: { ...appSettings.interaction, copy_on_select: v } })
            }
          />
        </SettingRow>

        <SettingRow label={t("settings.rightClickPaste")} desc={t("settings.rightClickPasteDesc")}>
          <SettingSwitch
            checked={appSettings.interaction.right_click_paste}
            onChange={(v) =>
              updateAppSettings({
                interaction: { ...appSettings.interaction, right_click_paste: v },
              })
            }
          />
        </SettingRow>

        <SettingInput
          label={t("settings.wordSeparators")}
          desc={t("settings.wordSeparatorsDesc")}
          value={appSettings.interaction.word_separators}
          controlClassName="max-w-2xl"
          onChange={(e) =>
            updateAppSettings({
              interaction: { ...appSettings.interaction, word_separators: e.target.value },
            })
          }
        />

        <SettingSelect
          label={t("settings.defaultEncoding")}
          value={appSettings.interaction.default_encoding}
          controlClassName="max-w-sm"
          onValueChange={(v) =>
            updateAppSettings({ interaction: { ...appSettings.interaction, default_encoding: v } })
          }
        >
          <SelectItem value="UTF-8">UTF-8</SelectItem>
          <SelectItem value="GBK">GBK</SelectItem>
        </SettingSelect>
      </SettingSection>

      {shortcutSections.map((section) => (
        <SettingSection
          key={section.title}
          title={section.title}
          desc={section.desc}
          contentClassName="space-y-0"
        >
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2 xl:gap-x-6">
            {section.items.map((item) => (
              <div
                key={item.label}
                className="flex flex-col gap-2 rounded-lg border border-border/60 bg-background/70 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="text-sm text-muted-foreground">{item.label}</span>
                <KbdGroup className="flex-wrap sm:justify-end">
                  {item.keys.split("+").map((key, i, arr) => (
                    <React.Fragment key={`${item.label}-${key.trim()}`}>
                      <Kbd>{key.trim()}</Kbd>
                      {i < arr.length - 1 && <span className="text-muted-foreground">+</span>}
                    </React.Fragment>
                  ))}
                </KbdGroup>
              </div>
            ))}
          </div>
        </SettingSection>
      ))}
    </div>
  );
}
