import assert from "node:assert/strict";
import test from "node:test";
import { buildV2Messages, confirmationRequiredReply, selectNecessaryHistory, unsupportedFeatureReply, V2_SYSTEM_PROMPT } from "../prompt.ts";
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
  assert.equal(JSON.parse(messages[1].content).targetLanguageName, "Chinese (中文)");
});

test("role-specific answer variants are passed explicitly for conditional generation", () => {
  const roleTrace = trace({ selectedKnowledge: [{ ...trace().selectedKnowledge[0], metadata: { answerVariants: { client: "管理员步骤", end_user: "成员步骤" } } }] });
  const payload = JSON.parse(buildV2Messages({ question: "代理失败", history: [], product: "dicloak", language: "zh", trace: roleTrace, prepared })[1].content);
  assert.deepEqual(payload.selectedKnowledge[0].roleVariants, ["client", "end_user"]);
});

test("function input uses the standard organized answer without a fixed template", () => {
  const functionTrace = trace({ selectedKnowledge: [{ ...trace().selectedKnowledge[0], knowledgeType: "function", metadata: { module: "全局设置", page: "全局设置", functionName: "开发者工具", entryPath: "浏览器设置", steps: "启用并保存", standardAnswer: "在全局设置中启用开发者工具并保存。" } }] });
  const functionPrepared = { ...prepared, knowledge: [{ ...prepared.knowledge[0], naturalLanguageFields: { module: "全局设置", page: "全局设置", functionName: "开发者工具", entryPath: "浏览器设置", steps: "启用并保存", standardAnswer: "在全局设置中启用开发者工具并保存。" } }] };
  const payload = JSON.parse(buildV2Messages({ question: "如何设置", history: [], product: "dicloak", language: "zh", trace: functionTrace, prepared: functionPrepared })[1].content);
  assert.deepEqual(payload.selectedKnowledge[0].requiredFacts, { standardAnswer: "在全局设置中启用开发者工具并保存。" });
  assert.equal(payload.functionResponseTemplate, undefined);
});

test("function synthesis treats standard answers as supporting rather than mandatory facts", () => {
  const functionTrace = trace({ responseStrategy: "feature_overview", selectedKnowledge: [{ ...trace().selectedKnowledge[0], knowledgeType: "function", metadata: { standardAnswer: "进入页面并查看奖励。" } }] });
  const functionPrepared = { ...prepared, knowledge: [{ ...prepared.knowledge[0], naturalLanguageFields: { standardAnswer: "进入页面并查看奖励。" } }] };
  const payload = JSON.parse(buildV2Messages({ question: "你们有推广奖励活动吗", history: [], product: "dicloak", language: "zh", trace: functionTrace, prepared: functionPrepared })[1].content);
  assert.equal(payload.selectedKnowledge[0].requiredFacts, undefined);
  assert.deepEqual(payload.selectedKnowledge[0].supportingFacts, { standardAnswer: "进入页面并查看奖励。" });
});

test("self-contained topic switches discard history while dependent follow-ups keep it", () => {
  const history = [{ role: "user" as const, content: "怎么修改代理" }, { role: "assistant" as const, content: "进入代理设置" }];
  assert.deepEqual(selectNecessaryHistory("我可以更改 DICloak 界面皮肤吗", history), []);
  assert.deepEqual(selectNecessaryHistory("那要怎么操作", history), history);
  const payload = JSON.parse(buildV2Messages({ question: "我可以更改 DICloak 界面皮肤吗", history, product: "dicloak", language: "zh", trace: trace(), prepared })[1].content);
  assert.deepEqual(payload.necessaryHistory, []);
});

test("unsupported function requests prohibit adjacent feature suggestions", () => {
  const unsupported = trace({
    responseStrategy: "unsupported",
    selectedKnowledge: [],
    intent: { product: "dicloak", language: "zh", knowledgeTypes: ["function"], apiType: null, apiVersion: null, method: null, object: null, action: null, missingConditions: [] },
  });
  const messages = buildV2Messages({ question: "可以隐藏 URL 栏吗", history: [], product: "dicloak", language: "zh", trace: unsupported, prepared: { ...prepared, knowledge: [], markers: [], stats: { ...prepared.stats, knowledgeCount: 0, technicalMarkers: 0 } } });
  const payload = JSON.parse(messages[1].content) as { unsupportedFeatureInstruction?: string };
  assert.match(payload.unsupportedFeatureInstruction ?? "", /currently unsupported/);
  assert.match(payload.unsupportedFeatureInstruction ?? "", /Do not mention, recommend, or explain any other feature/);
});

