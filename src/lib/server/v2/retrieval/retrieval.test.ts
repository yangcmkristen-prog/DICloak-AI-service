import assert from "node:assert/strict";
import test from "node:test";
import { extractSearchTerms, parseQuery } from "./query-parser.ts";
import { calculateConfidence, reciprocalRankFusion, rerankCandidates } from "./ranking.ts";
import { dedupeKnowledgeCandidates, runParallelRecall, runTimedOperation } from "./service.ts";
import type { QueryIntent, RetrievalCandidate } from "./types.ts";

const candidate = (id: string, overrides: Partial<RetrievalCandidate> = {}): RetrievalCandidate => ({ chunkId: id, knowledgeId: id.split("#")[0], title: id, text: "create profile POST /v1/env", metadata: {}, knowledgeType: "faq", apiType: null, apiVersion: null, products: ["dicloak"], source: "vector", sourceRank: 1, textScore: 0, vectorScore: 0.6, rrfScore: 0, rerankScore: 0, matchedBy: ["vector"], ...overrides });
const intent = (overrides: Partial<QueryIntent> = {}): QueryIntent => ({ product: "dicloak", language: "en", knowledgeTypes: [], apiType: null, apiVersion: null, method: null, object: null, action: null, missingConditions: [], ...overrides });

test("deterministic parser extracts product, language and strict API fields", () => {
  assert.deepEqual(parseQuery("DICloak HTTP API v1 POST object:env action:create", "paraturbo"), { product: "dicloak", language: "en", knowledgeTypes: ["http_api"], apiType: "http", apiVersion: "v1", method: "POST", object: "env", action: "create", missingConditions: [] });
  assert.equal(parseQuery("Как создать профиль браузера?").language, "ru");
  assert.equal(parseQuery("Como criar um perfil de navegador?").language, "pt");
  assert.deepEqual(parseQuery("API 怎么创建环境？").missingConditions.sort(), ["apiType", "method"]);
});

test("deterministic parser separates troubleshooting and pricing intents", () => {
  assert.deepEqual(parseQuery("打开环境显示代理检测失败怎么办").knowledgeTypes, ["troubleshooting", "troubleshooting_flow", "user_routing"]);
  assert.deepEqual(parseQuery("Does the current plan support API? Do I need to upgrade my plan?", "paraturbo").knowledgeTypes, ["pricing"]);
  assert.deepEqual(parseQuery("Does the current plan support API? Do I need to upgrade my plan?", "paraturbo").missingConditions, []);
  assert.deepEqual(parseQuery("我要怎么进行 DICloak 的长期续费").knowledgeTypes, ["faq", "function"]);
  assert.deepEqual(parseQuery("如何用 API 创建环境").knowledgeTypes, ["http_api", "local_api"]);
  assert.deepEqual(parseQuery("我想分享 Claude 订阅").knowledgeTypes, ["faq"]);
});

test("deterministic parser recognizes broad tool failures and insufficient balance", () => {
  assert.ok(parseQuery("Can't use ChatGPT").knowledgeTypes.includes("troubleshooting"));
  assert.ok(parseQuery("Gamma 显示余额不足").knowledgeTypes.includes("user_routing"));
});

test("deterministic parser recognizes out-of-scope, audit and sharing intents", () => {
  assert.deepEqual(parseQuery("我想用 AI Sora 生成视频").knowledgeTypes, ["out_of_scope"]);
  assert.deepEqual(parseQuery("visualização grátis", "paraturbo").knowledgeTypes, ["out_of_scope"]);
  assert.deepEqual(parseQuery("我的环境配置被改了，可以在哪里查是谁改的").knowledgeTypes, ["function"]);
  assert.deepEqual(parseQuery("十人团队如何分享 Claude 订阅").knowledgeTypes, ["faq"]);
  assert.deepEqual(parseQuery("My facebook account disabled.").missingConditions, []);
  assert.deepEqual(parseQuery("不让我打开环境").missingConditions, ["symptomDetails"]);
  assert.ok(extractSearchTerms("请先下载内核，Chrome 文件夹内容为空").includes("内核"));
  assert.ok(extractSearchTerms("团队如何分享 Claude 订阅").includes("subscription"));
  assert.ok(extractSearchTerms("团队如何分享 Claude 订阅").includes("multiple sessions"));
  assert.ok(extractSearchTerms("系统显示账号不存在").includes("account does not exist"));
});

