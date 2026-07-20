import { MdDriveFileMove } from "react-icons/md";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import type { Group } from "@/types/global";
import { naturalCompare } from "./context";

interface GroupMenuNode {
  group: Group;
  children: GroupMenuNode[];
}

interface MoveToGroupMenuProps {
  groups: Group[];
  onMove: (groupId: string | null) => void;
  t: (key: string) => string;
}

function sortGroups(groups: Group[]) {
  return [...groups].sort((left, right) => {
    if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order;
    return naturalCompare(left.name, right.name);
  });
}

function buildGroupMenuTree(groups: Group[]): GroupMenuNode[] {
  const sortedGroups = sortGroups(groups);
  const nodes = new Map<string, GroupMenuNode>();

  sortedGroups.forEach((group) => {
    nodes.set(group.id, { group, children: [] });
  });

  const roots: GroupMenuNode[] = [];
  sortedGroups.forEach((group) => {
    const node = nodes.get(group.id);
    if (!node) return;

    const parent = group.parent_id ? nodes.get(group.parent_id) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

function ContextGroupTarget({
  node,
  onMove,
}: {
  node: GroupMenuNode;
  onMove: (id: string) => void;
}) {
  if (node.children.length === 0) {
    return (
      <ContextMenuItem onClick={() => onMove(node.group.id)}>{node.group.name}</ContextMenuItem>
    );
  }

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>{node.group.name}</ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-h-[70vh] min-w-[180px] overflow-y-auto">
        <ContextMenuItem onClick={() => onMove(node.group.id)}>{node.group.name}</ContextMenuItem>
        <ContextMenuSeparator />
        {node.children.map((child) => (
          <ContextGroupTarget key={child.group.id} node={child} onMove={onMove} />
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function DropdownGroupTarget({
  node,
  onMove,
}: {
  node: GroupMenuNode;
  onMove: (id: string) => void;
}) {
  if (node.children.length === 0) {
    return (
      <DropdownMenuItem onClick={() => onMove(node.group.id)}>{node.group.name}</DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{node.group.name}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-[70vh] min-w-[180px] overflow-y-auto">
        <DropdownMenuItem onClick={() => onMove(node.group.id)}>{node.group.name}</DropdownMenuItem>
        <DropdownMenuSeparator />
        {node.children.map((child) => (
          <DropdownGroupTarget key={child.group.id} node={child} onMove={onMove} />
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function MoveToGroupContextMenu({ groups, onMove, t }: MoveToGroupMenuProps) {
  const roots = buildGroupMenuTree(groups);

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <MdDriveFileMove className="text-[0.875rem] text-muted-foreground mr-2" />
        {t("savedConnections.moveToGroup")}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-h-[70vh] min-w-[180px] overflow-y-auto">
        <ContextMenuItem onClick={() => onMove(null)}>
          {t("savedConnections.ungroupedConnections")}
        </ContextMenuItem>
        {roots.length > 0 && <ContextMenuSeparator />}
        {roots.map((node) => (
          <ContextGroupTarget key={node.group.id} node={node} onMove={onMove} />
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

export function MoveToGroupDropdownMenu({ groups, onMove, t }: MoveToGroupMenuProps) {
  const roots = buildGroupMenuTree(groups);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <MdDriveFileMove className="text-sm text-[var(--df-text-muted)]" />
        {t("savedConnections.moveToGroup")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-[70vh] min-w-[180px] overflow-y-auto">
        <DropdownMenuItem onClick={() => onMove(null)}>
          {t("savedConnections.ungroupedConnections")}
        </DropdownMenuItem>
        {roots.length > 0 && <DropdownMenuSeparator />}
        {roots.map((node) => (
          <DropdownGroupTarget key={node.group.id} node={node} onMove={onMove} />
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
