export type Platform = "whatsapp";

export interface ExternalChatMessage {
  id: string;
  role: "customer" | "agent" | "system" | "unknown";
  text: string;
  timestamp?: number;
  rawTimeText?: string;
}

export interface ExternalChatInfo {
  platform: Platform;
  externalChatId: string;
  displayName: string;
  avatarUrl?: string;
  onlineStatus?: string;
}

export interface ChatSnapshot {
  chat: ExternalChatInfo;
  messages: ExternalChatMessage[];
  sourceMessageHash: string;
}

export interface CopilotResult {
  id: string;
  type: "translate-clean" | "reply";
  title: string;
  content: string;
  createdAt: number;
  sourceMessageHash: string;
}