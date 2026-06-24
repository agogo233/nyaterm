import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MdEdit, MdRefresh, MdSearch } from "react-icons/md";
import { toast } from "sonner";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useApp } from "@/context/AppContext";
import {
  formatIndexedKeysForDisplay,
  formatKeysForDisplay,
  isValidIndexedShortcutTemplate,
  keyEventToHotkeyString,
  resolveKeys,
  SHORTCUT_CATEGORIES,
  SHORTCUT_REGISTRY,
  type ShortcutCategory,
  type ShortcutDefinition,
} from "@/lib/shortcutRegistry";
import { SettingSection } from "./SettingFormItems";

export function KeyboardShortcutsTab() {
  const { t } = useTranslation();
  const { appSettings, updateAppSettings } = useApp();
  const overrides = appSettings.keybindings;
  const [search, setSearch] = useState("");
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [pendingKeys, setPendingKeys] = useState<string | null>(null);
  const recorderRef = useRef<HTMLDivElement>(null);

  const resolvedShortcuts = useMemo(() => {
    return SHORTCUT_REGISTRY.map((def) => {
      const keys = resolveKeys(def.id, overrides);
      return {
        ...def,
        keys,
        displayKeys:
          def.id === "tab.switchTo"
            ? formatIndexedKeysForDisplay(keys)
            : formatKeysForDisplay(keys),
        isCustom: def.id in overrides,
      };
    });
  }, [overrides]);

  const findConflict = useCallback(
    (hotkeyString: string, excludeId: string) => {
      if (!hotkeyString) return null;
      const normalizedNew = hotkeyString
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      for (const sc of resolvedShortcuts) {
        if (sc.id === excludeId) continue;
        const normalizedExisting = sc.keys
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        for (const n of normalizedNew) {
          if (normalizedExisting.includes(n)) {
            return sc;
          }
        }
      }
      return null;
    },
    [resolvedShortcuts],
  );

  const conflict = useMemo(() => {
    if (!recordingId || !pendingKeys) return null;
    return findConflict(pendingKeys, recordingId);
  }, [recordingId, pendingKeys, findConflict]);

  const filteredByCategory = useMemo(() => {
    const lowerSearch = search.toLowerCase().trim();
    const grouped: Record<ShortcutCategory, typeof resolvedShortcuts> = {
      terminal: [],
      tab: [],
      view: [],
      fileExplorer: [],
      savedConnections: [],
      special: [],
    };

    for (const sc of resolvedShortcuts) {
      if (lowerSearch) {
        const label = t(sc.labelKey).toLowerCase();
        const keys = sc.displayKeys.toLowerCase();
        if (
          !label.includes(lowerSearch) &&
          !keys.includes(lowerSearch) &&
          !sc.id.toLowerCase().includes(lowerSearch)
        ) {
          continue;
        }
      }
      grouped[sc.category].push(sc);
    }
    return grouped;
  }, [resolvedShortcuts, search, t]);

  const handleStartRecording = (id: string) => {
    setRecordingId(id);
    setPendingKeys(null);
  };

  const handleCancelRecording = useCallback(() => {
    setRecordingId(null);
    setPendingKeys(null);
  }, []);

  const handleConfirmRecording = useCallback(() => {
    if (!recordingId || !pendingKeys) {
      handleCancelRecording();
      return;
    }
    const def = SHORTCUT_REGISTRY.find((d) => d.id === recordingId);
    const isDefault = def && pendingKeys === def.defaultKeys;
    const next = { ...overrides };
    if (isDefault) {
      delete next[recordingId];
    } else {
      next[recordingId] = pendingKeys;
    }
    updateAppSettings({ keybindings: next });
    setRecordingId(null);
    setPendingKeys(null);
  }, [recordingId, pendingKeys, overrides, updateAppSettings, handleCancelRecording]);

  const handleReset = (id: string) => {
    const next = { ...overrides };
    delete next[id];
    updateAppSettings({ keybindings: next });
  };

  const handleResetAll = () => {
    updateAppSettings({ keybindings: {} });
  };

  const handleIndexedShortcutCapture = useCallback(
    (combo: string) => {
      if (isValidIndexedShortcutTemplate(combo)) {
        const next = { ...overrides, "tab.switchTo": combo };
        updateAppSettings({ keybindings: next });
      } else {
        const next = { ...overrides };
        delete next["tab.switchTo"];
        updateAppSettings({ keybindings: next });
        toast.error(t("settings.keybindingsIndexedInvalid"));
      }
      setRecordingId(null);
      setPendingKeys(null);
    },
    [overrides, updateAppSettings, t],
  );

  useEffect(() => {
    if (!recordingId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        handleCancelRecording();
        return;
      }
      if (e.key === "Enter" && pendingKeys) {
        handleConfirmRecording();
        return;
      }

      const combo = keyEventToHotkeyString(e);
      if (combo) {
        if (recordingId === "tab.switchTo") {
          handleIndexedShortcutCapture(combo);
        } else {
          setPendingKeys(combo);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    recordingId,
    pendingKeys,
    handleCancelRecording,
    handleConfirmRecording,
    handleIndexedShortcutCapture,
  ]);

  useEffect(() => {
    if (!recordingId) return;
    const handleClick = (e: MouseEvent) => {
      if (recorderRef.current && !recorderRef.current.contains(e.target as Node)) {
        if (pendingKeys) {
          handleConfirmRecording();
        } else {
          handleCancelRecording();
        }
      }
    };
    window.addEventListener("mousedown", handleClick, true);
    return () => window.removeEventListener("mousedown", handleClick, true);
  }, [recordingId, pendingKeys, handleCancelRecording, handleConfirmRecording]);

  const hasAnyCustom = Object.keys(overrides).length > 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("settings.keybindingsSearch")}
            className="h-9 w-full rounded-lg border border-border/70 bg-background pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
          />
        </div>
        {hasAnyCustom && (
          <button
            type="button"
            onClick={handleResetAll}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border/70 bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MdRefresh className="text-sm" />
            {t("settings.keybindingsResetAll")}
          </button>
        )}
      </div>

      {SHORTCUT_CATEGORIES.map((cat) => {
        const items = filteredByCategory[cat.key];
        if (!items || items.length === 0) return null;

        return (
          <SettingSection key={cat.key} title={t(cat.labelKey)} contentClassName="space-y-0">
            <div className="divide-y divide-border/40">
              {items.map((sc) => (
                <ShortcutRow
                  key={sc.id}
                  shortcut={sc}
                  isRecording={recordingId === sc.id}
                  pendingKeys={recordingId === sc.id ? pendingKeys : null}
                  conflict={recordingId === sc.id ? conflict : null}
                  onStartRecording={handleStartRecording}
                  onConfirmRecording={handleConfirmRecording}
                  onCancelRecording={handleCancelRecording}
                  onReset={handleReset}
                  recorderRef={recordingId === sc.id ? recorderRef : undefined}
                  t={t}
                />
              ))}
            </div>
          </SettingSection>
        );
      })}
    </div>
  );
}

