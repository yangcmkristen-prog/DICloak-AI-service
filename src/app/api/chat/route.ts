import { NextRequest, NextResponse } from "next/server";
import { LLMClient, Config } from "coze-coding-dev-sdk";
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { KnowledgeBase } from '@/lib/types';

function sanitizeCustomerFacingContent(content: string): string {
  return content
    .replace(/根据(?:当前)?(?:价格功能表|Pricing Feature Comparison Table|pricing table)(?:中的)?(?:信息|数据)?[，,：:]?/gi, '')
    .replace(/(?:当前)?(?:价格功能表|Pricing Feature Comparison Table|pricing table)(?:显示|中显示|记录|中记录)[，,：:]?/gi, '')
    .replace(/(?:FAQ|价格功能表|Pricing Feature Comparison Table|pricing table|检索结果|表格显示)[：:]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


function detectRequestLanguage(text: string, provided?: string): string {
  if (provided && provided !== 'other') {
    return provided;
  }

  const cleanText = text.trim();
  const totalChars = cleanText.replace(/\s/g, '').length;
  if (totalChars === 0) {
    return 'zh';
  }

  const scripts: Array<[string, RegExp]> = [
    ['ru', /[\u0400-\u04FF]/g],
    ['ar', /[\u0600-\u06ff\u0750-\u077f]/g],
    ['th', /[\u0e00-\u0e7f]/g],
    ['ja', /[\u3040-\u30ff]/g],
    ['ko', /[\uac00-\ud7af\u1100-\u115f]/g],
    ['zh', /[\u4e00-\u9fa5]/g],
  ];

  for (const [language, pattern] of scripts) {
    const count = (cleanText.match(pattern) || []).length;
    if (count / totalChars >= 0.2) {
      return language;
    }
  }

  return /[a-zA-Z]/.test(cleanText) ? 'en' : 'zh';
}

// ==================== 后端获取 API 配置 ====================

async function getBackendApiConfig(): Promise<{
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
} | null> {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('system_configs')
      .select('*')
      .eq('config_key', 'default')
      .maybeSingle();

    if (error || !data?.config_value?.apiConfig) {
      return null;
    }

    return data.config_value.apiConfig;
  } catch (error) {
    console.error('[API Config] 获取后端配置失败:', error);
    return null;
  }
}

// 获取系统配置版本信息
async function getSystemConfigVersion(): Promise<{ version: number; updatedAt: string } | null> {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('system_configs')
      .select('version, updated_at')
      .eq('config_key', 'default')
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return {
      version: data.version || 1,
      updatedAt: data.updated_at || new Date().toISOString(),
    };
  } catch (error) {
    console.error('[Config Version] 获取版本信息失败:', error);
    return null;
  }
}

// ==================== 问题类型与身份识别 ====================

type ProblemType = 
  | 'api_problem'           // API 问题
  | 'subscription_problem'  // 套餐/价格/订阅问题
  | 'troubleshooting'       // 故障排查
  | 'info_insufficient'     // 信息不足
  | 'intent_unclear'        // 意图不明确
  | 'out_of_scope'          // 超出支持范围
  | 'feature_faq'           // 功能咨询
  | 'user_routing';         // 终端用户问题
type UserRole = 'client' | 'end_user' | 'unknown';

type TableId = "faq" | "troubleshooting" | "out_of_scope" | "function_knowledge" | "api_endpoints" | "pricing_table";

type ClassificationIntent = {
  type: ProblemType;
  confidence: number;
  tables: Array<{ id: TableId; action?: "full" | "filter" | "match"; filter?: Record<string, unknown> | null }>;
  entities?: {
    planNames?: string[];
    apiType?: string | null;
    apiModule?: string | null;
    apiMethod?: string | null;
    action?: string | null;
    feature?: string | null;
    errorMessage?: string | null;
  };
};

type ClassificationResult = {
  problemType?: ProblemType;
  primaryIntent?: ProblemType;
  identityStatus?: UserRole;
  tables?: Array<{ id?: TableId; action?: 'full' | 'filter' | 'match'; filter?: Record<string, unknown> | null }>;
  confidence?: number;
  reasoning?: string;
  intents?: ClassificationIntent[];
  needsFollowUp?: boolean;
  followUpQuestions?: string[];
};

function readStringField(source: Record<string, unknown>, field: string): string {
  const value = source[field];
  return typeof value === "string" ? value : "";
}

function extractTextFromContentParts(parts: unknown[]): string {
  return parts.map((part) => {
    if (typeof part === "string") {
      return part;
    }

    if (part && typeof part === "object") {
      return readStringField(part as Record<string, unknown>, "text");
    }

    return "";
  }).join("");
}

function extractTextFromLlmChunk(chunk: unknown): string {
  if (typeof chunk === "string") {
    return chunk;
  }

  if (!chunk || typeof chunk !== "object") {
    return "";
  }

  const chunkRecord = chunk as Record<string, unknown>;

  const content = chunkRecord.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return extractTextFromContentParts(content);
  }

  const text = readStringField(chunkRecord, "text");
  if (text) {
    return text;
  }

  const delta = chunkRecord.delta;
  if (delta && typeof delta === "object") {
    const deltaContent = (delta as Record<string, unknown>).content;

    if (typeof deltaContent === "string") {
      return deltaContent;
    }

    if (Array.isArray(deltaContent)) {
      return extractTextFromContentParts(deltaContent);
    }
  }

  return "";
}

// ==================== 信息不足检测 ====================

/**
 * 检测是否为信息不足场景
 */
function checkInfoInsufficient(message: string): { isInsufficient: boolean; missingInfo: string[] } {
  const msgLower = message.toLowerCase().trim();
  const missingInfo: string[] = [];
  
  // 宽泛描述关键词
  const vaguePhrases = [
    '打不开', '进不去', '有问题', '失败了', '不能用', '不工作', 
    '异常', '报错', 'error', 'failed', 'not working', 'broken',
    '不行', '无法', '不能', '出问题'
  ];
  
  // 检查是否只有宽泛描述
  const hasVaguePhrase = vaguePhrases.some(p => msgLower.includes(p));
  
  // 检查是否缺少具体信息
  const hasErrorDetail = msgLower.length > 30 && 
    (msgLower.includes('错误') || msgLower.includes('error code') || 
     msgLower.includes('err_') || msgLower.includes('0x'));
  const hasOperationSteps = msgLower.includes('步骤') || msgLower.includes('操作') || 
    msgLower.includes('点击') || msgLower.includes('选择') || msgLower.includes('step');
  const hasScreenshot = msgLower.includes('截图') || msgLower.includes('录屏') || 
    msgLower.includes('screenshot') || msgLower.includes('图片');
  const hasSpecificModule = msgLower.includes('环境') || msgLower.includes('成员') || 
    msgLower.includes('代理') || msgLower.includes('扩展') || msgLower.includes('分组');
  const hasIdentity = msgLower.includes('管理员') || msgLower.includes('成员') || 
    msgLower.includes('终端用户') || msgLower.includes('我购买');
  
  // 收集缺少的信息
  if (!hasErrorDetail) missingInfo.push('具体报错内容或错误代码');
  if (!hasOperationSteps) missingInfo.push('操作步骤描述');
  if (!hasScreenshot) missingInfo.push('截图或录屏');
  if (!hasSpecificModule) missingInfo.push('具体功能模块');
  if (!hasIdentity) missingInfo.push('使用身份（管理员/成员/终端用户）');
  
  // 判断是否为信息不足
  const isInsufficient = hasVaguePhrase && 
    message.length < 50 && 
    !hasErrorDetail && 
    !hasOperationSteps &&
    missingInfo.length >= 3;
  
  return { isInsufficient, missingInfo };
}

// ==================== API 问题检测 ====================

const API_KEYWORDS = [
  'api', '接口', 'endpoint', 'request', 'response', 
  'parameter', '参数', 'http', 'rest', 'webhook',
  '调用', '请求', '返回', 'json', 'curl'
];

function checkApiProblem(message: string): { isApiProblem: boolean; apiAction?: string; apiObject?: string } {
  const msgLower = message.toLowerCase();
  
  // 检查是否包含 API 相关关键词
  const hasApiKeyword = API_KEYWORDS.some(kw => msgLower.includes(kw));
  if (!hasApiKeyword) {
    return { isApiProblem: false };
  }
  
  // 识别操作动作
  const actionPatterns: Record<string, string[]> = {
    'create': ['创建', '新增', '添加', 'create', 'add', 'new', 'post'],
    'read': ['查询', '获取', '读取', 'get', 'read', 'list', 'fetch', '获取'],
    'update': ['修改', '更新', '编辑', 'update', 'edit', 'modify', 'put', 'patch'],
    'delete': ['删除', '移除', 'delete', 'remove', 'del'],
    'start': ['启动', '开启', 'start', 'launch', 'open'],
    'stop': ['停止', '关闭', 'stop', 'close', 'shutdown'],
    'import': ['导入', 'import', 'upload'],
    'export': ['导出', 'export', 'download']
  };
  
  let apiAction: string | undefined;
  for (const [action, patterns] of Object.entries(actionPatterns)) {
    if (patterns.some(p => msgLower.includes(p))) {
      apiAction = action;
      break;
    }
  }
  
  // 识别操作对象
  const objectPatterns: Record<string, string[]> = {
    'environment': ['环境', 'environment', 'profile', '浏览器'],
    'member': ['成员', 'member', '用户', 'user'],
    'group': ['分组', 'group', '群组'],
    'proxy': ['代理', 'proxy'],
    'extension': ['扩展', 'extension', '插件', 'plugin'],
    'account': ['账号', 'account'],
    'tag': ['标签', 'tag', '标记']
  };
  
  let apiObject: string | undefined;
  for (const [obj, patterns] of Object.entries(objectPatterns)) {
    if (patterns.some(p => msgLower.includes(p))) {
      apiObject = obj;
      break;
    }
  }
  
  return { isApiProblem: true, apiAction, apiObject };
}

/**
 * 检索 API 端点表
 * 根据 apiAction 和 apiObject 检索 API 端点与参数明细表
 */
