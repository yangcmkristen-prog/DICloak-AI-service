import { createClient } from '@supabase/supabase-js';

// Supabase 配置
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// ============ 默认配置 ============

export const DEFAULT_SYSTEM_PROMPT = "你是 DICloak AI 客服助手。必须使用：{{language}} 回复。任务：生成主回复、补充建议、需要补充的信息。【核心规则】1. 主回复必须完整输出 FAQ 标准答案的所有内容，禁止拆分到其他回复 2. FAQ 中的空行只是排版格式，不代表要拆分输出 3. 补充建议必须独立，禁止继续补充主回复 4. 需要补充的信息只用于收集：报错、截图、录屏、操作步骤、账号来源、使用场景 5. 只输出最终回复，禁止输出分析、判断、检索过程、知识来源 6. UI术语必须使用术语库翻译【身份识别】end_user：提到第三方工具、订阅、套餐、卖家、购买网站、管理员 client：提到团队、API、权限、代理、RPA、批量操作、环境管理【检索顺序】troubleshooting > feature_faq > user_routing > out_of_scope > 功能知识库【信息不足】用户只说打不开/无法使用/有问题但没有报错/截图/操作步骤时，优先收集信息。【输出格式】[问题类型] xxx [主回复] 完整标准答案 [补充建议] 其他FAQ或功能入口 [需要补充的信息] 需要的用户信息";

export const DEFAULT_API_CONFIG: ApiConfig = {
  provider: 'coze',
  apiKey: '',
  model: 'doubao-seed-2-0-lite-260215',
  baseUrl: '',
};

export const MODEL_OPTIONS = [
  { value: 'doubao-seed-2-0-pro-260215', label: '豆包 Pro', provider: 'coze' },
  { value: 'doubao-seed-2-0-lite-260215', label: '豆包 Lite', provider: 'coze' },
  { value: 'doubao-seed-2-0-mini-260215', label: '豆包 Mini', provider: 'coze' },
  { value: 'doubao-seed-1-8-251228', label: '豆包 1.8', provider: 'coze' },
  { value: 'doubao-seed-1-6-251015', label: '豆包 1.6', provider: 'coze' },
  { value: 'doubao-seed-1-6-vision-250815', label: '豆包视觉', provider: 'coze' },
  { value: 'doubao-seed-1-6-lite-251015', label: '豆包 Lite 1.6', provider: 'coze' },
  { value: 'deepseek-v3-2-251201', label: 'DeepSeek V3', provider: 'coze' },
  { value: 'deepseek-r1-250528', label: 'DeepSeek R1', provider: 'coze' },
  { value: 'kimi-k2-5-260127', label: 'Kimi K2', provider: 'coze' },
  { value: 'glm-5-0-260211', label: 'GLM-5', provider: 'coze' },
  { value: 'glm-5-turbo-260316', label: 'GLM-5 Turbo', provider: 'coze' },
  { value: 'glm-4-7-251222', label: 'GLM-4.7', provider: 'coze' },
  { value: 'minimax-m2-5-260212', label: 'MiniMax M2.5', provider: 'coze' },
  { value: 'minimax-m2-7-260318', label: 'MiniMax M2.7', provider: 'coze' },
  { value: 'qwen-3-5-plus-260215', label: 'Qwen 3.5', provider: 'coze' },
];

export const PROVIDER_INFO: Record<string, {
  label: string;
  defaultModel: string;
  baseUrl: string;
  keyPlaceholder: string;
}> = {
  coze: {
    label: '豆包/Coze',
    defaultModel: 'doubao-seed-2-0-lite-260215',
    baseUrl: '',
    keyPlaceholder: '输入你的 Coze API Token',
  },
};

// ============ 类型定义 ============

export interface ApiConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// ============ 知识库相关 ============

