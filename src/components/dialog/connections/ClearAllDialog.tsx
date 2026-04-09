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

interface ClearAllDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ClearAllDialog({
  open,
  onConfirm,
  onCancel,
}: ClearAllDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("savedConnections.clearAll")}</DialogTitle>
          <DialogDescription>
            {t("savedConnections.clearAllConfirm")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t("savedConnections.clearAll")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
