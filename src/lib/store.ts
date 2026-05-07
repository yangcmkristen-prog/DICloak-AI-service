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
  // 保留原有的 lastUpdated（如果不是 0），否则使用当前时间
  const lastUpdated = data.lastUpdated && data.lastUpdated !== 0 
    ? data.lastUpdated 
    : Date.now();
  
  saveKnowledgeBase({
    ...data,
    lastUpdated,
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

// ============ API Key 存储 ============

const API_CONFIG_KEY = 'diclok_api_config';

export interface ApiConfig {
  provider: 'coze' | 'openai' | 'deepseek' | 'kimi' | 'custom';
  apiKey: string;
  model: string;
  baseUrl?: string;
  // 自定义 HTTP 配置
  customConfig?: {
    endpoint: string;      // 完整 API 端点 URL
    modelName: string;     // 模型名称
    headers?: Record<string, string>;  // 自定义请求头
    bodyTemplate?: string;  // 请求体模板（JSON 格式）
  };
}

export const DEFAULT_API_CONFIG: ApiConfig = {
  provider: 'coze',
  apiKey: '',
  model: 'doubao-seed-2-0-lite-260215',
  baseUrl: '',
};

export function getApiConfig(): ApiConfig {
  if (typeof window === 'undefined') return DEFAULT_API_CONFIG;
  const data = localStorage.getItem(API_CONFIG_KEY);
  if (!data) return DEFAULT_API_CONFIG;
  
  try {
    return { ...DEFAULT_API_CONFIG, ...JSON.parse(data) };
  } catch {
    return DEFAULT_API_CONFIG;
  }
}

export function saveApiConfig(config: ApiConfig): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(API_CONFIG_KEY, JSON.stringify(config));
}

// 支持的模型列表
export const MODEL_OPTIONS = [
  // Coze / 豆包 - 旗舰级
  { provider: 'coze', label: '豆包 Pro (旗舰全能)', model: 'doubao-seed-2-0-pro-260215' },
  // Coze / 豆包 - 均衡型
  { provider: 'coze', label: '豆包 Lite (均衡性价比)', model: 'doubao-seed-2-0-lite-260215' },
  // Coze / 豆包 - 轻量级
  { provider: 'coze', label: '豆包 Mini (轻量快速)', model: 'doubao-seed-2-0-mini-260215' },
  // Coze / 豆包 - 1.x 系列
  { provider: 'coze', label: '豆包 1.8 (多模态)', model: 'doubao-seed-1-8-251228' },
  { provider: 'coze', label: '豆包 1.6 (全能)', model: 'doubao-seed-1-6-251015' },
  { provider: 'coze', label: '豆包 1.6 Vision (视觉)', model: 'doubao-seed-1-6-vision-250815' },
  { provider: 'coze', label: '豆包 1.6 Lite (轻量)', model: 'doubao-seed-1-6-lite-251015' },
  // OpenAI
  { provider: 'openai', label: 'GPT-4o', model: 'gpt-4o' },
  { provider: 'openai', label: 'GPT-4o Mini', model: 'gpt-4o-mini' },
  { provider: 'openai', label: 'GPT-4 Turbo', model: 'gpt-4-turbo' },
  { provider: 'openai', label: 'GPT-5.4', model: 'gpt-5.4' },
  // DeepSeek
  { provider: 'deepseek', label: 'DeepSeek V3', model: 'deepseek-v3-2-251201' },
  { provider: 'deepseek', label: 'DeepSeek R1', model: 'deepseek-r1-250528' },
  // Kimi
  { provider: 'kimi', label: 'Kimi K2 (全能)', model: 'kimi-k2-5-260127' },
  // 自定义 HTTP
  { provider: 'custom', label: '自定义 HTTP', model: 'custom' },
];

export const PROVIDER_INFO = {
  coze: {
    name: '豆包 (Coze)',
    defaultModel: 'doubao-seed-2-0-lite-260215',
    baseUrl: '',
    keyPlaceholder: '使用内置 API（无需填写）',
  },
  openai: {
    name: 'OpenAI',
    defaultModel: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
    keyPlaceholder: 'sk-xxxxxxxxxxxxxxxx',
  },
  deepseek: {
    name: 'DeepSeek',
    defaultModel: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    keyPlaceholder: 'sk-xxxxxxxxxxxxxxxx',
  },
  kimi: {
    name: 'Kimi (月之暗面)',
    defaultModel: 'moonshot-v1-8k',
    baseUrl: 'https://api.moonshot.cn/v1',
    keyPlaceholder: 'sk-xxxxxxxxxxxxxxxx',
  },
  custom: {
    name: '自定义 HTTP',
    defaultModel: '',
    baseUrl: '',
    keyPlaceholder: '输入你的 API Key',
  },
};

// ============ 语言检测 ============

export type DetectedLanguage = 'zh' | 'en' | 'mixed';

export function detectLanguage(text: string): DetectedLanguage {
  if (!text || typeof text !== 'string') return 'zh';
  
  // 移除空白字符
  const cleanText = text.trim();
  if (!cleanText) return 'zh';
  
  // 统计中文字符
  const chineseChars = (cleanText.match(/[\u4e00-\u9fa5]/g) || []).length;
  // 统计英文字母
  const englishChars = (cleanText.match(/[a-zA-Z]/g) || []).length;
  // 总字符数（不含空格）
  const totalChars = cleanText.replace(/\s/g, '').length;
  
  if (totalChars === 0) return 'zh';
  
  const chineseRatio = chineseChars / totalChars;
  const englishRatio = englishChars / totalChars;
  
  // 阈值判断
  if (chineseRatio > 0.3 && englishRatio > 0.3) {
    return 'mixed'; // 中英文混合
  } else if (chineseRatio > 0.5) {
    return 'zh'; // 以中文为主
  } else if (englishRatio > 0.5) {
    return 'en'; // 以英文为主
  } else if (chineseRatio > englishRatio) {
    return 'zh';
  } else {
    return 'en';
  }
}

export function getLanguageName(lang: DetectedLanguage): string {
  switch (lang) {
    case 'zh': return '中文';
    case 'en': return '英文';
    case 'mixed': return '中英文混合';
    default: return '中文';
  }
}