test("unsupported feature replies are stable and localized", () => {
  assert.match(unsupportedFeatureReply("zh"), /目前我们不支持这个功能/);
  assert.match(unsupportedFeatureReply("zh"), /反馈给产品同事/);
  assert.doesNotMatch(unsupportedFeatureReply("zh"), /批量打开|网站源码|本地网络访问/);
  assert.match(unsupportedFeatureReply("unknown"), /do not currently support this feature/);
});

test("confirmation replies are stable and never expose retrieval internals", () => {
  assert.match(confirmationRequiredReply("zh"), /需要进一步确认/);
  assert.doesNotMatch(confirmationRequiredReply("zh"), /知识库|检索|未找到|不支持/);
  assert.match(confirmationRequiredReply("pt"), /confirmar/i);
});

test("partial support prompt distinguishes the requested and supported limit directions", () => {
  const partialKnowledge = { ...trace().selectedKnowledge[0], knowledgeType: "function", metadata: { functionName: "同时打开环境数限制", description: "限制每个成员可同时打开的环境数量", entryPath: "环境设置", steps: "开启并保存", standardAnswer: "在环境设置中，可限制每个成员同时打开的环境数量，开启后保存。" } };
  const partial = trace({ responseStrategy: "partial_support", selectedKnowledge: [partialKnowledge] });
  const partialPrepared = { ...prepared, knowledge: [{ ...prepared.knowledge[0], naturalLanguageFields: { functionName: "同时打开环境数限制", description: "限制每个成员可同时打开的环境数量", entryPath: "环境设置", steps: "开启并保存", standardAnswer: "在环境设置中，可限制每个成员同时打开的环境数量，开启后保存。" }, body: "完整功能知识" }] };
  const payload = JSON.parse(buildV2Messages({ question: "限制一个环境的成员数", history: [], product: "dicloak", language: "zh", trace: partial, prepared: partialPrepared })[1].content) as { strategyInstruction: string; selectedKnowledge: Array<{ content: string; requiredFacts?: unknown }> };
  assert.match(payload.strategyInstruction, /direction of the limitation/);
  assert.match(payload.strategyInstruction, /supplied standard answer/);
  assert.equal(payload.selectedKnowledge[0]?.content, "完整功能知识");
  assert.deepEqual(payload.selectedKnowledge[0]?.requiredFacts, { standardAnswer: "在环境设置中，可限制每个成员同时打开的环境数量，开启后保存。" });
});

test("pricing entries are grouped by feature across plans", () => {
  const pricingKnowledge = ["base", "plus", "share-plus"].map((plan) => ({ ...trace().selectedKnowledge[0], chunkId: `PRICING:Open API:${plan}#1`, knowledgeId: `PRICING:Open API:${plan}`, knowledgeType: "pricing", metadata: { feature: "Open API", planName: plan } }));
  const pricingPrepared = { ...prepared, knowledge: pricingKnowledge.map((item) => ({ knowledgeId: item.knowledgeId, body: item.knowledgeId, naturalLanguageFields: {}, technicalFields: {}, markers: [] })) };
  const messages = buildV2Messages({ question: "Which plan supports API?", history: [], product: "dicloak", language: "en", trace: trace({ selectedKnowledge: pricingKnowledge }), prepared: pricingPrepared });
  const payload = JSON.parse(messages[1].content);
  assert.equal(payload.selectedKnowledge.length, 0);
  assert.equal(payload.pricingBundles[0].plans.length, 3);
});

test("protocol exposes one natural reply and claims remain internal", () => {
  const raw = '{"reply":"请检查网络。","claims":[{"text":"检查网络","knowledgeIds":["A"]}]}' ;
  assert.deepEqual(parseV2Envelope(raw), { reply: "请检查网络。", claims: [{ text: "检查网络", knowledgeIds: ["A"] }] });
});

test("protocol tolerates a fenced JSON object but rejects malformed JSON", () => {
  const raw = '```json\n{"reply":"完成。","claims":[{"text":"完成","knowledgeIds":["A"]}]}\n```';
  assert.deepEqual(parseV2Envelope(raw), { reply: "完成。", claims: [{ text: "完成", knowledgeIds: ["A"] }] });
  assert.throws(() => parseV2Envelope('{"reply":"未完成"'), /V2_OUTPUT_PROTOCOL_INVALID/);
});

