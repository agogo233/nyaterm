import { useTranslation } from "react-i18next";
import {
  MdBlock,
  MdCheck,
  MdContentCopy,
  MdErrorOutline,
  MdInput,
  MdPlayArrow,
  MdSave,
} from "react-icons/md";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { AICommandCard } from "@/types/global";
import type { AICommandExecutionState } from "./types";

export function AICommandCardView({
  card,
  execution,
  onInsert,
  onSave,
  onAuthorize,
  onReject,
}: {
  card: AICommandCard;
  execution?: AICommandExecutionState;
  onInsert: (card: AICommandCard) => void;
  onSave: (card: AICommandCard) => void;
  onAuthorize: (card: AICommandCard) => void;
  onReject: (card: AICommandCard) => void;
}) {
  const { t } = useTranslation();
  const status = execution?.status ?? "idle";
  const hasTarget = !!card.target?.terminalSessionId;

  const copy = async () => {
    await navigator.clipboard.writeText(card.command);
    toast.success(t("ai.commandCopied"));
  };

  return (
    <div className="rounded-md border border-border/70 bg-background/65 p-3 text-xs">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{card.title}</div>
        </div>
      </div>
      <pre className="mt-3 max-h-32 overflow-auto rounded-md border border-border/60 bg-muted/30 p-2 font-mono text-[0.6875rem] leading-5 terminal-scroll whitespace-pre-wrap break-all">
        {card.command}
      </pre>
      <div className="mt-2 text-[0.6875rem] font-medium text-muted-foreground">
        {hasTarget
          ? t("ai.commandTargetLabel", { target: card.target?.label })
          : t("ai.commandTargetMissing")}
      </div>
      <div className="mt-3 space-y-1 leading-5 text-muted-foreground">
        <p>{card.explanation}</p>
        <p>{card.expectedEffect}</p>
        {card.rollback ? <p>{card.rollback}</p> : null}
      </div>
      {status !== "idle" ? (
        <div className="mt-3 rounded-md border border-border/70 bg-muted/20 p-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            {status === "executed" ? <MdCheck /> : null}
            {status === "pending_approval" ? <MdErrorOutline /> : null}
            {status === "rejected" ? <MdBlock /> : null}
            {status === "failed" ? <MdErrorOutline /> : null}
            <span>
              {status === "executed"
                ? t("ai.commandExecuted")
                : status === "pending_approval"
                  ? t("ai.commandPendingApproval")
                  : status === "rejected"
                    ? t("ai.commandRejected")
                    : t("ai.commandExecutionFailed")}
            </span>
          </div>
          {status === "pending_approval" ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button size="xs" variant="outline" onClick={() => onReject(card)}>
                <MdBlock />
                {t("ai.rejectExecute")}
              </Button>
              <Button size="xs" disabled={!hasTarget} onClick={() => onAuthorize(card)}>
                <MdPlayArrow />
                {t("ai.authorizeExecute")}
              </Button>
            </div>
          ) : null}
          {execution?.error ? (
            <div className="mt-2 text-[0.6875rem] text-destructive">{execution.error}</div>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button size="xs" disabled={!hasTarget} onClick={() => onInsert(card)}>
          <MdInput />
          {t("ai.insertTerminal")}
        </Button>
        <Button size="xs" variant="outline" onClick={() => void copy()}>
          <MdContentCopy />
          {t("ai.copy")}
        </Button>
        <Button size="xs" variant="outline" onClick={() => onSave(card)}>
          <MdSave />
          {t("ai.saveQuickCommand")}
        </Button>
      </div>
    </div>
  );
}
