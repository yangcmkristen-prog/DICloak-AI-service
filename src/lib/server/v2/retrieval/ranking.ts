import { retrievalConfig } from "./config.ts";
import type { QueryIntent, RetrievalCandidate, RetrievalConfidence } from "./types.ts";

export function reciprocalRankFusion(lists: RetrievalCandidate[][]): RetrievalCandidate[] {
  const merged = new Map<string, RetrievalCandidate>();
  for (const list of lists) list.forEach((candidate, index) => {
    // Retrieval ultimately returns knowledge records. Letting overview/steps chunks
    // occupy separate fusion slots can evict a relevant record before reranking.
    const key = candidate.knowledgeId;
    const current = merged.get(key) ?? { ...candidate, source: "fused" as const, rrfScore: 0, matchedBy: [] };
    current.rrfScore += 1 / (retrievalConfig.rrfK + index + 1);
    current.vectorScore = Math.max(current.vectorScore, candidate.vectorScore);
    current.textScore = Math.max(current.textScore, candidate.textScore);
    current.matchedBy = [...new Set([...current.matchedBy, candidate.source])];
    merged.set(key, current);
  });
  return [...merged.values()].sort((a, b) => b.rrfScore - a.rrfScore).slice(0, retrievalConfig.fusedTopK);
}

const terms = (value: string) => {
  const normalized = value.toLocaleLowerCase();
  const latin = normalized.match(/[\p{Script=Latin}\p{N}_./{}-]{2,}/gu) ?? [];
  const han = normalized.match(/\p{Script=Han}+/gu)?.flatMap((segment) => Array.from({ length: Math.max(0, segment.length - 1) }, (_, index) => segment.slice(index, index + 2))) ?? [];
  const conceptGroups: Array<[RegExp, string[]]> = [
    [/(?:账号|环境|профил|профилей|профили|hồ sơ|môi trường)|\b(?:accounts?|profiles?|perfil|perfis|ambientes?)\b/i, ["profile", "profiles", "environment"]],
    [/(?:用户|成员|席位|участник|участников|пользователь|người dùng|thành viên)|\b(?:user|member|seat|membro|membros|miembro|miembros|usuario|usuarios)s?\b/i, ["member", "members", "actual users", "devices"]],
    [/(?:数量|个数|上限|限制|сколько|количество|огранич|bao nhiêu|số lượng|giới hạn)|\b(?:how\s+many|number|count|limit|maximum|quantos|quantas|quantidade|número|cuántos|cuántas|cantidad|límite)\b/i, ["number", "limit", "maximum", "quota"]],
    [/(?:访问|打开|使用|доступ|откры|truy cập|mở|sử dụng)|\b(?:access|open|use|acessar|abrir|usar|acceder)\b/i, ["access", "open", "use"]],
    [/(?:管理员|超管|администратор|quản trị viên)|\b(?:admin|administrator|adm|gerente|administrador)\b/i, ["admin", "administrator"]],
    [/(?:基础套餐)|\bbase\s+plan\b/i, ["base", "base plan"]],
  ];
  const concepts = conceptGroups.flatMap(([pattern, aliases]) => pattern.test(value) ? aliases : []);
  return [...new Set([...latin, ...han, ...concepts])];
};

export type ActionIntent = "configure" | "inspect" | "view" | "create" | "delete" | "import" | "export" | "open" | "close" | "enable" | "disable" | "reset";

const ACTION_PATTERNS: ReadonlyArray<[ActionIntent, RegExp]> = [
  ["inspect", /(?:检测|测试|校验|验证|诊断|排查|连通性|可用性|провер|тест|диагност|kiểm tra)|\b(?:detect|test|check|verify|diagnos|connectivity|availability|detectar|testar|verificar|comprobar|probar)\w*\b/i],
  ["configure", /(?:修改|编辑|配置|设置|更换|替换|换成|换掉|换|更改|调整|更新|改成|变更|редакт|измен|замен|настро|cấu hình|chỉnh sửa|thay đổi)|\b(?:edit|modify|configur|setting|settings|change|replace|swap|update|alter|editar|modificar|configurar|ajustar|cambiar|reemplazar|actualizar|trocar|substituir)\w*\b/i],
  ["create", /(?:创建|新建|添加|新增|建立|生成|созда|добав|tạo|thêm)|\b(?:create|add|new|generate|criar|adicionar|crear|agregar)\w*\b/i],
  ["delete", /(?:删除|移除|清除|注销|удал|xóa|gỡ)|\b(?:delete|remove|clear|erase|deletar|remover|eliminar|borrar)\w*\b/i],
  ["import", /(?:导入|上传|импорт|nhập|tải lên)|\b(?:import|upload|importar|subir)\w*\b/i],
  ["export", /(?:导出|下载|экспорт|xuất|tải xuống)|\b(?:export|download|exportar|descargar)\w*\b/i],
  ["enable", /(?:启用|开启|打开开关|激活|включ|kích hoạt|bật)|\b(?:enable|activate|habilitar|ativar)\w*\b/i],
  ["disable", /(?:禁用|停用|关闭开关|取消启用|отключ|vô hiệu hóa|tắt)|\b(?:disable|deactivate|desabilitar|desativar)\w*\b/i],
  ["reset", /(?:重置|恢复默认|初始化|сброс|đặt lại)|\b(?:reset|restore default|redefinir|restablecer)\w*\b/i],
  ["close", /(?:关闭|退出|关掉|закры|đóng)|\b(?:close|exit|fechar|cerrar)\w*\b/i],
  ["open", /(?:打开|启动|进入|访问|откры|запуст|mở|truy cập)|\b(?:open|launch|start|access|abrir|iniciar|acessar)\w*\b/i],
  ["view", /(?:查看|查询|显示|浏览|列表|记录|日志|просмотр|показ|xem|hiển thị)|\b(?:view|show|list|query|browse|history|log|visualizar|consultar|mostrar|ver)\w*\b/i],
];

