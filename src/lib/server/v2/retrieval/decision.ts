import { retrievalConfig } from "./config.ts";
import type { EvidenceConfidence, KnowledgeBranch, KnowledgeGroup, QueryIntent, QuestionMode, RejectedKnowledge, ResponseStrategy, RetrievalCandidate } from "./types.ts";

export interface RetrievalDecision {
  questionMode: QuestionMode;
  evidenceConfidence: EvidenceConfidence;
  responseStrategy: ResponseStrategy;
  selectedKnowledge: RetrievalCandidate[];
  debugCandidates: RetrievalCandidate[];
  rejectedCandidates: RejectedKnowledge[];
  knowledgeGroups: KnowledgeGroup[];
  branches: KnowledgeBranch[];
  missingCriticalInformation: string[];
  optionalFollowUpFields: string[];
  decisionReasons: string[];
}

const HIGH_RISK = /删除|清空|移除数据|退款|退钱|修改权限|授予权限|撤销权限|安全设置|delete|remove\s+data|clear\s+data|refund|permission|security/i;
const VAGUE_REFERENCE = /(?:它|这个|那个|this|it)\s*[。.!?？]*$/i;
const LOGIN_AMBIGUITY = /^(?:我)?(?:无法|不能|没法)?登录(?:了|。|！|!|？|\?)?$|^(?:账号不能用|无法打开账号)[。!！?？]*$|^(?:cannot|can't|unable to)\s+(?:log\s*in|login)\??$|^account\s+(?:not working|unavailable)[.!?]*$/i;
const BROAD_FAILURE = /环境打不开|打不开环境|页面(?:打不开|加载失败)|代理(?:连接不上|失败|异常)|扩展(?:异常|不能用|无法使用)|(?:profile|page)\s+(?:won't|cannot|can't)\s+open|proxy.{0,8}(?:fail|error)|extension.{0,8}(?:fail|error)/i;
const UNKNOWN_ACCESS_TARGET = /^(?:我)?(?:想要|要|需要)?访问(?:链接|页面)?[。.!?？]*$|^(?:I\s+)?want\s+to\s+(?:open|access)(?:\s+(?:it|a link))?[.!?]*$/i;

export function classifyQuestionMode(question: string, intent: QueryIntent): { mode: QuestionMode; missingCriticalInformation: string[]; optionalFollowUpFields: string[]; reasons: string[] } {
  if (intent.knowledgeTypes.length === 1 && intent.knowledgeTypes[0] === "out_of_scope") return { mode: "unsupported", missingCriticalInformation: [], optionalFollowUpFields: [], reasons: ["问题明确超出产品支持范围"] };
  if (HIGH_RISK.test(question)) {
    const missing = VAGUE_REFERENCE.test(question) ? ["操作对象"] : ["目标对象与影响范围"];
    return { mode: "missing_critical_information", missingCriticalInformation: missing, optionalFollowUpFields: [], reasons: ["模糊请求涉及不可逆或高风险操作"] };
  }
  if (UNKNOWN_ACCESS_TARGET.test(question.trim())) return { mode: "missing_critical_information", missingCriticalInformation: ["要访问的链接或页面"], optionalFollowUpFields: [], reasons: ["访问对象完全不明确，现有知识不能安全回答"] };
  const explicitApi = intent.knowledgeTypes.some((type) => type === "http_api" || type === "local_api");
  if (explicitApi && (!intent.apiType || !intent.method) && /精确|exact/i.test(question)) {
    const missing = [!intent.apiType && "API 类型", !intent.method && "Method"].filter((value): value is string => Boolean(value));
    return { mode: "missing_critical_information", missingCriticalInformation: missing, optionalFollowUpFields: [], reasons: ["客户要求精确 API，但关键 API 条件缺失"] };
  }
  if (LOGIN_AMBIGUITY.test(question.trim())) return { mode: "ambiguous_with_safe_branches", missingCriticalInformation: [], optionalFollowUpFields: ["登录对象", "错误提示"], reasons: ["可能是 DICloak 账号或环境内第三方平台账号，两个分支可安全并列"] };
  if (BROAD_FAILURE.test(question) || intent.missingConditions.includes("symptomDetails")) return { mode: "broad_troubleshooting", missingCriticalInformation: [], optionalFollowUpFields: ["错误提示", "发生步骤", "操作系统"], reasons: ["问题属于已知故障类别，但暂时不能确定唯一根因"] };
  return { mode: "precise", missingCriticalInformation: [], optionalFollowUpFields: [], reasons: ["对象和意图足以直接选择知识"] };
}

const directionRules: Array<[string, string, RegExp]> = [
  ["antivirus", "杀毒软件或安全软件", /杀毒|安全软件|antivirus|firewall/i],
  ["permission", "文件或系统权限", /权限|管理员运行|permission|administrator/i],
  ["network", "网络连接", /网络|无法访问|network|internet|site can't be reached/i],
  ["proxy", "代理配置或连通性", /代理|proxy/i],
  ["disk", "磁盘空间或路径", /磁盘|空间不足|硬盘|disk|drive/i],
  ["cache", "缓存或环境文件", /缓存|文件夹|环境文件|cache|folder|file/i],
  ["kernel", "浏览器内核", /内核|kernel|chrome\s*\d+/i],
  ["extension", "扩展", /扩展|extension/i],
  ["session", "登录状态或会话", /登录|会话|账号不存在|login|session|account does not exist/i],
  ["sync", "数据同步", /同步|cookie|sync/i],
];

function directions(candidate: RetrievalCandidate): Array<{ key: string; label: string }> {
  const content = `${candidate.metadata.category ?? ""} ${candidate.metadata.subcategory ?? ""} ${candidate.title} ${candidate.text}`;
  const matches = directionRules.filter(([, , pattern]) => pattern.test(content)).map(([key, label]) => ({ key, label }));
  if (matches.length) return matches;
  const fallback = String(candidate.metadata.subcategory ?? candidate.metadata.category ?? candidate.knowledgeId);
  return [{ key: fallback.toLocaleLowerCase(), label: fallback }];
}

function groupDiverse(candidates: RetrievalCandidate[], limit = 7): { selected: RetrievalCandidate[]; groups: KnowledgeGroup[] } {
  const groups = new Map<string, { label: string; candidates: RetrievalCandidate[] }>();
  for (const candidate of candidates) {
    for (const item of directions(candidate)) {
      const current = groups.get(item.key) ?? { label: item.label, candidates: [] };
      current.candidates.push(candidate); groups.set(item.key, current);
    }
  }
  const chosen = [...groups.entries()].slice(0, limit);
  const selected = [...new Map(chosen.map(([, value]) => [value.candidates[0].chunkId, value.candidates[0]])).values()].slice(0, limit);
  return {
    selected,
    groups: chosen.map(([key, value]) => ({ key, label: value.label, knowledgeIds: value.candidates.map((candidate) => candidate.knowledgeId) })),
  };
}

function loginBranches(candidates: RetrievalCandidate[]): { selected: RetrievalCandidate[]; branches: KnowledgeBranch[] } {
  const dicloak = candidates.filter((candidate) => /(?:logging\s+in\s+to|login.{0,12})\s*DICloak|DICloak\s+(?:账号|account|登录|login)/i.test(`${candidate.title} ${candidate.text}`)).slice(0, 2);
  const dicloakIds = new Set(dicloak.map((candidate) => candidate.knowledgeId));
  const platform = candidates.filter((candidate) => !dicloakIds.has(candidate.knowledgeId) && candidate.knowledgeType === "troubleshooting" && /平台|工具账号|网站账号|验证码|cookie|platform|tool account|website account|recaptcha/i.test(`${candidate.title} ${candidate.text}`)).slice(0, 2);
  const branches = [
    dicloak.length ? { label: "DICloak 账号登录", knowledgeIds: dicloak.map((item) => item.knowledgeId) } : null,
    platform.length ? { label: "第三方平台账号登录", knowledgeIds: platform.map((item) => item.knowledgeId) } : null,
  ].filter((value): value is KnowledgeBranch => Boolean(value));
  const ids = new Set(branches.flatMap((branch) => branch.knowledgeIds));
  return { selected: candidates.filter((candidate) => ids.has(candidate.knowledgeId)), branches };
}

export function decideRetrieval(question: string, intent: QueryIntent, candidates: RetrievalCandidate[], confidence: EvidenceConfidence, confidenceReasons: string[]): RetrievalDecision {
  const classification = classifyQuestionMode(question, intent);
  const apiRequested = intent.knowledgeTypes.some((type) => type === "http_api" || type === "local_api");
  const safe = candidates.filter((candidate) => {
    if (!apiRequested && /API/i.test(String(candidate.metadata.subcategory ?? ""))) return false;
    return candidate.rerankScore >= retrievalConfig.confidence.minimum || candidate.vectorScore >= 0.2 || candidate.textScore >= 0.2;
  });
  let selectedKnowledge: RetrievalCandidate[] = [];
  let knowledgeGroups: KnowledgeGroup[] = [];
  let branches: KnowledgeBranch[] = [];
  let responseStrategy: ResponseStrategy = "clarify_only";
  const decisionReasons = [...classification.reasons, ...confidenceReasons];

  if (classification.mode === "missing_critical_information") responseStrategy = "clarify_only";
  else if (classification.mode === "unsupported") { selectedKnowledge = safe.slice(0, 1); responseStrategy = selectedKnowledge.length ? "unsupported" : "clarify_only"; }
  else if (classification.mode === "ambiguous_with_safe_branches") {
    const result = loginBranches(safe); selectedKnowledge = result.selected; branches = result.branches;
    responseStrategy = branches.length >= 2 ? "conditional" : selectedKnowledge.length ? "answer_then_clarify" : "clarify_only";
  } else if (classification.mode === "broad_troubleshooting") {
    const result = groupDiverse(safe, 7); selectedKnowledge = result.selected.slice(0, 7); knowledgeGroups = result.groups;
    responseStrategy = selectedKnowledge.length >= 2 ? (classification.optionalFollowUpFields.length ? "answer_then_clarify" : "aggregated") : selectedKnowledge.length ? "answer_then_clarify" : "clarify_only";
  } else {
    selectedKnowledge = safe.slice(0, retrievalConfig.outputTopK); responseStrategy = selectedKnowledge.length ? "direct" : "clarify_only";
  }

  const selectedIds = new Set(selectedKnowledge.map((candidate) => candidate.chunkId));
  const rejectedCandidates = candidates.filter((candidate) => !selectedIds.has(candidate.chunkId)).map((candidate) => ({ candidate, reason: safe.includes(candidate) ? "未被当前回复策略选中" : "低于最低安全相关性阈值" }));
  return { questionMode: classification.mode, evidenceConfidence: confidence, responseStrategy, selectedKnowledge, debugCandidates: candidates, rejectedCandidates, knowledgeGroups, branches, missingCriticalInformation: classification.missingCriticalInformation, optionalFollowUpFields: classification.optionalFollowUpFields, decisionReasons };
}
