import type { SessionType } from "@/types/global";

export interface SyncOverlayState {
  peerCount: number;
  isPaused: boolean;
  groupColor?: string;
  groupName?: string;
  onPauseResume: () => void;
  onLeaveGroup: () => void;
  onCloseGroup: () => void;
}

export interface XTerminalProps {
  sessionId: string;
  active: boolean;
  visible?: boolean;
  sessionType: SessionType;
  connectionId?: string;
  onReconnected?: (oldSessionId: string, newSessionId: string) => void;
  onDisconnectedCloseRequested?: () => void;
  onConnectionError?: (sessionId: string, error: string) => void;
  syncPeerSessionIds?: string[];
  syncOverlay?: SyncOverlayState;
}

export interface MultiLinePasteDialogProps {
  open: boolean;
  text: string | null;
  onClose: () => void;
  onDirectPaste: (text: string) => void;
  onSendLineByLine: (text: string) => void;
}

export type PerformanceMode = "normal" | "strained" | "overloaded";
