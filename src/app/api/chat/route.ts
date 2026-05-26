import { NextRequest, NextResponse } from "next/server";
import { LLMClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { ConversationContext } from '@/lib/types';

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
  'billing', 'upgrade', '付费', '订阅', '续费',
  'subscription', 'pricing', '多少钱', '收费'
];

const NON_DICLOAK_KEYWORDS = [
  'chatgpt', 'gpt', 'claude', 'ai写作', 'ai生成',
  '编程', '写代码', '视频制作', '剪辑', '绘图',
  'midjourney', 'runway', 'freepik', 'canva',
  '文案', '翻译', '配音'
];

function checkSubscriptionProblem(message: string): { 
  isSubscriptionProblem: boolean; 
  isDicloak: boolean | null;  // true=明确是DICloak, false=明确不是, null=不明确
  nonDicloakPurpose?: string;
} {
  const msgLower = message.toLowerCase();
  
  // 检查是否包含订阅/价格相关关键词
  const hasSubscriptionKeyword = SUBSCRIPTION_KEYWORDS.some(kw => msgLower.includes(kw));
  if (!hasSubscriptionKeyword) {
    return { isSubscriptionProblem: false, isDicloak: null };
  }
  
  // 检查是否明确提到 DICloak
  const hasDicloakMention = msgLower.includes('dicloak') || 
    msgLower.includes('浏览器') || msgLower.includes('环境') ||
    msgLower.includes('账号共享') || msgLower.includes('多账号');
  
  // 检查是否提到非 DICloak 用途
  let nonDicloakPurpose: string | undefined;
  for (const kw of NON_DICLOAK_KEYWORDS) {
    if (msgLower.includes(kw)) {
      nonDicloakPurpose = kw;
      break;
    }
  }
  
  if (nonDicloakPurpose) {
    return { isSubscriptionProblem: true, isDicloak: false, nonDicloakPurpose };
  }
  
  if (hasDicloakMention) {
    return { isSubscriptionProblem: true, isDicloak: true };
  }
  
  // 意图不明确
  return { isSubscriptionProblem: true, isDicloak: null };
}

/**
 * 识别问题类型（后端规则分类，AI 不能改变）
 */