interface ShortcutRowProps {
  shortcut: ShortcutDefinition & {
    keys: string;
    displayKeys: string;
    isCustom: boolean;
  };
  isRecording: boolean;
  pendingKeys: string | null;
  conflict: (ShortcutDefinition & { keys: string; displayKeys: string }) | null;
  onStartRecording: (id: string) => void;
  onConfirmRecording: () => void;
  onCancelRecording: () => void;
  onReset: (id: string) => void;
  recorderRef?: React.Ref<HTMLDivElement>;
  t: (key: string, opts?: Record<string, string>) => string;
}

function ShortcutRow({
  shortcut,
  isRecording,
  pendingKeys,
  conflict,
  onStartRecording,
  onConfirmRecording,
  onCancelRecording,
  onReset,
  recorderRef,
  t,
}: ShortcutRowProps) {
  const keysToDisplay = pendingKeys
    ? shortcut.id === "tab.switchTo"
      ? formatIndexedKeysForDisplay(pendingKeys)
      : formatKeysForDisplay(pendingKeys)
    : shortcut.displayKeys;
  const keyParts = keysToDisplay.split("+").filter(Boolean);

  return (
    <div
      ref={recorderRef}
      className={`flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between transition-colors ${
        isRecording && shortcut.id === "tab.switchTo" ? "sm:flex-wrap" : ""
      } ${isRecording ? "bg-primary/5 ring-1 ring-inset ring-primary/20 rounded-lg" : ""}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm text-foreground truncate">{t(shortcut.labelKey)}</span>
        {shortcut.isCustom && !isRecording && (
          <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {t("settings.keybindingsCustom")}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 sm:justify-end">
        {isRecording ? (
          <div className="flex items-center gap-2">
            {pendingKeys ? (
              <div className="flex items-center gap-1.5">
                <KbdGroup className="flex-wrap">
                  {keyParts.map((key, i) => (
                    <React.Fragment key={`${shortcut.id}-rec-${key}`}>
                      <Kbd className={conflict ? "bg-destructive/15 text-destructive" : ""}>
                        {key.trim()}
                      </Kbd>
                      {i < keyParts.length - 1 && <span className="text-muted-foreground">+</span>}
                    </React.Fragment>
                  ))}
                </KbdGroup>
                {conflict && (
                  <span className="text-xs text-destructive whitespace-nowrap">
                    {t("settings.keybindingsConflict", { name: t(conflict.labelKey) })}
                  </span>
                )}
              </div>
            ) : (
              <span className="animate-pulse text-xs text-muted-foreground">
                {t("settings.keybindingsRecording")}
              </span>
            )}
            <div className="flex gap-1">
              {pendingKeys && (
                <button
                  type="button"
                  onClick={onConfirmRecording}
                  className="rounded px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                >
                  {t("common.confirm")}
                </button>
              )}
              <button
                type="button"
                onClick={onCancelRecording}
                className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <KbdGroup className="flex-wrap sm:justify-end">
              {keyParts.map((key, i) => (
                <React.Fragment key={`${shortcut.id}-${key}`}>
                  <Kbd>{key.trim()}</Kbd>
                  {i < keyParts.length - 1 && <span className="text-muted-foreground">+</span>}
                </React.Fragment>
              ))}
            </KbdGroup>
            <div className="flex gap-0.5">
              <button
                type="button"
                onClick={() => onStartRecording(shortcut.id)}
                className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={t("common.edit")}
              >
                <MdEdit className="text-sm" />
              </button>
              {shortcut.isCustom && (
                <button
                  type="button"
                  onClick={() => onReset(shortcut.id)}
                  className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title={t("settings.keybindingsReset")}
                >
                  <MdRefresh className="text-sm" />
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {isRecording && shortcut.id === "tab.switchTo" && (
        <p className="w-full text-xs text-muted-foreground">
          {t("settings.keybindingsIndexedHint")}
        </p>
      )}
    </div>
  );
}
