import { useState } from "react";
import { useTranslation } from "react-i18next";
import PanelHeader from "@/components/layout/PanelHeader";
import { CredentialManagementTab } from "@/components/panel/security-auth/CredentialManagementTab";
import { KeyManagementTab } from "@/components/panel/security-auth/KeyManagementTab";
import { OtpManagementTab } from "@/components/panel/security-auth/OtpManagementTab";
import { PasswordManagementTab } from "@/components/panel/security-auth/PasswordManagementTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type SecurityAuthTab = "keys" | "passwords" | "credentials" | "otp";

export default function SecurityAuthPanel() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SecurityAuthTab>("keys");
  const [keyCount, setKeyCount] = useState(0);
  const [passwordCount, setPasswordCount] = useState(0);
  const [credentialCount, setCredentialCount] = useState(0);
  const [otpCount, setOtpCount] = useState(0);
  const [secretsUnlocked, setSecretsUnlocked] = useState(false);

  const displayCount =
    activeTab === "keys"
      ? keyCount
      : activeTab === "passwords"
        ? passwordCount
        : activeTab === "credentials"
          ? credentialCount
          : otpCount;

  const handleTabChange = (value: string) => {
    setActiveTab(value as SecurityAuthTab);
  };

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: "var(--df-bg-panel)" }}>
      <PanelHeader
        title={t("securityAuth.title")}
        actions={
          <span className="text-[0.6875rem]" style={{ color: "var(--df-text-dimmed)" }}>
            {displayCount}
          </span>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="min-h-0 w-full flex-1 gap-0"
        >
          <div className="px-3 pt-3">
            <TabsList className="grid h-8 w-full grid-cols-4">
              <TabsTrigger value="keys" className="text-xs">
                {t("securityAuth.keys")}
              </TabsTrigger>
              <TabsTrigger value="passwords" className="text-xs">
                {t("securityAuth.passwords")}
              </TabsTrigger>
              <TabsTrigger value="otp" className="text-xs">
                {t("securityAuth.otp")}
              </TabsTrigger>
                <TabsTrigger value="credentials" className="text-xs">
                {t("securityAuth.credentials")}
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="passwords" className="mt-3 flex min-h-0 flex-1 overflow-hidden">
            <PasswordManagementTab
              onCountChange={setPasswordCount}
              secretsUnlocked={secretsUnlocked}
              onLockSecrets={() => setSecretsUnlocked(false)}
              onUnlockSecrets={() => setSecretsUnlocked(true)}
              showSecretUnlockFooter
            />
          </TabsContent>
          <TabsContent value="credentials" className="mt-3 flex min-h-0 flex-1 overflow-hidden">
            <CredentialManagementTab
              onCountChange={setCredentialCount}
              secretsUnlocked={secretsUnlocked}
              onLockSecrets={() => setSecretsUnlocked(false)}
              onUnlockSecrets={() => setSecretsUnlocked(true)}
            />
          </TabsContent>
          <TabsContent
            value="keys"
            className="mt-3 min-h-0 overflow-y-auto px-3 pb-3 terminal-scroll"
          >
            <KeyManagementTab onCountChange={setKeyCount} />
          </TabsContent>
          <TabsContent
            value="otp"
            className="mt-3 min-h-0 overflow-y-auto px-3 pb-3 terminal-scroll"
          >
            <OtpManagementTab onCountChange={setOtpCount} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
