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
  count?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteConnectionDialog({
  open,
  connectionName,
  count = 1,
  onConfirm,
  onCancel,
}: DeleteConnectionDialogProps) {
  const { t } = useTranslation();
  const isMultiDelete = count > 1;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {isMultiDelete ? t("savedConnections.deleteSelected") : t("savedConnections.delete")}
          </DialogTitle>
          <DialogDescription>
            {isMultiDelete
              ? t("savedConnections.deleteSelectedConfirm", { count })
              : t("savedConnections.deleteConfirm", { name: connectionName })}
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
