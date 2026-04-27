// 对话和消息类型定义
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
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

// 知识库完整数据
export interface KnowledgeBase {
  faqItems: FAQItem[];
  troubleshootingItems: TroubleshootingItem[];
  outOfScopeItems: OutOfScopeItem[];
  mappingItems: MappingItem[];
  functionKnowledge: FunctionKnowledge[];
  termItems: TermItem[];
  lastUpdated: number;
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
