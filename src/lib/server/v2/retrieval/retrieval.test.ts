import assert from "node:assert/strict";
import test from "node:test";
import { parseQuery } from "./query-parser.ts";
import { calculateConfidence, reciprocalRankFusion, rerankCandidates } from "./ranking.ts";
import { runParallelRecall, runTimedOperation } from "./service.ts";
import type { QueryIntent, RetrievalCandidate } from "./types.ts";

const candidate = (id: string, overrides: Partial<RetrievalCandidate> = {}): RetrievalCandidate => ({ chunkId: id, knowledgeId: id.split("#")[0], title: id, text: "create profile POST /v1/env", metadata: {}, knowledgeType: "faq", apiType: null, apiVersion: null, products: ["dicloak"], source: "vector", sourceRank: 1, textScore: 0, vectorScore: 0.6, rrfScore: 0, rerankScore: 0, matchedBy: ["vector"], ...overrides });
const intent = (overrides: Partial<QueryIntent> = {}): QueryIntent => ({ product: "dicloak", language: "en", knowledgeTypes: [], apiType: null, apiVersion: null, method: null, object: null, action: null, missingConditions: [], ...overrides });

test("deterministic parser extracts product, language and strict API fields", () => {
  assert.deepEqual(parseQuery("DICloak HTTP API v1 POST object:env action:create", "paraturbo"), { product: "dicloak", language: "en", knowledgeTypes: ["http_api"], apiType: "http", apiVersion: "v1", method: "POST", object: "env", action: "create", missingConditions: [] });
  assert.equal(parseQuery("Как создать профиль браузера?").language, "ru");
  assert.equal(parseQuery("Como criar um perfil de navegador?").language, "pt");
  assert.deepEqual(parseQuery("API 怎么创建环境？").missingConditions.sort(), ["apiType", "method"]);
});

test("RRF is centralized, deterministic and combines both recall routes", () => {
  const fused = reciprocalRankFusion([[candidate("A", { source: "fulltext" }), candidate("B", { source: "fulltext" })], [candidate("B"), candidate("C")]]);
  assert.equal(fused[0].chunkId, "B"); assert.deepEqual(fused[0].matchedBy.sort(), ["fulltext", "vector"].sort());
});

test("reranker handles only short fused candidates and rewards answer coverage", () => {
  const ranked = rerankCandidates("create profile", intent(), [candidate("weak", { text: "unrelated billing" }), candidate("answer", { text: "create profile steps", vectorScore: 0.65 })]);
  assert.equal(ranked[0].chunkId, "answer"); assert.ok(ranked[0].rerankScore > ranked[1].rerankScore);
});

test("confidence returns none for weak knowledge and low for conflicts", () => {
  assert.equal(calculateConfidence(intent(), [candidate("weak", { rerankScore: 0.19 })]).confidence, "none");
  const conflict = [candidate("http", { rerankScore: 0.7, apiType: "http" }), candidate("local", { rerankScore: 0.69, apiType: "local" })];
  assert.equal(calculateConfidence(intent({ apiType: "http" }), conflict).confidence, "low");
});

test("parallel recall starts together and degrades when one route fails", async () => {
  const started = Date.now(); const result = await runParallelRecall(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); return "text"; }, async () => { await new Promise((resolve) => setTimeout(resolve, 30)); throw new Error("vector failed"); });
  assert.ok(Date.now() - started < 55); assert.deepEqual(result.values, ["text"]); assert.equal(result.errors.length, 1);
});

test("timeout and caller cancellation abort the running operation", async () => {
  const timeout = await runTimedOperation("slow", (signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })), undefined, 10);
  assert.match(timeout.error ?? "", /slow 超时/);
  const controller = new AbortController(); const pending = runTimedOperation("cancel", (signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })), controller.signal, 1000); controller.abort();
  assert.match((await pending).error ?? "", /cancelled/);
});
