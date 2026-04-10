import { useState } from "react";
import { useTranslation } from "react-i18next";
import PanelHeader from "@/components/layout/PanelHeader";
import { KeyManagementTab } from "@/components/settings/KeyManagementTab";
import { PasswordManagementTab } from "@/components/settings/PasswordManagementTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type SecurityAuthTab = "keys" | "passwords";

export default function SecurityAuthPanel() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SecurityAuthTab>("keys");
  const [keyCount, setKeyCount] = useState(0);
  const [passwordCount, setPasswordCount] = useState(0);

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: "var(--df-bg-panel)" }}>
      <PanelHeader
        title={t("securityAuth.title")}
        actions={
          <span className="text-[0.6875rem]" style={{ color: "var(--df-text-dimmed)" }}>
            {activeTab === "keys" ? keyCount : passwordCount}
          </span>
        }
      />
      <div className="flex-1 overflow-y-auto p-3 terminal-scroll">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as SecurityAuthTab)}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-2 h-8">
            <TabsTrigger value="keys" className="text-xs">
              {t("securityAuth.keys")}
            </TabsTrigger>
            <TabsTrigger value="passwords" className="text-xs">
              {t("securityAuth.passwords")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="passwords" className="mt-3">
            <PasswordManagementTab onCountChange={setPasswordCount} />
          </TabsContent>
          <TabsContent value="keys" className="mt-3">
            <KeyManagementTab onCountChange={setKeyCount} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
