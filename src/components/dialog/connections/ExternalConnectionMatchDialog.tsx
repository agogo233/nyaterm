import { Server } from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import type { TemporaryLinkConfig } from "@/lib/temporaryLink";
import type { Group, SavedConnection } from "@/types/global";

interface ExternalConnectionMatchDialogProps {
  open: boolean;
  connections: SavedConnection[];
  groups: Group[];
  temporary: TemporaryLinkConfig | null;
  onOpenChange: (open: boolean) => void;
  onSelectConnection: (connection: SavedConnection) => void;
  onUseTemporary: (config: TemporaryLinkConfig) => void;
}

export default function ExternalConnectionMatchDialog({
  open,
  connections,
  groups,
  temporary,
  onOpenChange,
  onSelectConnection,
  onUseTemporary,
}: ExternalConnectionMatchDialogProps) {
  const { t } = useTranslation();
  const groupsById = new Map(groups.map((group) => [group.id, group]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[34rem]">
        <DialogHeader>
          <DialogTitle className="text-base">{t("externalOpen.matchTitle")}</DialogTitle>
          <DialogDescription>{t("externalOpen.matchDescription")}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[18rem] pr-3">
          <div className="space-y-2">
            {connections.map((connection) => (
              <button
                key={connection.id}
                type="button"
                className="flex w-full min-w-0 items-center gap-3 rounded-md border bg-card px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onSelectConnection(connection)}
              >
                <Server className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{connection.name}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {connectionAddress(connection)}
                  </span>
                  {connection.group_id && groupsById.has(connection.group_id) ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {groupsById.get(connection.group_id)?.name}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!temporary}
            onClick={() => temporary && onUseTemporary(temporary)}
          >
            {t("externalOpen.useTemporary")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function connectionAddress(connection: SavedConnection) {
  const host = connection.host ?? "";
  const port = connection.port ?? (connection.type === "ssh" ? 22 : 23);
  if (connection.type === "ssh") {
    return `${connection.username ?? ""}@${host}:${port}`;
  }
  return `${host}:${port}`;
}
