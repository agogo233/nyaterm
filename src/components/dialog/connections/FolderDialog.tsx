import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface FolderDialogProps {
  open: boolean;
  isEditing: boolean;
  name: string;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export default function FolderDialog({
  open,
  isEditing,
  name,
  onNameChange,
  onSubmit,
  onCancel,
}: FolderDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent showCloseButton={false} className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {isEditing ? t("savedConnections.renameFolder") : t("savedConnections.newFolder")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            className="text-sm"
            placeholder={t("savedConnections.folderNamePlaceholder")}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSubmit()}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t("dialog.cancel")}
          </Button>
          <Button size="sm" onClick={onSubmit} disabled={!name.trim()}>
            {t("dialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
