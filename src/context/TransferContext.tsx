import { listen } from "@tauri-apps/api/event";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";

export type TransferDirection = "upload" | "download";
export type TransferStatus = "transferring" | "completed" | "error";

export interface TransferItem {
  id: string;
  sessionId: string;
  fileName: string;
  direction: TransferDirection;
  status: TransferStatus;
  size: number;
  bytesTransferred: number;
  totalSize: number;
  error?: string;
  timestamp: number;
}

interface TransferContextValue {
  transfers: TransferItem[];
  clearCompleted: () => void;
  clearAll: () => void;
}

const TransferContext = createContext<TransferContextValue | null>(null);

/** Backend event payload shape. */
interface TransferEventPayload {
  id: string;
  session_id: string;
  file_name: string;
  direction: string;
  status: string;
  size: number;
  bytes_transferred: number;
  total_size: number;
  error_msg?: string;
}

export function TransferProvider({ children }: { children: ReactNode }) {
  const [transfers, setTransfers] = useState<TransferItem[]>([]);

  useEffect(() => {
    const unlisten = listen<TransferEventPayload>("transfer-event", (e) => {
      const p = e.payload;

      if (p.status === "started") {
        setTransfers((prev) => [
          {
            id: p.id,
            sessionId: p.session_id,
            fileName: p.file_name,
            direction: p.direction as TransferDirection,
            status: "transferring",
            size: 0,
            bytesTransferred: 0,
            totalSize: p.total_size,
            timestamp: Date.now(),
          },
          ...prev,
        ]);
      } else if (p.status === "progress") {
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === p.id
              ? {
                  ...t,
                  bytesTransferred: p.bytes_transferred,
                  totalSize: p.total_size,
                }
              : t,
          ),
        );
      } else {
        // "completed" or "error"
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === p.id
              ? {
                  ...t,
                  status: p.status as TransferStatus,
                  size: p.size,
                  bytesTransferred: p.bytes_transferred,
                  totalSize: p.total_size,
                  error: p.error_msg,
                }
              : t,
          ),
        );
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const clearCompleted = useCallback(() => {
    setTransfers((prev) => prev.filter((t) => t.status === "transferring"));
  }, []);

  const clearAll = useCallback(() => {
    setTransfers([]);
  }, []);

  return (
    <TransferContext.Provider value={{ transfers, clearCompleted, clearAll }}>
      {children}
    </TransferContext.Provider>
  );
}

export function useTransfer(): TransferContextValue {
  const ctx = useContext(TransferContext);
  if (!ctx) throw new Error("useTransfer must be used within TransferProvider");
  return ctx;
}
