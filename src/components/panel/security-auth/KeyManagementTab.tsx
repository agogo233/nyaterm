import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Eye, EyeOff, KeyRound } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { invoke } from "@/lib/invoke";
import type { SshKey } from "@/types/global";
import { CopyButton } from "./CopyButton";
import { SecretUnlockFooter } from "./SecretUnlockFooter";

interface KeyManagementTabProps {
  onCountChange?: (count: number) => void;
  secretsUnlocked?: boolean;
  onLockSecrets?: () => void;
  onUnlockSecrets?: () => void;
}

interface KeyEditorProps {
  editCertFileName: string;
  editHasCertData: boolean;
  editHasKeyData: boolean;
  editKeyFileName: string;
  editName: string;
  editPassphrase: string;
  editShowPassphrase: boolean;
  isEditing: boolean;
  passphraseLoading: boolean;
  onCancel: () => void;
  onNameChange: (value: string) => void;
  onPassphraseChange: (value: string) => void;
  onPickCertFile: () => Promise<void>;
  onPickFile: () => Promise<void>;
  onSave: () => void;
  onTogglePassphrase: () => void;
  saveDisabled: boolean;
  t: ReturnType<typeof useTranslation>["t"];
}

function KeyEditor({
  editCertFileName,
  editHasCertData,
  editHasKeyData,
  editKeyFileName,
  editName,
  editPassphrase,
  editShowPassphrase,
  isEditing,
  passphraseLoading,
  onCancel,
  onNameChange,
  onPassphraseChange,
  onPickCertFile,
  onPickFile,
  onSave,
  onTogglePassphrase,
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
      <div className="flex items-center w-full rounded-md border overflow-hidden bg-transparent">
        <div
          className={`flex-1 truncate px-3 py-2 text-xs ${editCertFileName || (isEditing && editHasCertData) ? "text-foreground" : "text-muted-foreground opacity-50"}`}
        >
          {editCertFileName ||
            (isEditing && editHasCertData
              ? t("settings.certFileLoaded")
              : t("settings.selectCertFile"))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto rounded-none border-l px-3 py-2"
          onClick={() => {
            void onPickCertFile();
          }}
        >
          <MdFolderOpen className="text-base" />
        </Button>
      </div>
      <div className="relative">
        <Input
          type={editShowPassphrase ? "text" : "password"}
          placeholder={passphraseLoading ? t("common.loading") : t("settings.passphrase")}
          className="h-8 pr-8 text-xs"
          value={editPassphrase}
          onChange={(event) => onPassphraseChange(event.target.value)}
          disabled={passphraseLoading}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-0.5 right-0.5 h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={onTogglePassphrase}
          disabled={passphraseLoading}
          aria-label={
            editShowPassphrase ? t("settings.hidePassphrase") : t("settings.showPassphrase")
          }
        >
          {editShowPassphrase ? (
            <EyeOff className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
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

export function KeyManagementTab({
  onCountChange,
  secretsUnlocked = false,
  onLockSecrets,
  onUnlockSecrets,
}: KeyManagementTabProps) {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<SshKey[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCertFilePath, setEditCertFilePath] = useState("");
  const [editCertFileName, setEditCertFileName] = useState("");
  const [editKeyFilePath, setEditKeyFilePath] = useState("");
  const [editKeyFileName, setEditKeyFileName] = useState("");
  const [editPassphrase, setEditPassphrase] = useState("");
  const [editPassphraseLoaded, setEditPassphraseLoaded] = useState(false);
  const [editShowPassphrase, setEditShowPassphrase] = useState(false);
  const [editHasCertData, setEditHasCertData] = useState(false);
  const [editHasKeyData, setEditHasKeyData] = useState(false);
  const [passphraseLoading, setPassphraseLoading] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [deletingKey, setDeletingKey] = useState<SshKey | null>(null);
  const [privateKeyEntry, setPrivateKeyEntry] = useState<SshKey | null>(null);
  const [privateKeyValue, setPrivateKeyValue] = useState("");
  const [privateKeyLoading, setPrivateKeyLoading] = useState(false);
  const [privateKeyError, setPrivateKeyError] = useState(false);
  const [unlockRequestNonce, setUnlockRequestNonce] = useState(0);
  const editRequestRef = useRef(0);
  const pendingUnlockedActionRef = useRef<(() => void | Promise<void>) | null>(null);

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

  useEffect(() => {
    if (!secretsUnlocked) {
      if (editingId !== "__new__" && editPassphraseLoaded) {
        setEditPassphrase("");
        setEditPassphraseLoaded(false);
      }
      setEditShowPassphrase(false);
      setPrivateKeyEntry(null);
      setPrivateKeyValue("");
      setPrivateKeyError(false);
      setPrivateKeyLoading(false);
    }
  }, [editPassphraseLoaded, editingId, secretsUnlocked]);

  const resetEdit = () => {
    editRequestRef.current += 1;
    setEditingId(null);
    setEditName("");
    setEditCertFilePath("");
    setEditCertFileName("");
    setEditKeyFilePath("");
    setEditKeyFileName("");
    setEditPassphrase("");
    setEditPassphraseLoaded(false);
    setEditShowPassphrase(false);
    setEditHasCertData(false);
    setEditHasKeyData(false);
    setPassphraseLoading(false);
    setIsNew(false);
  };

  const handleAdd = () => {
    resetEdit();
    setEditingId("__new__");
    setIsNew(true);
  };

  const loadEditPassphrase = useCallback(async (id: string, requestId = editRequestRef.current) => {
    setPassphraseLoading(true);
    try {
      const passphrase = await invoke<string | null>("get_ssh_key_passphrase", { id });
      if (editRequestRef.current !== requestId) return;
      setEditPassphrase(passphrase ?? "");
      setEditPassphraseLoaded(true);
    } catch {
      if (editRequestRef.current !== requestId) return;
      setEditPassphrase("");
      setEditPassphraseLoaded(true);
    } finally {
      if (editRequestRef.current === requestId) {
        setPassphraseLoading(false);
      }
    }
  }, []);

  const handleEdit = async (key: SshKey) => {
    const requestId = ++editRequestRef.current;
    setEditingId(key.id);
    setEditName(key.name);
    setEditCertFilePath("");
    setEditCertFileName("");
    setEditKeyFilePath("");
    setEditKeyFileName("");
    setEditPassphrase("");
    setEditPassphraseLoaded(false);
    setEditShowPassphrase(false);
    setEditHasCertData(key.has_cert_data || false);
    setEditHasKeyData(key.has_key_data || false);
    setPassphraseLoading(false);
    setIsNew(false);

    if (secretsUnlocked) {
      await loadEditPassphrase(key.id, requestId);
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
          cert_file_path: editCertFilePath || undefined,
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

  const runUnlockedAction = useCallback(
    (action: () => void | Promise<void>) => {
      if (secretsUnlocked) {
        void action();
        return;
      }

      pendingUnlockedActionRef.current = action;
      setUnlockRequestNonce((value) => value + 1);
    },
    [secretsUnlocked],
  );

  const handleSecretsUnlocked = useCallback(() => {
    onUnlockSecrets?.();
    const pendingAction = pendingUnlockedActionRef.current;
    pendingUnlockedActionRef.current = null;
    if (pendingAction) {
      window.setTimeout(() => {
        void pendingAction();
      }, 0);
    }
  }, [onUnlockSecrets]);

  const handleTogglePassphrase = useCallback(() => {
    if (!isNew && editingId && !secretsUnlocked && !editPassphrase) {
      const targetId = editingId;
      const requestId = editRequestRef.current;
      runUnlockedAction(async () => {
        await loadEditPassphrase(targetId, requestId);
        if (editRequestRef.current === requestId) {
          setEditShowPassphrase(true);
        }
      });
      return;
    }

    setEditShowPassphrase((value) => !value);
  }, [editPassphrase, editingId, isNew, loadEditPassphrase, runUnlockedAction, secretsUnlocked]);

  const handleViewPrivateKey = useCallback(async (key: SshKey) => {
    setPrivateKeyEntry(key);
    setPrivateKeyValue("");
    setPrivateKeyError(false);
    setPrivateKeyLoading(true);
    try {
      const value = await invoke<string | null>("get_ssh_key_private_key", { id: key.id });
      setPrivateKeyValue(value ?? "");
    } catch {
      setPrivateKeyError(true);
    } finally {
      setPrivateKeyLoading(false);
    }
  }, []);

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

  const handlePickCertFile = async () => {
    const selected = await openFileDialog({
      multiple: false,
      title: t("settings.selectCertFileTitle"),
    });
    if (selected) {
      setEditCertFilePath(selected);
      const parts = selected.replace(/\\/g, "/").split("/");
      setEditCertFileName(parts[parts.length - 1]);
      setEditHasCertData(false);
    }
  };

  const lockedHint = !secretsUnlocked ? t("secretUnlock.lockedActionHint") : undefined;
  const privateKeyDialogValue = privateKeyError
    ? t("settings.privateKeyLoadFailed")
    : privateKeyValue || (privateKeyLoading ? "" : t("settings.privateKeyEmpty"));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 terminal-scroll">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label className="min-w-0 text-sm font-medium">{t("settings.keyManagement")}</Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs text-primary"
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
                editCertFileName={editCertFileName}
                editHasCertData={editHasCertData}
                editHasKeyData={editHasKeyData}
                editKeyFileName={editKeyFileName}
                editName={editName}
                editPassphrase={editPassphrase}
                editShowPassphrase={editShowPassphrase}
                isEditing={false}
                passphraseLoading={passphraseLoading}
                onCancel={resetEdit}
                onNameChange={setEditName}
                onPassphraseChange={setEditPassphrase}
                onPickCertFile={handlePickCertFile}
                onPickFile={handlePickFile}
                onSave={handleSave}
                onTogglePassphrase={handleTogglePassphrase}
                saveDisabled={passphraseLoading || !editName.trim() || !editKeyFilePath}
                t={t}
              />
            )}

            {/* Existing keys */}
            {keys.map((key) => (
              <div key={key.id}>
                {editingId === key.id && !isNew ? (
                  <KeyEditor
                    editCertFileName={editCertFileName}
                    editHasCertData={editHasCertData}
                    editHasKeyData={editHasKeyData}
                    editKeyFileName={editKeyFileName}
                    editName={editName}
                    editPassphrase={editPassphrase}
                    editShowPassphrase={editShowPassphrase}
                    isEditing={true}
                    passphraseLoading={passphraseLoading}
                    onCancel={resetEdit}
                    onNameChange={setEditName}
                    onPassphraseChange={(value) => {
                      setEditPassphrase(value);
                      setEditPassphraseLoaded(false);
                    }}
                    onPickCertFile={handlePickCertFile}
                    onPickFile={handlePickFile}
                    onSave={handleSave}
                    onTogglePassphrase={handleTogglePassphrase}
                    saveDisabled={passphraseLoading || !editName.trim()}
                    t={t}
                  />
                ) : (
                  <div className="security-auth-action-row flex flex-wrap items-start gap-2 border-b px-3 py-2.5 transition-colors last:border-0 hover:bg-accent">
                    <span className="min-w-24 flex-1 truncate text-xs leading-8">{key.name}</span>
                    <div className="security-auth-row-actions flex shrink-0 items-center">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => {
                                runUnlockedAction(() => handleViewPrivateKey(key));
                              }}
                              disabled={editingId !== null || privateKeyLoading}
                              aria-label={t("settings.viewPrivateKey")}
                            >
                              <KeyRound className="h-4 w-4" />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {lockedHint ?? t("settings.viewPrivateKey")}
                        </TooltipContent>
                      </Tooltip>
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
      </div>

      <SecretUnlockFooter
        unlocked={secretsUnlocked}
        onLock={onLockSecrets ?? (() => {})}
        onUnlocked={handleSecretsUnlocked}
        unlockRequestNonce={unlockRequestNonce}
      />

      <Dialog
        open={privateKeyEntry !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPrivateKeyEntry(null);
            setPrivateKeyValue("");
            setPrivateKeyError(false);
            setPrivateKeyLoading(false);
          }
        }}
      >
        <DialogContent className="w-[min(720px,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-5 py-3 pr-12">
            <DialogTitle className="text-sm">{t("settings.privateKeyDialogTitle")}</DialogTitle>
            <DialogDescription className="truncate">{privateKeyEntry?.name}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0">
            <div className="flex h-9 items-center justify-between gap-2 border-b px-5">
              <Label className="text-[0.6875rem] text-muted-foreground">
                {t("settings.privateKey")}
              </Label>
              {privateKeyValue ? <CopyButton value={privateKeyValue} /> : null}
            </div>
            <pre className="terminal-scroll max-h-[60vh] min-h-72 overflow-auto bg-muted/20 p-4 font-mono text-[0.6875rem] leading-5 text-muted-foreground whitespace-pre">
              {privateKeyLoading ? t("common.loading") : privateKeyDialogValue}
            </pre>
          </div>
        </DialogContent>
      </Dialog>

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
