import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MdChevronRight } from "react-icons/md";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type TelnetEnterMode = "crlf" | "cr" | "lf";

interface TelnetFormProps {
  host: string;
  setHost: (v: string) => void;
  port: number;
  setPort: (v: number) => void;
  backspaceMode: string;
  setBackspaceMode: (v: string) => void;
  rawTcpCli: boolean;
  setRawTcpCli: (v: boolean) => void;
  enterMode: TelnetEnterMode;
  setEnterMode: (v: TelnetEnterMode) => void;
  localEcho: boolean;
  setLocalEcho: (v: boolean) => void;
  forceCharacterAtATime: boolean;
  setForceCharacterAtATime: (v: boolean) => void;
  sendNaws: boolean;
  setSendNaws: (v: boolean) => void;
  sendSga: boolean;
  setSendSga: (v: boolean) => void;
}

function RequiredMark() {
  return <span className="ml-0.5 text-destructive">*</span>;
}

export function TelnetForm({
  host,
  setHost,
  port,
  setPort,
  backspaceMode,
  setBackspaceMode,
  rawTcpCli,
  setRawTcpCli,
  enterMode,
  setEnterMode,
  localEcho,
  setLocalEcho,
  forceCharacterAtATime,
  setForceCharacterAtATime,
  sendNaws,
  setSendNaws,
  sendSga,
  setSendSga,
}: TelnetFormProps) {
  const { t } = useTranslation();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const renderSwitchRow = (
    label: string,
    description: string,
    checked: boolean,
    onCheckedChange: (checked: boolean) => void,
    disabled = false,
  ) => (
    <div className={cn("rounded-md border bg-background/70 px-3 py-2", disabled && "opacity-55")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="text-xs font-medium">{label}</div>
          <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <Switch
          className="mt-0.5"
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-3 w-full">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="min-w-0 flex-1">
          <Label className="text-xs font-medium text-foreground/80">
            {t("dialog.host")}
            <RequiredMark />
          </Label>
          <Input
            className="mt-1 text-xs h-8"
            placeholder="192.168.1.100"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-32">
          <Label className="text-xs font-medium text-foreground/80">
            {t("dialog.port")}
            <RequiredMark />
          </Label>
          <NumberInput
            className="mt-1 [&_button]:h-8 [&_button]:w-8 [&_input]:h-8 [&_input]:text-xs"
            value={port}
            onChange={setPort}
            min={1}
            max={65535}
          />
        </div>
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger className="group flex w-full items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
          <MdChevronRight
            className={`text-sm transition-transform duration-200 ${advancedOpen ? "rotate-90" : ""}`}
          />
          <span>{t("dialog.advancedConfig")}</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          <Tabs defaultValue="input" className="w-full">
            <TabsList className="grid h-8 w-full grid-cols-2 pointer-events-auto">
              <TabsTrigger value="input" className="text-xs">
                {t("dialog.telnetInputSettings", "Input")}
              </TabsTrigger>
              <TabsTrigger value="telnet" className="text-xs">
                {t("dialog.telnetCompatibility", "Compatibility")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="input" className="mt-3 border-0 outline-none">
              <div className="rounded-lg border bg-accent/25 p-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-medium">
                    {t("dialog.telnetInputBehavior", "Key input")}
                  </div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs font-medium text-foreground/80">
                      {t("dialog.backspaceMode", "Backspace Mode")}
                    </Label>
                    <Select value={backspaceMode} onValueChange={setBackspaceMode}>
                      <SelectTrigger className="mt-1 h-8 text-xs font-normal">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ctrl_h">
                          {t("dialog.backspaceCtrlH", "Ctrl+H (BS)")}
                        </SelectItem>
                        <SelectItem value="del">
                          {t("dialog.backspaceDel", "DEL (0x7F)")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-foreground/80">
                      {t("dialog.telnetEnterMode", "Enter sends")}
                    </Label>
                    <Select
                      value={enterMode}
                      onValueChange={(value) => setEnterMode(value as TelnetEnterMode)}
                    >
                      <SelectTrigger className="mt-1 h-8 text-xs font-normal">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="crlf">CRLF (\r\n)</SelectItem>
                        <SelectItem value="cr">CR (\r)</SelectItem>
                        <SelectItem value="lf">LF (\n)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="telnet" className="mt-3 border-0 outline-none">
              <div className="rounded-lg border bg-accent/25 p-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-medium">
                    {t("dialog.telnetCompatibility", "Compatibility")}
                  </div>
                  <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
                    {t(
                      "dialog.telnetRawTcpCliDesc",
                      "Suitable for non-standard Telnet, embedded debug ports, and device CLIs. When enabled, Telnet negotiation is disabled and input is passed through directly.",
                    )}
                  </p>
                </div>

                <div className="mt-3 grid gap-2">
                  {renderSwitchRow(
                    t("dialog.telnetRawTcpCli", "Embedded debug port / Raw TCP CLI"),
                    t(
                      "dialog.telnetRawTcpCliLongDesc",
                      "Disables Telnet negotiation and passes input directly through for TVs, routers, switches, and embedded debug ports.",
                    ),
                    rawTcpCli,
                    (checked) => {
                      setRawTcpCli(checked);
                      if (checked) {
                        setEnterMode("cr");
                      }
                    },
                  )}

                  <div className="grid gap-2 md:grid-cols-2">
                    {renderSwitchRow(
                      t("dialog.telnetLocalEcho", "Local Echo"),
                      t(
                        "dialog.telnetLocalEchoDesc",
                        "Show typed input locally when the device does not echo.",
                      ),
                      localEcho,
                      setLocalEcho,
                    )}
                    {renderSwitchRow(
                      t("dialog.telnetForceCharAtATime", "Force character-at-a-time"),
                      t(
                        "dialog.telnetForceCharAtATimeDesc",
                        "Write each input character to the TCP stream immediately.",
                      ),
                      forceCharacterAtATime,
                      setForceCharacterAtATime,
                    )}
                    {renderSwitchRow(
                      t("dialog.telnetSendNaws", "Send NAWS"),
                      t(
                        "dialog.telnetSendNawsDesc",
                        "Send terminal size changes in standard Telnet mode.",
                      ),
                      sendNaws,
                      setSendNaws,
                      rawTcpCli,
                    )}
                    {renderSwitchRow(
                      t("dialog.telnetSendSga", "Send SGA"),
                      t(
                        "dialog.telnetSendSgaDesc",
                        "Accept Suppress Go Ahead negotiation in standard Telnet mode.",
                      ),
                      sendSga,
                      setSendSga,
                      rawTcpCli,
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