function searchApiEndpoints(
  apiAction: string | undefined,
  apiObject: string | undefined,
  apiEndpoints: Array<{
    apiId?: string;
    apiName?: string;
    apiType?: string;
    method?: string;
    endpoint?: string;
    description?: string;
    module?: string;
    object?: string;
    operation?: string;
    isSupported?: boolean;
  }>,
  apiParameters: Array<{
    apiId?: string;
    paramName?: string;
    paramType?: string;
    isRequired?: boolean;
    defaultValue?: string;
    description?: string;
    validationRule?: string;
    example?: string;
  }> = []
): {
  found: boolean;
  endpoints: typeof apiEndpoints;
  parameters: typeof apiParameters;
  summary: string;
} {
  if (!apiEndpoints || apiEndpoints.length === 0) {
    return { found: false, endpoints: [], parameters: [], summary: 'API 端点表未加载' };
  }

  // 过滤匹配的端点
  const matchedEndpoints = apiEndpoints.filter(ep => {
    // 从 apiName 推断操作和对象
    const apiNameLower = (ep.apiName || '').toLowerCase();
    const methodLower = (ep.method || '').toLowerCase();
    const apiIdLower = (ep.apiId || '').toLowerCase();
    
    // 匹配操作类型
    let actionMatch = true;
    if (apiAction) {
      const actionKeywords: Record<string, string[]> = {
        'create': ['创建', '新增', '添加', 'create', 'add', 'new'],
        'read': ['查询', '获取', '读取', 'get', 'read', 'list', 'fetch'],
        'update': ['修改', '更新', '编辑', 'update', 'edit', 'modify'],
        'delete': ['删除', '移除', 'delete', 'remove', 'del'],
        'start': ['启动', '开启', 'start', 'launch', 'open', '打开'],
        'stop': ['停止', '关闭', 'stop', 'close'],
        'import': ['导入', 'import', 'upload'],
        'export': ['导出', 'export', 'download']
      };
      const keywords = actionKeywords[apiAction] || [apiAction];
      actionMatch = keywords.some(k => 
        apiNameLower.includes(k.toLowerCase()) || 
        methodLower.includes(k.toLowerCase()) ||
        apiIdLower.includes(k.toLowerCase())
      );
    }
    
    // 匹配操作对象
    let objectMatch = true;
    if (apiObject) {
      const objectKeywords: Record<string, string[]> = {
        'environment': ['环境', 'environment', 'profile', '浏览器', 'env'],
        'member': ['成员', 'member', '用户', 'user'],
        'group': ['分组', 'group', '群组'],
        'proxy': ['代理', 'proxy'],
        'extension': ['扩展', 'extension', '插件', 'plugin'],
        'account': ['账号', 'account'],
        'tag': ['标签', 'tag']
      };
      const keywords = objectKeywords[apiObject] || [apiObject];
      objectMatch = keywords.some(k => 
        apiNameLower.includes(k.toLowerCase()) || 
        apiIdLower.includes(k.toLowerCase()) ||
        (ep.endpoint || '').toLowerCase().includes(k.toLowerCase())
      );
    }
    
    return actionMatch && objectMatch;
  });

  if (matchedEndpoints.length === 0) {
    return { 
      found: false, 
      endpoints: [], 
      parameters: [], 
      summary: `未找到匹配的 API 端点 (操作: ${apiAction || '未知'}, 对象: ${apiObject || '未知'})` 
    };
  }

  // 获取关联的参数
  const matchedApiIds = matchedEndpoints.map(ep => ep.apiId).filter(Boolean);
  const matchedParameters = apiParameters.filter(p => 
    p.apiId && matchedApiIds.includes(p.apiId)
  );

  // 生成摘要
  const summary = matchedEndpoints.map(ep => {
    const params = matchedParameters.filter(p => p.apiId === ep.apiId);
    const requiredParams = params.filter(p => p.isRequired).map(p => p.paramName);
    return `${ep.apiName || ep.apiId}: ${ep.method} ${ep.endpoint}${requiredParams.length > 0 ? ` (必填: ${requiredParams.join(', ')})` : ''}`;
  }).join('\n');

  return {
    found: true,
    endpoints: matchedEndpoints,
    parameters: matchedParameters,
    summary
  };
}

/**
 * 检索价格功能表
 */
function searchPricingPlans(
  pricingPlans: Array<{
    planName?: string;
    planNameCN?: string;
    price?: number;
    priceUnit?: string;
    memberLimit?: number;
    environmentLimit?: number;
    profileLimit?: number;
    features?: string[];
    description?: string;
  }>,
  query?: string
): {
  found: boolean;
  plans: typeof pricingPlans;
  summary: string;
} {
  if (!pricingPlans || pricingPlans.length === 0) {
    return { found: false, plans: [], summary: '价格功能表未加载' };
  }

  // 如果有查询关键词，过滤匹配的套餐
  let matchedPlans = pricingPlans;
  if (query) {
    const queryLower = query.toLowerCase();
    matchedPlans = pricingPlans.filter(plan => 
      (plan.planName && plan.planName.toLowerCase().includes(queryLower)) ||
      (plan.planNameCN && plan.planNameCN.includes(query)) ||
      (plan.features && plan.features.some(f => f.toLowerCase().includes(queryLower)))
    );
  }

  if (matchedPlans.length === 0) {
    return { found: false, plans: [], summary: '未找到匹配的套餐信息' };
  }

  // 生成摘要
  const summary = matchedPlans.map(plan => {
    const features = plan.features?.slice(0, 3).join(', ') || '';
    return `${plan.planNameCN || plan.planName}: ¥${plan.price}/${plan.priceUnit}${plan.memberLimit ? `, 成员数: ${plan.memberLimit}` : ''}${plan.environmentLimit ? `, 环境数: ${plan.environmentLimit}` : ''}${features ? `\n  功能: ${features}...` : ''}`;
  }).join('\n\n');

  return {
    found: true,
    plans: matchedPlans,
    summary
  };
}

// ==================== 套餐/价格问题检测 ====================

const SUBSCRIPTION_KEYWORDS = [
  '订阅', '套餐', '价格', '购买', 'plan', 'price', 
  'billing', 'upgrade', '付费', '订阅', '续费', '续订',
  'subscription', 'pricing', '多少钱', '收费', 'renew', 'renewal', 'renovar', 'renovación'
];

// 套餐名称关键词（用于识别套餐功能对比问题）
const PLAN_NAME_KEYWORDS = [
  '免费版', 'free', '基础版', 'base', '高阶版', 'plus', 
  '共享版', 'share', '专业版', 'pro', '企业版', 'enterprise',
  'free plan', 'base plan', 'plus plan', 'share plan'
];

// 这些是第三方工具/用途名称，不代表一定是非 DICloak 业务；
// 只有在后续规则排除 DICloak/账号管理上下文后，才可能用于超范围判断。
const EXTERNAL_TOOL_KEYWORDS = [
  'chatgpt', 'gpt', 'claude', 'ai写作', 'ai生成',
  '编程', '写代码', '视频制作', '剪辑', '绘图',
  'midjourney', 'runway', 'freepik', 'canva',
  '文案', '翻译', '配音'
];

const DICLOAK_CONTEXT_SIGNALS = [
  'dicloak', '浏览器', '环境', '账号共享', '多账号', 'profile', 'env', 'environment',
];

const ACCOUNT_MANAGEMENT_SIGNALS = [
  '团队', '成员', '分发', '分享', '共享', '管理', '配置', '设置', '环境', 'profile',
  '多人', '额度', '席位', 'seat', 'member', 'team', 'share', 'distribute', 'manage',
  'команда', 'команд', 'человек', 'пользовател', 'раздать', 'выдать', 'поделиться',
  'настроить', 'настрой', 'профиль', 'аккаунт', 'учетн',
];

function hasAnySignal(text: string, signals: string[]): boolean {
  return signals.some((signal) => text.includes(signal));
}

function hasExternalToolMention(text: string): boolean {
  return EXTERNAL_TOOL_KEYWORDS.some((keyword) => text.includes(keyword));
}

function hasOutOfScopeExternalToolMention(text: string): boolean {
  return hasExternalToolMention(text) &&
    !hasAnySignal(text, DICLOAK_CONTEXT_SIGNALS) &&
    !hasAnySignal(text, ACCOUNT_MANAGEMENT_SIGNALS);
}

function checkSubscriptionProblem(message: string): { 
  isSubscriptionProblem: boolean; 
  isDicloak: boolean | null;  // true=明确是DICloak, false=明确不是, null=不明确
  nonDicloakPurpose?: string;
} {
  const msgLower = message.toLowerCase();
  
  // 检查是否包含订阅/价格相关关键词
  const hasSubscriptionKeyword = SUBSCRIPTION_KEYWORDS.some(kw => msgLower.includes(kw));
  
  // 检查是否包含套餐名称（用于识别"基础版支持XX功能"类问题）
  const hasPlanName = PLAN_NAME_KEYWORDS.some(kw => msgLower.includes(kw.toLowerCase()));
  
  if (!hasSubscriptionKeyword && !hasPlanName) {
    return { isSubscriptionProblem: false, isDicloak: null };
  }
  
  const hasDicloakContext = hasAnySignal(msgLower, DICLOAK_CONTEXT_SIGNALS);
  const hasAccountManagementContext = hasAnySignal(msgLower, ACCOUNT_MANAGEMENT_SIGNALS);
  const externalToolMention = hasExternalToolMention(msgLower);

  if (hasDicloakContext || hasAccountManagementContext) {
    return { isSubscriptionProblem: true, isDicloak: true };
  }

  // 多语言输入无法靠有限关键词穷尽识别“管理/分发账号”的语义。
  // 因此，订阅/套餐问题只要提到第三方工具，就保持意图不明确并带上价格表，交由后续追问或 LLM 语义分类处理，
  // 避免把多语言的 Claude/ChatGPT 账号管理问题误判为超范围。
  if (externalToolMention) {
    return { isSubscriptionProblem: true, isDicloak: null, nonDicloakPurpose: 'external_tool_subscription' };
  }
  
   // 意图不明确
  return { isSubscriptionProblem: true, isDicloak: null };
}

