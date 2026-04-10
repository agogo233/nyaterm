import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MdAdd, MdDelete, MdEdit, MdFolderOpen } from "react-icons/md";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SshKey } from "@/types/global";

interface KeyManagementTabProps {
  onCountChange?: (count: number) => void;
}

interface KeyEditorProps {
  editHasKeyData: boolean;
  editKeyFileName: string;
  editName: string;
  editPassphrase: string;
  isEditing: boolean;
  passphraseLoading: boolean;
  onCancel: () => void;
  onNameChange: (value: string) => void;
  onPassphraseChange: (value: string) => void;
  onPickFile: () => Promise<void>;
  onSave: () => void;
  saveDisabled: boolean;
  t: ReturnType<typeof useTranslation>["t"];
}

function KeyEditor({
  editHasKeyData,
  editKeyFileName,
  editName,
  editPassphrase,
  isEditing,
  passphraseLoading,
  onCancel,
  onNameChange,
  onPassphraseChange,
  onPickFile,
  onSave,
  saveDisabled,
  t,
}: KeyEditorProps) {
  return (
    <div className="space-y-2.5 border-b bg-accent/30 p-3">
      <Input
        placeholder={t("settings.keyNamePlaceholder")}
        className="h-8 text-xs"
        value={editName}
        onChange={(event) => onNameChange(event.target.value)}
        autoFocus
      />
      <div className="flex items-center w-full rounded-md border overflow-hidden bg-transparent">
        <div
          className={`flex-1 truncate px-3 py-2 text-xs ${editKeyFileName || (isEditing && editHasKeyData) ? "text-foreground" : "text-muted-foreground opacity-50"}`}
        >
          {editKeyFileName ||
            (isEditing && editHasKeyData
              ? t("settings.keyFileLoaded")
              : t("settings.selectKeyFile"))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto rounded-none border-l px-3 py-2"
          onClick={() => {
            void onPickFile();
          }}
        >
          <MdFolderOpen className="text-base" />
        </Button>
      </div>
      <Input
        type="password"
        placeholder={passphraseLoading ? t("common.loading") : t("settings.passphrase")}
        className="h-8 text-xs"
        value={editPassphrase}
        onChange={(event) => onPassphraseChange(event.target.value)}
        disabled={passphraseLoading}
      />
      <div className="flex justify-end gap-1.5 pt-0.5">
        <Button variant="outline" size="sm" className="h-7 px-3 text-xs" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" className="h-7 px-3 text-xs" onClick={onSave} disabled={saveDisabled}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

export function KeyManagementTab({ onCountChange }: KeyManagementTabProps) {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<SshKey[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editKeyFilePath, setEditKeyFilePath] = useState("");
  const [editKeyFileName, setEditKeyFileName] = useState("");
  const [editPassphrase, setEditPassphrase] = useState("");
  const [editHasKeyData, setEditHasKeyData] = useState(false);
  const [passphraseLoading, setPassphraseLoading] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [deletingKey, setDeletingKey] = useState<SshKey | null>(null);
  const editRequestRef = useRef(0);

  const loadKeys = useCallback(async () => {
    try {
      const result = await invoke<SshKey[]>("get_ssh_keys");
      setKeys(result);
      onCountChange?.(result.length);
    } catch {
      /* ignore */
    }
  }, [onCountChange]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const resetEdit = () => {
    editRequestRef.current += 1;
    setEditingId(null);
    setEditName("");
    setEditKeyFilePath("");
    setEditKeyFileName("");
    setEditPassphrase("");
    setEditHasKeyData(false);
    setPassphraseLoading(false);
    setIsNew(false);
  };

  const handleAdd = () => {
    resetEdit();
    setEditingId("__new__");
    setIsNew(true);
  };

  const handleEdit = async (key: SshKey) => {
    const requestId = ++editRequestRef.current;
    setEditingId(key.id);
    setEditName(key.name);
    setEditKeyFilePath("");
    setEditKeyFileName("");
    setEditPassphrase("");
    setEditHasKeyData(key.has_key_data || false);
    setPassphraseLoading(true);
    setIsNew(false);

    try {
      const passphrase = await invoke<string | null>("get_ssh_key_passphrase", { id: key.id });
      if (editRequestRef.current !== requestId) return;
      setEditPassphrase(passphrase ?? "");
    } catch {
      if (editRequestRef.current !== requestId) return;
      setEditPassphrase("");
    } finally {
      if (editRequestRef.current === requestId) {
        setPassphraseLoading(false);
      }
    }
  };

  const handleSave = async () => {
    if (!editName.trim()) return;
    if (isNew && !editKeyFilePath) return;
    try {
      await invoke("save_ssh_key", {
        key: {
          id: isNew ? "" : editingId,
          name: editName.trim(),
          key_file_path: editKeyFilePath || undefined,
          passphrase: editPassphrase || undefined,
        },
      });
      resetEdit();
      await loadKeys();
    } catch {
      /* ignore */
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingKey) return;
    try {
      await invoke("delete_ssh_key", { id: deletingKey.id });
      await loadKeys();
    } catch {
      /* ignore */
    }
    setDeletingKey(null);
  };

  const handlePickFile = async () => {
    const selected = await openFileDialog({
      multiple: false,
      title: t("settings.selectKeyFileTitle"),
    });
    if (selected) {
      setEditKeyFilePath(selected);
      const parts = selected.replace(/\\/g, "/").split("/");
      setEditKeyFileName(parts[parts.length - 1]);
      setEditHasKeyData(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="font-medium text-sm">{t("settings.keyManagement")}</Label>
          <Button
            variant="ghost"
            size="sm"
            className="text-primary h-7 px-2 text-xs"
            onClick={handleAdd}
            disabled={editingId !== null}
          >
            <MdAdd className="text-base mr-1" /> {t("settings.addKey")}
          </Button>
        </div>

        <div className="border rounded-md overflow-hidden">
          {/* Inline form for new key */}
          {isNew && editingId === "__new__" && (
            <KeyEditor
              editHasKeyData={editHasKeyData}
              editKeyFileName={editKeyFileName}
              editName={editName}
              editPassphrase={editPassphrase}
              isEditing={false}
              passphraseLoading={passphraseLoading}
              onCancel={resetEdit}
              onNameChange={setEditName}
              onPassphraseChange={setEditPassphrase}
              onPickFile={handlePickFile}
              onSave={handleSave}
              saveDisabled={passphraseLoading || !editName.trim() || !editKeyFilePath}
              t={t}
            />
          )}

          {/* Existing keys */}
          {keys.map((key) => (
            <div key={key.id}>
              {editingId === key.id && !isNew ? (
                <KeyEditor
                  editHasKeyData={editHasKeyData}
                  editKeyFileName={editKeyFileName}
                  editName={editName}
                  editPassphrase={editPassphrase}
                  isEditing={true}
                  passphraseLoading={passphraseLoading}
                  onCancel={resetEdit}
                  onNameChange={setEditName}
                  onPassphraseChange={setEditPassphrase}
                  onPickFile={handlePickFile}
                  onSave={handleSave}
                  saveDisabled={passphraseLoading || !editName.trim()}
                  t={t}
                />
              ) : (
                <div className="flex items-center gap-2 px-3 py-2.5 border-b last:border-0 hover:bg-accent transition-colors">
                  <span className="flex-1 text-xs truncate">{key.name}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      void handleEdit(key);
                    }}
                    disabled={editingId !== null}
                  >
                    <MdEdit className="text-base" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => setDeletingKey(key)}
                    disabled={editingId !== null}
                  >
                    <MdDelete className="text-base" />
                  </Button>
                </div>
              )}
            </div>
          ))}

          {keys.length === 0 && !isNew && (
            <div className="text-center py-6 text-xs text-muted-foreground">
              {t("settings.noKeys")}
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={deletingKey !== null} onOpenChange={(v) => !v && setDeletingKey(null)}>
        <DialogContent showCloseButton={false} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("settings.deleteKey")}</DialogTitle>
            <DialogDescription>
              {t("settings.deleteKeyConfirm", { name: deletingKey?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingKey(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm}>
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
