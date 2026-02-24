import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

export interface AutoUploadDialogData {
    sessionId: string;
    localPath: string;
    remotePath: string;
}

interface AutoUploadDialogProps {
    data: AutoUploadDialogData;
    onClose: () => void;
    onAlwaysUpload: (sessionId: string, localPath: string) => void;
}

export default function AutoUploadDialog({ data, onClose, onAlwaysUpload }: AutoUploadDialogProps) {
    const { t } = useTranslation();

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    const handleUpload = (always: boolean) => {
        if (always) {
            onAlwaysUpload(data.sessionId, data.localPath);
        }
        // Fire and forget — progress is tracked in FileTransfer panel
        invoke("upload_local_file", {
            sessionId: data.sessionId,
            localPath: data.localPath,
            remotePath: data.remotePath,
        });
        onClose();
    };

    return createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity">
            <div
                className="rounded-lg shadow-2xl p-5 w-96 flex flex-col gap-4"
                style={{
                    backgroundColor: "var(--df-bg-panel)",
                    border: "1px solid var(--df-border)",
                    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)"
                }}
            >
                <div className="flex items-center gap-3 border-b pb-3" style={{ borderColor: 'var(--df-border)' }}>
                    <div className="flex items-center justify-center w-8 h-8 rounded-full" style={{ backgroundColor: "color-mix(in srgb, var(--df-primary) 15%, transparent)" }}>
                        <span className="material-icons text-[18px]" style={{ color: "var(--df-primary)" }}>cloud_sync</span>
                    </div>
                    <h3 className="font-semibold text-sm" style={{ color: "var(--df-text)" }}>
                        {t("fileExplorer.fileModified", "File Modified Locally")}
                    </h3>
                </div>

                <p className="text-xs break-all leading-relaxed" style={{ color: "var(--df-text-muted)" }}>
                    {t("fileExplorer.uploadPrompt", "The following file was modified. Do you want to upload it to the remote server?")}<br /><br />
                    <span className="font-mono bg-black/20 px-2 py-1 rounded border inline-block w-full truncate" style={{ color: "var(--df-text)", borderColor: "var(--df-border)" }} title={data.remotePath}>
                        {data.remotePath}
                    </span>
                </p>

                <div className="flex justify-end gap-2 mt-4 pt-4 border-t" style={{ borderColor: 'var(--df-border)' }}>
                    <button
                        className="px-4 py-1.5 rounded transition-colors text-xs font-medium"
                        style={{ color: "var(--df-text-muted)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--df-bg-hover)"; e.currentTarget.style.color = "var(--df-text)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--df-text-muted)"; }}
                        onClick={onClose}
                    >
                        {t("dialog.cancel")}
                    </button>
                    <button
                        className="px-4 py-1.5 rounded transition-colors text-xs font-medium flex-1 text-center"
                        style={{ backgroundColor: "var(--df-bg-hover)", color: "var(--df-text)", border: "1px solid var(--df-border)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--df-border)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--df-bg-hover)"; }}
                        onClick={() => handleUpload(true)}
                    >
                        {t("fileExplorer.alwaysUpload", "Always")}
                    </button>
                    <button
                        className="px-4 py-1.5 rounded transition-colors text-xs font-medium flex items-center justify-center gap-1 flex-1"
                        style={{ backgroundColor: "var(--df-primary)", color: "#fff" }}
                        onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(1.1)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}
                        onClick={() => handleUpload(false)}
                    >
                        {t("fileExplorer.uploadOnce", "Upload")}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
