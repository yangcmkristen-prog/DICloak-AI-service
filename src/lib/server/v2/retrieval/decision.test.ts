import assert from "node:assert/strict";
import test from "node:test";
import { decideRetrieval, classifyQuestionMode } from "./decision.ts";
import { parseQuery } from "./query-parser.ts";
import type { QueryIntent, RetrievalCandidate } from "./types.ts";

const intent = (overrides: Partial<QueryIntent> = {}): QueryIntent => ({ product: "dicloak", language: "zh", knowledgeTypes: [], apiType: null, apiVersion: null, method: null, object: null, action: null, missingConditions: [], ...overrides });
const candidate = (id: string, overrides: Partial<RetrievalCandidate> = {}): RetrievalCandidate => ({ chunkId: `${id}#entry`, knowledgeId: id, title: id, text: id, metadata: {}, knowledgeType: "troubleshooting", apiType: null, apiVersion: null, products: ["dicloak"], source: "fused", sourceRank: 1, textScore: 0.3, vectorScore: 0.4, rrfScore: 0.03, rerankScore: 0.35, matchedBy: ["fulltext", "vector"], ...overrides });

test("precise HTTP API question selects direct evidence and excludes Local API", () => {
  const question = "HTTP API 打开环境的 Endpoint 是什么？";
  const parsed = parseQuery(question);
  const rows = [candidate("HTTP-OPEN", { knowledgeType: "http_api", apiType: "http" })];
  const result = decideRetrieval(question, parsed, rows, "high", []);
  assert.equal(result.questionMode, "precise");
  assert.equal(result.responseStrategy, "direct");
  assert.ok(result.selectedKnowledge.length > 0);
  assert.ok(result.selectedKnowledge.every((item) => item.apiType !== "local"));
});

test("broad troubleshooting aggregates distinct evidence and may ask only after answering", () => {
  const question = "环境打不开";
  const parsed = parseQuery(question);
  const rows = [
    candidate("PROXY-1", { text: "代理 proxy 失败" }), candidate("PROXY-2", { text: "代理连接失败" }),
    candidate("NET-1", { text: "检查网络 network" }), candidate("DISK-1", { text: "磁盘空间不足" }), candidate("CACHE-1", { text: "清理缓存文件夹" }),
  ];
  const result = decideRetrieval(question, parsed, rows, "low", []);
  assert.equal(result.questionMode, "broad_troubleshooting");
  assert.ok(["aggregated", "answer_then_clarify"].includes(result.responseStrategy));
  assert.notEqual(result.responseStrategy, "clarify_only");
  assert.ok(result.selectedKnowledge.length >= 3);
  assert.equal(new Set(result.knowledgeGroups.map((group) => group.key)).size, result.knowledgeGroups.length);
  assert.equal(result.selectedKnowledge.filter((item) => item.knowledgeId.startsWith("PROXY")).length, 1);
});

test("ambiguous login produces two evidence-backed safe branches", () => {
  const question = "无法登录";
  const rows = [
    candidate("ROUTING-LOGIN", { knowledgeType: "user_routing", title: "DICloak 账号登录" }),
    candidate("PLATFORM-LOGIN", { knowledgeType: "troubleshooting", title: "平台工具账号登录失败" }),
  ];
  const result = decideRetrieval(question, parseQuery(question), rows, "low", []);
  assert.equal(result.questionMode, "ambiguous_with_safe_branches");
  assert.equal(result.responseStrategy, "conditional");
  assert.deepEqual(result.branches.map((branch) => branch.label), ["DICloak 账号登录", "第三方平台账号登录"]);
  assert.equal(classifyQuestionMode("账号不能用", parseQuery("账号不能用")).mode, "ambiguous_with_safe_branches");
});

test("vague destructive request clarifies without speculative steps", () => {
  const question = "帮我删除它";
  const result = decideRetrieval(question, parseQuery(question), [candidate("DELETE-STEPS")], "high", []);
  assert.equal(result.questionMode, "missing_critical_information");
  assert.equal(result.responseStrategy, "clarify_only");
  assert.equal(result.selectedKnowledge.length, 0);
  assert.ok(result.missingCriticalInformation.length > 0);
});

test("unknown access target clarifies without selecting broad knowledge", () => {
  const question = "我想要访问链接。";
  const result = decideRetrieval(question, parseQuery(question), [candidate("GENERIC-LINK")], "low", []);
  assert.equal(result.questionMode, "missing_critical_information");
  assert.equal(result.responseStrategy, "clarify_only");
  assert.equal(result.selectedKnowledge.length, 0);
});

test("unrelated weak candidates are debug-only and never selected", () => {
  const rows = [candidate("UNRELATED", { rerankScore: 0.05, vectorScore: 0.05, textScore: 0.01 })];
  const result = decideRetrieval("火星天气怎么样", intent(), rows, "none", ["低于阈值"]);
  assert.equal(result.responseStrategy, "clarify_only");
  assert.equal(result.selectedKnowledge.length, 0);
  assert.equal(result.debugCandidates.length, 1);
  assert.equal(result.rejectedCandidates.length, 1);
});

test("question modes distinguish broad and critical ambiguity", () => {
  assert.equal(classifyQuestionMode("环境打不开", parseQuery("环境打不开")).mode, "broad_troubleshooting");
  assert.equal(classifyQuestionMode("帮我删除它", parseQuery("帮我删除它")).mode, "missing_critical_information");
});