function hasAmbiguousExternalToolTrouble(message: string): boolean {
  const msgLower = message.toLowerCase();
  const hasExternalToolName = hasExternalToolMention(msgLower);
  if (!hasExternalToolName) {
    return false;
  }

  const troubleKeywords = [
    '打不开', '无法打开', '开不了', '不能打开', '进不去', '无法访问', '访问不了',
    '登录不了', '登不上', '不能登录', '无法登录', '报错', '错误', '异常', '失败',
    'cannot open', 'can not open', "can't open", 'cannot access', 'can not access',
    "can't access", 'not opening', 'not working', 'login failed', 'error', 'failed',
  ];

  return troubleKeywords.some((kw) => msgLower.includes(kw));
}

/**
 * 识别问题类型（后端规则分类，AI 不能改变）
 */
function identifyProblemType(
  message: string,
  matchedFaqScore: number,
  matchedTsScore: number,
  matchedOosScore: number
): { type: ProblemType; reason: string; apiInfo?: ReturnType<typeof checkApiProblem>; subscriptionInfo?: ReturnType<typeof checkSubscriptionProblem> } {
  const msgLower = message.toLowerCase().trim();
  
  // 1. 信息不足检测（优先级最高）
  const infoCheck = checkInfoInsufficient(message);
  if (infoCheck.isInsufficient) {
    return { 
      type: 'info_insufficient', 
      reason: `信息不足，缺少：${infoCheck.missingInfo.join('、')}` 
    };
  }
  
  // 2. API 问题检测
  const apiCheck = checkApiProblem(message);
  if (apiCheck.isApiProblem) {
    return { 
      type: 'api_problem', 
      reason: `API问题 - 动作: ${apiCheck.apiAction || '未知'}, 对象: ${apiCheck.apiObject || '未知'}`,
      apiInfo: apiCheck
    };
  }
  
  // 3. 套餐/价格问题检测
  const subscriptionCheck = checkSubscriptionProblem(message);
  if (subscriptionCheck.isSubscriptionProblem) {
    // 明确不是 DICloak 用途 → 超出支持范围
    if (subscriptionCheck.isDicloak === false) {
      return { 
        type: 'out_of_scope', 
        reason: `超出支持范围 - 用户询问: ${subscriptionCheck.nonDicloakPurpose}`,
        subscriptionInfo: subscriptionCheck
      };
    }
    // 意图不明确 → 需要澄清
    if (subscriptionCheck.isDicloak === null) {
      return { 
        type: 'intent_unclear', 
        reason: '订阅/价格问题但意图不明确，需澄清是否为 DICloak',
        subscriptionInfo: subscriptionCheck
      };
    }
    // 明确是 DICloak → 套餐问题
    return { 
      type: 'subscription_problem', 
      reason: 'DICloak 套餐/价格问题',
      subscriptionInfo: subscriptionCheck
    };
  }
  
  // 4. 第三方工具名称 + 打不开/访问异常是歧义故障：可能是 DICloak 环境/profile 名称，不直接判为 user_routing 或超范围
  if (hasAmbiguousExternalToolTrouble(message)) {
    return {
      type: 'info_insufficient',
      reason: '第三方工具名称伴随打不开/访问异常，需澄清是 DICloak 环境/profile 还是外部平台本身'
    };
  }

  // 5. 检查是否超出支持范围（非 API/订阅场景）。
  // 注意：第三方工具名称本身不等于非 DICloak 业务；只有没有 DICloak/账号管理上下文时才判超范围。
  if (hasOutOfScopeExternalToolMention(msgLower)) {
    return { type: 'out_of_scope', reason: '超出 DICloak 支持范围' };
  }
  
  // 6. 根据匹配分数判断类型
  if (matchedTsScore >= matchedFaqScore && matchedTsScore >= matchedOosScore && matchedTsScore > 0) {
    return { type: 'troubleshooting', reason: '匹配到故障排查知识库' };
  }
  
  if (matchedOosScore > 0 && matchedOosScore > matchedFaqScore) {
    return { type: 'out_of_scope', reason: '匹配到超出支持范围知识库' };
  }
  
  if (matchedFaqScore > 0) {
    return { type: 'feature_faq', reason: '匹配到功能FAQ知识库' };
  }
  
  // 7. 默认返回信息不足
  return { type: 'info_insufficient', reason: '未匹配到相关知识库' };
}

/**
 * 识别用户身份
 */
function identifyUserRole(message: string, history?: Array<{ role: string; content: string }>): { role: UserRole; reason: string } {
  const allText = (message + ' ' + (history?.map(h => h.content).join(' ') || '')).toLowerCase();
  
  // 终端用户特征
  const endUserIndicators = [
    '账号是别人给的', '账号来自', '第三方', '不是管理员', 
    '服务商', '别人提供的', '管理员给的', '老师给的',
    'account was given', 'from third party', 'not admin'
  ];
  if (endUserIndicators.some(ind => allText.includes(ind))) {
    return { role: 'end_user', reason: '用户提到账号来自第三方或他人' };
  }
  
  // 客户/管理员特征
  const clientIndicators = [
    '我是管理员', '我的团队', '管理成员', '设置环境', 
    '我购买的', '我的套餐', '管理代理', '数据同步', '分发', '分享账号', '共享账号', '团队', '成员', '环境额度',
    'i am admin', 'my team', 'i purchased', 'manage members'
  ];
  if (clientIndicators.some(ind => allText.includes(ind))) {
    return { role: 'client', reason: '用户提到自己是管理员或在进行管理操作' };
  }
  
  return { role: 'unknown', reason: '用户身份不明确' };
}

/**
 * 获取输出格式类型（返回给前端，用于生成格式标题）
 */
function getOutputFormatType(problemType: ProblemType, userRole: UserRole): 'A' | 'B' | 'C' {
  // A. 非故障类问题（feature_faq, out_of_scope, intent_unclear, info_insufficient）
  if (problemType === 'feature_faq' || problemType === 'out_of_scope' || 
      problemType === 'intent_unclear' || problemType === 'info_insufficient') {
    return 'A';
  }
  
  // B. 故障排查 + 身份明确
  if (problemType === 'troubleshooting' && userRole !== 'unknown') {
    return 'B';
  }
  
  // C. 故障排查 + 身份不明确
  return 'C';
}

/**
 * 生成问题类型展示文案。
 */
function getProblemTypeOutputLabel(problemType: ProblemType): string {
  const labels: Record<ProblemType, string> = {
    api_problem: '功能咨询',
    subscription_problem: '功能咨询',
    troubleshooting: '故障排查',
    feature_faq: '功能咨询',
    info_insufficient: '信息不足',
    intent_unclear: '意图不明确',
    out_of_scope: '超出支持范围',
    user_routing: '终端用户问题',
  };

  return labels[problemType] || '功能咨询';
}

/**
 * 生成 AI 输出格式要求。必须和网站系统 Prompt 的 A/B/C 标题保持一致，避免覆盖后台配置的格式。
 */
function generateAIOutputFormat(problemType: ProblemType, userRole: UserRole): string {
  const problemTypeLabel = getProblemTypeOutputLabel(problemType);

  // A 格式：非故障类问题
  if (problemType === 'feature_faq' || problemType === 'out_of_scope' ||
      problemType === 'intent_unclear' || problemType === 'info_insufficient' ||
      problemType === 'api_problem' || problemType === 'subscription_problem' ||
      problemType === 'user_routing') {
    return `## 输出格式要求（必须按网站系统 Prompt 的 A 格式输出）

【问题类型】
${problemTypeLabel}

【主回复｜优先发送】
完整主回复。主回复必须完整，不要拆分到补充建议中。

【补充建议｜可选发送】
独立的补充建议；没有合适补充建议时写：无。

【需要补充的信息】
需要客户补充的信息；不需要补充信息时写：无。`;
  }
  
  // B 格式：故障排查 + 身份明确
  if (problemType === 'troubleshooting' && userRole !== 'unknown') {
    const identityLabel = userRole === 'client' ? 'DICloak 客户' : '终端用户';
    const roleAnswer = userRole === 'client' ? 'client' : 'end_user';
    return `## 输出格式要求（必须按网站系统 Prompt 的 B 格式输出）

【问题类型】
故障排查

【身份状态】
${identityLabel}

【主回复｜优先发送】
完整输出匹配资料中的「标准答案（${roleAnswer}）」，如为空则用「标准答案（通用）」；主回复必须完整，不要拆分到补充建议中。

【补充建议｜可选发送】
独立的补充建议；没有合适补充建议时写：无。

【需要补充的信息】
需要客户补充的信息；不需要补充信息时写：无。`;
  }
  
  // C 格式：故障排查 + 身份不明确
  return `## 输出格式要求（必须按网站系统 Prompt 的 C 格式输出）

【问题类型】
故障排查

【身份状态】
身份不明确，需要客服进一步确认

【通用回复｜不确定身份时优先发送】
完整输出匹配资料中的「标准答案（通用）」，如为空则写：无。

【客户回复｜适用于 DICloak 客户 / 管理员】
完整输出匹配资料中的「标准答案（client）」，如为空则写：无。

【终端用户回复｜简短版】
输出「标准答案（end_user）」的简短版，重点说明需联系账号/服务提供方；如为空则写：无。

【需要补充的信息｜用于继续排查】
生成追问，收集身份相关信息（如：账号是自己管理的还是他人提供的）。`;
}

