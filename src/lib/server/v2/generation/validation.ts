import type { PreparedTerminologyPipeline } from "../terminology/types.ts";
import { restoreProtectedResponse } from "../terminology/pipeline.ts";
import type { RetrievalTrace } from "../retrieval/types.ts";
import type { V2GeneratedEnvelope } from "./protocol.ts";

export interface V2ValidationResult { ok: boolean; reply?: string; errors: string[] }
const INTERNAL_LANGUAGE = /根据(?:知识库|检索)|内部资料|作为\s*AI|正在查询|responseStrategy|knowledge\s*base|according to (?:the )?(?:knowledge|retrieval)|as an AI/i;
const KNOWLEDGE_ID = /\b(?:(?:ERR|FUNC|API|ROUTING|BILL)-[A-Z0-9_]+-[A-Z0-9_.:#-]+|PRICING:[A-Z0-9_. :#-]+|TS_[A-Z0-9_.:#-]+_[A-Z0-9_.:#-]+)\b/i;

export function validateV2Generation(envelope: V2GeneratedEnvelope, trace: RetrievalTrace, prepared: PreparedTerminologyPipeline): V2ValidationResult {
  const errors: string[] = []; const allowedIds = new Set(trace.selectedKnowledge.map((item) => item.knowledgeId));
  for (const claim of envelope.claims) {
    if (!claim.text || !claim.knowledgeIds.length) errors.push("CLAIM_WITHOUT_EVIDENCE");
    if (claim.knowledgeIds.some((id) => !allowedIds.has(id))) errors.push("CLAIM_USES_UNSELECTED_KNOWLEDGE");
  }
  if (!["clarify_only", "unsupported"].includes(trace.responseStrategy) && !envelope.claims.length) errors.push("CLAIMS_MISSING");
  if (trace.responseStrategy === "clarify_only" && (envelope.reply.match(/[?？]/g) ?? []).length > 1) errors.push("CLARIFY_MORE_THAN_ONE_QUESTION");
  if (trace.responseStrategy === "conditional" && trace.branches.length >= 2) for (const branch of trace.branches) if (!envelope.claims.some((claim) => claim.knowledgeIds.some((id) => branch.knowledgeIds.includes(id)))) errors.push(`CONDITIONAL_BRANCH_MISSING:${branch.label}`);
  if (["aggregated", "answer_then_clarify"].includes(trace.responseStrategy) && trace.knowledgeGroups.length > 1) {
    const covered = trace.knowledgeGroups.filter((group) => envelope.claims.some((claim) => claim.knowledgeIds.some((id) => group.knowledgeIds.includes(id))));
    if (covered.length < Math.min(3, trace.knowledgeGroups.length)) errors.push("AGGREGATED_DIRECTIONS_INCOMPLETE");
  }
  if (INTERNAL_LANGUAGE.test(envelope.reply)) errors.push("INTERNAL_LANGUAGE_LEAKED");
  if (KNOWLEDGE_ID.test(envelope.reply) || [...allowedIds].some((id) => envelope.reply.includes(id))) errors.push("KNOWLEDGE_ID_LEAKED");
  const allowedTechnical = new Set(trace.selectedKnowledge.flatMap((item) => item.protectedFields ?? []).map((field) => field.value));
  const rawTechnical = [...(envelope.reply.match(/https?:\/\/[^\s<>"')\]，。；：）】]+/g) ?? []), ...(envelope.reply.match(/\/(?:openapi\/)?v\d+(?:\/[A-Za-z0-9_.{}:-]+)+/g) ?? [])];
  for (const value of rawTechnical) if (!allowedTechnical.has(value)) errors.push(`UNSELECTED_OR_MODIFIED_TECHNICAL_FIELD:${value}`);
  // Repeating a known immutable marker is safe: every occurrence restores to the
  // same catalog value. Unknown or modified markers remain hard failures.
  const restored = restoreProtectedResponse(envelope.reply, prepared, { requireAll: false, allowKnownDuplicates: true });
  if (!restored.ok) errors.push(...restored.errors.map((error) => error.code));
  return errors.length ? { ok: false, errors: [...new Set(errors)] } : { ok: true, reply: restored.text, errors: [] };
}
