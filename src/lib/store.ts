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