export async function POST(request: NextRequest) {
  const t0 = Date.now();
  try {
    const body = await request.json();
    console.log(`[PERF][CHAT] body_parsed_ms=${Date.now() - t0}`);
    const { message, history, knowledge, systemPrompt, detectedLanguage, aiKeywords, classification } = body as {
      message?: string;
      history?: Array<{ role: string; content: string }>;
      knowledge?: Partial<KnowledgeBase>;
      systemPrompt?: string;
      detectedLanguage?: string;
      aiKeywords?: string[];
      classification?: ClassificationResult;
    };
    
    
    // 调试：检查接收到的 knowledge
    console.log('[DEBUG] 后端接收到的请求体字段:', Object.keys(body));
    console.log('[DEBUG] knowledge 类型:', typeof knowledge);
    console.log('[DEBUG] knowledge 是否为数组:', Array.isArray(knowledge));
    console.log('[DEBUG] knowledge 是否为对象:', knowledge && typeof knowledge === 'object');
    if (knowledge && typeof knowledge === 'object') {
      console.log('[DEBUG] knowledge 的键:', Object.keys(knowledge));
      console.log('[DEBUG] knowledge.faqItems 数量:', knowledge.faqItems?.length || 0);
    }

    if (!message) {
      return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
    }

    // 调试知识库数据
    const effectiveLanguage = detectRequestLanguage(message, detectedLanguage);
    console.log('[DEBUG] 后端接收语言:', detectedLanguage, '=>', effectiveLanguage);
    console.log('[DEBUG] AI 关键词:', aiKeywords);
    if (knowledge) {
      console.log('[DEBUG] FAQ数量:', knowledge.faqItems?.length || 0);
      console.log('[DEBUG] 术语库数量:', knowledge.termItems?.length || 0);
      console.log('[DEBUG] pricingPlans数量:', knowledge.pricingPlans?.length || 0);
      console.log('[DEBUG] pricingRawTable行数:', knowledge.pricingRawTable?.rows.length || 0);
    }

    // 语言规则映射
    const languageRules: Record<string, string> = {
      zh: "所有回复必须使用中文",
      en: "All replies must be in English",
      es: "Todas las respuestas deben estar en español",
      pt: "Todas as respostas devem estar em português",
      ru: "Все ответы должны быть на русском языке",
      vi: "Tất cả các câu trả lời phải bằng tiếng Việt",
      id: "Semua jawaban harus dalam bahasa Indonesia",
      th: "คำตอบทั้งหมดต้องเป็นภาษาไทย",
      ar: "يجب أن تكون جميع الإجابات باللغة العربية",
      ja: "すべての回答は日本語で作成する必要があります",
      ko: "모든 답변은 한국어로 작성해야 합니다",
      mixed: "用户问题中包含多种语言，请使用中文回复",
    };
    const languageRule = languageRules[effectiveLanguage] || languageRules.zh;
    console.log(`[PERF][CHAT] pre_config_ms=${Date.now() - t0}`);

    // API 配置
    // 从后端获取 API 配置（安全：API Key 不暴露给前端）
    const backendConfig = await getBackendApiConfig();
    const config = backendConfig || { provider: 'coze', apiKey: '', model: 'doubao-seed-2-0-lite-260215', baseUrl: '' };

    // 精简版 System Prompt（复杂逻辑已由前端/后端处理）
    const baseSystemPrompt = `You are a DICloak customer service assistant.

## Core Rules
1. Generate professional, friendly customer replies
2. Use the FAQ StandardAnswer as the basis for your reply
3. Do NOT expose internal logic (FAQ, knowledge base, matching, etc.)
4. Reply in the same language as the user's question
5. Tool names such as ChatGPT or Claude do not by themselves mean end-user or out-of-scope; account management/sharing/distribution questions are DICloak client questions
6. Client = person managing/sharing AI or other tool accounts; end user = person using an account sold or assigned by the client; if role is uncertain, ask for the role before giving role-specific steps

## FAQ Selection
- Choose the FAQ with HIGHEST Score
- Prefer FAQs with Score >= 10
- Start your reply with [FAQ_ID: xxx], [TS_ID: xxx], or [FUNCTION_ID: xxx] when you used the corresponding knowledge source

## Term Translation
- Replace {{UI terms}} with translated terms
- Remove {{}} symbols in output
- For languages not in term library, translate the entire content

## Pricing Rules
- For plan, price, member quota, environment quota, or recommendation questions, the Pricing Feature Comparison Table has highest priority
- Except Free, paid plans can adjust member/environment quotas when the pricing table indicates configurable or purchasable quotas; do not claim Base cannot buy extra members unless the table explicitly says so
- When recommending plans by user/member count, compare against the pricing table and do not exclude Base only because the team has more than 2 users
- You may share official website or help-guide links when useful for the customer to verify details
- Do not expose internal file/table names such as FAQ file names, pricing table names, or Pricing Feature Comparison Table in customer-facing replies; answer directly as DICloak support`;

    // 优先使用前端传递的 System Prompt，否则使用精简版
    const finalSystemPrompt = systemPrompt || baseSystemPrompt;

    const outputFormatGuardrail = `## 输出格式硬性要求
    1. 输出格式必须以网站系统 Prompt 的 A/B/C 格式为准，并使用本次用户消息中提供的“输出格式要求”。
    2. 每个板块标题必须独占一行，标题后必须换行再写内容。
    3. 不要把下一个板块标题或标题图标接在上一段正文后面。
    4. 板块标题必须只保留文字标题，不使用 emoji 图标，也不要单独输出任何标题图标。
    5. 板块标题必须保留网站系统 Prompt 指定的中文书名号样式方括号“【】”、分隔符“｜”和中文标题，例如“【主回复｜优先发送】”；禁止改成 []、翻译标题或改写标题。
    6. 只能翻译正文内容，禁止翻译板块标题；例如西班牙语回复也必须保留“【主回复｜优先发送】”。
    7. 正文必须是纯文本，不要使用 Markdown 加粗/斜体/标题符号，例如不要输出 **文本**、__文本__、# 标题。
    8. 正文不得保留术语占位符花括号；如果内部资料出现 {{Equipo}}、{{Members}}，输出时必须变成 Equipo、Members 或目标语言译文。`;

    const evidenceGuardrail = `## 知识依据与防编造硬性要求
    1. 回复只能基于上方提供的内部资料和同会话历史；这些资料名称仅供内部生成使用。
    2. 禁止编造内部资料中没有出现的套餐权益、容量、配额、限制、价格、入口路径、按钮名称、操作步骤或功能结论。
    3. 当用户询问“是否有限制/容量/配额/上限/limit/quota/capacity/storage”等问题时，只有内部资料明确给出具体限制，才允许回答具体数值或套餐差异。
    4. 如果内部资料没有明确证据，可以直接说明“知识库未检索到相关知识，此回复来源为 AI 生成”，并建议进一步核实；不要自行推测确定结论。
    5. DICloak 不存在已知的云存储空间容量套餐限制；除非知识库明确提供容量上限，否则不得输出 Free/Base/Plus/Share 等套餐对应的云存储容量数值。
    6. 套餐问题必须优先使用内部价格数据；除免费版外，成员和环境额度是否可调整、是否可购买额外额度，以内部价格数据为准，不得沿用旧结论。
    7. 可以提供官网或操作指南链接，帮助客户自行核对具体信息。
    8. 面向客户的正文不得透露内部具体文件/表名称或工作流，例如“FAQ 文件/价格功能表/Pricing Feature Comparison Table/表格显示”；但在未检索到相关信息时，可以说“知识库未检索到相关知识，此回复来源为 AI 生成”。`;
  
    const intentGuardrail = (classification?.intents && classification.intents.length > 0)
      ? `
    ## Intent Coverage Rules (MUST)
    You MUST address ALL intents below in one response, each with a clear subsection:
    ${classification.intents.map((it, idx) => `${idx + 1}. ${it.type}`).join("\n")}
    For EACH intent include:
    - conclusion
    - evidence from knowledge context
    - actionable next step
    If evidence is insufficient for any intent, explicitly ask follow-up for that intent.
    Do NOT skip any intent.
    `
      : "";

    const finalPromptWithCoverage = `${finalSystemPrompt}\n${intentGuardrail}\n${outputFormatGuardrail}\n${evidenceGuardrail}\n${languageRule}`;

    // 构建知识库上下文（只传递最相关的知识库项）
    let knowledgeContext = "";
    let responseShouldUsePricingTable = false;

    // 关键词来源：优先使用 AI 提取的关键词，否则使用本地提取
    const extractKeywords = (text: string): string[] => {
      const lower = text.toLowerCase();
      // 分词
      const words = lower.split(/[\s,.!?;:，。！？；：、]+/).filter(w => w.length > 1);
      // 中文提取2-4字子串
      const subs: string[] = [];
      for (let i = 0; i < lower.length - 1; i++) {
        for (let len = 2; len <= 4; len++) {
          if (i + len <= lower.length) {
            const sub = lower.substring(i, i + len);
            if (/^[\u4e00-\u9fa5]+$/.test(sub)) subs.push(sub);
          }
        }
      }
      return [...new Set([...words, ...subs])];
    };

    const expandDomainKeywords = (keywords: string[], userMessage: string): string[] => {
      const text = userMessage.toLowerCase();
      const expanded = new Set(keywords.map((keyword) => keyword.toLowerCase()).filter(Boolean));
      const windowSyncSignals = [
        "дублирование экранов",
        "несколько профилей",
        "разных профилях",
        "одним щелчком",
        "одну и ту же ссылку",
        "одно и тоже действие",
        "одно и то же действие",
        "лайк",
        "multi profile",
        "multiple profiles",
        "same link",
        "same action",
        "simultaneously",
        "同步",
        "多个环境",
        "多个窗口",
        "同一链接",
        "相同操作",
      ];

      if (windowSyncSignals.some((signal) => text.includes(signal))) {
        [
          "window synchronizer",
          "window synchronization",
          "window_synchronizer",
          "multi_profile_control",
          "sync_operations",
          "multiple profiles",
          "same link",
          "same action",
          "simultaneous operation",
          "窗口同步",
          "多环境同步",
          "多窗口同步",
        ].forEach((keyword) => expanded.add(keyword));
      }

      return [...expanded];
    };

    const normalizeForMatch = (value: string): string => value.toLowerCase().replace(/[\s_\-]+/g, " ").trim();
    
    // 同时使用 AI 提取关键词和原始问题关键词，避免中文功能知识库被英文关键词覆盖而无法命中
    const messageKeywords = extractKeywords(message);
    const baseKeywords: string[] = aiKeywords && aiKeywords.length > 0
      ? [...new Set([...aiKeywords.map((k: string) => k.toLowerCase()), ...messageKeywords])]
      : messageKeywords;
    const userKeywords = expandDomainKeywords(baseKeywords, message);
    
    console.log('[DEBUG] 使用的关键词（英语）:', userKeywords);

    // 术语翻译函数：根据 term_id 在术语库中查找对应语言的翻译
    const translateTerms = (
      text: string, 
      termIds: string[] = [], 
      userLang: string,
      termItems: Array<{ termId?: string; zh?: string; en?: string; pt?: string; es?: string; ru?: string; vi?: string }> = []
    ): string => {
      if (!text || termIds.length === 0 || termItems.length === 0) return text;
      
      // 支持的语言字段映射
      const langFieldMap: Record<string, string> = {
        'zh': 'zh',
        'cn': 'zh',
        'chinese': 'zh',
        'en': 'en',
        'english': 'en',
        'pt': 'pt',
        'portuguese': 'pt',
        'es': 'es',
        'spanish': 'es',
        'ru': 'ru',
        'russian': 'ru',
        'vi': 'vi',
        'vietnamese': 'vi'
      };
      
      const field = langFieldMap[userLang.toLowerCase()] || 'en';
      
      console.log(`[TERM DEBUG] 翻译术语 - 用户语言: ${userLang}, 字段: ${field}, termIds: ${termIds.join(', ')}`);
      
      // 构建 term_id 到翻译的映射
      const termMap: Record<string, string> = {};
      termItems.forEach(term => {
        if (term.termId) {
          const translation = (term as Record<string, unknown>)[field] as string || term.en || term.zh;
          if (translation) {
            termMap[term.termId] = translation;
          }
        }
      });
      
      // 替换 {{xxx}} 格式的术语
      let result = text;
      
      // 方法1: 根据 term_id 精确匹配术语库中的翻译
      termIds.forEach(termId => {
        const translation = termMap[termId];
        if (translation) {
          // 匹配 {{xxx}} 格式，其中 xxx 可能是任何文本
          const bracketPattern = /\{\{[^}]+\}\}/g;
          const matches = text.match(bracketPattern);
          if (matches) {
            matches.forEach(match => {
              const innerText = match.slice(2, -2); // 提取 {{ 和 }} 之间的内容
              // 如果术语库中的英文术语匹配 {{ }} 内的内容，则替换
              const termEn = termItems.find(t => t.termId === termId)?.en;
              if (termEn && innerText.toLowerCase() === termEn.toLowerCase()) {
                result = result.replace(match, translation);
                console.log(`[TERM DEBUG] 替换术语: ${match} -> ${translation} (termId: ${termId})`);
              }
            });
          }
        }
      });
      
      // 方法2: 直接用术语库中的英文匹配 {{ }} 内的内容
      const bracketPattern = /\{\{[^}]+\}\}/g;
      const matches = result.match(bracketPattern);
      if (matches) {
        matches.forEach(match => {
          const innerText = match.slice(2, -2).toLowerCase();
          // 在术语库中查找英文匹配的术语
          const matchedTerm = termItems.find(t => t.en && t.en.toLowerCase() === innerText);
          if (matchedTerm && matchedTerm.termId) {
            const translation = (matchedTerm as Record<string, unknown>)[field] as string || matchedTerm.en;
            if (translation) {
              result = result.replace(match, translation);
              console.log(`[TERM DEBUG] 直接匹配替换: ${match} -> ${translation}`);
            }
          }
        });
      }
      
      return result;
    };

    // 处理术语定位符和残留占位符，确保传给模型的知识库上下文不包含 {{}}
    const processTermMarkers = (text: string): string => {
      return text
        // 匹配 [已翻译:原文->译文] 格式，只保留译文
        .replace(/\[已翻译:[^>]*->([^\]]+)\]/g, '$1')
        // 兜底移除术语占位符花括号：{{Team}} -> Team
        .replace(/\{\{\s*([^{}]+?)\s*\}\}/g, '$1')
        .replace(/[{}]/g, '')
        // 避免知识库 Markdown 加粗符号诱导模型原样输出
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/__(.*?)__/g, '$1');
    };

    // 初始化问题类型和格式（默认值）
    let problemType: ProblemType = 'info_insufficient';
    let userRole: UserRole = 'unknown';
    let outputFormatType: 'A' | 'B' | 'C' = 'A';
    let aiOutputFormat = generateAIOutputFormat(problemType, userRole);

    const tKnowledgeStart = Date.now();
    if (knowledge && ((knowledge.faqItems?.length ?? 0) > 0 || (knowledge.troubleshootingItems?.length ?? 0) > 0 || (knowledge.outOfScopeItems?.length ?? 0) > 0 || (knowledge.functionKnowledge?.length ?? 0) > 0)) {
      // 计算匹配分数（增强标签匹配）
      const calculateMatchScore = (userMsg: string, item: { questionCN?: string; questionEN?: string; tags?: string[]; userPhrases?: string }, keywords: string[]) => {
        let score = 0;
        const msgLower = userMsg.toLowerCase();
        const normalizedMsg = normalizeForMatch(userMsg);
        const normalizedKeywords = keywords.map(normalizeForMatch);

        // 1. 问题文本匹配
        if (item.questionCN) {
          const cnLower = item.questionCN.toLowerCase();
          if (cnLower.includes(msgLower) || msgLower.includes(cnLower)) score += 10;
          normalizedKeywords.forEach(kw => {
            if (normalizeForMatch(cnLower).includes(kw)) score += 2;
          });
        }
        if (item.questionEN) {
          const enLower = item.questionEN.toLowerCase();
          if (enLower.includes(msgLower) || msgLower.includes(enLower)) score += 10;
          normalizedKeywords.forEach(kw => {
            if (normalizeForMatch(enLower).includes(kw)) score += 2;
          });
        }

        // 2. 标签匹配（关键词与标签匹配）
        if (item.tags && item.tags.length > 0) {
          item.tags.forEach(tag => {
            const tagLower = tag.toLowerCase();
            const normalizedTag = normalizeForMatch(tag);
            // 用户消息直接包含标签
            if (msgLower.includes(tagLower) || normalizedMsg.includes(normalizedTag)) score += 5;
            // 关键词匹配标签
            normalizedKeywords.forEach(kw => {
              if (normalizedTag.includes(kw) || kw.includes(normalizedTag)) score += 3;
            });
          });
        }

        // 3. 用户问法匹配
        if (item.userPhrases) {
          const phrases = item.userPhrases.split(/[,，;；\n]+/).map(p => p.trim().toLowerCase());
          phrases.forEach(phrase => {
            if (phrase && (msgLower.includes(phrase) || normalizedMsg.includes(normalizeForMatch(phrase)))) score += 4;
          });
        }

        const searchableText = normalizeForMatch([
          item.questionCN,
          item.questionEN,
          item.userPhrases,
          ...(item.tags || []),
        ].filter(Boolean).join(" "));
        if (normalizedKeywords.includes("window synchronizer") && searchableText.includes("window synchronizer")) score += 12;
        if (normalizedKeywords.includes("window synchronization") && searchableText.includes("window synchronization")) score += 12;
        if (normalizedKeywords.includes("multi profile control") && searchableText.includes("multi profile control")) score += 8;
        if (normalizedKeywords.includes("sync operations") && searchableText.includes("sync operations")) score += 8;

        return score;
      };

      type FunctionKnowledgeItem = {
        id?: string;
        functionId?: string;
        module1?: string;
        pageName?: string;
        functionType?: string;
        functionName?: string;
        description?: string;
        entryPath?: string;
        uiPosition?: string;
        prerequisites?: string;
        steps?: string;
        faqIds?: string;
        keywordsCN?: string;
        keywordsEN?: string;
      };

      const normalizeFunctionText = (value?: string) => (value || '').toLowerCase();
      const calculateFunctionKnowledgeScore = (userMsg: string, item: FunctionKnowledgeItem, keywords: string[]) => {
        let score = 0;
        const msgLower = userMsg.toLowerCase();
        const searchableFields = [
          item.functionName,
          item.description,
          item.keywordsCN,
          item.keywordsEN,
          item.module1,
          item.pageName,
          item.functionType,
          item.entryPath,
          item.uiPosition,
          item.prerequisites,
          item.steps,
        ];
        const searchableText = searchableFields.map(normalizeFunctionText).filter(Boolean).join(' ');
        const compactMessage = msgLower.replace(/[\s,，。！？?；;、]/g, '');
        const compactSearchableText = searchableText.replace(/[\s,，。！？?；;、]/g, '');

        if (searchableText.includes(msgLower) || msgLower.includes(searchableText) || compactSearchableText.includes(compactMessage)) {
          score += 12;
        }

        keywords.forEach((kw) => {
          const keyword = kw.toLowerCase();
          if (!keyword) return;
          if (normalizeFunctionText(item.functionName).includes(keyword)) score += 5;
          if (normalizeFunctionText(item.description).includes(keyword)) score += 4;
          if (normalizeFunctionText(item.keywordsCN).includes(keyword) || normalizeFunctionText(item.keywordsEN).includes(keyword)) score += 5;
          if (normalizeFunctionText(item.steps).includes(keyword) || normalizeFunctionText(item.prerequisites).includes(keyword)) score += 3;
          if (normalizeFunctionText(item.module1).includes(keyword) || normalizeFunctionText(item.pageName).includes(keyword)) score += 2;
        });

        const userQuestionTokens = msgLower.split(/[\s,，。！？?；;、]+/).filter((token) => token.length >= 2);
        userQuestionTokens.forEach((token) => {
          if (searchableText.includes(token)) score += 2;
        });

        return score;
      };

      // FAQ 匹配过滤（只过滤，不排序，由 AI 判断相关度）
      type FaqItem = { questionCN: string; questionEN?: string; tags?: string[]; userPhrases?: string; answer: string; functionId?: string; termIds?: string[]; faqId?: string };
      const faqItems = (knowledge.faqItems || []) as FaqItem[];
      const matchedFaq = faqItems
        .map((item: FaqItem) => ({ item, score: calculateMatchScore(message, item, userKeywords) }))
        .filter(m => m.score > 0); // 只过滤匹配到的，不排序不限制数量，由 AI 判断相关度

      // 功能知识库匹配过滤
      const functionKnowledgeItems = (knowledge.functionKnowledge || []) as FunctionKnowledgeItem[];
      const matchedFunctionKnowledge = functionKnowledgeItems
        .map((item: FunctionKnowledgeItem) => ({ item, score: calculateFunctionKnowledgeScore(message, item, userKeywords) }))
        .filter((m) => m.score > 0)
        .sort((a, b) => b.score - a.score);

      // Troubleshooting 匹配过滤
      type TsItem = { questionCN: string; questionEN?: string; tags?: string[]; userPhrases?: string; answer: string; answerClient?: string; answerEndUser?: string; functionId?: string; termIds?: string[]; faqId?: string };
      const tsItems = (knowledge.troubleshootingItems || []) as TsItem[];
      const matchedTs = tsItems
        .map((item: TsItem) => ({ item, score: calculateMatchScore(message, item, userKeywords) }))
        .filter(m => m.score > 0);

      // Out of Scope 匹配过滤
      type OosItem = { questionCN: string; questionEN?: string; userPhrases?: string; tags?: string[]; answer: string; answerClient?: string; answerEndUser?: string; faqId?: string };
      const oosItems = (knowledge.outOfScopeItems || []) as OosItem[];
      const matchedOos = oosItems
        .map((item: OosItem) => ({ item, score: calculateMatchScore(message, item, userKeywords) }))
        .filter(m => m.score > 0);

      // ==================== 问题类型与身份识别 ====================
      const topFaqScore = matchedFaq.length > 0 ? Math.max(...matchedFaq.map(m => m.score)) : 0;
      const topTsScore = matchedTs.length > 0 ? Math.max(...matchedTs.map(m => m.score)) : 0;
      const topOosScore = matchedOos.length > 0 ? Math.max(...matchedOos.map(m => m.score)) : 0;
      const topFunctionKnowledgeScore = matchedFunctionKnowledge.length > 0 ? Math.max(...matchedFunctionKnowledge.map(m => m.score)) : 0;
      
      const problemTypeResult = identifyProblemType(message, Math.max(topFaqScore, topFunctionKnowledgeScore), topTsScore, topOosScore);
      const userRoleResult = identifyUserRole(message, history);

      const intents = classification?.intents || [];
      const selectedTables = new Set<TableId>(
        intents.flatMap((it) => (it.tables || []).map((t) => t.id)).filter((id): id is TableId => Boolean(id))
      );

      // API + 套餐共现强规则：强制双表
      const lowerMessage = message.toLowerCase();
      const apiSignals = ["api", "endpoint", "key", "create", "post", "member", "成员"];
      const planSignals = ["plan", "tier", "subscription", "pricing", "upgrade", "套餐", "权限"];
      const hasApiSignal = apiSignals.some((k) => lowerMessage.includes(k));
      const hasPlanSignal = planSignals.some((k) => lowerMessage.includes(k));
      if (hasApiSignal && hasPlanSignal) {
        selectedTables.add("api_endpoints");
        selectedTables.add("pricing_table");
        selectedTables.add("faq");
      }
      
      const classifiedProblemType = classification?.problemType || classification?.primaryIntent;
      const backendRequiresClarification = problemTypeResult.type === 'intent_unclear' || problemTypeResult.type === 'info_insufficient';
      const classificationLooksLikeMisroutedEndUser = classifiedProblemType === 'user_routing' && userRoleResult.role !== 'end_user';

      // 更新块外变量：后端的澄清/信息不足规则优先，避免分类器把模糊续订、ChatGPT profile 打不开误判为功能咨询或终端用户问题
      problemType = backendRequiresClarification || classificationLooksLikeMisroutedEndUser
        ? problemTypeResult.type
        : classifiedProblemType || problemTypeResult.type;
      userRole = classification?.identityStatus || userRoleResult.role;
      outputFormatType = getOutputFormatType(problemType, userRole);
      aiOutputFormat = generateAIOutputFormat(problemType, userRole);
      
      console.log("[TYPE DEBUG] 问题类型:", problemType, "-", problemTypeResult.reason);
      console.log("[TYPE DEBUG] 用户身份:", userRole, "-", userRoleResult.reason);
      console.log("[TYPE DEBUG] 输出格式:", outputFormatType);
      console.log("[TYPE DEBUG] 匹配分数 - FAQ:", topFaqScore, "Function:", topFunctionKnowledgeScore, "TS:", topTsScore, "OOS:", topOosScore);

      // ==================== API 端点表检索 ====================
      // 当检测到 API 相关问题时，始终检索 API 端点表
      // 不再仅依赖 problemType === 'api_problem'，因为 API 功能查询可能被归类为其他类型
      let apiSearchResult: { found: boolean; endpoints: unknown[]; parameters: unknown[]; summary: string } | null = null;
      const apiIntent = intents.find((it) => it.type === "api_problem");
      const isApiQuestion =
        problemType === "api_problem" ||
        selectedTables.has("api_endpoints") ||
        (problemTypeResult.apiInfo !== undefined);

      if (isApiQuestion) {
        const apiAction = apiIntent?.entities?.action || problemTypeResult.apiInfo?.apiAction;
        const apiObject = apiIntent?.entities?.apiModule || problemTypeResult.apiInfo?.apiObject;

        apiSearchResult = searchApiEndpoints(
          apiAction || undefined,
          apiObject || undefined,
          knowledge.apiEndpoints || [],
          knowledge.apiParameters || []
        );
        console.log("[API DEBUG] API 检索结果:", apiSearchResult.found ? "找到" : "未找到");
        console.log("[API DEBUG] 匹配端点数:", apiSearchResult.endpoints.length);
        console.log("[API DEBUG] 摘要:", apiSearchResult.summary);
      }

      // ==================== 价格功能表检索 ====================
      // 当检测到套餐/价格相关问题时，始终检索价格功能表
      // 不再依赖 problemType === 'subscription_problem'，因为套餐功能对比问题可能被归类为其他类型
      let pricingSearchResult: { found: boolean; plans: unknown[]; summary: string } | null = null;
      const isPricingQuestion = problemType === 'subscription_problem' || 
                          problemType === 'intent_unclear' || 
                          selectedTables.has("pricing_table") ||
                          (problemTypeResult.subscriptionInfo !== undefined);
      if (isPricingQuestion) {
        // 套餐推荐类问题，不使用关键词过滤，直接返回所有套餐供 AI 参考
        const subscriptionKeywords = ['推荐', '哪个', '适合', '选择', '比较', 'difference', 'compare', 'recommend', 'which', '支持', '能否', '可以', '功能', 'subscription', 'tier', 'plan', '套餐', '订阅'];
        const isRecommendQuestion = subscriptionKeywords.some(k => message.toLowerCase().includes(k));
        
        // 当检测为价格/套餐问题时，始终返回所有套餐供 AI 判断（不做关键词过滤）
        // 因为用户问题通常是自然语言句子，很难精确匹配 planName/features
        const queryForPricing = undefined;
        
        pricingSearchResult = searchPricingPlans(knowledge.pricingPlans || [], queryForPricing);
        console.log("[PRICING DEBUG] 价格检索结果:", pricingSearchResult.found ? "找到" : "未找到");
        console.log("[PRICING DEBUG] 推荐问题:", isRecommendQuestion);
        console.log("[PRICING DEBUG] 匹配套餐数:", pricingSearchResult.plans.length);
      }

      // 调试日志
      console.log("[MATCH DEBUG] User message:", message);
      console.log("[MATCH DEBUG] User keywords:", userKeywords.slice(0, 10).join(', '));
      console.log("[MATCH DEBUG] Matched FAQ count:", matchedFaq.length);
      matchedFaq.slice(0, 10).forEach((m, i) => {
        console.log(`[MATCH DEBUG] FAQ ${i+1}: ${m.item.faqId}, score: ${m.score}, question: ${m.item.questionCN}, tags: ${m.item.tags?.join(',')}`);
      });
      if (matchedFaq.length > 10) {
        console.log(`[MATCH DEBUG] ... and ${matchedFaq.length - 10} more FAQs`);
      }
      console.log("[MATCH DEBUG] Matched TS count:", matchedTs.length);
      console.log("[MATCH DEBUG] Matched Function Knowledge count:", matchedFunctionKnowledge.length);
      matchedFunctionKnowledge.slice(0, 10).forEach((m, i) => {
        console.log(`[MATCH DEBUG] Function ${i+1}: ${m.item.functionId || m.item.id || 'unknown'}, score: ${m.score}, name: ${m.item.functionName || ''}, module: ${m.item.module1 || ''}`);
      });
      console.log("[MATCH DEBUG] Matched OOS count:", matchedOos.length);

      // ==========================================
      // 根据问题类型决定上下文构建顺序
      // API 问题：API 端点表优先
      // 套餐问题：价格功能表优先
      // 其他问题：FAQ 优先
      // ==========================================
      
      // 更新优先级判断（考虑检索结果）
      const finalIsApiQuestion = isApiQuestion || apiSearchResult?.found;
      const finalIsPricingQuestion = isPricingQuestion || pricingSearchResult?.found;
      responseShouldUsePricingTable = Boolean(finalIsPricingQuestion);
      
      console.log("[PRIORITY DEBUG] isApiQuestion:", finalIsApiQuestion, "isPricingQuestion:", finalIsPricingQuestion);

      // 使用临时变量存储优先上下文
      let priorityContext = "";
      
      // 优先构建 API 端点上下文（如果是 API 问题）
      if (apiSearchResult && apiSearchResult.found) {
        priorityContext += "## API Endpoints (from API Table - HIGHEST PRIORITY)\n";
        priorityContext += "IMPORTANT: For API questions, you MUST use this API table data first. FAQ is supplementary.\n";
        priorityContext += "DO NOT fabricate API endpoints, methods, or parameters not in this table.\n\n";
        apiSearchResult.endpoints.forEach((ep: unknown, index: number) => {
          const endpoint = ep as {
            apiId?: string;
            apiName?: string;
            apiType?: string;
            method?: string;
            fullpathRule?: string;
            endpoint?: string;
            authMethod?: string;
            description?: string;
            module?: string;
            requestParamLocation?: string;
            needEnvId?: string;
            isSupported?: string;
            successResponse?: string;
            remarks?: string;
          };
          priorityContext += `[API ${index + 1}] ${endpoint.apiName || 'Unknown'}\n`;
          priorityContext += `  API ID: ${endpoint.apiId || ''}\n`;
          priorityContext += `  Type: ${endpoint.apiType || 'HTTP API'}\n`;
          priorityContext += `  Method: ${endpoint.method || 'GET'}\n`;
          priorityContext += `  Endpoint: ${endpoint.endpoint || ''}\n`;
          if (endpoint.fullpathRule) priorityContext += `  Full Path: ${endpoint.fullpathRule}\n`;
          if (endpoint.authMethod) priorityContext += `  Auth: ${endpoint.authMethod}\n`;
          if (endpoint.description) priorityContext += `  Description: ${endpoint.description}\n`;
          if (endpoint.module) priorityContext += `  Module: ${endpoint.module}\n`;
          if (endpoint.requestParamLocation) priorityContext += `  Param Location: ${endpoint.requestParamLocation}\n`;
          if (endpoint.needEnvId) priorityContext += `  Need env_id: ${endpoint.needEnvId}\n`;
          if (endpoint.isSupported !== undefined) priorityContext += `  Supported: ${endpoint.isSupported}\n`;
          if (endpoint.successResponse) priorityContext += `  Success Response: ${endpoint.successResponse}\n`;
          if (endpoint.remarks) priorityContext += `  Remarks: ${endpoint.remarks}\n`;
          
          // 添加参数信息
          const params = (apiSearchResult.parameters as unknown[]).filter((p): p is { apiId?: string } => {
            const param = p as { apiId?: string };
            return param.apiId === endpoint.apiId;
          });
          if (params.length > 0) {
            priorityContext += `  Parameters:\n`;
            params.forEach((p) => {
              const param = p as {
                paramName?: string;
                paramNameCn?: string;
                paramType?: string;
                isRequired?: boolean;
                description?: string;
                example?: string;
                validationRule?: string;
                applicableScenarios?: string;
              };
              const required = param.isRequired ? ' [REQUIRED]' : '';
              priorityContext += `    - ${param.paramName || ''} (${param.paramType || 'any'})${required}\n`;
              if (param.paramNameCn) priorityContext += `      Name CN: ${param.paramNameCn}\n`;
              if (param.description) priorityContext += `      Description: ${param.description}\n`;
              if (param.example) priorityContext += `      Example/Options: ${param.example}\n`;
              if (param.validationRule) priorityContext += `      Validation: ${param.validationRule}\n`;
              if (param.applicableScenarios) priorityContext += `      Applicable: ${param.applicableScenarios}\n`;
            });
          }
          priorityContext += "\n";
        });
      }

      // 优先构建价格功能表上下文（如果是套餐问题）
      if (pricingSearchResult && pricingSearchResult.found) {
        priorityContext += "## Pricing Feature Comparison Table (HIGHEST PRIORITY, INTERNAL KNOWLEDGE BASE)\n";
        priorityContext += "IMPORTANT: For subscription/plan questions, you MUST use this imported pricing table first. This is not live website content.\n";
        priorityContext += "Use FAQ as supplementary only. If FAQ conflicts with this table, the table wins. Paid plans other than Free may have adjustable member/environment quotas when shown here; do not invent Base restrictions.\n";
        priorityContext += "Customer-facing wording: you may provide official website/help-guide links when useful, but do NOT expose internal file/table names such as FAQ file, pricing table, or Pricing Feature Comparison Table. Answer directly as DICloak support.\n\n";
        
        // 输出原始横向表格
        if (knowledge.pricingRawTable) {
          const rawTable = knowledge.pricingRawTable;
          priorityContext += "| " + rawTable.columns.join(" | ") + " |\n";
          priorityContext += "| " + rawTable.columns.map(() => "---").join(" | ") + " |\n";
          rawTable.rows.forEach((row: Record<string, string>) => {
            priorityContext += "| " + rawTable.columns.map((col: string) => row[col] || "").join(" | ") + " |\n";
          });
        } else if (pricingSearchResult.plans) {
          // 如果没有原始表格，使用解析后的套餐数据
          pricingSearchResult.plans.forEach((plan, index) => {
            const planData = plan as { planName?: string; planNameCN?: string; price?: number; priceUnit?: string; features?: string[] };
            priorityContext += `[Plan ${index + 1}] ${planData.planNameCN || planData.planName}\n`;
            if (planData.price) priorityContext += `  Price: ${planData.price}/${planData.priceUnit || 'month'}\n`;
            if (planData.features && planData.features.length > 0) {
              priorityContext += `  Features: ${planData.features.join(', ')}\n`;
            }
            priorityContext += "\n";
          });
        }
        priorityContext += "\n";
      }

      // 将优先上下文添加到最前面
      knowledgeContext = priorityContext + knowledgeContext;

      // 构建功能知识库上下文
      const shouldUseFunctionKnowledge = problemType === 'feature_faq' || selectedTables.has('function_knowledge') || matchedFunctionKnowledge.length > 0;
      if (shouldUseFunctionKnowledge && matchedFunctionKnowledge.length > 0) {
        knowledgeContext += "## Function Knowledge Base (sorted by relevance score)\n";
        knowledgeContext += "IMPORTANT: For feature capability / function usage questions, you MUST use this function knowledge before saying no related knowledge was found.\n";
        knowledgeContext += "Use EntryPath, UIPosition, Prerequisites and Steps to answer how the feature works.\n";
        knowledgeContext += "If you use this section, start your reply with [FUNCTION_ID: xxx].\n\n";

        matchedFunctionKnowledge.slice(0, 12).forEach((m, index) => {
          const item = m.item;
          knowledgeContext += `[FUNCTION ${index + 1}] ID: ${item.functionId || item.id || 'unknown'} | Score: ${m.score}\n`;
          if (item.module1) knowledgeContext += `Module: ${item.module1}\n`;
          if (item.pageName) knowledgeContext += `Page: ${item.pageName}\n`;
          if (item.functionType) knowledgeContext += `FunctionType: ${item.functionType}\n`;
          if (item.functionName) knowledgeContext += `FunctionName: ${item.functionName}\n`;
          if (item.description) knowledgeContext += `Description: ${item.description}\n`;
          if (item.entryPath) knowledgeContext += `EntryPath: ${item.entryPath}\n`;
          if (item.uiPosition) knowledgeContext += `UIPosition: ${item.uiPosition}\n`;
          if (item.prerequisites) knowledgeContext += `Prerequisites: ${item.prerequisites}\n`;
          if (item.steps) knowledgeContext += `Steps: ${item.steps}\n`;
          if (item.keywordsCN) knowledgeContext += `KeywordsCN: ${item.keywordsCN}\n`;
          if (item.keywordsEN) knowledgeContext += `KeywordsEN: ${item.keywordsEN}\n`;
          if (item.faqIds) knowledgeContext += `RelatedFAQ: ${item.faqIds}\n`;
          knowledgeContext += "\n";
        });
      }

      // 构建 FAQ 上下文
      const faqContextLabel = finalIsApiQuestion || finalIsPricingQuestion ? "FAQ Knowledge Base (SUPPLEMENTARY)" : "FAQ Knowledge Base (sorted by relevance score)";
      
      if (matchedFaq.length > 0) {
        knowledgeContext += `## ${faqContextLabel}\n`;
        if (finalIsApiQuestion || finalIsPricingQuestion) {
          knowledgeContext += "NOTE: This is SUPPLEMENTARY information. Priority data (API/Pricing) is provided above.\n";
        }
        knowledgeContext += "IMPORTANT: You MUST start your reply with [FAQ_ID: xxx] where xxx is the FAQ ID you used.\n";
        knowledgeContext += "HINT: Higher score = more relevant. Prefer FAQs with score >= 10.\n\n";
        matchedFaq.slice(0, 20).forEach((m, index) => {
          const item = m.item;
          // 翻译术语：根据 term_id 在术语库中查找对应语言的翻译
          const translatedAnswer = translateTerms(
            item.answer, 
            item.termIds, 
            effectiveLanguage,
            knowledge.termItems || []
          );
          // 处理术语定位符
          const processedAnswer = processTermMarkers(translatedAnswer);
          knowledgeContext += `[FAQ ${index + 1}] ID: ${item.faqId || 'unknown'} | Score: ${m.score}\n`;
          knowledgeContext += `Problem: ${item.questionCN || item.questionEN}\n`;
          if (item.userPhrases) {
            knowledgeContext += `UserPhrases: ${item.userPhrases}\n`;
          }
          knowledgeContext += `StandardAnswer: ${processedAnswer}\n`;
          if (item.tags && item.tags.length > 0) {
            knowledgeContext += `Tags: ${item.tags.join(', ')}\n`;
          }
          if (item.functionId) {
            knowledgeContext += `RelatedFunction: ${item.functionId}\n`;
          }
          knowledgeContext += "\n";
        });
      }

      // 构建 Troubleshooting 上下文
      if (matchedTs.length > 0) {
        knowledgeContext += "## Troubleshooting Knowledge Base (sorted by relevance score)\n";
        knowledgeContext += "IMPORTANT: You MUST start your reply with [TS_ID: xxx] where xxx is the FAQ ID you used.\n";
        knowledgeContext += "HINT: Higher score = more relevant. Prefer items with score >= 10.\n\n";
        matchedTs.slice(0, 20).forEach((m, index) => {
          const item = m.item;
          // 翻译术语
          const translatedAnswer = translateTerms(
            item.answer, 
            item.termIds, 
            effectiveLanguage,
            knowledge.termItems || []
          );
          const processedAnswer = processTermMarkers(translatedAnswer);
          
          // 翻译 client 和 end_user 答案
          const translatedAnswerClient = item.answerClient ? processTermMarkers(translateTerms(
            item.answerClient, 
            item.termIds, 
            effectiveLanguage,
            knowledge.termItems || []
          )) : '';
          const translatedAnswerEndUser = item.answerEndUser ? processTermMarkers(translateTerms(
            item.answerEndUser, 
            item.termIds, 
            effectiveLanguage,
            knowledge.termItems || []
          )) : '';
          
          knowledgeContext += `[TS ${index + 1}] ID: ${item.faqId || 'unknown'} | Score: ${m.score}\n`;
          knowledgeContext += `Problem: ${item.questionCN || item.questionEN}\n`;
          if (item.userPhrases) {
            knowledgeContext += `UserPhrases: ${item.userPhrases}\n`;
          }
          knowledgeContext += `StandardAnswer (通用): ${processedAnswer}\n`;
          if (translatedAnswerClient) {
            knowledgeContext += `StandardAnswer (client): ${translatedAnswerClient}\n`;
          }
          if (translatedAnswerEndUser) {
            knowledgeContext += `StandardAnswer (end_user): ${translatedAnswerEndUser}\n`;
          }
          if (item.functionId) {
            knowledgeContext += `RelatedFunction: ${item.functionId}\n`;
          }
          if (item.tags && item.tags.length > 0) {
            knowledgeContext += `Tags: ${item.tags.join(', ')}\n`;
          }
          knowledgeContext += "\n";
        });
      }

      // 构建 Out of Scope 上下文
      if (matchedOos.length > 0) {
        knowledgeContext += "## Out of Scope Knowledge Base (for reference)\n";
        matchedOos.forEach((m, index) => {
          const item = m.item;
          knowledgeContext += `[OutOfScope ${index + 1}] ID: ${item.faqId || 'unknown'}\n`;
          knowledgeContext += `Problem: ${item.questionCN || item.questionEN}\n`;
          if (item.userPhrases) {
            knowledgeContext += `UserPhrases: ${item.userPhrases}\n`;
          }
          knowledgeContext += `StandardAnswer: ${item.answer}\n`;
          if (item.answerClient) {
            knowledgeContext += `ClientAnswer: ${item.answerClient}\n`;
          }
          if (item.answerEndUser) {
            knowledgeContext += `EndUserAnswer: ${item.answerEndUser}\n`;
          }
          if (item.tags && item.tags.length > 0) {
            knowledgeContext += `Tags: ${item.tags.join(', ')}\n`;
          }
          knowledgeContext += "\n";
        });
      }
    } // end of if (knowledge ...)
    console.log(`[PERF][CHAT] knowledge_match_ms=${Date.now() - tKnowledgeStart}`);

    // 构建对话历史上下文
    let historyContext = "";
    if (history && history.length > 0) {
      const cleanedHistory = history.slice(-12).map((msg: { role: string; content: string }) => {
        const cleanContent = msg.content
          .replace(/\[META\][\s\S]*?\[\/META\]/g, "")
          .trim();

        const clippedContent = cleanContent.length > 1200
          ? `${cleanContent.slice(0, 1200)}...`
          : cleanContent;

        return `${msg.role === "assistant" ? "Assistant" : "User"}: ${clippedContent}`;
      });

      historyContext = `## Conversation History and Memory
    The following messages are from the SAME conversation. You MUST use them as context.
    - Inherit known user identity, role, product plan, device, error message, API type, and previous troubleshooting steps.
    - If the current question is short or ambiguous, resolve it using this history before asking follow-up.
    - Do not ask again for information already present in the history.
    - If history shows the user is a DICloak admin/client or end user/member, keep that role unless the current message clearly changes it.

    ${cleanedHistory.join("\n")}

    `;
    }

    // 构建用户消息
    const userMessage = `## Current User Question
    ${message}

    ${languageRule}

    ${responseShouldUsePricingTable ? "Internal pricing requirement: use the pricing data in the context for plan/price/member/environment quota answers. Do NOT mention internal file/table names such as pricing table or Pricing Feature Comparison Table in the customer-facing reply. Official website/help-guide links are allowed when useful. Answer directly as DICloak support." : ""}

    ${aiOutputFormat}

    ${outputFormatGuardrail}

    ${evidenceGuardrail}

    ${historyContext}

    ${knowledgeContext}

    Please generate reply based on the knowledge base and conversation history above.`;

    // 调试日志：检查知识库上下文是否为空
    console.log("[DEBUG] knowledgeContext 长度:", knowledgeContext.length);
    if (knowledgeContext.length === 0) {
      console.log("[DEBUG] 警告：知识库上下文为空！");
      console.log("[DEBUG] knowledge 对象存在:", !!knowledge);
      console.log("[DEBUG] knowledge.faqItems 数量:", knowledge?.faqItems?.length || 0);
    } else {
      console.log("[DEBUG] 知识库上下文前300字符:", knowledgeContext.substring(0, 300));
    }

    // 获取系统配置版本信息
    const configVersion = await getSystemConfigVersion();

    // 构建元数据（前端用于生成格式标题）
    const metaData = JSON.stringify({
      problemType,
      userRole,
      outputFormatType,
      problemTypeLabel: problemType === 'feature_faq' ? '功能咨询' :
                        problemType === 'troubleshooting' ? '故障排查' :
                        problemType === 'out_of_scope' ? '超出支持范围' :
                        problemType === 'intent_unclear' ? '意图不明确' : '信息不足',
      userRoleLabel: userRole === 'client' ? 'DICloak 客户/管理员' :
                     userRole === 'end_user' ? '终端用户' : '身份不明确',
      promptVersion: configVersion?.version || 1,
      promptUpdatedAt: configVersion?.updatedAt || new Date().toISOString(),
    });

    // 调用 AI API
    const messages = [
      { role: "system" as const, content: finalPromptWithCoverage },
      { role: "user" as const, content: userMessage },
    ];
    const tLlmStart = Date.now();
    let firstTokenLogged = false;

    // 调试日志：追踪发送给 AI 的内容
    console.log("[AI DEBUG] System Prompt 长度:", finalSystemPrompt.length);
    console.log("[AI DEBUG] User Message 长度:", userMessage.length);
    console.log("[AI DEBUG] User Message 前500字符:", userMessage.substring(0, 500));
    console.log("[AI DEBUG] knowledgeContext 长度:", knowledgeContext.length);

    // 检查 API Key
    const isOpenAICompatibleProvider = config.provider === 'deepseek' || config.provider === 'aliyun';

    if (isOpenAICompatibleProvider && !config.apiKey) {
      return NextResponse.json({ error: `请先配置 ${config.provider === 'aliyun' ? '阿里百炼' : 'DeepSeek'} API Key` }, { status: 400 });
    }

    const streamChatResponse = async (controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> => {
      // 首先发送元数据给前端
      const encoder = new TextEncoder();
      let fullContent = "";
      controller.enqueue(encoder.encode(`[META]${metaData}[/META]\n`));
      
      if (isOpenAICompatibleProvider) {
        // DeepSeek / 阿里百炼使用 OpenAI 兼容 API
        const baseUrl = config.baseUrl || (config.provider === 'aliyun' ? 'https://dashscope.aliyuncs.com/compatible-mode/v1' : 'https://api.deepseek.com');
        const requestMessages = config.provider === 'aliyun'
          ? messages.map(m => ({ role: m.role === 'system' ? 'user' : m.role, content: m.content }))
          : messages.map(m => ({ role: m.role, content: m.content }));

        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model || (config.provider === 'aliyun' ? 'qwen-mt-flash' : 'deepseek-chat'),
            messages: requestMessages,
            temperature: responseShouldUsePricingTable ? 0.2 : 0.7,
            stream: true,
          }),
        });
  
        if (!response.ok) {
          throw new Error(`${config.provider === 'aliyun' ? 'Aliyun Bailian' : 'DeepSeek'} API error: ${response.status} ${response.statusText}`);
        }
  
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');
  
        const decoder = new TextDecoder();
  
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
  
          const chunk = decoder.decode(value, { stream: true });
          if (!firstTokenLogged && chunk) {
            console.log(`[PERF][CHAT] llm_first_token_ms=${Date.now() - tLlmStart}`);
            firstTokenLogged = true;
          }
          const lines = chunk.split('\n');
  
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content || '';
                if (content) {
                  fullContent += content;
                }
              } catch (parseError) {
                void parseError;
                // Ignore parse errors
              }
            }
          }
        }
        console.log(`[PERF][CHAT] llm_total_ms=${Date.now() - tLlmStart}`);
      } else {
        // Coze/豆包 使用 SDK
        const llmConfig = new Config({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl || "https://api.coze.cn/v1",
        });
  
        const client = new LLMClient(llmConfig);
        const llmConfigStream = {
          model: config.model || "doubao-seed-2-0-lite-260215",
          temperature: responseShouldUsePricingTable ? 0.2 : 0.7,
        };
  
        for await (const chunk of client.stream(messages, llmConfigStream)) {
          const content = extractTextFromLlmChunk(chunk);
  
          if (content) {
            fullContent += content;
          }
        }
        console.log(`[PERF][CHAT] llm_total_ms=${Date.now() - tLlmStart}`);
      }
      if (fullContent) {
        controller.enqueue(encoder.encode(sanitizeCustomerFacingContent(fullContent)));
      }
      controller.close();
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        await streamChatResponse(controller).catch((error: unknown) => {
          console.error("[Stream Error]:", error);
          controller.error(error);
        });
      },
    });

    console.log(`[PERF][CHAT] total_ms=${Date.now() - t0}`);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("[API Error]:", error);
    console.log(`[PERF][CHAT] failed_total_ms=${Date.now() - t0}`);
    return NextResponse.json(
      { error: "处理请求失败" },
      { status: 500 }
    );
  }
}
