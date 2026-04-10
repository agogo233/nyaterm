import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MdAdd, MdClose } from "react-icons/md";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApp } from "@/context/AppContext";
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
} from "@/lib/terminalFontSize";
import { themeList } from "@/lib/themes";
import {
  SettingFieldGrid,
  SettingNumberInput,
  SettingRow,
  SettingSection,
  SettingSelect,
  SettingSwitch,
} from "./SettingFormItems";

export function AppearanceTab() {
  const { t } = useTranslation();
  const { appSettings, updateAppSettings } = useApp();
  const [systemFonts, setSystemFonts] = useState<string[]>([]);

  const PACKAGE_FONTS = ["JetBrains Mono", "Noto Sans SC Variable", "Inter"];
  const applicationFonts = Array.from(new Set([...PACKAGE_FONTS, ...systemFonts]));

  useEffect(() => {
    invoke<string[]>("get_system_fonts")
      .then((fonts) => setSystemFonts(fonts))
      .catch(console.error);
  }, []);

  return (
    <div className="space-y-5">
      <SettingSection contentClassName="space-y-5">
        <SettingSelect
          label={t("settings.theme")}
          desc={t("settings.themeDesc")}
          value={appSettings.appearance.theme || "github-dark"}
          onValueChange={(v) =>
            updateAppSettings({ appearance: { ...appSettings.appearance, theme: v } })
          }
        >
          {themeList.map((tm) => (
            <SelectItem key={tm.id} value={tm.id}>
              {tm.name}
            </SelectItem>
          ))}
        </SettingSelect>

        <SettingSelect
          label={t("settings.terminalTheme")}
          desc={t("settings.terminalThemeDesc")}
          value={appSettings.appearance.terminal_theme || "__follow__"}
          onValueChange={(v) =>
            updateAppSettings({
              appearance: {
                ...appSettings.appearance,
                terminal_theme: v === "__follow__" ? null : v,
              },
            })
          }
        >
          <SelectItem value="__follow__">{t("settings.followUiTheme")}</SelectItem>
          {themeList.map((tm) => (
            <SelectItem key={tm.id} value={tm.id}>
              {tm.name}
            </SelectItem>
          ))}
        </SettingSelect>
      </SettingSection>

      <SettingSection
        title={t("settings.fontFamily")}
        desc={t("settings.fontFamilyDesc")}
        action={
          <Button
            variant="ghost"
            size="xs"
            className="text-primary"
            onClick={() => {
              const newFonts = [
                ...appSettings.appearance.font_family.split(",").map((f) => f.trim()),
                applicationFonts[0] || "Arial",
              ];
              updateAppSettings({
                appearance: { ...appSettings.appearance, font_family: newFonts.join(", ") },
              });
            }}
          >
            <MdAdd className="text-[0.875rem]" />
            {t("settings.addFallbackFont")}
          </Button>
        }
        contentClassName="space-y-3"
      >
        {appSettings.appearance.font_family
          .split(",")
          .map((f) => f.trim())
          .map((font, idx, arr) => (
            <div
              key={`${font}-${idx === 0 ? "primary" : `fallback-${idx}`}`}
              className="rounded-lg border border-border/70 bg-background/70 p-3"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 sm:w-32 sm:shrink-0">
                  <p className="text-xs font-medium text-muted-foreground">
                    {idx === 0 ? t("settings.fontPrimary") : `${t("settings.fontFallback")} ${idx}`}
                  </p>
                </div>
                <Select
                  value={applicationFonts.includes(font) ? font : ""}
                  onValueChange={(v) => {
                    const newFonts = [...arr];
                    newFonts[idx] = v;
                    updateAppSettings({
                      appearance: {
                        ...appSettings.appearance,
                        font_family: newFonts.filter(Boolean).join(", "),
                      },
                    });
                  }}
                >
                  <SelectTrigger className="h-9 w-full flex-1 px-3 text-sm shadow-xs focus:ring-1 focus:ring-ring focus:outline-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {!applicationFonts.includes(font) && (
                      <SelectItem value={font}>{font} (Custom/Missing)</SelectItem>
                    )}
                    {applicationFonts.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f} {PACKAGE_FONTS.includes(f) && `(${t("settings.fontBuiltIn")})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="self-end text-destructive hover:bg-destructive/10 sm:self-auto"
                  title={t("common.remove")}
                  onClick={() => {
                    const newFonts = arr.filter((_, i) => i !== idx);
                    if (newFonts.length === 0) newFonts.push("Consolas");
                    updateAppSettings({
                      appearance: { ...appSettings.appearance, font_family: newFonts.join(", ") },
                    });
                  }}
                >
                  <MdClose className="text-[1rem]" />
                </Button>
              </div>
            </div>
          ))}
      </SettingSection>

      <SettingSection contentClassName="space-y-5">
        <SettingFieldGrid>
          <SettingNumberInput
            label={t("settings.fontSize")}
            min={MIN_TERMINAL_FONT_SIZE}
            max={MAX_TERMINAL_FONT_SIZE}
            value={appSettings.appearance.font_size}
            controlClassName="max-w-sm"
            onChange={(v) =>
              updateAppSettings({
                appearance: {
                  ...appSettings.appearance,
                  font_size: v || DEFAULT_TERMINAL_FONT_SIZE,
                },
              })
            }
          />
          <SettingNumberInput
            label={t("settings.uiFontSize")}
            min={12}
            max={24}
            value={appSettings.appearance.ui_font_size}
            controlClassName="max-w-sm"
            onChange={(v) =>
              updateAppSettings({
                appearance: { ...appSettings.appearance, ui_font_size: v || 16 },
              })
            }
          />
          <SettingSelect
            label={t("settings.cursorStyle")}
            value={appSettings.appearance.cursor_style}
            controlClassName="max-w-sm"
            onValueChange={(v) =>
              updateAppSettings({ appearance: { ...appSettings.appearance, cursor_style: v } })
            }
          >
            <SelectItem value="block">{t("settings.cursorBlock")}</SelectItem>
            <SelectItem value="underline">{t("settings.cursorUnderline")}</SelectItem>
            <SelectItem value="bar">{t("settings.cursorBar")}</SelectItem>
          </SettingSelect>
        </SettingFieldGrid>

        <SettingRow label={t("settings.cursorBlink")}>
          <SettingSwitch
            checked={appSettings.appearance.cursor_blink}
            onChange={(v) =>
              updateAppSettings({ appearance: { ...appSettings.appearance, cursor_blink: v } })
            }
          />
        </SettingRow>

        <SettingRow label={t("settings.fontLigatures")} desc={t("settings.fontLigaturesDesc")}>
          <SettingSwitch
            checked={appSettings.appearance.ligatures}
            onChange={(v) =>
              updateAppSettings({ appearance: { ...appSettings.appearance, ligatures: v } })
            }
          />
        </SettingRow>
      </SettingSection>
    </div>
  );
}