export function detectActions(value: string): ActionIntent[] {
  const matches = ACTION_PATTERNS.flatMap(([action, pattern], priority) => {
    const match = pattern.exec(value);
    return match ? [{ action, index: match.index, priority }] : [];
  });
  matches.sort((left, right) => left.index - right.index || left.priority - right.priority);
  return matches.map((match) => match.action);
}

export function detectAction(value: string): ActionIntent | null {
  return detectActions(value)[0] ?? null;
}

function candidateAction(candidate: RetrievalCandidate): ActionIntent | null {
  const metadataAction = String(candidate.metadata.action ?? "");
  const heading = [candidate.title, candidate.metadata.functionName, candidate.metadata.description]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");
  return detectAction(metadataAction) ?? detectAction(heading);
}

function actionAdjustment(question: string, candidate: RetrievalCandidate): number {
  const requested = detectAction(question);
  const offered = candidateAction(candidate);
  if (!requested || !offered) return 0;
  if (requested === offered) return 0.14;

  const conflicts: ReadonlyArray<ReadonlySet<ActionIntent>> = [
    new Set(["configure", "inspect"]),
    new Set(["configure", "view"]),
    new Set(["create", "delete"]),
    new Set(["import", "export"]),
    new Set(["open", "close"]),
    new Set(["enable", "disable"]),
    new Set(["reset", "configure"]),
  ];
  return conflicts.some((pair) => pair.has(requested) && pair.has(offered)) ? -0.18 : 0;
}

function keywordAliasAdjustment(question: string, candidate: RetrievalCandidate): number {
  if (candidate.knowledgeType !== "function") return 0;
  const keywords = [candidate.metadata.keywordsZh, candidate.metadata.keywordsEn]
    .flatMap((value) => Array.isArray(value) ? value : [])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (!keywords.length) return 0;
  const normalizedQuestion = question.trim().toLocaleLowerCase();
  if (keywords.some((keyword) => normalizedQuestion.includes(keyword.trim().toLocaleLowerCase()))) return 0.16;
  const requestedAction = detectAction(question);
  const questionTerms = new Set(terms(question));
  const semanticAlias = keywords.some((keyword) => {
    if (!requestedAction || detectAction(keyword) !== requestedAction) return false;
    return terms(keyword).some((term) => questionTerms.has(term));
  });
  return semanticAlias ? 0.12 : 0;
}