export async function getKnowledgeBase(): Promise<Record<string, any>> {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('knowledge_configs')
        .select('category, content')
        .single();
      
      if (!error && data) {
        const knowledgeData: Record<string, any> = {};
        for (const item of data.content || []) {
          knowledgeData[item.id] = item;
        }
        return knowledgeData;
      }
    }
  } catch (e) {
    console.error('获取知识库失败:', e);
  }
  
  const local = localStorage.getItem('diclok_knowledge');
  return local ? JSON.parse(local) : {};
}

export async function saveKnowledgeBase(data: Record<string, any>): Promise<void> {
  try {
    const items = Object.values(data);
    
    if (supabase) {
      const { error } = await supabase
        .from('knowledge_configs')
        .upsert([{ category: 'faq', content: items }], { onConflict: 'category' });
      
      if (error) throw error;
    }
  } catch (e) {
    console.error('保存知识库到数据库失败:', e);
  }
  
  localStorage.setItem('diclok_knowledge', JSON.stringify(data));
}

export function getKnowledgeStats(data: Record<string, any>): Record<string, number> {
  const stats: Record<string, number> = {
    feature_faq: 0,
    troubleshooting: 0,
    user_routing: 0,
    out_of_scope: 0,
    mapping: 0,
    功能知识: 0,
    术语: 0,
    total: 0
  };
  
  for (const item of Object.values(data)) {
    const category = (item as any).category || 'unknown';
    if (category in stats) {
      stats[category]++;
    }
    stats.total++;
  }
  
  return stats;
}

export function replaceKnowledgeData(existing: Record<string, any>, newData: Record<string, any>): Record<string, any> {
  const result = { ...existing };
  
  for (const [id, item] of Object.entries(newData)) {
    result[id] = item;
  }
  
  return result;
}

// ============ System Prompt 相关 ============

export function getSystemPrompt(): string | null {
  return localStorage.getItem('diclok_system_prompt');
}

export function saveSystemPrompt(prompt: string): void {
  localStorage.setItem('diclok_system_prompt', prompt);
  
  if (supabase) {
    supabase
      .from('system_configs')
      .upsert({ key: 'prompt', value: prompt }, { onConflict: 'key' })
      .then(({ error }) => {
        if (error) console.error('保存 prompt 到数据库失败:', error);
      });
  }
}

// ============ API 配置相关 ============

export function getApiConfig(): ApiConfig {
  const stored = localStorage.getItem('diclok_api_config');
  if (stored) {
    return JSON.parse(stored);
  }
  
  return {
    provider: 'coze',
    apiKey: '',
    model: 'doubao-seed-2-0-lite-260215',
    baseUrl: ''
  };
}

export function saveApiConfig(config: ApiConfig): void {
  localStorage.setItem('diclok_api_config', JSON.stringify(config));
  
  if (supabase) {
    supabase
      .from('system_configs')
      .upsert({ key: 'api_config', value: config }, { onConflict: 'key' })
      .then(({ error }) => {
        if (error) console.error('保存 API 配置到数据库失败:', error);
      });
  }
}

// ============ 对话管理 ============

export function getConversations(): Conversation[] {
  const stored = localStorage.getItem('diclok_conversations');
  return stored ? JSON.parse(stored) : [];
}

export function saveConversations(conversations: Conversation[]): void {
  localStorage.setItem('diclok_conversations', JSON.stringify(conversations));
}

