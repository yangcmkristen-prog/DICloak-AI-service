import type { PreparedTerminologyPipeline } from "../terminology/types.ts";
import { restoreProtectedResponse } from "../terminology/pipeline.ts";
import type { RetrievalTrace } from "../retrieval/types.ts";
import type { V2GeneratedEnvelope } from "./protocol.ts";

export interface V2ValidationResult { ok: boolean; reply?: string; errors: string[] }
const INTERNAL_LANGUAGE = /根据(?:知识库|检索)|内部资料|作为\s*AI|正在查询|responseStrategy|knowledge\s*base|according to (?:the )?(?:knowledge|retrieval)|as an AI/i;
const MISSING_INFORMATION_LANGUAGE = /(?:未|没)(?:有)?(?:找到|查到|检索到).{0,12}(?:信息|资料|内容|答案)|(?:知识库|检索结果).{0,12}(?:没有|无|未包含|找不到)|\b(?:no|could not|couldn't|cannot|can't|unable to)\s+(?:find|locate).{0,20}(?:information|answer|documentation)|\bno\s+(?:relevant\s+)?(?:information|answer|documentation)\s+(?:was\s+)?found\b/i;
const KNOWLEDGE_ID = /\b(?:(?:ERR|FUNC|API|ROUTING|BILL)-[A-Z0-9_]+-[A-Z0-9_.:#-]+|PRICING:[A-Z0-9_. :#-]+|TS_[A-Z0-9_.:#-]+_[A-Z0-9_.:#-]+)\b/i;

export function validateV2Generation(envelope: V2GeneratedEnvelope, trace: RetrievalTrace, prepared: PreparedTerminologyPipeline): V2ValidationResult {
  const errors: string[] = []; const allowedIds = new Set(trace.selectedKnowledge.map((item) => item.knowledgeId));
  if (trace.responseStrategy === "clarify_only" && (envelope.reply.match(/[?？]/g) ?? []).length > 1) errors.push("CLARIFY_MORE_THAN_ONE_QUESTION");
  if (INTERNAL_LANGUAGE.test(envelope.reply)) errors.push("INTERNAL_LANGUAGE_LEAKED");
  if (MISSING_INFORMATION_LANGUAGE.test(envelope.reply)) errors.push("MISSING_INFORMATION_LANGUAGE_LEAKED");
  if (prepared.targetLanguage !== "zh" && /\p{Script=Han}/u.test(envelope.reply)) errors.push("UNEXPECTED_HAN_SCRIPT");
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
