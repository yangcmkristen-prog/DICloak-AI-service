import { retrievalConfig } from "./config.ts";
import type { QueryIntent, RetrievalCandidate, RetrievalConfidence } from "./types.ts";

export function reciprocalRankFusion(lists: RetrievalCandidate[][]): RetrievalCandidate[] {
  const merged = new Map<string, RetrievalCandidate>();
  for (const list of lists) list.forEach((candidate, index) => {
    const current = merged.get(candidate.chunkId) ?? { ...candidate, source: "fused" as const, rrfScore: 0, matchedBy: [] };
    current.rrfScore += 1 / (retrievalConfig.rrfK + index + 1);
    current.vectorScore = Math.max(current.vectorScore, candidate.vectorScore);
    current.textScore = Math.max(current.textScore, candidate.textScore);
    current.matchedBy = [...new Set([...current.matchedBy, candidate.source])];
    merged.set(candidate.chunkId, current);
  });
  return [...merged.values()].sort((a, b) => b.rrfScore - a.rrfScore).slice(0, retrievalConfig.fusedTopK);
}

const terms = (value: string) => {
  const normalized = value.toLocaleLowerCase();
  const latin = normalized.match(/[\p{Script=Latin}\p{N}_./{}-]{2,}/gu) ?? [];
  const han = normalized.match(/\p{Script=Han}+/gu)?.flatMap((segment) => Array.from({ length: Math.max(0, segment.length - 1) }, (_, index) => segment.slice(index, index + 2))) ?? [];
  return [...new Set([...latin, ...han])];
};

export function rerankCandidates(question: string, intent: QueryIntent, candidates: RetrievalCandidate[]): RetrievalCandidate[] {
  const queryTerms = terms(question);
  const maxRrf = Math.max(...candidates.map((item) => item.rrfScore), 1);
  return candidates.map((candidate) => {
    const content = `${candidate.title}\n${candidate.text}`.toLocaleLowerCase();
    const coverage = queryTerms.length ? queryTerms.filter((term) => content.includes(term)).length / queryTerms.length : 0;
    const structureMatches = [intent.method && content.includes(intent.method.toLowerCase()), intent.apiVersion && candidate.apiVersion === intent.apiVersion, intent.object && String(candidate.metadata.object ?? "").toLowerCase() === intent.object.toLowerCase(), intent.action && String(candidate.metadata.action ?? "").toLowerCase() === intent.action.toLowerCase()].filter(Boolean).length;
    const structuralCoverage = structureMatches / Math.max(1, [intent.method, intent.apiVersion, intent.object, intent.action].filter(Boolean).length);
    const normalizedText = Math.min(1, candidate.textScore);
    const baseCoverage = Math.max(coverage, structuralCoverage);
    const rerankScore = retrievalConfig.rerank.rrf * (candidate.rrfScore / maxRrf) + retrievalConfig.rerank.vector * Math.max(0, candidate.vectorScore) + retrievalConfig.rerank.text * normalizedText + retrievalConfig.rerank.coverage * baseCoverage;
    return { ...candidate, rerankScore };
  }).sort((a, b) => b.rerankScore - a.rerankScore);
}

export function calculateConfidence(intent: QueryIntent, candidates: RetrievalCandidate[]): { confidence: RetrievalConfidence; reasons: string[] } {
  const first = candidates[0]; const second = candidates[1];
  if (!first) return { confidence: "none", reasons: ["没有候选知识"] };
  const gap = first.rerankScore - (second?.rerankScore ?? 0);
  const conflict = Boolean(second && first.apiType && second.apiType && first.apiType !== second.apiType);
  const reasons = [`Top-1=${first.rerankScore.toFixed(3)}`, `差距=${gap.toFixed(3)}`];
  if (intent.missingConditions.length) reasons.push(`缺失条件：${intent.missingConditions.join(",")}`);
  if (conflict) reasons.push("Top 候选存在 API 类型冲突");
  if (intent.missingConditions.includes("symptomDetails")) return { confidence: "none", reasons: [...reasons, "问题缺少可定位的故障信息"] };
  if (intent.missingConditions.length >= 2 && first.rerankScore < retrievalConfig.confidence.medium) return { confidence: "none", reasons: [...reasons, "结构化条件不足且候选不够强"] };
  if (first.rerankScore < retrievalConfig.confidence.minimum) return { confidence: "none", reasons: [...reasons, "低于最低返回阈值"] };
  if (conflict || intent.missingConditions.length > 1 || gap < retrievalConfig.confidence.weakGap) return { confidence: "low", reasons };
  if (first.rerankScore >= retrievalConfig.confidence.high && gap >= retrievalConfig.confidence.strongGap) return { confidence: "high", reasons };
  if (first.rerankScore >= retrievalConfig.confidence.medium) return { confidence: "medium", reasons };
  return { confidence: "low", reasons };
}
