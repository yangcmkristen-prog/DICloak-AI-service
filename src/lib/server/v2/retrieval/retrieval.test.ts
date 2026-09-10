import assert from "node:assert/strict";
import test from "node:test";
import { extractSearchTerms, parseQuery } from "./query-parser.ts";
import { calculateConfidence, reciprocalRankFusion, rerankCandidates } from "./ranking.ts";
import { buildRetrievalFilters, dedupeKnowledgeCandidates, runParallelRecall, runTimedOperation } from "./service.ts";
import type { QueryIntent, RetrievalCandidate } from "./types.ts";

const candidate = (id: string, overrides: Partial<RetrievalCandidate> = {}): RetrievalCandidate => ({ chunkId: id, knowledgeId: id.split("#")[0], title: id, text: "create profile POST /v1/env", metadata: {}, knowledgeType: "faq", apiType: null, apiVersion: null, products: ["dicloak"], source: "vector", sourceRank: 1, textScore: 0, vectorScore: 0.6, rrfScore: 0, rerankScore: 0, matchedBy: ["vector"], ...overrides });
const intent = (overrides: Partial<QueryIntent> = {}): QueryIntent => ({ product: "dicloak", language: "en", knowledgeTypes: [], apiType: null, apiVersion: null, method: null, object: null, action: null, missingConditions: [], ...overrides });

test("general FAQ participates as fallback without weakening API isolation", () => {
  assert.deepEqual(buildRetrievalFilters(intent({ knowledgeTypes: ["function"] })).params[1], ["function", "general_faq"]);
  assert.deepEqual(buildRetrievalFilters(intent({ knowledgeTypes: ["http_api", "local_api"] })).params[1], ["http_api", "local_api"]);
});

test("deterministic parser extracts product, language and strict API fields", () => {
  assert.deepEqual(parseQuery("DICloak HTTP API v1 POST object:env action:create", "paraturbo"), { product: "dicloak", language: "en", knowledgeTypes: ["http_api"], apiType: "http", apiVersion: "v1", method: "POST", object: "env", action: "create", missingConditions: [] });
  assert.equal(parseQuery("Как создать профиль браузера?").language, "ru");
  assert.equal(parseQuery("Como criar um perfil de navegador?").language, "pt");
  assert.equal(parseQuery("visualização grátis").language, "pt");
  assert.ok(extractSearchTerms("visualização grátis").includes("free views"));
  assert.deepEqual(parseQuery("como cria o novegador").knowledgeTypes, ["function"]);
  assert.ok(extractSearchTerms("como cria o novegador").includes("create browser profile"));
  assert.deepEqual(parseQuery("API 怎么创建环境？").missingConditions.sort(), ["apiType", "method"]);
});

test("deterministic parser separates troubleshooting and pricing intents", () => {
  assert.deepEqual(parseQuery("打开环境显示代理检测失败怎么办").knowledgeTypes, ["troubleshooting", "troubleshooting_flow", "user_routing"]);
  assert.deepEqual(parseQuery("Does the current plan support API? Do I need to upgrade my plan?", "paraturbo").knowledgeTypes, ["pricing"]);
  assert.deepEqual(parseQuery("Does the current plan support API? Do I need to upgrade my plan?", "paraturbo").missingConditions, []);
  assert.deepEqual(parseQuery("我要怎么进行 DICloak 的长期续费").knowledgeTypes, ["faq", "function"]);
  assert.deepEqual(parseQuery("如何用 API 创建环境").knowledgeTypes, ["http_api", "local_api"]);
  assert.deepEqual(parseQuery("我想分享 Claude 订阅").knowledgeTypes, ["faq"]);
  assert.deepEqual(parseQuery("怎么换环境已配置的代理ip").knowledgeTypes, ["function"]);
  assert.deepEqual(parseQuery("我可以更改 DICloak 界面皮肤吗").knowledgeTypes, ["function"]);
  assert.deepEqual(parseQuery("你们有推广奖励活动吗").knowledgeTypes, ["function"]);
  assert.deepEqual(parseQuery("推广返现是什么").knowledgeTypes, ["function"]);
  assert.deepEqual(parseQuery("推广返现怎么用").knowledgeTypes, ["function"]);
  assert.deepEqual(parseQuery("代理设置和指纹设置有什么区别").knowledgeTypes, ["function"]);
});

test("Portuguese capability wording is generally classified without a feature-specific alias", () => {
  const question = "Seria interessante que a gente adm pudesse determinar quantos membros podem acessar um perfil";
  assert.deepEqual(parseQuery(question).knowledgeTypes, ["function"]);
  assert.ok(!extractSearchTerms(question).includes("concurrent profile open limit"));
  assert.ok(extractSearchTerms(question).includes("limit"));
  assert.ok(extractSearchTerms(question).includes("profile"));
  assert.ok(extractSearchTerms(question).includes("member"));
  assert.deepEqual(parseQuery("Tem como limitar a quantidade de dispositivos por membro?").knowledgeTypes, ["function"]);
  assert.deepEqual(parseQuery("Gostaria de configurar o acesso dos membros por horário").knowledgeTypes, ["function"]);
  assert.deepEqual(parseQuery("¿Se puede limitar cuántos miembros acceden a un perfil?").knowledgeTypes, ["function"]);
  assert.deepEqual(parseQuery("Можно ли ограничить количество профилей для участника?").knowledgeTypes, ["function"]);
  assert.deepEqual(parseQuery("Có thể giới hạn số lượng hồ sơ cho thành viên không?").knowledgeTypes, ["function"]);
});

