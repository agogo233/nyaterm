import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MdSend } from "react-icons/md";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { invoke } from "@/lib/invoke";
import { buildTerminalCommandInput, sendSessionInput } from "@/lib/sessionInput";

interface SerialSendPanelProps {
  serialSessionId: string | null;
  shellSessionIds: string[];
}

function isValidHex(str: string): boolean {
  return /^[0-9a-fA-F\s]*$/.test(str);
}

function hexStringToBytes(hex: string): number[] {
  const cleaned = hex.replace(/\s+/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    const byte = Number.parseInt(cleaned.substring(i, i + 2), 16);
    if (!Number.isNaN(byte)) bytes.push(byte);
  }
  return bytes;
}

export default function SerialSendPanel({
  serialSessionId,
  shellSessionIds,
}: SerialSendPanelProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"serial" | "shell">(serialSessionId ? "serial" : "shell");
  const [serialMode, setSerialMode] = useState<"text" | "hex">("text");
  const [textData, setTextData] = useState("");
  const [hexData, setHexData] = useState("");
  const [shellCommand, setShellCommand] = useState("");
  const [lineEnding, setLineEnding] = useState<"none" | "cr" | "lf" | "crlf">("crlf");
  const [hexError, setHexError] = useState(false);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const hexInputRef = useRef<HTMLTextAreaElement>(null);
  const shellInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!serialSessionId && mode === "serial") {
      setMode("shell");
    }
  }, [mode, serialSessionId]);

  const sendText = useCallback(() => {
    if (!textData || !serialSessionId) return;
    let data = textData;
    if (lineEnding === "cr") data += "\r";
    else if (lineEnding === "lf") data += "\n";
    else if (lineEnding === "crlf") data += "\r\n";
    invoke("write_to_session", { sessionId: serialSessionId, data }).catch(() => {});
    setTextData("");
    textInputRef.current?.focus();
  }, [lineEnding, serialSessionId, textData]);

  const sendHex = useCallback(() => {
    if (!hexData || !serialSessionId) return;
    if (!isValidHex(hexData)) {
      setHexError(true);
      return;
    }
    const bytes = hexStringToBytes(hexData);
    if (bytes.length === 0) return;
    const str = String.fromCharCode(...bytes);
    invoke("write_to_session", { sessionId: serialSessionId, data: str }).catch(() => {});
    setHexData("");
    setHexError(false);
    hexInputRef.current?.focus();
  }, [hexData, serialSessionId]);

  const sendShellCommand = useCallback(async () => {
    const normalizedCommand = shellCommand.replace(/[\r\n]+$/u, "");
    if (!normalizedCommand.trim() || shellSessionIds.length === 0) return;

    const results = await Promise.allSettled(
      shellSessionIds.map(async (sessionId) => {
        await sendSessionInput(sessionId, buildTerminalCommandInput(normalizedCommand), {
          preview: { kind: "reset" },
          registerSubmission: normalizedCommand,
        });
      }),
    );

    const failedCount = results.filter((result) => result.status === "rejected").length;
    if (failedCount === shellSessionIds.length) {
      toast.error(t("serialSend.shellSendFailed", "Failed to send command to active windows"));
      return;
    }
    if (failedCount > 0) {
      toast.error(
        t("serialSend.shellSendPartial", "Some active windows did not receive the command"),
      );
    }

    setShellCommand("");
    shellInputRef.current?.focus();
  }, [shellCommand, shellSessionIds, t]);

  const renderUnavailable = useCallback(
    (title: string, description: string) => (
      <div className="h-full flex flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 text-center">
        <div className="text-xs font-medium text-foreground">{title}</div>
        <div className="text-[0.6875rem] text-muted-foreground">{description}</div>
      </div>
    ),
    [],
  );

  return (
    <div className="h-full flex flex-col overflow-hidden px-2 py-1.5 gap-1">
      <Tabs
        value={mode}
        onValueChange={(value) => setMode(value as typeof mode)}
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="flex items-center gap-2 shrink-0">
          <TabsList className="h-7">
            <TabsTrigger
              value="serial"
              disabled={!serialSessionId}
              className="text-[0.6875rem] px-2.5 h-6"
            >
              {t("serialSend.serialData", "Serial Data")}
            </TabsTrigger>
            <TabsTrigger value="shell" className="text-[0.6875rem] px-2.5 h-6">
              {t("serialSend.shellCommand", "Shell Command")}
            </TabsTrigger>
          </TabsList>
          <span className="text-[0.625rem] text-muted-foreground ml-auto select-none">
            {t("serialSend.title", "Command Send")}
          </span>
        </div>

        <TabsContent value="serial" className="flex-1 m-0 mt-1 min-h-0">
          {serialSessionId ? (
            <Tabs
              orientation="vertical"
              value={serialMode}
              onValueChange={(value) => setSerialMode(value as typeof serialMode)}
              className="flex h-full min-h-0 gap-1.5"
            >
              <TabsList className="h-auto w-20 shrink-0 flex-col">
                <TabsTrigger value="text" className="text-[0.6875rem] px-2.5 h-7">
                  {t("serialSend.text", "Text")}
                </TabsTrigger>
                <TabsTrigger value="hex" className="text-[0.6875rem] px-2.5 h-7">
                  {t("serialSend.hex", "Hex")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="text" className="flex-1 m-0 min-h-0">
                <div className="h-full flex flex-col gap-1.5 min-h-0">
                  <Textarea
                    ref={textInputRef}
                    className="min-h-0 flex-1 resize-none text-xs md:text-xs"
                    placeholder={t("serialSend.textPlaceholder", "Enter text to send...")}
                    value={textData}
                    onChange={(e) => setTextData(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                        e.preventDefault();
                        sendText();
                      }
                    }}
                  />
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Select
                      value={lineEnding}
                      onValueChange={(value) => setLineEnding(value as typeof lineEnding)}
                    >
                      <SelectTrigger className="h-7 w-20 text-[0.625rem]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" className="text-xs">
                          {t("serialSend.noLineEnding", "None")}
                        </SelectItem>
                        <SelectItem value="cr" className="text-xs">
                          CR
                        </SelectItem>
                        <SelectItem value="lf" className="text-xs">
                          LF
                        </SelectItem>
                        <SelectItem value="crlf" className="text-xs">
                          CR+LF
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="ml-auto text-[0.625rem] text-muted-foreground select-none">
                      {t("serialSend.sendShortcut", "Ctrl/Cmd + Enter to send")}
                    </span>
                    <Button
                      size="icon-xs"
                      variant="default"
                      className="h-7 w-7 shrink-0"
                      onClick={sendText}
                      disabled={!textData}
                    >
                      <MdSend className="text-sm" />
                    </Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="hex" className="flex-1 m-0 min-h-0">
                <div className="h-full flex flex-col gap-1.5 min-h-0">
                  <Textarea
                    ref={hexInputRef}
                    className={`min-h-0 flex-1 resize-none font-mono text-xs md:text-xs ${hexError ? "border-destructive" : ""}`}
                    placeholder={t("serialSend.hexPlaceholder", "e.g. 48 65 6C 6C 6F")}
                    value={hexData}
                    onChange={(e) => {
                      setHexData(e.target.value);
                      setHexError(false);
                    }}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                        e.preventDefault();
                        sendHex();
                      }
                    }}
                  />
                  <div className="flex items-center gap-1.5 shrink-0">
                    {hexError && (
                      <span className="text-[0.625rem] text-destructive truncate">
                        {t(
                          "serialSend.hexError",
                          "Invalid hex input. Use hex characters (0-9, A-F) separated by spaces.",
                        )}
                      </span>
                    )}
                    <span className="ml-auto text-[0.625rem] text-muted-foreground select-none shrink-0">
                      {t("serialSend.sendShortcut", "Ctrl/Cmd + Enter to send")}
                    </span>
                    <Button
                      size="icon-xs"
                      variant="default"
                      className="h-7 w-7 shrink-0"
                      onClick={sendHex}
                      disabled={!hexData}
                    >
                      <MdSend className="text-sm" />
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            renderUnavailable(
              t(
                "serialSend.serialUnavailable",
                "Serial data send is only available for the active serial session",
              ),
              t(
                "serialSend.serialUnavailableDesc",
                "Switch to a serial tab to send text or hex data here.",
              ),
            )
          )}
        </TabsContent>

        <TabsContent value="shell" className="flex-1 m-0 mt-1 min-h-0">
          {shellSessionIds.length > 0 ? (
            <div className="h-full flex flex-col gap-1.5 min-h-0">
              <div className="flex items-center gap-2 text-[0.625rem] text-muted-foreground select-none">
                <span>
                  {t("serialSend.shellTargets", "Active windows: {{count}}", {
                    count: shellSessionIds.length,
                  })}
                </span>
                <span className="ml-auto">
                  {t("serialSend.sendShortcut", "Ctrl/Cmd + Enter to send")}
                </span>
              </div>
              <Textarea
                ref={shellInputRef}
                className="min-h-0 flex-1 resize-none font-mono text-xs md:text-xs"
                placeholder={t(
                  "serialSend.shellPlaceholder",
                  "Enter a command to send to all active windows and execute...",
                )}
                value={shellCommand}
                onChange={(e) => setShellCommand(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    void sendShellCommand();
                  }
                }}
              />
              <div className="flex justify-end shrink-0">
                <Button
                  size="icon-xs"
                  variant="default"
                  className="h-7 w-7"
                  onClick={() => void sendShellCommand()}
                  disabled={!shellCommand.trim()}
                >
                  <MdSend className="text-sm" />
                </Button>
              </div>
            </div>
          ) : (
            renderUnavailable(
              t("serialSend.shellUnavailable", "No active shell windows available"),
              t(
                "serialSend.shellUnavailableDesc",
                "None of the active windows currently contain SSH, local terminal, or Telnet sessions.",
              ),
            )
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
