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
import type { SshKey } from "@/types/global";

interface KeyDeleteDialogProps {
  entry: SshKey | null;
  onCancel: () => void;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

export function KeyDeleteDialog({
  entry,
  onCancel,
  onConfirm,
  onOpenChange,
}: KeyDeleteDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={entry !== null} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("settings.deleteKey")}</DialogTitle>
          <DialogDescription>
            {t("settings.deleteKeyConfirm", { name: entry?.name })}
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
