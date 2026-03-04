import {
  MdAdd,
  MdCreateNewFolder,
  MdDelete,
  MdDriveFileRenameOutline,
  MdExpandMore,
  MdFolder,
  MdFolderOpen,
} from "react-icons/md";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useSavedConnectionsContext } from "./context";
import type { GroupNode } from "./context";
import ConnectionItem from "./ConnectionItem";

interface GroupNodeItemProps {
  node: GroupNode;
  depth: number;
}

export default function GroupNodeItem({ node, depth }: GroupNodeItemProps) {
  const {
    isDragEnabled,
    dragTarget,
    expandedGroups,
    toggleGroup,
    onNewConnection,
    openNewFolderDialog,
    openRenameFolderDialog,
    setDeleteFolderTarget,
    handleDragStart,
    handleDragEnd,
    handleDragOverItem,
    handleDragLeaveItem,
    handleDropItem,
    t,
  } = useSavedConnectionsContext();

  const collapsed = !expandedGroups.has(node.group.id);
  const isTarget = dragTarget?.id === node.group.id && dragTarget.type === "group";
  const showGroupBefore = isTarget && dragTarget.position === "before";
  const showGroupAfter = isTarget && dragTarget.position === "after";
  const isInside = isTarget && dragTarget.position === "inside";
  const indentPx = `${8 + depth * 16}px`;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="relative"
          draggable={isDragEnabled}
          onDragStart={isDragEnabled ? (e) => handleDragStart(e, "group", node.group.id) : undefined}
          onDragEnd={isDragEnabled ? handleDragEnd : undefined}
        >
          {showGroupBefore && (
            <div className="absolute top-0 right-2 h-0.5 rounded-full z-10" style={{ backgroundColor: "var(--df-primary)", left: indentPx }} />
          )}
          <div
            data-group-header
            className={`flex items-center gap-1.5 py-1.5 px-2 rounded cursor-pointer transition-colors select-none df-hover ${isInside ? "ring-1 ring-primary/60 bg-primary/10" : ""}`}
            style={{ paddingLeft: indentPx }}
            onClick={() => toggleGroup(node.group.id)}
            onDragOver={isDragEnabled ? (e) => handleDragOverItem(e, node.group.id, "group") : undefined}
            onDragLeave={isDragEnabled ? (e) => handleDragLeaveItem(e, node.group.id, "group") : undefined}
            onDrop={isDragEnabled ? (e) => handleDropItem(e, node.group.id, "group") : undefined}
          >
            <MdExpandMore
              className="text-xs transition-transform shrink-0"
              style={{
                color: "var(--df-text-dimmed)",
                transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
              }}
            />
            {collapsed ? (
              <MdFolder className="text-sm text-amber-500/70 shrink-0" />
            ) : (
              <MdFolderOpen className="text-sm text-amber-500/70 shrink-0" />
            )}
            <span className="text-xs font-medium flex-1 truncate" style={{ color: "var(--df-text-muted)" }}>
              {node.group.name}
            </span>
            <span className="text-xs tabular-nums shrink-0" style={{ color: "var(--df-text-dimmed)" }}>
              {node.totalCount}
            </span>
          </div>
          {!collapsed && (
            <div className={depth === 0 ? "mb-1" : ""}>
              {node.children.map((child) => (
                <GroupNodeItem key={child.group.id} node={child} depth={depth + 1} />
              ))}
              {node.connections.map((conn) => (
                <ConnectionItem key={conn.id} conn={conn} indented depth={depth + 1} />
              ))}
            </div>
          )}
          {showGroupAfter && (
            <div className="absolute bottom-0 right-2 h-0.5 rounded-full z-10" style={{ backgroundColor: "var(--df-primary)", left: indentPx }} />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[160px]">
        <ContextMenuItem onClick={() => onNewConnection(node.group.id)}>
          <MdAdd className="text-[0.875rem] text-muted-foreground mr-2" />
          {t("savedConnections.newConnection")}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => openNewFolderDialog(node.group.id)}>
          <MdCreateNewFolder className="text-[0.875rem] text-muted-foreground mr-2" />
          {t("savedConnections.newSubfolder")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => openRenameFolderDialog(node.group)}>
          <MdDriveFileRenameOutline className="text-[0.875rem] text-muted-foreground mr-2" />
          {t("savedConnections.renameFolder")}
        </ContextMenuItem>
        <ContextMenuItem className="text-red-400" onClick={() => setDeleteFolderTarget(node.group)}>
          <MdDelete className="text-[0.875rem] mr-2" />
          {t("savedConnections.deleteFolder")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
