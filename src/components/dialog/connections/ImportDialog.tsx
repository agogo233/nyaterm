import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApp } from "../../../context/AppContext";
import { invoke } from "../../../lib/invoke";
import { logger } from "../../../lib/logger";

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
}

interface ImportSource {
  id: string;
  name: string;
  icon: string;
  extensions: string[];
  hint?: string;
}

const IMPORT_SOURCES: ImportSource[] = [
  { id: "xshell", name: "Xshell", icon: "/Xshell.svg", extensions: ["xts"] },
  { id: "mobaxterm", name: "MobaXterm", icon: "/MobaXterm.svg", extensions: ["mxtsessions"] },
  { id: "windterm", name: "WindTerm", icon: "/WindTerm.svg", extensions: ["sessions"], hint: "" },
];

export default function ImportDialog({ open, onClose }: ImportDialogProps) {
  const { t } = useTranslation();
  const { refreshConnections } = useApp();

  const handleSelect = async (source: ImportSource) => {
    onClose();
    const selected = await openFileDialog({
      multiple: false,
      filters: [{ name: source.name, extensions: source.extensions }],
    });
    if (!selected) return;
    try {
      const count = await invoke<number>("import_sessions", { filePath: selected });
      if (count > 0) {
        toast.success(t("savedConnections.importSuccess", { count }));
        refreshConnections();
      } else {
        toast.info(t("savedConnections.importSuccess", { count: 0 }));
      }
    } catch (e) {
      logger.error("Import sessions failed", e);
      toast.error(t("savedConnections.importFailed", { error: e }));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[360px] sm:max-w-[360px] p-6">
        <DialogHeader>
          <DialogTitle className="text-sm">{t("savedConnections.importFrom")}</DialogTitle>
          <DialogDescription className="text-xs">
            {t("savedConnections.importSelectSource")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3 pt-2">
          {IMPORT_SOURCES.map((source) => (
            <button
              key={source.id}
              className="flex flex-col items-center gap-2 p-3 rounded-lg border transition-colors hover:border-[var(--df-primary)] hover:bg-[color-mix(in_srgb,var(--df-primary)_8%,transparent)] cursor-pointer"
              style={{ borderColor: "var(--df-border)" }}
              onClick={() => handleSelect(source)}
            >
              <img src={source.icon} alt={source.name} className="w-10 h-10" draggable={false} />
              <span className="text-xs font-medium" style={{ color: "var(--df-text)" }}>
                {source.name}
              </span>
              {source.hint && (
                <span
                  className="text-[0.6rem] leading-tight text-center break-all"
                  style={{ color: "var(--df-text-dimmed)" }}
                >
                  {source.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
