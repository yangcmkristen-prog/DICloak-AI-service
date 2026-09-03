import assert from "node:assert/strict";
import test from "node:test";
import { buildV2Messages, V2_SYSTEM_PROMPT } from "../prompt.ts";
import { parseV2Envelope, V2VisibleStreamFilter } from "./protocol.ts";
import { validateV2Generation } from "./validation.ts";
import type { RetrievalTrace } from "../retrieval/types.ts";
import type { PreparedTerminologyPipeline } from "../terminology/types.ts";

const trace = (overrides: Partial<RetrievalTrace> = {}): RetrievalTrace => ({
  question: "环境打不开", intent: { product: "dicloak", language: "zh", knowledgeTypes: [], apiType: null, apiVersion: null, method: null, object: null, action: null, missingConditions: [] }, filters: {}, fulltext: [], vector: [], fused: [], reranked: [], debugCandidates: [], rejectedCandidates: [],
  selectedKnowledge: [{ chunkId: "A#1", knowledgeId: "A", title: "网络", text: "检查网络 https://help.test/a", metadata: {}, protectedFields: [{ kind: "url", value: "https://help.test/a" }], termIds: [], sourceLanguage: "zh", knowledgeType: "troubleshooting", apiType: null, apiVersion: null, products: ["dicloak"], source: "fused", sourceRank: 1, textScore: 1, vectorScore: 1, rrfScore: 1, rerankScore: 1, matchedBy: [] }],
  knowledgeGroups: [{ key: "network", label: "网络", knowledgeIds: ["A"] }], branches: [], questionMode: "broad_troubleshooting", evidenceConfidence: "medium", responseStrategy: "answer_then_clarify", missingCriticalInformation: [], optionalFollowUpFields: ["错误提示"], decisionReasons: [], top: [], filteredReasons: [], confidence: "medium", confidenceReasons: [], degradedRoutes: [], timings: {}, ...overrides,
});
const prepared: PreparedTerminologyPipeline = { ok: true, targetLanguage: "zh", knowledge: [{ knowledgeId: "A", body: "检查网络 ⟦V2:a:technical:0:x⟧", naturalLanguageFields: {}, technicalFields: {}, markers: ["⟦V2:a:technical:0:x⟧"] }], branches: [], markers: [{ marker: "⟦V2:a:technical:0:x⟧", kind: "technical", value: "https://help.test/a", sourceValue: "https://help.test/a", knowledgeId: "A", occurrences: 1 }], warnings: [], errors: [], stats: { knowledgeCount: 1, referencedTermIds: 0, uniqueTermIds: 0, termMarkers: 0, technicalMarkers: 1, fallbackTranslations: 0 } };

test("V2 prompt is independent, compact, strategy-aware and contains no V1 prompt", () => {
  const messages = buildV2Messages({ question: "环境打不开", history: Array.from({ length: 8 }, (_, index) => ({ role: index % 2 ? "assistant" as const : "user" as const, content: String(index) })), product: "dicloak", language: "zh", trace: trace(), prepared });
  assert.equal(messages.length, 2); assert.match(messages[1].content, /answer_then_clarify/); assert.doesNotMatch(V2_SYSTEM_PROMPT, /V1|三条推荐回复/); assert.doesNotMatch(messages[1].content, /"content":"0"/);
});

test("protocol exposes one natural reply and claims remain internal", () => {
  const raw = '<<<V2_REPLY>>>请检查网络。<<<END_V2_REPLY>>><<<V2_CLAIMS>>>{"claims":[{"text":"检查网络","knowledgeIds":["A"]}]}<<<END_V2_CLAIMS>>>';
  assert.deepEqual(parseV2Envelope(raw), { reply: "请检查网络。", claims: [{ text: "检查网络", knowledgeIds: ["A"] }] });
});

test("true stream filter hides protocol, claims and partial internal markers", () => {
  const filter = new V2VisibleStreamFilter(new Map([["⟦V2:a:technical:0:x⟧", "https://help.test/a"]]));
  const chunks = ["<<<V2_RE", "PLY>>>\n请打开 ⟦", "V", "2:a:", "technical:0:x⟧。<<<END_V2_REPLY>>><<<V2_CLAIMS>>>{}"];
  const visible = chunks.map((chunk) => filter.push(chunk)).join("");
  assert.equal(visible, "请打开 https://help.test/a。"); assert.doesNotMatch(visible, /V2_|⟦/);
});

test("grounding accepts selected claims and restores protected URL", () => {
  const envelope = { reply: "请检查网络 ⟦V2:a:technical:0:x⟧，然后告诉我错误提示？", claims: [{ text: "检查网络", knowledgeIds: ["A"] }] };
  const result = validateV2Generation(envelope, trace(), prepared);
  assert.equal(result.ok, true); assert.match(result.reply ?? "", /https:\/\/help\.test\/a/);
});

test("grounding rejects unselected claims, invented links, IDs and excessive clarification", () => {
  const result = validateV2Generation({ reply: "根据知识库 FAQ-9 请访问 https://invented.test。为什么？版本？", claims: [{ text: "猜测", knowledgeIds: ["B"] }] }, trace({ responseStrategy: "clarify_only" }), prepared);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("CLAIM_USES_UNSELECTED_KNOWLEDGE")); assert.ok(result.errors.some((error) => error.startsWith("UNSELECTED_OR_MODIFIED_TECHNICAL_FIELD"))); assert.ok(result.errors.includes("INTERNAL_LANGUAGE_LEAKED"));
});

test("conditional and aggregated strategies require traceable coverage", () => {
  const conditional = trace({ responseStrategy: "conditional", branches: [{ label: "DICloak", knowledgeIds: ["A"] }, { label: "平台", knowledgeIds: ["B"] }], selectedKnowledge: [...trace().selectedKnowledge, { ...trace().selectedKnowledge[0], chunkId: "B#1", knowledgeId: "B" }] });
  const result = validateV2Generation({ reply: "如果是 DICloak，请检查网络。", claims: [{ text: "检查网络", knowledgeIds: ["A"] }] }, conditional, { ...prepared, markers: [] });
  assert.ok(result.errors.some((error) => error.startsWith("CONDITIONAL_BRANCH_MISSING")));
});
