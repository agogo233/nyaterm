import { useTranslation } from "react-i18next";
import { SelectItem } from "@/components/ui/select";
import { useApp } from "@/context/AppContext";
import { AVAILABLE_LANGUAGES } from "@/i18n";
import {
  SettingInput,
  SettingRow,
  SettingSection,
  SettingSelect,
  SettingSwitch,
} from "./SettingFormItems";

export function GeneralTab() {
  const { t, i18n } = useTranslation();
  const { appSettings, updateAppSettings, updateUi } = useApp();

  return (
    <div className="space-y-5">
      <SettingSection contentClassName="space-y-5">
        <SettingSelect
          label={t("settings.language")}
          desc={t("settings.languageDesc")}
          value={appSettings.ui.language || "en"}
          onValueChange={(lng) => {
            i18n.changeLanguage(lng);
            updateUi({ language: lng });
          }}
        >
          {AVAILABLE_LANGUAGES.map((lng) => (
            <SelectItem key={lng.id} value={lng.id}>
              {lng.name}
            </SelectItem>
          ))}
        </SettingSelect>

        <SettingInput
          label={t("settings.defaultLocalShell")}
          desc={t("settings.defaultLocalShellDesc")}
          value={appSettings.general.default_local_shell}
          controlClassName="max-w-2xl"
          onChange={(e) =>
            updateAppSettings({
              general: { ...appSettings.general, default_local_shell: e.target.value },
            })
          }
        />
      </SettingSection>

      <SettingSection contentClassName="space-y-4">
        <SettingRow label={t("settings.startupRestore")} desc={t("settings.startupRestoreDesc")}>
          <SettingSwitch
            checked={appSettings.general.startup_restore}
            onChange={(v) =>
              updateAppSettings({ general: { ...appSettings.general, startup_restore: v } })
            }
          />
        </SettingRow>

        <SettingRow label={t("settings.minimizeToTray")} desc={t("settings.minimizeToTrayDesc")}>
          <SettingSwitch
            checked={appSettings.general.minimize_to_tray}
            onChange={(v) =>
              updateAppSettings({ general: { ...appSettings.general, minimize_to_tray: v } })
            }
          />
        </SettingRow>

        <SettingRow label={t("settings.confirmOnClose")} desc={t("settings.confirmOnCloseDesc")}>
          <SettingSwitch
            checked={appSettings.general.confirm_on_close}
            onChange={(v) =>
              updateAppSettings({ general: { ...appSettings.general, confirm_on_close: v } })
            }
          />
        </SettingRow>
      </SettingSection>
    </div>
  );
}
