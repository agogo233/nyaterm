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

interface DeleteFolderDialogProps {
  open: boolean;
  folderName?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteFolderDialog({
  open,
  folderName,
  onConfirm,
  onCancel,
}: DeleteFolderDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("savedConnections.deleteFolder")}</DialogTitle>
          <DialogDescription>
            {t("savedConnections.deleteFolderConfirm", { name: folderName })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t("savedConnections.deleteFolder")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
