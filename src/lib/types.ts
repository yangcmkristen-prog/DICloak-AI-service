// 对话和消息类型定义
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  // 消息级别的元数据
  detectedLanguage?: string;      // 检测到的语言
  problemType?: string;           // 问题类型
  userRole?: string;              // 用户身份
  usedFaqIds?: string[];          // 使用的 FAQ ID
  usedApiIds?: string[];          // 使用的 API ID
}

// 对话上下文 - 用于多轮对话记忆
export interface ConversationContext {
  // 客户信息
  clientLanguage: string;             // 客户原始语言
  
  // 已确认的信息
  confirmedIdentity: 'client' | 'end_user' | 'unknown' | null;  // 已确认身份
  confirmedProblemType: string | null;  // 已确认问题类型
  confirmedFunctionModule: string | null;  // 已确认功能模块
  confirmedErrorInfo: string | null;    // 已确认报错信息
  confirmedOperationSteps: string | null;  // 已确认操作步骤
  hasScreenshot: boolean;             // 已确认截图状态
  hasRecording: boolean;              // 已确认录屏状态
  subscriptionIntent: 'dicloak' | 'other' | 'unclear' | null;  // 订阅意图
  
  // 历史建议追踪
  previousSuggestions: string[];      // 已给出的建议
  missingInfo: string[];              // 当前仍缺少的信息
  
  // 对话摘要
  summary: string;                    // 当前对话摘要
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  // 新增：对话上下文
  context: ConversationContext;
}

// ============ 知识库类型定义 ============

// FAQ 数据基础接口
export interface FAQItem {
  id: string;
  source: 'feature_faq' | 'user_routing' | 'troubleshooting' | 'out_of_scope' | 'mapping';
  category1: string;      // 一级分类
  category2: string;     // 二级分类
  tags: string[];        // 标签
  questionCN: string;    // 标准问题（中文）
  questionEN: string;    // 标准问题（英文）
  userPhrases: string;   // 用户问法
  answer: string;        // 标准答案
  functionId?: string;   // 关联功能ID
  termIds?: string[];    // 关联的术语ID列表
  priority?: number;     // 优先级
  faqId: string;        // FAQ_ID
}

// Troubleshooting 专用字段
export interface TroubleshootingItem extends FAQItem {
  answerClient?: string;    // 标准答案（client）
  answerEndUser?: string;   // 标准答案（end_user）
}

// Out of scope 专用字段
export interface OutOfScopeItem extends FAQItem {
  subType?: string;         // sub_type
  matchRule?: string;       // 匹配规则
}

// Mapping 映射表
export interface MappingItem {
  id: string;
  category2: string;      // mapping二级分类
  abbreviation: string;    // 缩写
  tags: string[];          // 标签
  keywordsEN: string;      // 英文关键词
  scenarioTag: string;     // 场景标签
  roleScope: string;       // role_scope
  domainKeywords: string;   // domain_keywords
}

// 功能知识库
export interface FunctionKnowledge {
  id: string;
  functionId: string;       // function_id
  module1: string;          // 一级模块
  pageName: string;         // 页面名称
  functionType: string;    // 功能类型
  functionName: string;     // 功能点名称
  description: string;      // 功能说明
  entryPath: string;        // 入口路径
  uiPosition: string;        // 界面位置
  prerequisites: string;     // 前置条件
  steps: string;            // 操作步骤
  faqIds: string;          // 常见问题FAQ_ID
  keywordsCN: string;       // 关键词（中文）
  keywordsEN: string;       // 关键词（英文）
}

// 术语库
export interface TermItem {
  id: string;
  termId: string;         // term_id
  module1: string;        // 一级模块
  module2: string;        // 二级模块
  termCN: string;         // 中文术语
  termEN: string;         // 英文
  termRU?: string;        // 俄语
  termPT?: string;        // 葡萄牙语（巴西）
  termES?: string;        // 西班牙语
  termVI?: string;        // 越南语
  termType: string;       // 术语类型
  definition: string;     // 定义说明
  isUiVisible: boolean;    // is_ui_visible
}

// 导入状态
export interface ImportStatus {
  totalFiles: number;
  processedFiles: number;
  totalSheets: number;
  processedSheets: number;
  errors: string[];
  success: boolean;
}

