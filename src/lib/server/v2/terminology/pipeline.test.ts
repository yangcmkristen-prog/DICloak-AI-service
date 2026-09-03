import test from "node:test";
import assert from "node:assert/strict";
import { prepareTerminologyPipeline, restoreProtectedResponse } from "./pipeline.ts";
import type { TerminologyKnowledge, V2TermDefinition } from "./types.ts";

const terms: V2TermDefinition[] = [
  { termId: "team", translations: { en: "Team", zh: "团队", pt: "Equipe", ru: "Команда" } },
  { termId: "profile", translations: { en: "Profile", zh: "环境", pt: "Perfil" } },
  { termId: "member", translations: { en: "Member", zh: "成员" } },
  { termId: "fallback", translations: { en: "Workspace" } },
];
const knowledge = (overrides: Partial<TerminologyKnowledge> = {}): TerminologyKnowledge => ({
  id: "FAQ-1", type: "faq", sourceLanguage: "en", body: "Open {{Team}} and {{Profile}}.", termIds: ["team", "profile"], metadata: {}, protectedFields: [], ...overrides,
});

test("single and multiple FAQ terms resolve only through the current FAQ termIds", () => {
  const prepared = prepareTerminologyPipeline({ knowledge: [knowledge()], terms, targetLanguage: "pt" });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.stats.termMarkers, 2);
  const restored = restoreProtectedResponse(prepared.knowledge[0].body, prepared);
  assert.deepEqual(restored, { ok: true, text: "Open Equipe and Perfil.", errors: [] });
});

test("FAQ cannot borrow a placeholder term from another knowledge item", () => {
  const prepared = prepareTerminologyPipeline({ knowledge: [knowledge({ id: "FAQ-A", body: "Open {{Member}}.", termIds: ["team"] }), knowledge({ id: "FAQ-B", body: "Use {{Member}}.", termIds: ["member"] })], terms, targetLanguage: "zh" });
  assert.equal(prepared.ok, false);
  assert.ok(prepared.errors.some((item) => item.code === "FAQ_PLACEHOLDER_UNLINKED" && item.knowledgeId === "FAQ-A"));
});

test("missing translation falls back to English with a warning and never asks AI", () => {
  const prepared = prepareTerminologyPipeline({ knowledge: [knowledge({ body: "Open {{Workspace}}.", termIds: ["fallback"] })], terms, targetLanguage: "vi" });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.warnings[0].code, "TERM_TRANSLATION_FALLBACK_EN");
  assert.equal(restoreProtectedResponse(prepared.knowledge[0].body, prepared).text, "Open Workspace.");
});

test("non-UI relationship terms never enter customer-facing function text", () => {
  const hiddenTerms: V2TermDefinition[] = [...terms, { termId: "internal", translations: { zh: "内部关联" }, isUiVisible: false }];
  const prepared = prepareTerminologyPipeline({ knowledge: [knowledge({ id: "FUNC-H", type: "function", sourceLanguage: "zh", body: "", termIds: ["internal"], metadata: { description: "内部关联知识" } })], terms: hiddenTerms, targetLanguage: "pt" });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.stats.termMarkers, 0);
  assert.equal(prepared.knowledge[0].naturalLanguageFields.description, "内部关联知识");
});

test("invalid IDs and conflicting translations block formal generation", () => {
  const invalid = prepareTerminologyPipeline({ knowledge: [knowledge({ termIds: ["missing"] })], terms, targetLanguage: "en" });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((item) => item.code === "TERM_ID_UNKNOWN"));
  const conflict = prepareTerminologyPipeline({ knowledge: [knowledge()], terms: [...terms, { termId: "team", translations: { pt: "Time" } }], targetLanguage: "pt" });
  assert.ok(conflict.errors.some((item) => item.code === "TERM_TRANSLATION_CONFLICT"));
});

test("five aggregated knowledge items deduplicate shared term IDs and are order independent", () => {
  const five = Array.from({ length: 5 }, (_, index) => knowledge({ id: `FAQ-${index}`, body: "Open {{Team}}.", termIds: index % 2 ? ["team", "team"] : ["team"] }));
  const first = prepareTerminologyPipeline({ knowledge: five, terms, targetLanguage: "pt" });
  const reversed = prepareTerminologyPipeline({ knowledge: [...five].reverse(), terms: [...terms].reverse(), targetLanguage: "pt" });
  assert.equal(first.stats.uniqueTermIds, 1);
  assert.deepEqual(first.knowledge.map((item) => item.body), reversed.knowledge.map((item) => item.body));
  assert.ok(first.knowledge.every((item) => restoreProtectedResponse(item.body, { ...first, markers: first.markers.filter((marker) => marker.knowledgeId === item.knowledgeId) }).text === "Open Equipe."));
});

