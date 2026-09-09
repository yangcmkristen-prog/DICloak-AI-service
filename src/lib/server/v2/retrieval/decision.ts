import { retrievalConfig } from "./config.ts";
import { detectActions } from "./ranking.ts";
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
const FEATURE_CAPABILITY_QUESTION = /(?:是否|能否|可不可以|可以|能不能|支持|有没有).{0,30}(?:功能|按钮|菜单|栏|页面|设置|模式|同步|隐藏|显示|关闭|开启|打开|禁用|启用)|\b(?:can|could|does|support|hide|show|disable|enable|limit|restrict|configure|set|allow)\b|(?:seria\s+interessante|poderia|pudesse|podemos|é\s+possível|tem\s+como|gostaria|sería\s+interesante|podría|se\s+puede|es\s+posible|quisiera).{0,80}(?:membro|perfil|ambiente|função|configura|limite|acesso|dispositivo|miembro|usuario|función|acceso)|(?:quantos|quantidade|número\s+de|cuántos|cantidad).{0,50}(?:membro|perfil|ambiente|dispositivo|acesso|miembro|usuario)|(?:можно\s+ли|хотелось\s+бы|возможно\s+ли).{0,80}(?:участник|пользователь|профил|доступ|устройств|огранич)|(?:có\s+thể|có\s+hỗ\s+trợ|muốn).{0,80}(?:thành\s+viên|người\s+dùng|hồ\s+sơ|môi\s+trường|truy\s+cập|thiết\s+bị|giới\s+hạn)/i;
const FEATURE_ACTIONS = ["隐藏", "显示", "关闭", "开启", "打开", "禁用", "启用", "同步", "批量", "hide", "show", "disable", "enable", "turn off", "turn on", "sync", "batch"];
type FunctionQuestionScope = "specific_operation" | "feature_overview" | "workflow" | "comparison" | "ambiguous";
const WORKFLOW_QUESTION = /怎么用|如何使用|怎么参与|如何参与|完整流程|全部步骤|从哪里开始|先.+再|how\s+(?:do\s+i|to)\s+(?:use|participate|get started)|step[- ]by[- ]step|workflow|processo\s+completo|cómo\s+(?:usar|participar)/i;
const OVERVIEW_QUESTION = /是什么|有哪些(?:功能|能力)?|有什么(?:功能|能力)?|能做什么|介绍一下|功能介绍|(?:有|有没有|是否有|提供|支持).{0,24}(?:功能|活动|计划|方案|能力|奖励|返现)|what\s+is|what\s+(?:features|capabilities)|do\s+you\s+(?:have|offer)|overview|o\s+que\s+é|qué\s+es/i;
const COMPARISON_QUESTION = /区别|差异|对比|比较|哪个好|哪个更|还是.{0,16}好|difference|compare|comparison|versus|\bvs\.?\b|qual\s+é\s+melhor|diferencia/i;

export function classifyFunctionQuestionScope(question: string): FunctionQuestionScope {
  const actions = [...new Set(detectActions(question))];
  if (COMPARISON_QUESTION.test(question)) return "comparison";
  if (WORKFLOW_QUESTION.test(question) || actions.length >= 2) return "workflow";
  if (OVERVIEW_QUESTION.test(question) && actions.length === 0) return "feature_overview";
  if (actions.length === 1) return "specific_operation";
  return "ambiguous";
}

type QuantityEntity = "member" | "profile" | "device" | "website" | "ip";
const QUANTITY_ENTITY_PATTERNS: Array<[QuantityEntity, string]> = [
  ["member", "成员|用户|席位|members?|users?|seats?|membros?|miembros?|usuarios?|участник(?:ов)?|пользовател(?:ь|ей)|thành\\s+viên|người\\s+dùng"],
  ["profile", "环境|浏览器配置|profiles?|environments?|perfil|perfis|ambientes?|профил(?:ь|ей|и)?|hồ\\s+sơ|môi\\s+trường"],
  ["device", "设备|devices?|dispositivos?|устройств(?:о|а)?|thiết\\s+bị"],
  ["website", "网站|网页|sites?|websites?|sites?|sitios?|сайт(?:ов)?|trang\\s+web"],
  ["ip", "IP|ip(?:s|地址)?"],
];
const QUANTITY_WORD = "数量|个数|上限|最多|多少|number|count|maximum|how\\s+many|quantos?|quantas?|quantidade|número|cuántos?|cuántas?|cantidad|сколько|количество|bao\\s+nhiêu|số\\s+lượng";

