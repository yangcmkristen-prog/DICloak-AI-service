import { createClient } from '@supabase/supabase-js';
import type { ApiConfig, Conversation, ConversationContext, KnowledgeBase } from './types';
import { generateId } from './types';

// Supabase 配置
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// ============ 默认配置 ============

export const DEFAULT_SYSTEM_PROMPT = `你是 DICloak 客服助手，只生成可直接发送给客户的回复。

核心规则：
1. 必须按用户问题语言回复正文；短 section 标签必须原样保留，不翻译、不改写。
2. 套餐、价格、成员/环境额度、功能支持必须以内部价格数据为最高优先级；FAQ 仅作补充。禁止编造没有依据的限制、按钮、路径、权限、密码/有效期、额度或操作步骤；可以提供官网或操作指南链接；禁止在对外回复中提到具体知识库文件名、FAQ 文件、价格功能表等内部文件/表名称。功能咨询或故障报错未检索到相关信息时：若涉及 DICloak 软件本身的技术逻辑，应回复“该问题我们需进一步跟技术人员确认”；若属于网络或网站本身的通用问题，可基于通用公开信息组织回答，但第一句必须写明“知识库未检索到相关知识，该回复由AI生成，请核实后回复客户”。
3. 用户提到 ChatGPT、Claude、Midjourney 等工具名称时，不要直接判为终端用户或超出范围；如果语义是在管理、分发、共享、配置这些工具账号，应按 DICloak 客户/管理员问题回复。
4. 身份定义：客户是管理和分享 AI/其他工具账号的人；终端用户是使用客户售卖或分配的工具账号的人。只有明确说明账号由别人/第三方/管理员提供且自己不是管理者时，才按终端用户处理；不确定时先询问身份。
5. 故障信息不足时，优先收集报错、截图/录屏、操作步骤、账号来源、使用场景。

输出格式：
[[question]]
xxx
[[/question]]
[[main]]
xxx
[[/main]]
[[supplement]]
xxx
[[/supplement]]
[[info]]
xxx
[[/info]]`;

export const DEFAULT_API_CONFIG: ApiConfig = {
  provider: 'coze',
  apiKey: '',
  model: 'doubao-seed-2-0-lite-260215',
  baseUrl: '',
};