test("RRF is centralized, deterministic and combines both recall routes", () => {
  const fused = reciprocalRankFusion([[candidate("A", { source: "fulltext" }), candidate("B", { source: "fulltext" })], [candidate("B"), candidate("C")]]);
  assert.equal(fused[0].chunkId, "B"); assert.deepEqual(fused[0].matchedBy.sort(), ["fulltext", "vector"].sort());
});

test("RRF fuses multiple semantic chunks as one knowledge candidate", () => {
  const fused = reciprocalRankFusion([[candidate("A#overview"), candidate("A#steps"), candidate("B#entry")]]);
  assert.deepEqual(fused.map((item) => item.knowledgeId), ["A", "B"]);
});

test("reranker handles only short fused candidates and rewards answer coverage", () => {
  const ranked = rerankCandidates("create profile", intent(), [candidate("weak", { text: "unrelated billing" }), candidate("answer", { text: "create profile steps", vectorScore: 0.65 })]);
  assert.equal(ranked[0].chunkId, "answer"); assert.ok(ranked[0].rerankScore > ranked[1].rerankScore);
});

test("reranker uses the declared out-of-scope subtype instead of generic semantic proximity", () => {
  const rows = [
    candidate("create-account", { knowledgeType: "out_of_scope", metadata: { subType: "account_service" } }),
    candidate("unsupported", { knowledgeType: "out_of_scope", metadata: { subType: "unsupported" } }),
  ];
  assert.equal(rerankCandidates("I want to make money from a website", intent({ knowledgeTypes: ["out_of_scope"] }), rows)[0].chunkId, "unsupported");
});

test("reranker prefers team account-sharing guidance over cross-team profile sharing", () => {
  const rows = [
    candidate("profile-share", { metadata: { category: "环境管理", subcategory: "账号共享" } }),
    candidate("team-share", { metadata: { category: "团队管理", subcategory: "账号共享与安全" } }),
  ];
  assert.equal(rerankCandidates("十人团队如何分享 Claude 订阅", intent({ knowledgeTypes: ["faq"] }), rows)[0].chunkId, "team-share");
});

test("pricing results are diversified by feature instead of repeated by plan", () => {
  const rows = [candidate("base", { knowledgeId: "PRICING:included members:base", knowledgeType: "pricing" }), candidate("plus", { knowledgeId: "PRICING:included members:plus", knowledgeType: "pricing" }), candidate("price", { knowledgeId: "PRICING:base plan price:plus", knowledgeType: "pricing" })];
  assert.deepEqual(dedupeKnowledgeCandidates(rows).map((row) => row.knowledgeId), ["PRICING:included members:base", "PRICING:base plan price:plus"]);
});

test("confidence returns none for weak knowledge and low for conflicts", () => {
  assert.equal(calculateConfidence(intent(), [candidate("weak", { rerankScore: 0.19, vectorScore: 0.05, textScore: 0.05 })]).confidence, "none");
  const conflict = [candidate("http", { rerankScore: 0.7, apiType: "http" }), candidate("local", { rerankScore: 0.69, apiType: "local" })];
  assert.equal(calculateConfidence(intent({ apiType: "http" }), conflict).confidence, "low");
});

test("confidence accepts a consistent generic API family and typo-tolerant multilingual function", () => {
  const genericApi = intent({ knowledgeTypes: ["http_api", "local_api"], missingConditions: ["apiType", "method"] });
  assert.equal(calculateConfidence(genericApi, [candidate("local-one", { rerankScore: 0.26, apiType: "local" }), candidate("local-two", { rerankScore: 0.22, apiType: "local" })]).confidence, "low");
  const portuguese = intent({ language: "pt" });
  assert.equal(calculateConfidence(portuguese, [candidate("create", { knowledgeType: "function", rerankScore: 0.13, vectorScore: 0.2 }), candidate("other", { knowledgeType: "function", rerankScore: 0.1, vectorScore: 0.19 }), candidate("third", { knowledgeType: "function", rerankScore: 0.09 })]).confidence, "medium");
});

test("confidence accepts a deterministic multilingual out-of-scope route", () => {
  const oos = intent({ language: "pt", knowledgeTypes: ["out_of_scope"] });
  assert.equal(calculateConfidence(oos, [candidate("OOS-001", { knowledgeType: "out_of_scope", rerankScore: 0.16, vectorScore: 0.3 })]).confidence, "medium");
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
