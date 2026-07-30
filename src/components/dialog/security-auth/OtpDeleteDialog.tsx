import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OtpEntry } from "@/types/global";

interface OtpDeleteDialogProps {
  entry: OtpEntry | null;
  onCancel: () => void;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

export function OtpDeleteDialog({
  entry,
  onCancel,
  onConfirm,
  onOpenChange,
}: OtpDeleteDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={entry !== null} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("otpManager.deleteTitle")}</DialogTitle>
          <DialogDescription>
            {t("otpManager.deleteConfirm", { name: entry?.issuer })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t("common.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
