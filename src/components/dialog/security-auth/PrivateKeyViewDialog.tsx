import { Check, Copy } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SshKey } from "@/types/global";

interface PrivateKeyViewDialogProps {
  entry: SshKey | null;
  loading: boolean;
  loadError: boolean;
  value: string;
  onOpenChange: (open: boolean) => void;
}

function DialogCopyButton({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleCopy = () => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 cursor-pointer items-center rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          onClick={handleCopy}
          aria-label={copied ? t("common.copied") : t("common.copyToClipboard")}
        >
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {copied ? t("common.copied") : t("common.copyToClipboard")}
      </TooltipContent>
    </Tooltip>
  );
}

export function PrivateKeyViewDialog({
  entry,
  loading,
  loadError,
  value,
  onOpenChange,
}: PrivateKeyViewDialogProps) {
  const { t } = useTranslation();
  const dialogValue = loadError
    ? t("settings.privateKeyLoadFailed")
    : value || (loading ? "" : t("settings.privateKeyEmpty"));

  return (
    <Dialog open={entry !== null} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(720px,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-3 pr-12">
          <DialogTitle className="text-sm">{t("settings.privateKeyDialogTitle")}</DialogTitle>
          <DialogDescription className="truncate">{entry?.name}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0">
          <div className="flex h-9 items-center justify-between gap-2 border-b px-5">
            <Label className="text-[0.6875rem] text-muted-foreground">
              {t("settings.privateKey")}
            </Label>
            {value ? <DialogCopyButton value={value} /> : null}
          </div>
          <pre className="terminal-scroll max-h-[60vh] min-h-72 overflow-auto bg-muted/20 p-4 font-mono text-[0.6875rem] leading-5 whitespace-pre text-muted-foreground">
            {loading ? t("common.loading") : dialogValue}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}
