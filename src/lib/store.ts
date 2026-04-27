import { 
  Conversation, 
  KnowledgeBase, 
  FAQItem, 
  TroubleshootingItem, 
  OutOfScopeItem, 
  MappingItem, 
  FunctionKnowledge, 
  TermItem,
  generateId 
} from './types';

const CONVERSATIONS_KEY = 'diclok_conversations';
const KNOWLEDGE_KEY = 'diclok_knowledge';
const CURRENT_CONVERSATION_KEY = 'diclok_current_conversation';

// ============ 对话存储 ============

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
  if (getCurrentConversationId() === id) {
    setCurrentConversationId(null);
  }
}

export function getConversation(id: string): Conversation | undefined {
  return getConversations().find((c) => c.id === id);
}

// ============ 当前对话ID管理 ============

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

// ============ 知识库存储 ============

const DEFAULT_KNOWLEDGE_BASE: KnowledgeBase = {
  faqItems: [],
  troubleshootingItems: [],
  outOfScopeItems: [],
  mappingItems: [],
  functionKnowledge: [],
  termItems: [],
  lastUpdated: 0,
};

export function getKnowledgeBase(): KnowledgeBase {
  if (typeof window === 'undefined') return DEFAULT_KNOWLEDGE_BASE;
  const data = localStorage.getItem(KNOWLEDGE_KEY);
  if (!data) return DEFAULT_KNOWLEDGE_BASE;
  
  try {
    const parsed = JSON.parse(data);
    // 确保所有字段都存在
    return {
      faqItems: parsed.faqItems || [],
      troubleshootingItems: parsed.troubleshootingItems || [],
      outOfScopeItems: parsed.outOfScopeItems || [],
      mappingItems: parsed.mappingItems || [],
      functionKnowledge: parsed.functionKnowledge || [],
      termItems: parsed.termItems || [],
      lastUpdated: parsed.lastUpdated || 0,
    };
  } catch {
    return DEFAULT_KNOWLEDGE_BASE;
  }
}

export function saveKnowledgeBase(knowledge: KnowledgeBase): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KNOWLEDGE_KEY, JSON.stringify(knowledge));
}

export function updateKnowledgeBase(updates: Partial<KnowledgeBase>): KnowledgeBase {
  const current = getKnowledgeBase();
  const updated: KnowledgeBase = {
    ...current,
    ...updates,
    lastUpdated: Date.now(),
  };
  saveKnowledgeBase(updated);
  return updated;
}

export function clearKnowledgeBase(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KNOWLEDGE_KEY);
}

// 导入知识库数据
export function importKnowledgeData(data: Partial<KnowledgeBase>): void {
  const current = getKnowledgeBase();
  const updated: KnowledgeBase = {
    faqItems: [...current.faqItems, ...(data.faqItems || [])],
    troubleshootingItems: [...current.troubleshootingItems, ...(data.troubleshootingItems || [])],
    outOfScopeItems: [...current.outOfScopeItems, ...(data.outOfScopeItems || [])],
    mappingItems: [...current.mappingItems, ...(data.mappingItems || [])],
    functionKnowledge: [...current.functionKnowledge, ...(data.functionKnowledge || [])],
    termItems: [...current.termItems, ...(data.termItems || [])],
    lastUpdated: Date.now(),
  };
  saveKnowledgeBase(updated);
}

// 替换所有知识库数据（导入时使用）
export function replaceKnowledgeData(data: KnowledgeBase): void {
  saveKnowledgeBase({
    ...data,
    lastUpdated: Date.now(),
  });
}

// 获取知识库统计信息
export function getKnowledgeStats(): { 
  faqCount: number; 
  troubleshootingCount: number; 
  outOfScopeCount: number; 
  mappingCount: number; 
  functionCount: number; 
  termCount: number;
  lastUpdated: number;
} {
  const kb = getKnowledgeBase();
  return {
    faqCount: kb.faqItems.length,
    troubleshootingCount: kb.troubleshootingItems.length,
    outOfScopeCount: kb.outOfScopeItems.length,
    mappingCount: kb.mappingItems.length,
    functionCount: kb.functionKnowledge.length,
    termCount: kb.termItems.length,
    lastUpdated: kb.lastUpdated,
  };
}

// ============ System Prompt 存储 ============

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
