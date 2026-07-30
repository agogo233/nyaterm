import { ChevronsUpDownIcon } from "lucide-react";
import { type ElementType, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MdCheck, MdDns } from "react-icons/md";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SelectGroup, SelectLabel } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Group, SavedConnection } from "@/types/global";

export interface ConnectionOption {
  connection: SavedConnection;
  groupPath: string;
  subtitle: string;
  searchText: string;
  disabled?: boolean;
  disabledReason?: string;
}

export interface ConnectionOptionGroup {
  id: string;
  label: string;
  options: ConnectionOption[];
}

export function sortLabel(left: string, right: string) {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function buildGroupPath(groupId: string | undefined, groupsById: Map<string, Group>) {
  if (!groupId) return "";

  const parts: string[] = [];
  let current = groupId;

  while (current) {
    const group = groupsById.get(current);
    if (!group) break;
    parts.unshift(group.name);
    current = group.parent_id ?? "";
  }

  return parts.join(" / ");
}

export function StatusBadge({
  active,
  activeLabel,
  inactiveLabel,
}: {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[0.625rem] font-medium",
        active ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground",
      )}
    >
      {active ? activeLabel : inactiveLabel}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-8 text-center">
      <div
        className="mb-3 flex size-10 items-center justify-center rounded-full"
        style={{ backgroundColor: "color-mix(in srgb, var(--df-text-muted) 12%, transparent)" }}
      >
        <Icon className="text-lg" style={{ color: "var(--df-text-muted)" }} />
      </div>
      <div className="text-sm font-medium" style={{ color: "var(--df-text)" }}>
        {title}
      </div>
      <p className="mt-1 max-w-xs text-xs leading-5" style={{ color: "var(--df-text-dimmed)" }}>
        {description}
      </p>
    </div>
  );
}

export function ConnectionField({
  option,
  missingLabel,
}: {
  option?: ConnectionOption;
  missingLabel: string;
}) {
  return (
    <div
      className="rounded-md border px-3 py-2"
      style={{
        borderColor: "var(--df-border)",
        backgroundColor: "color-mix(in srgb, var(--df-bg-hover) 55%, transparent)",
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <MdDns className="shrink-0 text-sm" style={{ color: "var(--df-text-muted)" }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" style={{ color: "var(--df-text)" }}>
            {option?.connection.name ?? missingLabel}
          </div>
          <div className="truncate text-xs" style={{ color: "var(--df-text-dimmed)" }}>
            {option?.subtitle ?? missingLabel}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConnectionCombobox({
  value,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  missingSelectionLabel,
  clearLabel,
  onChange,
}: {
  value: string;
  options: ConnectionOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  missingSelectionLabel: string;
  clearLabel?: string;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const selected = options.find((option) => option.connection.id === value);
  const displayLabel = selected
    ? selected.connection.name
    : value
      ? missingSelectionLabel
      : placeholder;
  const displaySubtitle = selected?.subtitle ?? "";
  const groupedOptions = useMemo<ConnectionOptionGroup[]>(() => {
    const groups = new Map<string, ConnectionOption[]>();

    for (const option of options) {
      const groupKey = option.groupPath || "__ungrouped__";
      const existing = groups.get(groupKey);
      if (existing) {
        existing.push(option);
      } else {
        groups.set(groupKey, [option]);
      }
    }

    return [...groups.entries()].map(([groupKey, groupOptions]) => ({
      id: groupKey,
      label: groupKey === "__ungrouped__" ? t("network.ungroupedConnections") : groupKey,
      options: groupOptions,
    }));
  }, [options, t]);

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-auto min-h-10 w-full justify-between px-3 py-2 font-normal"
        >
          <div className="min-w-0 text-left">
            <div
              className={cn(
                "truncate text-sm",
                !selected && !value ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {displayLabel}
            </div>
            {(selected || value) && (
              <div className="truncate text-xs text-muted-foreground">
                {displaySubtitle || missingSelectionLabel}
              </div>
            )}
          </div>
          <ChevronsUpDownIcon className="ml-3 shrink-0 text-sm text-muted-foreground opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        collisionPadding={16}
        className="w-[min(32rem,calc(100vw-2rem))] p-0"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="terminal-scroll max-h-72 overscroll-contain">
            <CommandEmpty>{emptyText}</CommandEmpty>
            {clearLabel ? (
              <CommandGroup className="p-0">
                <CommandItem
                  value={clearLabel}
                  className="items-start gap-3 px-3 py-2"
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{clearLabel}</div>
                  </div>
                  {!value ? <MdCheck className="mt-0.5 text-sm text-primary" /> : null}
                </CommandItem>
              </CommandGroup>
            ) : null}
            {groupedOptions.map((group) => (
              <CommandGroup
                key={group.id}
                value={group.id}
                heading={
                  <SelectGroup>
                    <SelectLabel className="truncate px-3 py-2 text-[0.6875rem] uppercase tracking-[0.08em]">
                      {group.label}
                    </SelectLabel>
                  </SelectGroup>
                }
                className="p-0 [&_[cmdk-group-heading]]:p-0"
              >
                {group.options.map((option) => (
                  <CommandItem
                    key={option.connection.id}
                    value={`${option.connection.name} ${option.searchText}`}
                    className="items-start gap-3 px-3 py-2"
                    disabled={!!option.disabled && option.connection.id !== value}
                    onSelect={() => {
                      if (option.disabled && option.connection.id !== value) {
                        return;
                      }
                      onChange(option.connection.id);
                      setOpen(false);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{option.connection.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {option.subtitle}
                      </div>
                    </div>
                    {option.disabled && option.connection.id !== value ? (
                      <span className="pt-0.5 text-[0.625rem] text-muted-foreground">
                        {option.disabledReason ?? t("network.alreadyConfigured")}
                      </span>
                    ) : null}
                    {option.connection.id === value ? (
                      <MdCheck className="mt-0.5 text-sm text-primary" />
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