// ============ 新增：问题类型定义 ============
export type ProblemType = 
  | 'api_problem'         // API 问题（调用、端点、参数）
  | 'subscription_problem' // 套餐/价格/订阅问题
  | 'troubleshooting'     // 故障排查
  | 'info_insufficient'   // 信息不足
  | 'intent_unclear'      // 意图不明确
  | 'out_of_scope'        // 超出支持范围
  | 'feature_faq'         // 功能咨询
  | 'user_routing';       // 终端用户问题

// ============ 新增：API 端点与参数类型 ============
export interface ApiEndpoint {
  id: string;
  apiId: string;              // api_id
  apiName: string;            // API 名称（功能）
  apiType: string;            // API 类型 (HTTP API / Local API)
  method: string;             // 请求方法 (GET/POST/PUT/DELETE)
  endpoint: string;           // 端点路径
  fullpathRule?: string;      // 完整路径规则
  authMethod?: string;        // 鉴权方式
  paramLocation?: string;     // 请求参数位置
  needsEnvId?: string;        // 是否需要env_id
  description: string;        // 主要用途
  responseFields?: string;    // 成功响应核心字段
  remark?: string;            // 备注
  module: string;             // 所属模块（接口模块）
  object: string;             // 操作对象
  operation: string;          // 操作类型 (create/read/update/delete)
  isSupported: boolean;       // 是否支持
}

export interface ApiParameter {
  id: string;
  apiId: string;              // 关联的 api_id
  apiType?: string;           // API 类型
  module?: string;            // 接口模块
  functionName?: string;      // 功能名称
  method?: string;            // 请求方法
  endpoint?: string;          // 端点路径
  paramLocation?: string;     // 参数位置
  paramName: string;          // 参数名
  paramType: string;          // 参数类型
  isRequired: boolean;        // 是否必填
  description: string;        // 参数说明
  example?: string;           // 可选值/示例
  validationRule?: string;    // 适用场景
  remark?: string;            // 备注
}

// API 表完整数据
export interface ApiTable {
  endpoints: ApiEndpoint[];
  parameters: ApiParameter[];
  lastUpdated: number;
  fileName?: string;
}

// ============ 新增：价格功能表类型 ============
export interface PricingPlan {
  id: string;
  planName: string;           // 套餐名称 (Plus/Starter/Free)
  planNameCN: string;         // 套餐中文名
  price: number;              // 价格
  priceUnit: string;          // 价格单位 (月/年)
  memberLimit: number;        // 成员数限制
  environmentLimit: number;   // 环境数限制
  profileLimit: number;       // 配置文件数限制
  features: string[];         // 包含功能
  description: string;        // 套餐说明
}

// 价格功能表原始数据（横向表格）
export interface PricingRawTable {
  columns: string[];          // 列名（Features + 套餐列）
  rows: Record<string, string>[];  // 每行数据
  lastUpdated: number;
  fileName?: string;
}

export interface PricingTable {
  plans: PricingPlan[];
  featureComparison: Record<string, boolean[]>;  // 功能对比表
  lastUpdated: number;
  fileName?: string;
}

// 知识库完整数据
export interface KnowledgeBase {
  faqItems: FAQItem[];
  troubleshootingItems: TroubleshootingItem[];
  outOfScopeItems: OutOfScopeItem[];
  mappingItems: MappingItem[];
  functionKnowledge: FunctionKnowledge[];
  termItems: TermItem[];
  apiEndpoints: ApiEndpoint[];
  apiParameters: ApiParameter[];
  pricingPlans: PricingPlan[];
  pricingRawTable?: PricingRawTable;  // 价格功能表原始数据
  lastUpdated: number;
  fileNames?: {
    faqFile?: string;
    termFile?: string;
    functionFile?: string;
    apiFile?: string;
    pricingFile?: string;
  };
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

// API 配置类型
export interface ApiConfig {
  provider: 'coze' | 'deepseek' | 'custom';
  apiKey: string;
  model: string;
  baseUrl: string;
  customConfig?: {
    endpoint?: string;
    modelName?: string;
    headers?: Record<string, string>;
  };
}