test("multilingual concept normalization favors matching constraints over adjacent entities", () => {
  const question = "Seria interessante que a gente adm pudesse determinar quantos membros podem acessar um perfil";
  const ranked = rerankCandidates(question, parseQuery(question), [
    candidate("ADJACENT", { knowledgeType: "function", title: "Group members", text: "View members included in a profile group", vectorScore: 0.35, rrfScore: 0.02 }),
    candidate("MATCHING", { knowledgeType: "function", title: "Profile limit", text: "Limit the number of profiles each member can open", vectorScore: 0.35, rrfScore: 0.02 }),
  ]);
  assert.equal(ranked[0]?.knowledgeId, "MATCHING");
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

test("reranker distinguishes operations on the same object", () => {
  const ranked = rerankCandidates("如何修改环境的代理 IP", intent({ knowledgeTypes: ["function"], language: "zh" }), [
    candidate("DETECT-PROXY", { knowledgeType: "function", title: "检测代理", text: "进入编辑环境，在代理设置中检测当前代理 IP 的连通性，然后保存", metadata: { functionName: "检测代理", description: "检测当前配置的代理 IP 是否可用" }, vectorScore: 0.72, textScore: 0.7, rrfScore: 0.03 }),
    candidate("CONFIGURE-PROXY", { knowledgeType: "function", title: "配置代理", text: "在环境管理中编辑环境，修改代理类型、主机和端口后保存", metadata: { functionName: "配置代理", description: "修改环境使用的代理 IP" }, vectorScore: 0.62, textScore: 0.6, rrfScore: 0.025 }),
  ]);
  assert.equal(ranked[0]?.knowledgeId, "CONFIGURE-PROXY");
});

test("reranker treats replacement as configuration and viewing configuration as view", () => {
  const ranked = rerankCandidates("怎么换环境已配置的代理ip", intent({ knowledgeTypes: ["function"], language: "zh" }), [
    candidate("VIEW-PROXY", { knowledgeType: "function", title: "查看代理配置", text: "鼠标移到代理图标上查看当前代理 IP", metadata: { functionName: "查看代理配置", description: "查看环境已经配置的代理" }, vectorScore: 0.72, textScore: 0.7, rrfScore: 0.03 }),
    candidate("CONFIGURE-PROXY", { knowledgeType: "function", title: "配置代理", text: "编辑环境并更换代理主机、端口后保存", metadata: { functionName: "配置代理", description: "修改环境使用的代理 IP" }, vectorScore: 0.62, textScore: 0.6, rrfScore: 0.025 }),
  ]);
  assert.equal(ranked[0]?.knowledgeId, "CONFIGURE-PROXY");
});

test("function keywords act as semantic aliases when action and object are separated", () => {
  const ranked = rerankCandidates("怎么换环境已配置的代理ip", intent({ knowledgeTypes: ["function"], language: "zh" }), [
    candidate("GENERIC-CONFIG", { knowledgeType: "function", title: "环境配置", metadata: { functionName: "环境配置" }, vectorScore: 0.68, textScore: 0.65 }),
    candidate("PROXY-ALIAS", { knowledgeType: "function", title: "编辑代理配置", metadata: { functionName: "编辑代理配置", keywordsZh: ["编辑代理", "修改代理", "更改代理", "换代理"] }, vectorScore: 0.58, textScore: 0.55 }),
  ]);
  assert.equal(ranked[0]?.knowledgeId, "PROXY-ALIAS");
});

test("action-aware reranking works across common feature operations", () => {
  const cases = [
    ["how to delete a profile", "Delete profile", "View profiles"],
    ["Como testar o proxy?", "Testar proxy", "Configurar proxy"],
    ["¿Cómo importar perfiles?", "Importar perfiles", "Exportar perfiles"],
    ["Как создать профиль?", "Создать профиль", "Удалить профиль"],
  ] as const;
  for (const [question, matchingTitle, conflictingTitle] of cases) {
    const ranked = rerankCandidates(question, intent({ knowledgeTypes: ["function"] }), [
      candidate("CONFLICT", { knowledgeType: "function", title: conflictingTitle, metadata: { functionName: conflictingTitle }, vectorScore: 0.7 }),
      candidate("MATCH", { knowledgeType: "function", title: matchingTitle, metadata: { functionName: matchingTitle }, vectorScore: 0.6 }),
    ]);
    assert.equal(ranked[0]?.knowledgeId, "MATCH", question);
  }
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