function quantityTarget(value: string): QuantityEntity | null {
  for (const [entity, source] of QUANTITY_ENTITY_PATTERNS) {
    if (new RegExp(`(?:${QUANTITY_WORD}).{0,24}(?:${source})|(?:${source}).{0,4}(?:${QUANTITY_WORD})`, "i").test(value)) return entity;
  }
  return null;
}

function mentionedEntities(value: string): Set<QuantityEntity> {
  return new Set(QUANTITY_ENTITY_PATTERNS.filter(([, source]) => new RegExp(source, "i").test(value)).map(([entity]) => entity));
}

function inverseQuantityKnowledge(question: string, candidates: RetrievalCandidate[]): RetrievalCandidate | undefined {
  const requestedTarget = quantityTarget(question);
  const requestedEntities = mentionedEntities(question);
  if (!requestedTarget || requestedEntities.size < 2) return undefined;
  return candidates.find((candidate) => {
    const fields = [candidate.title, String(candidate.metadata.functionName ?? ""), String(candidate.metadata.description ?? ""), candidate.text];
    const content = fields.join(" ");
    const candidateTarget = fields.map(quantityTarget).find((target): target is QuantityEntity => target !== null) ?? null;
    if (!candidateTarget || candidateTarget === requestedTarget) return false;
    const candidateEntities = mentionedEntities(content);
    return candidateEntities.has(requestedTarget) && requestedEntities.has(candidateTarget);
  });
}

function hasMatchingFeatureAction(question: string, candidates: RetrievalCandidate[]): boolean {
  const normalized = question.toLocaleLowerCase();
  const actions = FEATURE_ACTIONS.filter((action) => normalized.includes(action));
  if (!actions.length) return true;
  return candidates.some((candidate) => {
    const content = `${candidate.title} ${candidate.metadata.functionName ?? ""} ${candidate.text}`.toLocaleLowerCase();
    return actions.some((action) => content.includes(action));
  });
}

function functionFamilyKnowledge(candidates: RetrievalCandidate[]): RetrievalCandidate[] {
  const first = candidates.find((candidate) => candidate.knowledgeType === "function");
  if (!first) return [];
  const module = String(first.metadata.module ?? "").trim().toLocaleLowerCase();
  const page = String(first.metadata.page ?? "").trim().toLocaleLowerCase();
  if (!module || !page) return [first];
  return candidates.filter((candidate) => candidate.knowledgeType === "function"
    && String(candidate.metadata.module ?? "").trim().toLocaleLowerCase() === module
    && String(candidate.metadata.page ?? "").trim().toLocaleLowerCase() === page).slice(0, 3);
}

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

