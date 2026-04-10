import { useTranslation } from "react-i18next";
import { SelectItem } from "@/components/ui/select";
import { useApp } from "@/context/AppContext";
import {
  SettingFieldGrid,
  SettingInput,
  SettingNumberInput,
  SettingRow,
  SettingSection,
  SettingSelect,
  SettingSwitch,
} from "./SettingFormItems";

export function ProxyTab() {
  const { t } = useTranslation();
  const { appSettings, updateAppSettings } = useApp();

  return (
    <div className="space-y-5">
      <SettingSection contentClassName="space-y-5">
        <SettingRow label={t("settings.enableProxy")} desc={t("settings.enableProxyDesc")}>
          <SettingSwitch
            checked={appSettings.proxy.enabled}
            onChange={(v) => updateAppSettings({ proxy: { ...appSettings.proxy, enabled: v } })}
          />
        </SettingRow>

        <div
          className={`space-y-5 transition-opacity ${
            !appSettings.proxy.enabled ? "pointer-events-none opacity-50" : ""
          }`}
        >
          <SettingSelect
            label={t("settings.proxyProtocol")}
            value={appSettings.proxy.protocol}
            controlClassName="max-w-sm"
            onValueChange={(v) =>
              updateAppSettings({ proxy: { ...appSettings.proxy, protocol: v } })
            }
          >
            <SelectItem value="socks5">SOCKS5</SelectItem>
            <SelectItem value="http">HTTP</SelectItem>
          </SettingSelect>

          <SettingFieldGrid>
            <SettingInput
              label={t("settings.proxyHost")}
              placeholder="127.0.0.1"
              value={appSettings.proxy.host}
              onChange={(e) =>
                updateAppSettings({ proxy: { ...appSettings.proxy, host: e.target.value } })
              }
            />
            <SettingNumberInput
              label={t("settings.proxyPort")}
              min={1}
              max={65535}
              value={appSettings.proxy.port || 0}
              controlClassName="max-w-sm"
              onChange={(v) => updateAppSettings({ proxy: { ...appSettings.proxy, port: v || 0 } })}
            />
          </SettingFieldGrid>
        </div>
      </SettingSection>
    </div>
  );
}
