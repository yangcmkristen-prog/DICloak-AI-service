// 对话和消息类型定义
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

// 知识库类型定义
export interface KnowledgeItem {
  id: string;
  name: string;
  type: 'feishu' | 'document';
  url?: string;
  content?: string;
  createdAt: number;
}

// 推荐回复类型
export interface RecommendedReply {
  id: string;
  content: string;
}

// 生成唯一ID
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}