export const MODEL_OPTIONS = [
  // Coze 平台模型
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
  // GPT / TokenLab 模型（OpenAI 兼容）
  { value: 'gpt-5.4', label: 'GPT-5.4', provider: 'gpt' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', provider: 'gpt' },
  { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', provider: 'gpt' },
  { value: 'gpt-5.2', label: 'GPT-5.2', provider: 'gpt' },
  // 阿里百炼模型
  { value: 'qwen-mt-flash', label: 'Qwen MT Flash（翻译）', provider: 'aliyun' },
  { value: 'qwen-vl-ocr', label: 'Qwen VL OCR（图片识别）', provider: 'aliyun' },
  { value: 'qwen-mt-lite', label: 'Qwen MT Lite（翻译）', provider: 'aliyun' },
  { value: 'qwen-mt-plus', label: 'Qwen MT Plus（翻译）', provider: 'aliyun' },
  { value: 'qwen-mt-turbo', label: 'Qwen MT Turbo（翻译）', provider: 'aliyun' },
  // DeepSeek 直连模型 (v4 版本)
  { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (快速)', provider: 'deepseek' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro (增强)', provider: 'deepseek' },
];

export const PROVIDER_INFO: Record<string, {
  label: string;
  name: string;
  defaultModel: string;
  baseUrl: string;
  keyPlaceholder: string;
}> = {
  coze: {
    label: '豆包/Coze',
    name: '豆包/Coze',
    defaultModel: 'doubao-seed-2-0-lite-260215',
    baseUrl: '',
    keyPlaceholder: '输入你的 Coze API Token',
  },
  gpt: {
    label: 'GPT / TokenLab',
    name: 'GPT / TokenLab',
    defaultModel: 'gpt-5.4',
    baseUrl: 'https://api.tokenlab.sh/v1',
    keyPlaceholder: '输入你的 TokenLab API Key (sk-xxx)',
  },
  aliyun: {
    label: '阿里百炼',
    name: '阿里百炼',
    defaultModel: 'qwen-mt-flash',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    keyPlaceholder: '输入你的 百炼 API Token',
  },
  deepseek: {
    label: 'DeepSeek',
    name: 'DeepSeek',
    defaultModel: 'deepseek-v4-flash',
    baseUrl: 'https://api.deepseek.com', // 不需要 /v1 后缀
    keyPlaceholder: '输入你的 DeepSeek API Key (sk-xxx)',
  },
};

// ============ 类型定义 ============

// 重新导出类型
export type { Conversation, ConversationContext, ApiConfig } from './types';

// 创建默认对话上下文
export function createDefaultContext(): ConversationContext {
  return {
    clientLanguage: '',
    summary: '',
    confirmedIdentity: null,
    roleSource: null,
    confirmedProblemType: null,
    confirmedFunctionModule: null,
    confirmedErrorInfo: null,
    confirmedOperationSteps: null,
    hasScreenshot: false,
    hasRecording: false,
    subscriptionIntent: null,
    previousSuggestions: [],
    missingInfo: [],
  };
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// ============ 知识库相关 ============

const KNOWLEDGE_CONFIG_KEY = 'default';

export async function getKnowledgeBase(): Promise<Partial<KnowledgeBase>> {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('knowledge_configs')
        .select('config_key, knowledge_data')
        .eq('config_key', KNOWLEDGE_CONFIG_KEY)
        .maybeSingle();
      
      if (!error && data && data.knowledge_data) {
        // knowledge_data 是完整的 KnowledgeBase 对象
        return data.knowledge_data;
      }
    }
  } catch (e) {
    console.error('获取知识库失败:', e);
  }
  
  const local = localStorage.getItem('diclok_knowledge');
  return local ? JSON.parse(local) : {};
}

export async function saveKnowledgeBase(data: Partial<KnowledgeBase>): Promise<void> {
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

export function getKnowledgeStats(data?: Partial<KnowledgeBase>): {
  faqCount: number;
  troubleshootingCount: number;
  troubleshootingFlowCount: number;
  outOfScopeCount: number;
  mappingCount: number;
  functionCount: number;
  termCount: number;
  apiEndpointCount: number;
  apiParameterCount: number;
  pricingPlanCount: number;
  lastUpdated: number;
  fileNames: {
    faqFile?: string;
    termFile?: string;
    functionFile?: string;
    apiFile?: string;
    pricingFile?: string;
    allFiles?: string[];
  };
} {
  const result = {
    faqCount: 0,
    troubleshootingCount: 0,
    troubleshootingFlowCount: 0,
    outOfScopeCount: 0,
    mappingCount: 0,
    functionCount: 0,
    termCount: 0,
    apiEndpointCount: 0,
    apiParameterCount: 0,
    pricingPlanCount: 0,
    lastUpdated: 0,
    fileNames: {} as { faqFile?: string; termFile?: string; functionFile?: string; apiFile?: string; pricingFile?: string; allFiles?: string[] },
  };
  
  // 如果没有传入数据，从 localStorage 读取
  let kbData: Partial<KnowledgeBase> | undefined = data;
  if (!kbData) {
    try {
      const local = localStorage.getItem('diclok_knowledge');
      if (local) {
        kbData = JSON.parse(local);
      } else {
        return result;
      }
    } catch (e) {
      console.error('读取知识库失败:', e);
      return result;
    }
  }
  
  const knowledgeData = kbData!;
  
  // 统计各项数量
  if (knowledgeData.faqItems) {
    result.faqCount += knowledgeData.faqItems.length;
  }
  if (knowledgeData.troubleshootingItems) {
    result.troubleshootingCount += knowledgeData.troubleshootingItems.length;
  }
  if (knowledgeData.troubleshootingFlowItems) {
    result.troubleshootingFlowCount += knowledgeData.troubleshootingFlowItems.length;
  }
  if (knowledgeData.outOfScopeItems) {
    result.outOfScopeCount += knowledgeData.outOfScopeItems.length;
  }
  if (knowledgeData.mappingItems) {
    result.mappingCount += knowledgeData.mappingItems.length;
  }
  if (knowledgeData.functionKnowledge) {
    result.functionCount += knowledgeData.functionKnowledge.length;
  }
  if (knowledgeData.termItems) {
    result.termCount += knowledgeData.termItems.length;
  }
  if (knowledgeData.apiEndpoints) {
    result.apiEndpointCount += knowledgeData.apiEndpoints.length;
  }
  if (knowledgeData.apiParameters) {
    result.apiParameterCount += knowledgeData.apiParameters.length;
  }
  if (knowledgeData.pricingPlans) {
    result.pricingPlanCount += knowledgeData.pricingPlans.length;
  }
  
  // 获取文件名
  if (knowledgeData.fileNames) {
    result.fileNames = knowledgeData.fileNames;
  }
  
  // 获取更新时间
  if (knowledgeData.lastUpdated) {
    result.lastUpdated = knowledgeData.lastUpdated;
  }
  
  return result;
}

export function replaceKnowledgeData(existing: Record<string, unknown>, newData?: Record<string, unknown>): Record<string, unknown> {
  const result = { ...existing };
  
  if (!newData) return result;
  
  // 遍历 newData 的所有键值对
  for (const [key, value] of Object.entries(newData)) {
    // 如果值是数组，展开到扁平格式
    if (Array.isArray(value)) {
        for (const item of value as Array<Record<string, unknown>>) {
        if (typeof item.id === "string") {
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
    updatedAt: Date.now(),
    context: {
      clientLanguage: '',
      confirmedIdentity: null,
      roleSource: null,
      confirmedProblemType: null,
      confirmedFunctionModule: null,
      confirmedErrorInfo: null,
      confirmedOperationSteps: null,
      hasScreenshot: false,
      hasRecording: false,
      subscriptionIntent: null,
      previousSuggestions: [],
      missingInfo: [],
      summary: ''
    }
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
function detectLatinScript(text: string): { language: DetectedLanguage; confidence: number; detected: boolean } | null {
  if (text.length < 5) return null;
  
  // 越南语特殊字符检测（优先检测，因为有独特的字母组合）
  const hasVietnamese = /[ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(text);
  if (hasVietnamese) {
    return { language: 'vi', confidence: 0.95, detected: true };
  }
  
  // 葡萄牙语特殊字符检测（优先检测）
  const hasPortugueseChars = /[ãõçáéíóúàèìòùâêîôûãõÃÕÇÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛ]/i.test(text);
  
  // 印尼语特征词汇（印尼语特有的词，使用单词边界）
  const indonesianWords = ['kamu', 'mereka', 'kami', 'kita', 'gimana', 'nggak', 'banget', 'masak', 'jangan', 'udah', 'dong', 'kok', 'kan', 'tuh', 'deh', 'nih', 'aja', 'sih', 'gue', 'lu', 'ane', 'ente', 'mu', 'nya', 'kira', 'tiba', 'mau', 'bisa', 'gak', 'suka', 'bukan', 'halo', 'terima', 'kasih', 'tolong', 'ya', 'okee', 'siapa', 'apa', 'kenapa', 'di mana', 'bagaimana', 'yang', 'ada', 'ini', 'itu', 'dari', 'dengan', 'untuk', 'pada', 'ke', 'dalam', 'tidak', 'mana'];
  
  // 葡萄牙语特征词汇（葡萄牙语特有的词，使用单词边界）
  const portugueseWords = ['tem', 'alguma', 'forma', 'ficarem', 'visiveis', 'membros', 'perfil', 'perfis', 'nao', 'voce', 'voces', 'ola', 'obrigado', 'obrigada', 'trabalho', 'problema', 'tenho', 'preciso', 'precisamos', 'ajuda', 'sinal', 'erro', 'funciona', 'login', 'sessao', 'entrar', 'este', 'estao', 'esses', 'essas', 'onde', 'quando', 'como', 'porque', 'bem', 'muito', 'pouco', 'bom', 'ruim', 'sim', 'nao', 'ja', 'agora', 'depois', 'antes', 'sempre', 'nunca', 'talvez', 'certamente', 'provavelmente', 'aqui', 'ali', 'embaixo', 'em cima', 'longe', 'perto', 'elemento', 'topo', 'ocultar', 'perfil', 'Vyral', 'conseguir', 'por favor', 'boa', 'boas', 'tardes', 'noite', 'dias', 'tudo', 'falar', 'sinto', 'tenho'];
  
  // 西班牙语特征词汇（西班牙语特有的词，使用单词边界）
  const spanishWords = ['hay', 'alguna', 'visibles', 'miembros', 'perfil', 'perfiles', 'cuenta', 'compartir', 'equipo', 'suscripcion', 'hola', 'gracias', 'trabajo', 'trabajos', 'necesito', 'ayudar', 'senal', 'funciona', 'ayuda', 'iniciar', 'eliminar', 'imagenes', 'hacer', 'quiero', 'puedo', 'tiene', 'tienen', 'donde', 'cuando', 'porque', 'pero', 'este', 'esta', 'esto', 'estos', 'estas', 'esos', 'esas', 'sobre', 'tener', 'hacer', 'ir', 'ver', 'dar', 'saber', 'querer', 'poder', 'deber', 'decir', 'quien', 'cual', 'cuanto', 'aqui', 'alli', 'ahora', 'luego', 'despues', 'siempre', 'nunca', 'tambien', 'solo', 'entonces', 'bueno', 'vale', 'mira', 'oye', 'favor', 'saludos', 'ayudame'];
  
  // 计算单词总数
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const totalWords = words.length || 1;
  
  // 辅助函数：使用单词边界匹配
  const countMatches = (wordList: string[]): number => {
    return wordList.filter(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      return regex.test(text);
    }).length;
  };
  
  // 计算各语言匹配分数
  const spanishScore = countMatches(spanishWords);
  const portugueseScore = countMatches(portugueseWords) + (hasPortugueseChars ? 2 : 0); // 特殊字符加权
  const indonesianScore = countMatches(indonesianWords);
  
  console.log('[DEBUG] 拉丁语检测 - 西班牙语:', spanishScore, '葡萄牙语:', portugueseScore, '印尼语:', indonesianScore, '总词数:', totalWords, 'PT特殊字符:', hasPortugueseChars);
  
  // 如果有葡萄牙语特殊字符，直接返回葡萄牙语
  if (hasPortugueseChars) {
    return { language: 'pt', confidence: 0.85, detected: true };
  }
  
  // 如果有匹配的小语种词汇（分数 >= 1），返回检测到的语言
  if (spanishScore >= 1 && spanishScore >= portugueseScore && spanishScore >= indonesianScore) {
    return { language: 'es', confidence: Math.min(spanishScore / totalWords * 2, 0.95), detected: true };
  }
  
  if (portugueseScore >= 1 && portugueseScore >= spanishScore && portugueseScore >= indonesianScore) {
    return { language: 'pt', confidence: Math.min(portugueseScore / totalWords * 2, 0.95), detected: true };
  }
  
  if (indonesianScore >= 1 && indonesianScore >= spanishScore && indonesianScore >= portugueseScore) {
    return { language: 'id', confidence: Math.min(indonesianScore / totalWords * 2, 0.95), detected: true };
  }
  
  // 没有检测到明确的小语种特征
  return { language: 'en', confidence: 0, detected: false };
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
  
  // 2. 检测拉丁语系小语种（西班牙语、葡萄牙语、越南语、印尼语）
  // 如果检测到任何小语种特征，直接返回该语言
  const latinResult = detectLatinScript(cleanText);
  console.log('[DEBUG] Latin检测结果:', latinResult);
  if (latinResult && latinResult.detected) {
    console.log('[DEBUG] 返回小语种:', latinResult.language);
    return latinResult.language;
  }
  
  // 3. 其他语言检测
  const englishCount = (cleanText.match(/[a-zA-Z]/g) || []).length;
  
  // 混合语言检测
  const activeNonEnglishCount = Object.entries(nonLatinRatios).filter(([k, v]) => k !== 'chinese' && v >= 0.1).length;
  const chineseChars = nonLatinStats.chinese;
  
  if (chineseChars > 0 && englishCount > 0) return 'mixed';
  if (chineseChars > 0 && activeNonEnglishCount > 0) return 'mixed';
  
  // 默认返回英文（如果没有任何非英文特征）
  console.log('[DEBUG] 无小语种特征，返回en');
  return 'en';
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
