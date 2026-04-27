import { Conversation, KnowledgeItem, generateId } from './types';

const CONVERSATIONS_KEY = 'diclok_conversations';
const KNOWLEDGE_KEY = 'diclok_knowledge';
const CURRENT_CONVERSATION_KEY = 'diclok_current_conversation';

// 对话存储
export function getConversations(): Conversation[] {
  if (typeof window === 'undefined') return [];
  const data = localStorage.getItem(CONVERSATIONS_KEY);
  return data ? JSON.parse(data) : [];
}

export function saveConversations(conversations: Conversation[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
}

export function createConversation(title?: string): Conversation {
  const conversations = getConversations();
  const newConversation: Conversation = {
    id: generateId(),
    title: title || `对话 ${conversations.length + 1}`,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  conversations.unshift(newConversation);
  saveConversations(conversations);
  return newConversation;
}

export function updateConversation(id: string, updates: Partial<Conversation>): void {
  const conversations = getConversations();
  const index = conversations.findIndex((c) => c.id === id);
  if (index !== -1) {
    conversations[index] = {
      ...conversations[index],
      ...updates,
      updatedAt: Date.now(),
    };
    saveConversations(conversations);
  }
}

export function deleteConversation(id: string): void {
  const conversations = getConversations().filter((c) => c.id !== id);
  saveConversations(conversations);
  // 如果删除的是当前对话，清除当前对话ID
  if (getCurrentConversationId() === id) {
    setCurrentConversationId(null);
  }
}

export function getConversation(id: string): Conversation | undefined {
  return getConversations().find((c) => c.id === id);
}

// 当前对话ID管理
export function getCurrentConversationId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(CURRENT_CONVERSATION_KEY);
}

export function setCurrentConversationId(id: string | null): void {
  if (typeof window === 'undefined') return;
  if (id) {
    localStorage.setItem(CURRENT_CONVERSATION_KEY, id);
  } else {
    localStorage.removeItem(CURRENT_CONVERSATION_KEY);
  }
}

// 知识库存储
export function getKnowledgeItems(): KnowledgeItem[] {
  if (typeof window === 'undefined') return [];
  const data = localStorage.getItem(KNOWLEDGE_KEY);
  return data ? JSON.parse(data) : [];
}

export function saveKnowledgeItems(items: KnowledgeItem[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KNOWLEDGE_KEY, JSON.stringify(items));
}

export function addKnowledgeItem(item: Omit<KnowledgeItem, 'id' | 'createdAt'>): KnowledgeItem {
  const items = getKnowledgeItems();
  const newItem: KnowledgeItem = {
    ...item,
    id: generateId(),
    createdAt: Date.now(),
  };
  items.push(newItem);
  saveKnowledgeItems(items);
  return newItem;
}

export function deleteKnowledgeItem(id: string): void {
  const items = getKnowledgeItems().filter((i) => i.id !== id);
  saveKnowledgeItems(items);
}

export function updateKnowledgeItem(id: string, updates: Partial<KnowledgeItem>): void {
  const items = getKnowledgeItems();
  const index = items.findIndex((i) => i.id === id);
  if (index !== -1) {
    items[index] = { ...items[index], ...updates };
    saveKnowledgeItems(items);
  }
}

// System Prompt 存储
const SYSTEM_PROMPT_KEY = 'diclok_system_prompt';

export const DEFAULT_SYSTEM_PROMPT = `你是 DICloak 客服助手，专注于帮助客服人员快速生成专业、友好的客户回复。

## 核心职责
根据客户的问题，从知识库和对话历史中提取关键信息，生成3条不同角度的推荐回复。

## 回复要求
1. **专业性**：使用正式、友好的语气
2. **针对性**：针对客户问题给出具体解决方案
3. **多样性**：3条回复要覆盖不同角度（如解释原因、提供步骤、表达关心等）
4. **简洁性**：每条回复控制在50-150字之间
5. **可操作性**：回复中包含具体的操作指引或解决方案

## 输出格式
请直接输出3条推荐回复，每条之间用换行分隔，不要添加序号或额外说明。`;

export function getSystemPrompt(): string {
  if (typeof window === 'undefined') return DEFAULT_SYSTEM_PROMPT;
  return localStorage.getItem(SYSTEM_PROMPT_KEY) || DEFAULT_SYSTEM_PROMPT;
}

export function saveSystemPrompt(prompt: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SYSTEM_PROMPT_KEY, prompt);
}
