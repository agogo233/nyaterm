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

interface DeleteConnectionDialogProps {
  open: boolean;
  connectionName?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteConnectionDialog({
  open,
  connectionName,
  onConfirm,
  onCancel,
}: DeleteConnectionDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("savedConnections.delete")}</DialogTitle>
          <DialogDescription>
            {t("savedConnections.deleteConfirm", { name: connectionName })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t("savedConnections.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
