export type Platform = "whatsapp";
export type ConversationRole = "client" | "end_user";
export type ConversationRoleSource = "manual" | "ai" | null;

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
  confirmedRole?: ConversationRole;
}

export interface ChatSnapshot {
  chat: ExternalChatInfo;
  messages: ExternalChatMessage[];
  sourceMessageHash: string;
}

export interface CopilotReplyResponse {
  content?: string;
  error?: string;
  detectedRole?: ConversationRole | null;
  roleSource?: ConversationRoleSource;
}

export interface CopilotResult {
  id: string;
  type: "translate-clean" | "reply";
  title: string;
  content: string;
  createdAt: number;
  sourceMessageHash: string;
}