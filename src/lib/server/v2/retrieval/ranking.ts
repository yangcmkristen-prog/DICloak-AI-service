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
    [/(?:账号|环境)|\b(?:account|profile)s?\b/i, ["profile", "profiles"]],
    [/(?:用户|成员|席位)|\b(?:user|member|seat)s?\b/i, ["member", "members", "actual users", "devices"]],
    [/(?:基础套餐)|\bbase\s+plan\b/i, ["base", "base plan"]],
  ];
  const concepts = conceptGroups.flatMap(([pattern, aliases]) => pattern.test(value) ? aliases : []);
  return [...new Set([...latin, ...han, ...concepts])];
};

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
    const rerankScore = retrievalConfig.rerank.rrf * (candidate.rrfScore / maxRrf) + retrievalConfig.rerank.vector * Math.max(0, candidate.vectorScore) + retrievalConfig.rerank.text * normalizedText + retrievalConfig.rerank.coverage * baseCoverage + retrievalConfig.rerank.categorical * categoricalCoverage;
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
  if (effectiveMissing.includes("symptomDetails")) return { confidence: "none", reasons: [...reasons, "问题缺少可定位的故障信息"] };
  const deterministicOutOfScope = intent.knowledgeTypes.length === 1 && intent.knowledgeTypes[0] === "out_of_scope" && candidates.slice(0, 4).every((candidate) => candidate.knowledgeType === "out_of_scope");
  if (deterministicOutOfScope) return { confidence: "medium", reasons: [...reasons, "确定性识别为非产品支持范围"] };
  if (effectiveMissing.length >= 2 && first.rerankScore < retrievalConfig.confidence.medium) return { confidence: "none", reasons: [...reasons, "结构化条件不足且候选不够强"] };
  if (first.rerankScore < retrievalConfig.confidence.minimum) {
    const typoTolerantFunction = !["zh", "en"].includes(intent.language) && first.knowledgeType === "function" && candidates.slice(0, 3).every((candidate) => candidate.knowledgeType === "function") && first.vectorScore >= 0.18 && gap >= retrievalConfig.confidence.weakGap;
    return typoTolerantFunction ? { confidence: "medium", reasons: [...reasons, "多语言功能意图一致，容忍明显拼写偏差"] } : { confidence: "none", reasons: [...reasons, "低于最低返回阈值"] };
  }
  if (conflict || effectiveMissing.length > 1 || gap < retrievalConfig.confidence.weakGap) return { confidence: "low", reasons };
  if (first.rerankScore >= retrievalConfig.confidence.high && gap >= retrievalConfig.confidence.strongGap) return { confidence: "high", reasons };
  if (first.rerankScore >= retrievalConfig.confidence.medium) return { confidence: "medium", reasons };
  return { confidence: "low", reasons };
}