test("JSON stream filter exposes only reply and decodes split escapes", () => {
  const filter = new V2VisibleStreamFilter(new Map([["⟦V2:a:technical:0:x⟧", "https://help.test/a"]]));
  const chunks = ['{"re', 'ply":"请打开 ⟦V2:a:technical:0:x⟧。\\', 'n已完成","claims":[{"text":"内部', '","knowledgeIds":["A"]}]}'];
  const visible = chunks.map((chunk) => filter.push(chunk)).join("");
  assert.equal(visible, "请打开 https://help.test/a。\n已完成"); assert.doesNotMatch(visible, /内部|knowledgeIds|⟦/);
});

test("grounding accepts selected claims and restores protected URL", () => {
  const envelope = { reply: "请检查网络 ⟦V2:a:technical:0:x⟧，然后告诉我错误提示？", claims: [{ text: "检查网络", knowledgeIds: ["A"] }] };
  const result = validateV2Generation(envelope, trace(), prepared);
  assert.equal(result.ok, true); assert.match(result.reply ?? "", /https:\/\/help\.test\/a/);
});

test("generation safely permits repeated known markers but still rejects unknown markers", () => {
  const marker = prepared.markers[0].marker;
  const repeated = validateV2Generation({ reply: `${marker} ${marker}`, claims: [{ text: "重复链接", knowledgeIds: ["A"] }] }, trace({ responseStrategy: "direct" }), prepared);
  assert.equal(repeated.ok, true);
  const unknown = validateV2Generation({ reply: "⟦V2:unknown:technical:0:x⟧", claims: [{ text: "未知", knowledgeIds: ["A"] }] }, trace({ responseStrategy: "direct" }), prepared);
  assert.equal(unknown.ok, false);
  assert.ok(unknown.errors.includes("MARKER_UNKNOWN"));
});

test("grounding rejects unselected claims, invented links, IDs and excessive clarification", () => {
  const result = validateV2Generation({ reply: "根据知识库 FAQ-9 请访问 https://invented.test。为什么？版本？", claims: [{ text: "猜测", knowledgeIds: ["B"] }] }, trace({ responseStrategy: "clarify_only" }), prepared);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("CLAIM_USES_UNSELECTED_KNOWLEDGE")); assert.ok(result.errors.some((error) => error.startsWith("UNSELECTED_OR_MODIFIED_TECHNICAL_FIELD"))); assert.ok(result.errors.includes("INTERNAL_LANGUAGE_LEAKED"));
});

test("grounding rejects customer-facing claims that information was not found", () => {
  const chinese = validateV2Generation({ reply: "目前没有找到相关信息。", claims: [] }, trace({ responseStrategy: "clarify_only" }), prepared);
  assert.ok(chinese.errors.includes("MISSING_INFORMATION_LANGUAGE_LEAKED"));
  const english = validateV2Generation({ reply: "No relevant information was found.", claims: [] }, trace({ responseStrategy: "clarify_only", intent: { ...trace().intent, language: "en" } }), { ...prepared, targetLanguage: "en" });
  assert.ok(english.errors.includes("MISSING_INFORMATION_LANGUAGE_LEAKED"));
});

test("grounding rejects Chinese prose in a non-Chinese reply", () => {
  const result = validateV2Generation({ reply: "Acesse 下滑至环境设置。", claims: [{ text: "Passo", knowledgeIds: ["A"] }] }, trace({ intent: { ...trace().intent, language: "pt" } }), { ...prepared, targetLanguage: "pt" });
  assert.ok(result.errors.includes("UNEXPECTED_HAN_SCRIPT"));
});

test("conditional and aggregated strategies require traceable coverage", () => {
  const conditional = trace({ responseStrategy: "conditional", branches: [{ label: "DICloak", knowledgeIds: ["A"] }, { label: "平台", knowledgeIds: ["B"] }], selectedKnowledge: [...trace().selectedKnowledge, { ...trace().selectedKnowledge[0], chunkId: "B#1", knowledgeId: "B" }] });
  const result = validateV2Generation({ reply: "如果是 DICloak，请检查网络。", claims: [{ text: "检查网络", knowledgeIds: ["A"] }] }, conditional, { ...prepared, markers: [] });
  assert.ok(result.errors.some((error) => error.startsWith("CONDITIONAL_BRANCH_MISSING")));
});