function identifyProblemType(
  message: string,
  matchedFaqScore: number,
  matchedTsScore: number,
  matchedOosScore: number,
  conversationContext?: ConversationContext
): { type: ProblemType; reason: string; apiInfo?: any; subscriptionInfo?: any } {
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
  
  // 4. 检查是否超出支持范围（非 API/订阅场景）
  const outOfScopeKeywords = [
    'chatgpt', 'gpt-4', 'claude', 'midjourney', 'runway', 
    'freepik', 'canva', 'ai写作', 'ai生成', '编程工具',
    '视频制作', '剪辑软件', '绘图工具'
  ];
  if (outOfScopeKeywords.some(kw => msgLower.includes(kw))) {
    return { type: 'out_of_scope', reason: '超出 DICloak 支持范围' };
  }
  
  // 5. 根据匹配分数判断类型
  if (matchedTsScore >= matchedFaqScore && matchedTsScore >= matchedOosScore && matchedTsScore > 0) {
    return { type: 'troubleshooting', reason: '匹配到故障排查知识库' };
  }
  
  if (matchedOosScore > 0 && matchedOosScore > matchedFaqScore) {
    return { type: 'out_of_scope', reason: '匹配到超出支持范围知识库' };
  }
  
  if (matchedFaqScore > 0) {
    return { type: 'feature_faq', reason: '匹配到功能FAQ知识库' };
  }
  
  // 6. 默认返回信息不足
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
    '我购买的', '我的套餐', '管理代理', '数据同步',
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
 * 生成 AI 输出格式要求（AI 只输出内容，不带标题）
 */
function generateAIOutputFormat(problemType: ProblemType, userRole: UserRole): string {
  // A 格式：非故障类问题
  if (problemType === 'feature_faq' || problemType === 'out_of_scope' || 
      problemType === 'intent_unclear' || problemType === 'info_insufficient') {
    return `## 你需要输出的内容

[主回复]
完整输出 FAQ 标准答案的所有内容，不要拆分到其他部分

[补充建议]
独立的补充建议（如有），如无则写"无"

[需要补充的信息]
需要用户提供的信息（如有），如无需则写"无"`;
  }
  
  // B 格式：故障排查 + 身份明确
  if (problemType === 'troubleshooting' && userRole !== 'unknown') {
    const roleAnswer = userRole === 'client' ? 'client' : 'end_user';
    return `## 你需要输出的内容

[主回复]
完整输出 FAQ 中的「标准答案（${roleAnswer}）」，如为空则用「标准答案（通用）」

[补充建议]
独立的补充建议（如有），如无则写"无"

[需要补充的信息]
需要用户提供的信息（如有），如无需则写"无"`;
  }
  
  // C 格式：故障排查 + 身份不明确
  return `## 你需要输出的内容

[通用回复]
完整输出 FAQ 中的「标准答案（通用）」，如为空则写"无"

[客户回复]
完整输出 FAQ 中的「标准答案（client）」，如为空则写"无"

[终端用户回复]
输出「标准答案（end_user）」的简短版，重点说明需联系账号/服务提供方，如为空则写"无"

[需要补充的信息]
生成追问，收集身份相关信息（如：账号是自己管理的还是他人提供的）`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, history, knowledge, systemPrompt, apiConfig, detectedLanguage, aiKeywords } = body;
    
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
    console.log('[DEBUG] 后端接收语言:', detectedLanguage);
    console.log('[DEBUG] AI 关键词:', aiKeywords);
    if (knowledge) {
      console.log('[DEBUG] FAQ数量:', knowledge.faqItems?.length || 0);
      console.log('[DEBUG] 术语库数量:', knowledge.termItems?.length || 0);
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
    const languageRule = languageRules[detectedLanguage] || languageRules.zh;

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

## FAQ Selection
- Choose the FAQ with HIGHEST Score
- Prefer FAQs with Score >= 10
- Start your reply with [FAQ_ID: xxx] or [TS_ID: xxx]

## Term Translation
- Replace {{UI terms}} with translated terms
- Remove {{}} symbols in output
- For languages not in term library, translate the entire content`;

    // 优先使用前端传递的 System Prompt，否则使用精简版
    const finalSystemPrompt = systemPrompt || baseSystemPrompt;

    // 构建知识库上下文（只传递最相关的知识库项）
    let knowledgeContext = "";

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
    
    // 使用 AI 提取的英语关键词（已在 /api/keywords 中提取并翻译）
    const userKeywords: string[] = aiKeywords && aiKeywords.length > 0 
      ? aiKeywords.map((k: string) => k.toLowerCase())
      : extractKeywords(message);
    
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

    // 处理术语定位符：提取 [已翻译:原文->译文] 中的译文
    const processTermMarkers = (text: string): string => {
      // 匹配 [已翻译:原文->译文] 格式，只保留译文
      return text.replace(/\[已翻译:[^>]*->([^\]]+)\]/g, '$1');
    };

    // 初始化问题类型和格式（默认值）
    let problemType: ProblemType = 'info_insufficient';
    let userRole: UserRole = 'unknown';
    let outputFormatType: 'A' | 'B' | 'C' = 'A';
    let aiOutputFormat = generateAIOutputFormat(problemType, userRole);

    if (knowledge && (knowledge.faqItems?.length > 0 || knowledge.troubleshootingItems?.length > 0 || knowledge.outOfScopeItems?.length > 0)) {
      // 计算匹配分数（增强标签匹配）
      const calculateMatchScore = (userMsg: string, item: { questionCN?: string; questionEN?: string; tags?: string[]; userPhrases?: string }, keywords: string[]) => {
        let score = 0;
        const msgLower = userMsg.toLowerCase();

        // 1. 问题文本匹配
        if (item.questionCN) {
          const cnLower = item.questionCN.toLowerCase();
          if (cnLower.includes(msgLower) || msgLower.includes(cnLower)) score += 10;
          keywords.forEach(kw => {
            if (cnLower.includes(kw)) score += 2;
          });
        }
        if (item.questionEN) {
          const enLower = item.questionEN.toLowerCase();
          if (enLower.includes(msgLower) || msgLower.includes(enLower)) score += 10;
          keywords.forEach(kw => {
            if (enLower.includes(kw)) score += 2;
          });
        }

        // 2. 标签匹配（关键词与标签匹配）
        if (item.tags && item.tags.length > 0) {
          item.tags.forEach(tag => {
            const tagLower = tag.toLowerCase();
            // 用户消息直接包含标签
            if (msgLower.includes(tagLower)) score += 5;
            // 关键词匹配标签
            keywords.forEach(kw => {
              if (tagLower.includes(kw) || kw.includes(tagLower)) score += 3;
            });
          });
        }

        // 3. 用户问法匹配
        if (item.userPhrases) {
          const phrases = item.userPhrases.split(/[,，;；\n]+/).map(p => p.trim().toLowerCase());
          phrases.forEach(phrase => {
            if (phrase && msgLower.includes(phrase)) score += 4;
          });
        }

        return score;
      };

      // FAQ 匹配过滤（只过滤，不排序，由 AI 判断相关度）
      type FaqItem = { questionCN: string; questionEN?: string; tags?: string[]; userPhrases?: string; answer: string; functionId?: string; termIds?: string[]; faqId?: string };
      const faqItems = (knowledge.faqItems || []) as FaqItem[];
      const matchedFaq = faqItems
        .map((item: FaqItem) => ({ item, score: calculateMatchScore(message, item, userKeywords) }))
        .filter(m => m.score > 0); // 只过滤匹配到的，不排序不限制数量，由 AI 判断相关度

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
      
      const problemTypeResult = identifyProblemType(message, topFaqScore, topTsScore, topOosScore);
      const userRoleResult = identifyUserRole(message, history);
      
      // 更新块外变量
      problemType = problemTypeResult.type;
      userRole = userRoleResult.role;
      outputFormatType = getOutputFormatType(problemType, userRole);
      aiOutputFormat = generateAIOutputFormat(problemType, userRole);
      
      console.log("[TYPE DEBUG] 问题类型:", problemType, "-", problemTypeResult.reason);
      console.log("[TYPE DEBUG] 用户身份:", userRole, "-", userRoleResult.reason);
      console.log("[TYPE DEBUG] 输出格式:", outputFormatType);
      console.log("[TYPE DEBUG] 匹配分数 - FAQ:", topFaqScore, "TS:", topTsScore, "OOS:", topOosScore);

      // ==================== API 端点表检索 ====================
      let apiSearchResult: { found: boolean; endpoints: unknown[]; parameters: unknown[]; summary: string } | null = null;
      if (problemType === 'api_problem' && problemTypeResult.apiInfo) {
        apiSearchResult = searchApiEndpoints(
          problemTypeResult.apiInfo.apiAction,
          problemTypeResult.apiInfo.apiObject,
          knowledge.apiEndpoints || [],
          knowledge.apiParameters || []
        );
        console.log("[API DEBUG] API 检索结果:", apiSearchResult.found ? "找到" : "未找到");
        console.log("[API DEBUG] 匹配端点数:", apiSearchResult.endpoints.length);
        console.log("[API DEBUG] 摘要:", apiSearchResult.summary);
      }

      // ==================== 价格功能表检索 ====================
      let pricingSearchResult: { found: boolean; plans: unknown[]; summary: string } | null = null;
      if (problemType === 'subscription_problem' || problemType === 'intent_unclear') {
        pricingSearchResult = searchPricingPlans(knowledge.pricingPlans || [], message);
        console.log("[PRICING DEBUG] 价格检索结果:", pricingSearchResult.found ? "找到" : "未找到");
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
      console.log("[MATCH DEBUG] Matched OOS count:", matchedOos.length);

      // 构建 FAQ 上下文
      if (matchedFaq.length > 0) {
        knowledgeContext += "## FAQ Knowledge Base (sorted by relevance score)\n";
        knowledgeContext += "IMPORTANT: You MUST start your reply with [FAQ_ID: xxx] where xxx is the FAQ ID you used.\n";
        knowledgeContext += "HINT: Higher score = more relevant. Prefer FAQs with score >= 10.\n\n";
        matchedFaq.slice(0, 20).forEach((m, index) => {
          const item = m.item;
          // 翻译术语：根据 term_id 在术语库中查找对应语言的翻译
          const translatedAnswer = translateTerms(
            item.answer, 
            item.termIds, 
            detectedLanguage || 'zh',
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
            detectedLanguage || 'zh',
            knowledge.termItems || []
          );
          const processedAnswer = processTermMarkers(translatedAnswer);
          
          // 翻译 client 和 end_user 答案
          const translatedAnswerClient = item.answerClient ? processTermMarkers(translateTerms(
            item.answerClient, 
            item.termIds, 
            detectedLanguage || 'zh',
            knowledge.termItems || []
          )) : '';
          const translatedAnswerEndUser = item.answerEndUser ? processTermMarkers(translateTerms(
            item.answerEndUser, 
            item.termIds, 
            detectedLanguage || 'zh',
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

      // 构建 API 端点上下文
      if (apiSearchResult && apiSearchResult.found) {
        knowledgeContext += "## API Endpoints (from API Table - HIGHEST PRIORITY)\n";
        knowledgeContext += "IMPORTANT: API endpoints, methods, and parameters MUST come from this table. DO NOT fabricate.\n\n";
        apiSearchResult.endpoints.forEach((ep: unknown, index: number) => {
          const endpoint = ep as {
            apiId?: string;
            apiName?: string;
            apiType?: string;
            method?: string;
            fullpathRule?: string;
            authMethod?: string;
            paramLocation?: string;
            needsEnvId?: string;
            endpoint?: string;
            description?: string;
            responseFields?: string;
            remark?: string;
            module?: string;
            object?: string;
            operation?: string;
            isSupported?: boolean;
          };
          knowledgeContext += `[API ${index + 1}] ${endpoint.apiName || endpoint.apiId}\n`;
          knowledgeContext += `  API ID: ${endpoint.apiId}\n`;
          knowledgeContext += `  Type: ${endpoint.apiType || 'HTTP API'}\n`;
          knowledgeContext += `  Method: ${endpoint.method}\n`;
          knowledgeContext += `  Endpoint: ${endpoint.endpoint}\n`;
          if (endpoint.fullpathRule) knowledgeContext += `  Full Path Rule: ${endpoint.fullpathRule}\n`;
          if (endpoint.authMethod) knowledgeContext += `  Auth Method: ${endpoint.authMethod}\n`;
          if (endpoint.paramLocation) knowledgeContext += `  Param Location: ${endpoint.paramLocation}\n`;
          if (endpoint.needsEnvId) knowledgeContext += `  Needs env_id: ${endpoint.needsEnvId}\n`;
          knowledgeContext += `  Description: ${endpoint.description}\n`;
          if (endpoint.responseFields) knowledgeContext += `  Response Fields: ${endpoint.responseFields}\n`;
          if (endpoint.remark) knowledgeContext += `  Remark: ${endpoint.remark}\n`;
          knowledgeContext += `  Supported: ${endpoint.isSupported !== false ? 'Yes' : 'No'}\n`;
          
          // 添加关联参数
          const relatedParams = apiSearchResult?.parameters.filter(
            (p: unknown) => (p as { apiId?: string }).apiId === endpoint.apiId
          ) || [];
          if (relatedParams.length > 0) {
            knowledgeContext += `  Parameters:\n`;
            relatedParams.forEach((param: unknown) => {
              const p = param as {
                apiType?: string;
                module?: string;
                functionName?: string;
                method?: string;
                endpoint?: string;
                paramLocation?: string;
                paramName?: string;
                paramType?: string;
                isRequired?: boolean;
                description?: string;
                example?: string;
                validationRule?: string;
                remark?: string;
              };
              knowledgeContext += `    - ${p.paramName} (${p.paramType || 'string'})${p.isRequired ? ' [REQUIRED]' : ''}\n`;
              if (p.apiType) knowledgeContext += `      API Type: ${p.apiType}\n`;
              if (p.module) knowledgeContext += `      Module: ${p.module}\n`;
              if (p.functionName) knowledgeContext += `      Function: ${p.functionName}\n`;
              if (p.method) knowledgeContext += `      Method: ${p.method}\n`;
              if (p.endpoint) knowledgeContext += `      Endpoint: ${p.endpoint}\n`;
              if (p.paramLocation) knowledgeContext += `      Param Location: ${p.paramLocation}\n`;
              if (p.description) knowledgeContext += `      Description: ${p.description}\n`;
              if (p.example) knowledgeContext += `      Example/Options: ${p.example}\n`;
              if (p.validationRule) knowledgeContext += `      Validation: ${p.validationRule}\n`;
              if (p.remark) knowledgeContext += `      Remark: ${p.remark}\n`;
            });
          }
          knowledgeContext += "\n";
        });
      }

      // 构建价格功能表上下文
      if (pricingSearchResult && pricingSearchResult.found) {
        knowledgeContext += "## Pricing Plans (from Pricing Table)\n";
        knowledgeContext += "IMPORTANT: Use this pricing information for subscription/plan questions.\n\n";
        // 输出完整的横向表格
        knowledgeContext += "## Pricing Feature Comparison Table\n";
        knowledgeContext += "This table shows feature availability and limits for each plan.\n\n";
        
        // 获取原始表格数据
        const rawTable = knowledge.pricingRawTable;
        if (rawTable && rawTable.columns && rawTable.rows) {
          // 输出表头
          knowledgeContext += "| " + rawTable.columns.join(" | ") + " |\n";
          knowledgeContext += "| " + rawTable.columns.map(() => "---").join(" | ") + " |\n";
          
          // 输出每行数据
          rawTable.rows.forEach((row: Record<string, string>) => {
            const values = rawTable.columns.map((col: string) => row[col] || "-");
            knowledgeContext += "| " + values.join(" | ") + " |\n";
          });
        } else {
          // 如果没有原始表格数据，使用套餐列表
          knowledgeContext += "Plans found:\n";
          pricingSearchResult.plans.forEach((plan: unknown, index: number) => {
            const p = plan as {
              planName?: string;
              planNameCN?: string;
              features?: string[];
            };
            knowledgeContext += `${index + 1}. ${p.planNameCN || p.planName}: ${p.features?.length || 0} features\n`;
          });
        }
        knowledgeContext += "\n";
      }
    }

    // 构建对话历史上下文
    let historyContext = "";
    if (history && history.length > 0) {
      historyContext = "## Conversation History\n";
      history.forEach((msg: { role: string; content: string }) => {
        if (msg.role === "user") {
          historyContext += `User: ${msg.content}\n`;
        } else if (msg.role === "assistant") {
          // 提取主回复内容
          const mainMatch = msg.content.match(/\[Main\][\s\S]*?[-–]?[\s]*?([\s\S]+?)(?=\[|$)/);
          if (mainMatch) {
            historyContext += `Assistant: ${mainMatch[1].trim()}\n`;
          }
        }
      });
      historyContext += "\n";
    }

    // 构建用户消息
    const userMessage = `## Current User Question
${message}

${languageRule}

${aiOutputFormat}

${knowledgeContext}
${historyContext}
Please generate reply based on the knowledge base above.`;

    // 调试日志：检查知识库上下文是否为空
    console.log("[DEBUG] knowledgeContext 长度:", knowledgeContext.length);
    if (knowledgeContext.length === 0) {
      console.log("[DEBUG] 警告：知识库上下文为空！");
      console.log("[DEBUG] knowledge 对象存在:", !!knowledge);
      console.log("[DEBUG] knowledge.faqItems 数量:", knowledge?.faqItems?.length || 0);
    } else {
      console.log("[DEBUG] 知识库上下文前300字符:", knowledgeContext.substring(0, 300));
    }

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
                     userRole === 'end_user' ? '终端用户' : '身份不明确'
    });

    // 调用 AI API
    const messages = [
      { role: "system" as const, content: finalSystemPrompt },
      { role: "user" as const, content: userMessage },
    ];

    // 调试日志：追踪发送给 AI 的内容
    console.log("[AI DEBUG] System Prompt 长度:", finalSystemPrompt.length);
    console.log("[AI DEBUG] User Message 长度:", userMessage.length);
    console.log("[AI DEBUG] User Message 前500字符:", userMessage.substring(0, 500));
    console.log("[AI DEBUG] knowledgeContext 长度:", knowledgeContext.length);

    // 检查 API Key
    if (config.provider === 'deepseek' && !config.apiKey) {
      return NextResponse.json({ error: "请先配置 DeepSeek API Key" }, { status: 400 });
    }

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 首先发送元数据给前端
          controller.enqueue(new TextEncoder().encode(`[META]${metaData}[/META]\n`));
          
          if (config.provider === 'deepseek') {
            // DeepSeek 使用 OpenAI 兼容 API (不需要 /v1 后缀)
            const baseUrl = config.baseUrl || 'https://api.deepseek.com';
            const response = await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`,
              },
              body: JSON.stringify({
                model: config.model || 'deepseek-chat',
                messages: messages.map(m => ({ role: m.role, content: m.content })),
                temperature: 0.7,
                stream: true,
              }),
            });

            if (!response.ok) {
              throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body');

            const decoder = new TextDecoder();

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value, { stream: true });
              const lines = chunk.split('\n');

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data === '[DONE]') continue;
                  try {
                    const parsed = JSON.parse(data);
                    const content = parsed.choices?.[0]?.delta?.content || '';
                    if (content) {
                      controller.enqueue(new TextEncoder().encode(content));
                    }
                  } catch {
                    // Ignore parse errors
                  }
                }
              }
            }
          } else {
            // Coze/豆包 使用 SDK
            const llmConfig = new Config({
              apiKey: config.apiKey,
              baseUrl: config.baseUrl || "https://api.coze.cn/v1",
            });

            const client = new LLMClient(llmConfig);
            const llmConfigStream = {
              model: config.model || "doubao-seed-2-0-lite-260215",
              temperature: 0.7,
            };

            for await (const chunk of client.stream(messages, llmConfigStream)) {
              const content = Array.isArray(chunk.content) 
                ? chunk.content.map(c => 'text' in c ? c.text : '').join('')
                : chunk.content;
              if (content) {
                controller.enqueue(new TextEncoder().encode(content));
              }
            }
          }
          controller.close();
        } catch (error) {
          console.error("[Stream Error]:", error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("[API Error]:", error);
    return NextResponse.json(
      { error: "处理请求失败" },
      { status: 500 }
    );
  }
}