export function createConversation(title?: string): Conversation {
  const conversations = getConversations();
  const newConversation: Conversation = {
    id: generateId(),
    title: title || `对话 ${conversations.length + 1}`,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  
  conversations.unshift(newConversation);
  saveConversations(conversations);
  
  return newConversation;
}

export function deleteConversation(id: string): void {
  const conversations = getConversations();
  const filtered = conversations.filter(c => c.id !== id);
  saveConversations(filtered);
}

export function updateConversation(id: string, updates: Partial<Conversation>): void {
  const conversations = getConversations();
  const index = conversations.findIndex(c => c.id === id);
  
  if (index !== -1) {
    conversations[index] = {
      ...conversations[index],
      ...updates,
      updatedAt: Date.now()
    };
    saveConversations(conversations);
  }
}

export function getCurrentConversationId(): string | null {
  return localStorage.getItem('diclok_current_conversation');
}

export function setCurrentConversationId(id: string | null): void {
  if (id) {
    localStorage.setItem('diclok_current_conversation', id);
  } else {
    localStorage.removeItem('diclok_current_conversation');
  }
}

// ============ 工具函数 ============

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

// ============ 语言检测 ============

export type DetectedLanguage = 
  | 'zh'      // 中文
  | 'en'      // 英文
  | 'es'      // 西班牙语
  | 'pt'      // 葡萄牙语
  | 'ru'      // 俄语
  | 'vi'      // 越南语
  | 'id'      // 印尼语
  | 'th'      // 泰语
  | 'ar'      // 阿拉伯语
  | 'ja'      // 日语
  | 'ko'      // 韩语
  | 'mixed';  // 混合语言

export function detectLanguage(text: string): DetectedLanguage {
  if (!text || typeof text !== 'string') return 'zh';
  
  const cleanText = text.trim();
  if (!cleanText) return 'zh';
  
  // 统计各语言字符
  const stats = {
    chinese: (cleanText.match(/[\u4e00-\u9fa5]/g) || []).length,
    japanese: (cleanText.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length,
    korean: (cleanText.match(/[\uac00-\ud7af\u1100-\u115f]/g) || []).length,
    english: (cleanText.match(/[a-zA-Z]/g) || []).length,
    spanish: (cleanText.match(/[áéíóúüñ¿¡]+/gi) || []).length,
    portuguese: (cleanText.match(/[ãõâêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gi) || []).length,
    cyrillic: (cleanText.match(/[\u0400-\u04FF]/g) || []).length,
    thai: (cleanText.match(/[\u0e00-\u0e7f]/g) || []).length,
    arabic: (cleanText.match(/[\u0600-\u06ff\u0750-\u077f]/g) || []).length,
  };
  
  const totalChars = cleanText.replace(/\s/g, '').length;
  if (totalChars === 0) return 'zh';
  
  const ratios: Record<string, number> = {};
  for (const [lang, count] of Object.entries(stats)) {
    ratios[lang] = count / totalChars;
  }
  
  const THRESHOLD = 0.2;
  
  if (ratios.thai >= THRESHOLD) return 'th';
  if (ratios.arabic >= THRESHOLD) return 'ar';
  if (ratios.cyrillic >= THRESHOLD) return 'ru';
  if (ratios.spanish >= THRESHOLD) return 'es';
  if (ratios.portuguese >= THRESHOLD) return 'pt';
  if (ratios.chinese >= THRESHOLD) return 'zh';
  if (ratios.japanese >= THRESHOLD) return 'ja';
  if (ratios.korean >= THRESHOLD) return 'ko';
  if (ratios.english >= THRESHOLD) return 'en';
  
  const activeLangCount = Object.entries(ratios).filter(([_, r]) => r >= 0.1).length;
  if (activeLangCount >= 2) return 'mixed';
  
  return 'zh';
}

export function getLanguageName(lang: DetectedLanguage): string {
  const names: Record<DetectedLanguage, string> = {
    zh: '中文',
    en: '英文',
    es: '西班牙语',
    pt: '葡萄牙语',
    ru: '俄语',
    vi: '越南语',
    id: '印尼语',
    th: '泰语',
    ar: '阿拉伯语',
    ja: '日语',
    ko: '韩语',
    mixed: '混合语言',
  };
  return names[lang] || '中文';
}

export function getLanguageCode(lang: DetectedLanguage): string {
  const codes: Record<DetectedLanguage, string> = {
    zh: 'zh',
    en: 'en',
    es: 'es',
    pt: 'pt',
    ru: 'ru',
    vi: 'vi',
    id: 'id',
    th: 'th',
    ar: 'ar',
    ja: 'ja',
    ko: 'ko',
    mixed: 'zh',
  };
  return codes[lang] || 'zh';
}