function priority(candidate: RetrievalCandidate): number {
  const value = Number(candidate.metadata.priority);
  return Number.isFinite(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER;
}

function groupDiverse(candidates: RetrievalCandidate[], limit = 5): { selected: RetrievalCandidate[]; groups: KnowledgeGroup[] } {
  const groups = new Map<string, { label: string; candidates: RetrievalCandidate[] }>();
  for (const candidate of candidates) {
    for (const item of directions(candidate)) {
      const current = groups.get(item.key) ?? { label: item.label, candidates: [] };
      current.candidates.push(candidate); groups.set(item.key, current);
    }
  }
  for (const value of groups.values()) value.candidates.sort((a, b) => priority(a) - priority(b) || b.rerankScore - a.rerankScore);
  const chosen = [...groups.entries()].sort(([, a], [, b]) => priority(a.candidates[0]) - priority(b.candidates[0]) || b.candidates[0].rerankScore - a.candidates[0].rerankScore).slice(0, limit);
  const selected = [...new Map(chosen.map(([, value]) => [value.candidates[0].chunkId, value.candidates[0]])).values()];
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
  const inverseQuantity = intent.knowledgeTypes.length === 1 && intent.knowledgeTypes[0] === "function" && FEATURE_CAPABILITY_QUESTION.test(question)
    ? inverseQuantityKnowledge(question, safe)
    : undefined;
  const functionCapabilityUncertain = intent.knowledgeTypes.length === 1 && intent.knowledgeTypes[0] === "function"
    && FEATURE_CAPABILITY_QUESTION.test(question)
    && (confidence === "none" || confidence === "low" || !hasMatchingFeatureAction(question, safe));
  const functionScope = intent.knowledgeTypes.length === 1 && intent.knowledgeTypes[0] === "function" ? classifyFunctionQuestionScope(question) : null;

  if (inverseQuantity) {
    selectedKnowledge = [inverseQuantity];
    responseStrategy = "partial_support";
    decisionReasons.push("目标数量限制与已支持功能的限制方向相反，仅可作为部分支持说明");
  } else if (functionCapabilityUncertain) {
    responseStrategy = "confirmation_required";
    decisionReasons.push("功能能力咨询缺少足够确定且动作一致的证据，需要进一步确认");
  } else if (functionScope === "feature_overview" || functionScope === "workflow") {
    selectedKnowledge = functionFamilyKnowledge(safe);
    responseStrategy = selectedKnowledge.length >= 2 ? functionScope === "workflow" ? "function_workflow" : "feature_overview" : selectedKnowledge.length ? "direct" : "confirmation_required";
    if (selectedKnowledge.length >= 2) {
      const first = selectedKnowledge[0];
      const key = `feature:${String(first.metadata.module ?? "")}:${String(first.metadata.page ?? "")}`;
      knowledgeGroups = [{ key, label: String(first.metadata.page ?? first.metadata.module ?? "功能概览"), knowledgeIds: selectedKnowledge.map((candidate) => candidate.knowledgeId) }];
      decisionReasons.push(functionScope === "workflow" ? "完整流程问题，整合同一模块和页面下的互补步骤" : "概览型功能问题，整合同一模块和页面下的互补功能");
    }
  } else if (functionScope === "comparison") {
    selectedKnowledge = safe.filter((candidate) => candidate.knowledgeType === "function").slice(0, 3);
    responseStrategy = selectedKnowledge.length >= 2 ? "function_comparison" : selectedKnowledge.length ? "direct" : "confirmation_required";
    if (selectedKnowledge.length >= 2) decisionReasons.push("功能比较问题，保留多个直接相关候选用于对照");
  } else if (classification.mode === "missing_critical_information") responseStrategy = "clarify_only";
  else if (classification.mode === "unsupported") { selectedKnowledge = safe.slice(0, 1); responseStrategy = selectedKnowledge.length ? "unsupported" : "clarify_only"; }
  else if (classification.mode === "ambiguous_with_safe_branches") {
    const result = loginBranches(safe); selectedKnowledge = result.selected; branches = result.branches;
    responseStrategy = branches.length >= 2 ? "conditional" : selectedKnowledge.length ? "answer_then_clarify" : "clarify_only";
  } else if (classification.mode === "broad_troubleshooting") {
    const result = groupDiverse(safe, 5); selectedKnowledge = result.selected; knowledgeGroups = result.groups;
    responseStrategy = selectedKnowledge.length >= 2 ? (classification.optionalFollowUpFields.length ? "answer_then_clarify" : "aggregated") : selectedKnowledge.length ? "answer_then_clarify" : "clarify_only";
  } else {
    const uncertainFunction = intent.knowledgeTypes.length === 1 && intent.knowledgeTypes[0] === "function" && (confidence === "low" || confidence === "none");
    selectedKnowledge = uncertainFunction ? [] : safe.slice(0, retrievalConfig.outputTopK);
    responseStrategy = uncertainFunction ? "confirmation_required" : selectedKnowledge.length ? "direct" : "clarify_only";
    if (uncertainFunction) decisionReasons.push("功能候选置信度不足，需要进一步确认");
  }

  const selectedIds = new Set(selectedKnowledge.map((candidate) => candidate.chunkId));
  const rejectedCandidates = candidates.filter((candidate) => !selectedIds.has(candidate.chunkId)).map((candidate) => ({ candidate, reason: safe.includes(candidate) ? "未被当前回复策略选中" : "低于最低安全相关性阈值" }));
  return { questionMode: classification.mode, evidenceConfidence: confidence, responseStrategy, selectedKnowledge, debugCandidates: candidates, rejectedCandidates, knowledgeGroups, branches, missingCriticalInformation: classification.missingCriticalInformation, optionalFollowUpFields: classification.optionalFollowUpFields, decisionReasons };
}
