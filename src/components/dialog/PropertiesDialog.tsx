import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MdFolder, MdInsertDriveFile, MdRefresh } from "react-icons/md";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export interface PropertiesDialogData {
  sessionId: string;
  fullPath: string;
  name: string;
  is_dir: boolean;
}

interface FileProperties {
  size: number;
  permissions: string;
  owner: string;
  group: string;
  uid: string;
  gid: string;
  mtime: number;
  atime: number;
}

interface PropertiesDialogProps {
  data: PropertiesDialogData;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  if (bytes < 1024) return `${bytes} Bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(unix: number): string {
  if (!unix) return "-";
  const d = new Date(unix * 1000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parsePermissionsToOctal(perms: string): string {
  if (!perms || perms.length < 10) return "0644";
  let special = 0,
    u = 0,
    g = 0,
    o = 0;
  const p = perms.split("");

  if (p[1] === "r") u |= 4;
  if (p[2] === "w") u |= 2;
  if (p[3] === "x") u |= 1;
  else if (p[3] === "s") {
    u |= 1;
    special |= 4;
  } else if (p[3] === "S") {
    special |= 4;
  }

  if (p[4] === "r") g |= 4;
  if (p[5] === "w") g |= 2;
  if (p[6] === "x") g |= 1;
  else if (p[6] === "s") {
    g |= 1;
    special |= 2;
  } else if (p[6] === "S") {
    special |= 2;
  }

  if (p[7] === "r") o |= 4;
  if (p[8] === "w") o |= 2;
  if (p[9] === "x") o |= 1;
  else if (p[9] === "t") {
    o |= 1;
    special |= 1;
  } else if (p[9] === "T") {
    special |= 1;
  }

  return `${special}${u}${g}${o}`;
}

export default function PropertiesDialog({ data, onClose }: PropertiesDialogProps) {
  const { t } = useTranslation();
  const [properties, setProperties] = useState<FileProperties | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [octal, setOctal] = useState<string>("0644");
  const [isSaving, setIsSaving] = useState(false);
  const initialOctal = properties ? parsePermissionsToOctal(properties.permissions) : "0644";

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    invoke("get_file_properties", {
      sessionId: data.sessionId,
      path: data.fullPath,
    })
      .then((props: any) => {
        if (isMounted) {
          setProperties(props);
          setOctal(parsePermissionsToOctal(props.permissions));
        }
      })
      .catch((e) => {
        if (isMounted) setError(String(e));
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [data.sessionId, data.fullPath]);

  const handleSave = async () => {
    if (octal === initialOctal) {
      onClose();
      return;
    }
    setIsSaving(true);
    try {
      await invoke("chmod_remote_file", {
        sessionId: data.sessionId,
        path: data.fullPath,
        mode: octal,
      });
      onClose();
    } catch (e) {
      alert(String(e));
    } finally {
      setIsSaving(false);
    }
  };

  const updateBit = (index: number, bit: number, checked: boolean) => {
    const chars = octal.split("");
    for (let i = 0; i < 4; i++) {
      if (!chars[i]) chars[i] = "0";
    }
    let val = parseInt(chars[index], 8);
    if (isNaN(val)) val = 0;
    if (checked) val |= bit;
    else val &= ~bit;
    chars[index] = val.toString(8);
    setOctal(chars.join(""));
  };

  const hasBit = (index: number, bit: number) => {
    const val = parseInt(octal[index] || "0", 8);
    return (val & bit) === bit;
  };

  const getFileType = () => {
    if (data.is_dir) return t("fileExplorer.folder", "Folder");
    const ext = data.name.split(".").pop()?.toLowerCase();
    if (ext === "sh" || ext === "bash") return t("fileExplorer.shellScript", "Shell Script");
    return t("fileExplorer.file", "File");
  };

  const getLocation = () => {
    const idx = data.fullPath.lastIndexOf("/");
    if (idx <= 0) return "/";
    return data.fullPath.substring(0, idx + 1);
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !isSaving && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[420px] sm:max-w-[420px] p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-5 py-3 border-b">
          <DialogTitle className="text-sm flex items-center gap-2">
            {data.is_dir ? (
              <MdFolder className="text-lg" style={{ color: "#eab308" }} />
            ) : (
              <MdInsertDriveFile className="text-lg" style={{ color: "var(--df-primary)" }} />
            )}
            <span className="truncate max-w-[300px]" title={data.name}>
              {t("fileExplorer.propertiesOf", { name: data.name })}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Body */}
        <div className="p-5 overflow-y-auto max-h-[75vh] space-y-5 relative min-h-[250px]">
          {loading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center space-y-2 text-muted-foreground">
              <MdRefresh className="animate-spin text-3xl" />
              <span className="text-xs">{t("fileExplorer.loading", "Loading...")}</span>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex items-center justify-center text-destructive text-xs px-5 text-center">
              {error}
            </div>
          ) : properties ? (
            <>
              {/* General Information */}
              <div>
                <h3 className="text-xs font-semibold mb-3 tracking-wider uppercase text-muted-foreground">
                  {t("fileExplorer.general", "General")}
                </h3>
                <div className="space-y-2.5 text-xs text-left">
                  {[
                    [t("fileExplorer.type", "Type"), getFileType()],
                    [
                      t("fileExplorer.location", "Location"),
                      <span
                        key="loc"
                        className="truncate break-all select-all font-mono"
                        title={getLocation()}
                      >
                        {getLocation()}
                      </span>,
                    ],
                    [t("fileExplorer.size", "Size"), formatSize(properties.size)],
                    [
                      t("fileExplorer.mtime", "Modified"),
                      <span key="mt" className="font-mono">
                        {formatTime(properties.mtime)}
                      </span>,
                    ],
                    [
                      t("fileExplorer.atime", "Accessed"),
                      <span key="at" className="font-mono">
                        {formatTime(properties.atime)}
                      </span>,
                    ],
                    [
                      t("fileExplorer.owner", "Owner"),
                      <span key="ow">
                        {properties.owner}{" "}
                        <span className="font-mono opacity-70">[{properties.uid}]</span>
                      </span>,
                    ],
                    [
                      t("fileExplorer.group", "Group"),
                      <span key="gr">
                        {properties.group}{" "}
                        <span className="font-mono opacity-70">[{properties.gid}]</span>
                      </span>,
                    ],
                  ].map(([label, value], i) => (
                    <div key={i} className="flex items-start">
                      <span className="w-24 shrink-0 text-muted-foreground">{label}:</span>
                      <span>{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t" />

              {/* Permissions */}
              <div>
                <h3 className="text-xs font-semibold mb-3 tracking-wider uppercase text-muted-foreground">
                  {t("fileExplorer.permissions", "Permissions")}
                </h3>
                <div className="rounded-md border overflow-hidden bg-background">
                  <table className="w-full text-xs text-left select-none">
                    <thead className="bg-muted text-muted-foreground">
                      <tr>
                        <th className="font-normal px-3 py-2 w-16"></th>
                        <th className="font-normal px-2 py-2 text-center w-14">R</th>
                        <th className="font-normal px-2 py-2 text-center w-14">W</th>
                        <th className="font-normal px-2 py-2 text-center w-14">X</th>
                        <th className="font-normal px-2 py-2 text-center">
                          {t("fileExplorer.special", "Special")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        {
                          label: t("fileExplorer.permUser", "User"),
                          idx: 1,
                          sIdx: 0,
                          sBit: 4,
                          sLabel: "UID",
                          alt: true,
                        },
                        {
                          label: t("fileExplorer.permGroup", "Group"),
                          idx: 2,
                          sIdx: 0,
                          sBit: 2,
                          sLabel: "GID",
                          alt: false,
                        },
                        {
                          label: t("fileExplorer.permOther", "Other"),
                          idx: 3,
                          sIdx: 0,
                          sBit: 1,
                          sLabel: t("fileExplorer.permSticky", "Sticky"),
                          alt: true,
                        },
                      ].map((row) => (
                        <tr key={row.idx} className={`border-t ${row.alt ? "bg-muted/30" : ""}`}>
                          <td className="px-3 py-2 text-muted-foreground">{row.label}</td>
                          <td className="px-2 py-2 text-center">
                            <input
                              type="checkbox"
                              className="accent-primary cursor-pointer"
                              checked={hasBit(row.idx, 4)}
                              onChange={(e) => updateBit(row.idx, 4, e.target.checked)}
                            />
                          </td>
                          <td className="px-2 py-2 text-center">
                            <input
                              type="checkbox"
                              className="accent-primary cursor-pointer"
                              checked={hasBit(row.idx, 2)}
                              onChange={(e) => updateBit(row.idx, 2, e.target.checked)}
                            />
                          </td>
                          <td className="px-2 py-2 text-center">
                            <input
                              type="checkbox"
                              className="accent-primary cursor-pointer"
                              checked={hasBit(row.idx, 1)}
                              onChange={(e) => updateBit(row.idx, 1, e.target.checked)}
                            />
                          </td>
                          <td className="px-2 py-2 text-center">
                            <label className="flex items-center justify-center gap-1.5 cursor-pointer text-[10px]">
                              <input
                                type="checkbox"
                                className="accent-primary cursor-pointer"
                                checked={hasBit(row.sIdx, row.sBit)}
                                onChange={(e) => updateBit(row.sIdx, row.sBit, e.target.checked)}
                              />
                              {row.sLabel}
                            </label>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between mt-4">
                  <span className="text-xs text-muted-foreground">
                    {t("fileExplorer.octal", "Octal Mode")}:
                  </span>
                  <div className="flex items-center">
                    <span className="text-xs font-mono mr-2 opacity-50">0</span>
                    <Input
                      className="w-[60px] text-center font-mono text-xs h-7"
                      style={{ letterSpacing: "2px" }}
                      value={octal.substring(1)}
                      onChange={(e) => {
                        let val = e.target.value.replace(/[^0-7]/g, "");
                        if (val.length > 3) val = val.substring(0, 3);
                        setOctal(octal[0] + val.padStart(3, "0"));
                      }}
                    />
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <DialogFooter className="px-5 py-3 border-t">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={onClose}
            disabled={isSaving}
          >
            {t("dialog.cancel", "Cancel")}
          </Button>
          <Button
            size="sm"
            className="text-xs"
            onClick={handleSave}
            disabled={isSaving || loading || !!error}
          >
            {isSaving && <MdRefresh className="text-[14px] animate-spin" />}
            {t("dialog.save", "Save Changes")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
