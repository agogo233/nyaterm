import { useTranslation } from "react-i18next";
import { MdCheck, MdClose } from "react-icons/md";
import { SelectItem } from "@/components/ui/select";
import { useApp } from "@/context/AppContext";
import { cn } from "@/lib/utils";
import { SettingFieldGrid, SettingInput, SettingSection, SettingSelect } from "./SettingFormItems";

const TARGET_LANGUAGES = [
  { value: "zh-CN", label: "中文 (简体)" },
  { value: "zh-TW", label: "中文 (繁體)" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
  { value: "ru", label: "Русский" },
  { value: "it", label: "Italiano" },
  { value: "ar", label: "العربية" },
  { value: "th", label: "ไทย" },
  { value: "vi", label: "Tiếng Việt" },
];

function ProviderStatus({ configured, free }: { configured: boolean; free?: boolean }) {
  const { t } = useTranslation();

  const sharedClassName =
    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium";

  if (free) {
    return (
      <span className={cn(sharedClassName, "border-primary/20 bg-primary/10 text-primary")}>
        <MdCheck className="text-sm" />
        {t("settings.noKeyRequired")}
      </span>
    );
  }

  return configured ? (
    <span
      className={cn(sharedClassName, "border-emerald-500/20 bg-emerald-500/10 text-emerald-600")}
    >
      <MdCheck className="text-sm" />
      {t("settings.configured")}
    </span>
  ) : (
    <span className={cn(sharedClassName, "border-border/70 bg-muted/40 text-muted-foreground")}>
      <MdClose className="text-sm" />
      {t("settings.notConfigured")}
    </span>
  );
}

function ProviderCard({
  title,
  status,
  children,
}: {
  title: string;
  status: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/75 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm font-medium">{title}</span>
        {status}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function TranslationTab() {
  const { t } = useTranslation();
  const { appSettings, updateAppSettings } = useApp();
  const ts = appSettings.translation;

  const update = (patch: Partial<typeof ts>) =>
    updateAppSettings({ translation: { ...ts, ...patch } });

  return (
    <div className="space-y-5">
      <SettingSection>
        <SettingSelect
          label={t("settings.targetLanguage")}
          desc={t("settings.targetLanguageDesc")}
          value={ts.target_language || "zh-CN"}
          controlClassName="max-w-sm"
          onValueChange={(v) => update({ target_language: v })}
        >
          {TARGET_LANGUAGES.map((lang) => (
            <SelectItem key={lang.value} value={lang.value}>
              {lang.label}
            </SelectItem>
          ))}
        </SettingSelect>
      </SettingSection>

      <SettingSection
        title={t("settings.translationProviders")}
        desc={t("settings.translationProvidersDesc")}
        contentClassName="space-y-4"
      >
        <ProviderCard title={t("translation.google")} status={<ProviderStatus configured free />} />

        <ProviderCard
          title={t("translation.microsoft")}
          status={<ProviderStatus configured free />}
        />

        <ProviderCard
          title={t("translation.deepl")}
          status={<ProviderStatus configured={!!ts.deepl_api_key} />}
        >
          <SettingInput
            label={t("settings.apiKey")}
            type="password"
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx"
            controlClassName="max-w-lg"
            value={ts.deepl_api_key}
            onChange={(e) => update({ deepl_api_key: e.target.value })}
          />
        </ProviderCard>

        <ProviderCard
          title={t("translation.baidu")}
          status={<ProviderStatus configured={!!(ts.baidu_app_id && ts.baidu_app_key)} />}
        >
          <SettingFieldGrid>
            <SettingInput
              label={t("settings.appId")}
              placeholder="App ID"
              value={ts.baidu_app_id}
              onChange={(e) => update({ baidu_app_id: e.target.value })}
            />
            <SettingInput
              label={t("settings.appKey")}
              type="password"
              placeholder="App Key"
              value={ts.baidu_app_key}
              onChange={(e) => update({ baidu_app_key: e.target.value })}
            />
          </SettingFieldGrid>
        </ProviderCard>

        <ProviderCard
          title={t("translation.ali")}
          status={<ProviderStatus configured={!!(ts.ali_app_id && ts.ali_app_key)} />}
        >
          <SettingFieldGrid>
            <SettingInput
              label={t("settings.appId")}
              placeholder="Access Key ID"
              value={ts.ali_app_id}
              onChange={(e) => update({ ali_app_id: e.target.value })}
            />
            <SettingInput
              label={t("settings.appKey")}
              type="password"
              placeholder="Access Key Secret"
              value={ts.ali_app_key}
              onChange={(e) => update({ ali_app_key: e.target.value })}
            />
          </SettingFieldGrid>
        </ProviderCard>

        <ProviderCard
          title={t("translation.youdao")}
          status={<ProviderStatus configured={!!(ts.youdao_app_id && ts.youdao_app_key)} />}
        >
          <SettingFieldGrid>
            <SettingInput
              label={t("settings.appId")}
              placeholder="App ID"
              value={ts.youdao_app_id}
              onChange={(e) => update({ youdao_app_id: e.target.value })}
            />
            <SettingInput
              label={t("settings.appKey")}
              type="password"
              placeholder="App Key"
              value={ts.youdao_app_key}
              onChange={(e) => update({ youdao_app_key: e.target.value })}
            />
          </SettingFieldGrid>
        </ProviderCard>
      </SettingSection>
    </div>
  );
}