test("conditional branches retain only their own knowledge term scopes", () => {
  const prepared = prepareTerminologyPipeline({
    knowledge: [knowledge({ id: "LOGIN-DIC", body: "Ask the {{Member}}.", termIds: ["member"] }), knowledge({ id: "LOGIN-PLATFORM", body: "Open {{Profile}}.", termIds: ["profile"] })], terms, targetLanguage: "zh",
    branches: [{ label: "DICloak", knowledgeIds: ["LOGIN-DIC"] }, { label: "第三方平台", knowledgeIds: ["LOGIN-PLATFORM"] }],
  });
  assert.deepEqual(prepared.branches, [{ label: "DICloak", knowledgeIds: ["LOGIN-DIC"] }, { label: "第三方平台", knowledgeIds: ["LOGIN-PLATFORM"] }]);
  assert.deepEqual(prepared.markers.filter((item) => item.knowledgeId === "LOGIN-DIC").map((item) => item.termId), ["member"]);
});

test("function processing touches natural language fields but never translates entryPath", () => {
  const prepared = prepareTerminologyPipeline({ knowledge: [knowledge({ id: "FUNC-1", type: "function", sourceLanguage: "zh", body: "", termIds: ["profile"], metadata: { functionName: "打开环境", description: "选择环境", steps: "点击环境 https://help.example/v1", entryPath: "环境/Profile" }, protectedFields: [{ kind: "url", value: "https://help.example/v1" }] })], terms, targetLanguage: "pt" });
  assert.match(prepared.knowledge[0].naturalLanguageFields.functionName, /⟦V2:/);
  assert.match(prepared.knowledge[0].technicalFields.entryPath, /⟦V2:/);
  assert.match(prepared.knowledge[0].naturalLanguageFields.steps, /⟦V2:/);
  assert.equal(restoreProtectedResponse(prepared.knowledge[0].technicalFields.entryPath, { ...prepared, markers: prepared.markers.filter((marker) => marker.sourceValue === "环境/Profile") }).text, "环境/Profile");
});

test("URL, API path, method, parameter, JSON, code, version, numbers, price and product remain byte-identical", () => {
  const values = ["https://api.example.com/v1", "PATCH", "/openapi/v1/env/{env_id}/open", "env_id", "{\"env_id\":123}", "npm run dev", "v1.2.3", "123", "$19.99", "DICloak"];
  const item = knowledge({ id: "API-1", type: "http_api", body: `PATCH /openapi/v1/env/{env_id}/open | ${values.join(" | ")}`, termIds: [], protectedFields: values.map((value, index) => ({ kind: `technical_${index}`, value })) });
  for (const language of ["zh", "en", "ru", "pt", "es", "vi"] as const) {
    const prepared = prepareTerminologyPipeline({ knowledge: [item], terms, targetLanguage: language });
    const restored = restoreProtectedResponse(prepared.knowledge[0].body, prepared);
    assert.equal(restored.ok, true);
    assert.equal(restored.text, item.body);
    assert.ok(restored.text?.includes("PATCH /openapi/v1/env/{env_id}/open"));
  }
});

test("API path identical to term text is protected and never translated", () => {
  const item = knowledge({ id: "API-P", type: "http_api", body: "/Team Team {{Team}}", termIds: ["team"], protectedFields: [{ kind: "endpoint", value: "/Team" }] });
  const prepared = prepareTerminologyPipeline({ knowledge: [item], terms, targetLanguage: "pt" });
  assert.equal(restoreProtectedResponse(prepared.knowledge[0].body, prepared).text, "/Team Team Equipe");
});

test("missing, modified, duplicated and unknown markers return structured errors without repair", () => {
  const prepared = prepareTerminologyPipeline({ knowledge: [knowledge()], terms, targetLanguage: "pt" });
  const marker = prepared.markers[0].marker;
  assert.equal(restoreProtectedResponse(prepared.knowledge[0].body.replace(marker, ""), prepared).errors[0].code, "MARKER_MISSING_OR_MODIFIED");
  assert.ok(restoreProtectedResponse(`${prepared.knowledge[0].body}${marker}`, prepared).errors.some((item) => item.code === "MARKER_DUPLICATED"));
  assert.ok(restoreProtectedResponse(`${prepared.knowledge[0].body}⟦V2:bad:term:0:bad⟧`, prepared).errors.some((item) => item.code === "MARKER_UNKNOWN"));
});
