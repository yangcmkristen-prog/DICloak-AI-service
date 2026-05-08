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

export function getKnowledgeStats(data?: Record<string, any>): Record<string, number> {
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
  
  // 如果没有传入数据，从 localStorage 读取
  if (!data) {
    try {
      const local = localStorage.getItem('diclok_knowledge');
      if (local) {
        data = JSON.parse(local);
      } else {
        return stats;
      }
    } catch (e) {
      console.error('读取知识库失败:', e);
      return stats;
    }
  }
  
  // 遍历 data 的所有键值对
  for (const [key, value] of Object.entries(data)) {
    // 如果值是数组（KnowledgeItem 数组），遍历每个 item
    if (Array.isArray(value)) {
      for (const item of value as KnowledgeItem[]) {
        if (item && item.category) {
          if (item.category in stats) {
            stats[item.category]++;
          }
          stats.total++;
        }
      }
    }
  }
  
  return stats;
}

export function replaceKnowledgeData(existing: Record<string, any>, newData?: Record<string, any>): Record<string, any> {
  const result = { ...existing };
  
  if (!newData) return result;
  
  // 遍历 newData 的所有键值对
  for (const [key, value] of Object.entries(newData)) {
    // 如果值是数组（KnowledgeItem 数组），展开到扁平格式
    if (Array.isArray(value)) {
      for (const item of value as KnowledgeItem[]) {
        if (item && item.id) {
          result[item.id] = item;
        }
      }
    } else {
      // 其他字段（如 lastUpdated）直接设置
      result[key] = value;
    }
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

// 语言检测辅助函数 - 检测拉丁字母文字所属语言
// 使用严格的单词边界匹配，避免子字符串误判
function detectLatinScript(text: string): { language: DetectedLanguage; confidence: number } | null {
  if (text.length < 5) return null;
  
  // 转换为小写
  const lowerText = text.toLowerCase();
  
  // 越南语特殊字符检测（优先检测，因为有独特的字母组合）
  const hasVietnamese = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(text);
  if (hasVietnamese) {
    return { language: 'vi', confidence: 0.95 };
  }
  
  // 印尼语特征词汇（印尼语特有的词，使用单词边界）
  const indonesianWords = ['kamu', 'mereka', 'kami', 'kita', 'gimana', 'nggak', 'banget', 'masak', 'jangan', 'udah', 'dong', 'kok', 'kan', 'tuh', 'deh', 'nih', 'aja', 'sih', 'gue', 'lu', 'ane', 'ente', 'mu', 'nya', 'dong', 'kira', 'tiba', 'mau', 'bisa', 'gak', 'suka', 'bukan', 'halo', 'terima', 'kasih', 'tolong', 'ya', 'okee', 'siapa', 'apa', 'kenapa', 'di mana', 'bagaimana'];
  
  // 葡萄牙语特征词汇（葡萄牙语特有的词，使用单词边界）
  const portugueseWords = ['ola', 'obrigado', 'obrigada', 'obrigada', 'trabalho', 'problema', 'tenho', 'preciso', 'ajuda', 'sinal', 'erro', 'funciona', 'login', 'sessao', 'entrar', 'este', 'estao', 'esses', 'essas', 'onde', 'quando', 'como', 'porque', 'bem', 'muito', 'pouco', 'bom', 'ruim', 'sim', 'nao', 'ja', 'agora', 'depois', 'antes', 'sempre', 'nunca', 'talvez', 'certamente', 'provavelmente', 'aqui', 'ali', 'embaixo', 'em cima', 'longe', 'perto'];
  
  // 西班牙语特征词汇（西班牙语特有的词，使用单词边界）
  // 只包含西班牙语特有的、不易与英文混淆的词汇
  const spanishWords = ['hola', 'gracias', 'trabajo', 'trabajos', 'necesito', 'ayudar', 'senal', 'funciona', 'ayuda', 'iniciar', 'eliminar', 'imagenes', 'hacer', 'quiero', 'puedo', 'tiene', 'tienen', 'donde', 'cuando', 'porque', 'pero', 'este', 'esta', 'esto', 'estos', 'estas', 'esos', 'esas', 'sobre', 'tener', 'hacer', 'ir', 'ver', 'dar', 'saber', 'querer', 'poder', 'deber', 'decir', 'quien', 'cual', 'cuanto', 'aqui', 'alli', 'ahora', 'luego', 'despues', 'siempre', 'nunca', 'tambien', 'solo', 'ahora', 'entonces', 'bueno', 'vale', 'mira', 'oye', 'favor', 'saludos'];
  
  // 计算单词总数
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const totalWords = words.length || 1;
  
  // 辅助函数：使用单词边界匹配
  const countMatches = (wordList: string[]): number => {
    return wordList.filter(word => {
      // 使用单词边界匹配
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      return regex.test(text);
    }).length;
  };
  
  // 计算各语言匹配分数
  const spanishScore = countMatches(spanishWords);
  const portugueseScore = countMatches(portugueseWords);
  const indonesianScore = countMatches(indonesianWords);
  
  console.log('[DEBUG] 拉丁语检测 - 西班牙语:', spanishScore, '葡萄牙语:', portugueseScore, '印尼语:', indonesianScore, '总词数:', totalWords);
  
  // 只有当最高分数语言的分数 >= 1 时才返回该语言
  // 否则返回 null
  if (spanishScore >= 1 && spanishScore >= portugueseScore && spanishScore >= indonesianScore) {
    return { language: 'es', confidence: Math.min(spanishScore / totalWords * 2, 0.95) };
  }
  
  if (portugueseScore >= 1 && portugueseScore >= spanishScore && portugueseScore >= indonesianScore) {
    return { language: 'pt', confidence: Math.min(portugueseScore / totalWords * 2, 0.95) };
  }
  
  if (indonesianScore >= 1 && indonesianScore >= spanishScore && indonesianScore >= portugueseScore) {
    return { language: 'id', confidence: Math.min(indonesianScore / totalWords * 2, 0.95) };
  }
  
  // 没有检测到明确的拉丁语系语言，返回 null
  return null;
}

export function detectLanguage(text: string): DetectedLanguage {
  if (!text || typeof text !== 'string') return 'zh';
  
  const cleanText = text.trim();
  if (!cleanText) return 'zh';
  
  // 1. 先检测非拉丁语系语言
  const nonLatinStats = {
    chinese: (cleanText.match(/[\u4e00-\u9fa5]/g) || []).length,
    japanese: (cleanText.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length,
    korean: (cleanText.match(/[\uac00-\ud7af\u1100-\u115f]/g) || []).length,
    cyrillic: (cleanText.match(/[\u0400-\u04FF]/g) || []).length,
    thai: (cleanText.match(/[\u0e00-\u0e7f]/g) || []).length,
    arabic: (cleanText.match(/[\u0600-\u06ff\u0750-\u077f]/g) || []).length,
  };
  
  const totalChars = cleanText.replace(/\s/g, '').length;
  if (totalChars === 0) return 'zh';
  
  const nonLatinRatios: Record<string, number> = {};
  for (const [lang, count] of Object.entries(nonLatinStats)) {
    nonLatinRatios[lang] = count / totalChars;
  }
  
  const THRESHOLD = 0.2;
  
  // 非拉丁语系优先检测
  if (nonLatinRatios.thai >= THRESHOLD) return 'th';
  if (nonLatinRatios.arabic >= THRESHOLD) return 'ar';
  if (nonLatinRatios.cyrillic >= THRESHOLD) return 'ru';
  if (nonLatinRatios.chinese >= THRESHOLD) return 'zh';
  if (nonLatinRatios.japanese >= THRESHOLD) return 'ja';
  if (nonLatinRatios.korean >= THRESHOLD) return 'ko';
  
  // 2. 检测拉丁语系语言（西班牙语、葡萄牙语、越南语、印尼语）
  const latinResult = detectLatinScript(cleanText);
  console.log('[DEBUG] Latin检测结果:', latinResult);
  if (latinResult && latinResult.confidence >= 0.3) {
    console.log('[DEBUG] 返回拉丁语系:', latinResult.language);
    return latinResult.language;
  }
  
  // 3. 检测英文
  const englishCount = (cleanText.match(/[a-zA-Z]/g) || []).length;
  const englishRatio = englishCount / totalChars;
  
  if (englishRatio >= 0.5) {
    // 英文为主，检查是否有其他语言混入
    const chineseChars = nonLatinStats.chinese;
    
    if (chineseChars > 5) return 'mixed';
    // 英文为主时，只有当拉丁语系置信度 >= 0.7 且英文比率 < 0.7 时才覆盖
    if (latinResult && latinResult.confidence >= 0.7 && englishRatio < 0.7) {
      console.log('[DEBUG] 英文为主但检测到更强的拉丁语系:', latinResult.language);
      return latinResult.language;
    }
    console.log('[DEBUG] 英文为主，返回en');
    
    return 'en';
  }
  
  // 4. 混合语言检测
  const activeNonEnglishCount = Object.entries(nonLatinRatios).filter(([k, v]) => k !== 'chinese' && v >= 0.1).length;
  const chineseChars = nonLatinStats.chinese;
  const englishChars = englishCount;
  
  if (chineseChars > 0 && englishChars > 0) return 'mixed';
  if (chineseChars > 0 && activeNonEnglishCount > 0) return 'mixed';
  if (englishChars > 0 && activeNonEnglishCount > 0) return 'mixed';
  
  // 默认返回中文
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
