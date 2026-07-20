import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MdArrowDropDown } from "react-icons/md";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { invoke } from "@/lib/invoke";
import { logger } from "@/lib/logger";
import {
  getActiveTransferDuplicatePrompt,
  resolveTransferDuplicatePrompt,
  setBackendTransferDuplicatePrompt,
  subscribeTransferDuplicatePrompt,
  type TransferDuplicateChoice,
  type TransferDuplicatePromptChoice,
  type TransferDuplicateRequest,
} from "@/lib/transferDuplicatePrompt";

export function TransferDuplicateDialog() {
  const { t } = useTranslation();
  const [request, setRequest] = useState<TransferDuplicateRequest | null>(() =>
    getActiveTransferDuplicatePrompt(),
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => subscribeTransferDuplicatePrompt(setRequest), []);

  const handleChoice = async (choice: TransferDuplicatePromptChoice) => {
    if (!request || submitting) return;
    setSubmitting(true);

    try {
      if (request.respondViaBackend) {
        const backendChoice: TransferDuplicateChoice =
          choice === "overwriteAllForTask" ? "overwrite" : choice;
        await invoke("respond_transfer_duplicate", {
          requestId: request.requestId,
          action: backendChoice,
        });
      } else {
        resolveTransferDuplicatePrompt(choice);
        setSubmitting(false);
        return;
      }
    } catch (error) {
      logger.error({
        domain: "transfer.lifecycle",
        event: "duplicate.response_failed",
        message: "Failed to send duplicate resolution to backend",
        ids: { request_id: request.requestId },
        error,
      });
      if (request.respondViaBackend) {
        await invoke("respond_transfer_duplicate", {
          requestId: request.requestId,
          action: "skip",
        }).catch(() => {});
      } else {
        resolveTransferDuplicatePrompt("skip");
      }
    }

    setSubmitting(false);
    if (request.respondViaBackend) {
      setBackendTransferDuplicatePrompt(null);
    }
  };

  const kindLabel = request?.isDirectory
    ? t("fileTransfer.duplicateKindFolder")
    : t("fileTransfer.duplicateKindFile");
  const canApplyToTask = !!request?.allowApplyToTask && !request.respondViaBackend;

  return (
    <AlertDialog
      open={!!request}
      onOpenChange={(open) => {
        if (!open && request && !submitting) {
          void handleChoice("skip");
        }
      }}
    >
      <AlertDialogContent
        size="sm"
        className="w-[min(22rem,calc(100vw-2rem))] sm:max-w-md"
        onKeyDown={(event) => {
          if (event.key === "Enter" && !submitting && request) {
            event.preventDefault();
            void handleChoice(request.unverified ? "skip" : "overwrite");
          }
        }}
      >
        <AlertDialogHeader className="min-w-0 text-left">
          <AlertDialogTitle className="text-sm">
            {request?.unverified
              ? t("fileTransfer.duplicateUnverifiedTitle")
              : t("fileTransfer.duplicateTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-xs leading-relaxed">
            {request?.unverified
              ? t("fileTransfer.duplicateUnverifiedDescription", {
                  name: request?.fileName ?? "",
                })
              : t("fileTransfer.duplicateDescription", {
                  kind: kindLabel,
                  name: request?.fileName ?? "",
                })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {request?.remotePath && (
          <div
            className="rounded-md border px-2 py-1.5 font-mono text-[0.6875rem] break-all"
            style={{ borderColor: "var(--df-border)", color: "var(--df-text-dimmed)" }}
          >
            {request.remotePath}
          </div>
        )}

        <AlertDialogFooter className="grid grid-cols-2 gap-3 sm:grid sm:justify-stretch">
          <AlertDialogCancel
            className="w-full text-xs"
            disabled={submitting}
            onClick={(event) => {
              event.preventDefault();
              void handleChoice("skip");
            }}
          >
            {t("fileTransfer.duplicateSkip")}
          </AlertDialogCancel>
          <div className="flex min-w-0 items-center gap-0">
            <AlertDialogAction
              className={
                canApplyToTask ? "min-w-0 flex-1 rounded-r-none text-xs" : "w-full text-xs"
              }
              disabled={submitting}
              onClick={(event) => {
                event.preventDefault();
                void handleChoice("overwrite");
              }}
            >
              {t("fileTransfer.duplicateOverwrite")}
            </AlertDialogAction>
            {canApplyToTask && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    className="h-9 w-9 rounded-l-none border-l border-primary-foreground/25 px-0 text-xs"
                    disabled={submitting}
                  >
                    <MdArrowDropDown className="text-base" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuItem
                    className="flex-col items-start gap-0.5"
                    onSelect={() => {
                      void handleChoice("overwriteAllForTask");
                    }}
                  >
                    <span>{t("fileTransfer.duplicateOverwriteAllForTask")}</span>
                    <span className="text-[0.6875rem] leading-4 text-muted-foreground">
                      {t("fileTransfer.duplicateOverwriteAllForTaskDesc")}
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