export function rerankCandidates(question: string, intent: QueryIntent, candidates: RetrievalCandidate[]): RetrievalCandidate[] {
  const queryTerms = terms(question);
  const teamAccountSharing = /(?:分享|共享).{0,15}(?:订阅|账号|账户)|(?:团队|成员).{0,15}(?:分享|共享)|share.{0,15}(?:subscription|account)/i.test(question);
  const maxRrf = Math.max(...candidates.map((item) => item.rrfScore), 1);
  return candidates.map((candidate) => {
    const content = `${candidate.title}\n${candidate.text}`.toLocaleLowerCase();
    const coverage = queryTerms.length ? queryTerms.filter((term) => content.includes(term)).length / queryTerms.length : 0;
    const structureMatches = [intent.method && content.includes(intent.method.toLowerCase()), intent.apiVersion && candidate.apiVersion === intent.apiVersion, intent.object && String(candidate.metadata.object ?? "").toLowerCase() === intent.object.toLowerCase(), intent.action && String(candidate.metadata.action ?? "").toLowerCase() === intent.action.toLowerCase()].filter(Boolean).length;
    const structuralCoverage = structureMatches / Math.max(1, [intent.method, intent.apiVersion, intent.object, intent.action].filter(Boolean).length);
    const normalizedText = Math.min(1, candidate.textScore);
    const expectedOutOfScopeSubtype = /(?:生成|购买|提供).{0,12}(?:AI|Sora|视频|工具账号)/i.test(question) ? "tool_services"
      : /免费.{0,8}(?:浏览|播放|点赞|粉丝)|visualiza(?:ção|cao)\s+gr[aá]tis/i.test(question) ? "growth_service"
      : /(?:账号|account).{0,10}(?:封禁|禁用|disabled|unblock)|(?:赚钱|挣钱|earn\s+money|make\s+money)/i.test(question) ? "unsupported"
      : null;
    const outOfScopeCategory = expectedOutOfScopeSubtype && candidate.knowledgeType === "out_of_scope"
      ? String(candidate.metadata.subType ?? "") === expectedOutOfScopeSubtype ? 1 : 0
      : 0;
    const sharingCategory = teamAccountSharing && candidate.knowledgeType === "faq" && String(candidate.metadata.category ?? "") === "团队管理" && String(candidate.metadata.subcategory ?? "").includes("账号共享") ? 1 : 0;
    const categoricalCoverage = Math.max(outOfScopeCategory, sharingCategory);
    const baseCoverage = Math.max(coverage, structuralCoverage);
    // 专用知识在相近分数下优先；通用问答只有明显更贴近用户原问时才越过它。
    const sourcePriority = candidate.knowledgeType === 'general_faq' ? -0.03 : 0;
    const rerankScore = retrievalConfig.rerank.rrf * (candidate.rrfScore / maxRrf) + retrievalConfig.rerank.vector * Math.max(0, candidate.vectorScore) + retrievalConfig.rerank.text * normalizedText + retrievalConfig.rerank.coverage * baseCoverage + retrievalConfig.rerank.categorical * categoricalCoverage + actionAdjustment(question, candidate) + keywordAliasAdjustment(question, candidate) + sourcePriority;
    return { ...candidate, rerankScore };
  }).sort((a, b) => b.rerankScore - a.rerankScore);
}

export function calculateConfidence(intent: QueryIntent, candidates: RetrievalCandidate[]): { confidence: RetrievalConfidence; reasons: string[] } {
  const first = candidates[0]; const second = candidates[1];
  if (!first) return { confidence: "none", reasons: ["没有候选知识"] };
  const gap = first.rerankScore - (second?.rerankScore ?? 0);
  const conflict = Boolean(second && first.apiType && second.apiType && first.apiType !== second.apiType);
  const apiTypes = new Set(candidates.slice(0, 5).map((candidate) => candidate.apiType).filter(Boolean));
  const genericApiResolved = intent.knowledgeTypes.includes("http_api") && intent.knowledgeTypes.includes("local_api") && apiTypes.size === 1;
  const effectiveMissing = intent.missingConditions.filter((condition) => !genericApiResolved || condition !== "apiType" && condition !== "method");
  const reasons = [`Top-1=${first.rerankScore.toFixed(3)}`, `差距=${gap.toFixed(3)}`];
  if (genericApiResolved) reasons.push("候选一致指向同一 API 类型");
  if (effectiveMissing.length) reasons.push(`缺失条件：${effectiveMissing.join(",")}`);
  if (conflict) reasons.push("Top 候选存在 API 类型冲突");
  if (effectiveMissing.includes("symptomDetails")) reasons.push("缺少唯一根因所需的故障细节，但不否定已有排障证据");
  const deterministicOutOfScope = intent.knowledgeTypes.length === 1 && intent.knowledgeTypes[0] === "out_of_scope" && candidates.slice(0, 4).every((candidate) => candidate.knowledgeType === "out_of_scope");
  if (deterministicOutOfScope) return { confidence: "medium", reasons: [...reasons, "确定性识别为非产品支持范围"] };
  if (effectiveMissing.length >= 2 && first.rerankScore < retrievalConfig.confidence.medium) return { confidence: "none", reasons: [...reasons, "结构化条件不足且候选不够强"] };
  if (first.rerankScore < retrievalConfig.confidence.minimum) {
    const typoTolerantFunction = !["zh", "en"].includes(intent.language) && first.knowledgeType === "function" && candidates.slice(0, 3).every((candidate) => candidate.knowledgeType === "function") && first.vectorScore >= 0.18 && gap >= retrievalConfig.confidence.weakGap;
    if (typoTolerantFunction) return { confidence: "medium", reasons: [...reasons, "多语言功能意图一致，容忍明显拼写偏差"] };
    return first.vectorScore >= 0.2 || first.textScore >= 0.2 ? { confidence: "low", reasons: [...reasons, "单路证据超过最低安全阈值"] } : { confidence: "none", reasons: [...reasons, "低于最低返回阈值"] };
  }
  if (conflict || effectiveMissing.length > 0 || gap < retrievalConfig.confidence.weakGap) return { confidence: "low", reasons };
  if (first.rerankScore >= retrievalConfig.confidence.high && gap >= retrievalConfig.confidence.strongGap) return { confidence: "high", reasons };
  if (first.rerankScore >= retrievalConfig.confidence.medium) return { confidence: "medium", reasons };
  return { confidence: "low", reasons };
}
