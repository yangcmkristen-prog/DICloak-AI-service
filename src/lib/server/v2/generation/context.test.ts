import assert from "node:assert/strict";
import test from "node:test";
import { selectGenerationKnowledge } from "./context.ts";
import type { RetrievalCandidate, RetrievalTrace } from "../retrieval/types.ts";

function candidate(id: string): RetrievalCandidate {
  return {
    chunkId: id, knowledgeId: id, title: "打开环境", text: `huge ${"parameter ".repeat(100)}`,
    metadata: { apiType: "HTTP API", version: "v1", method: "PATCH", endpoint: "/openapi/v1/env/{env_id}/open", fullPath: "https://api.example/open", object: "环境", action: "打开环境", parameters: [{ name: "env_id", location: "Path", dataType: "string", required: "是", description: "环境 ID" }] },
    protectedFields: [{ kind: "endpoint", value: "/openapi/v1/env/{env_id}/open" }, { kind: "parameter", value: "unused_field" }],
    knowledgeType: "http_api", apiType: "http", apiVersion: "v1", products: ["dicloak"], source: "fused", sourceRank: 1,
    textScore: 1, vectorScore: 1, rrfScore: 1, rerankScore: 1, matchedBy: [],
  };
}

function trace(strategy: RetrievalTrace["responseStrategy"]): RetrievalTrace {
  const selectedKnowledge = Array.from({ length: 6 }, (_, index) => candidate(String(index + 1)));
  return { responseStrategy: strategy, selectedKnowledge } as RetrievalTrace;
}

test("direct 只传前三条且 API Endpoint 保持原样", () => {
  const result = selectGenerationKnowledge(trace("direct"), "HTTP API 打开环境的 Endpoint 是什么？");
  assert.equal(result.length, 3);
  assert.match(result[0].text, /Endpoint：\/openapi\/v1\/env\/\{env_id\}\/open/);
  assert.doesNotMatch(result[0].text, /参数：/);
  assert.deepEqual(result[0].protectedFields?.map((field) => field.value), ["/openapi/v1/env/{env_id}/open"]);
});

test("高置信且明显领先的 direct 功能回答只传第一名", () => {
  const selectedKnowledge = Array.from({ length: 3 }, (_, index) => ({
    ...candidate(String(index + 1)), knowledgeType: "function", apiType: null, rerankScore: 0.8 - index * 0.3,
    metadata: { standardAnswer: index === 0 ? "进入扩展管理，点击添加扩展并保存。" : "无关内容" },
  }));
  const result = selectGenerationKnowledge({ ...trace("direct"), evidenceConfidence: "high", selectedKnowledge }, "怎么操作？");
  assert.deepEqual(result.map((item) => item.knowledgeId), ["1"]);
  assert.equal(result[0].text, "进入扩展管理，点击添加扩展并保存。");
  assert.doesNotMatch(result[0].text, /TERM-|huge|\n1\n2/);
});

test("没有决定性领先时 direct 仍保留多个候选供模型判断", () => {
  const selectedKnowledge = Array.from({ length: 3 }, (_, index) => ({
    ...candidate(String(index + 1)), knowledgeType: "function", apiType: null, rerankScore: 0.45 - index * 0.01,
    metadata: { standardAnswer: `答案 ${index + 1}` },
  }));
  const result = selectGenerationKnowledge({ ...trace("direct"), evidenceConfidence: "medium", selectedKnowledge }, "怎么操作？");
  assert.deepEqual(result.map((item) => item.knowledgeId), ["1", "2", "3"]);
});

test("回答后追问只传最相关知识，避免把多个歧义答案塞给模型", () => {
  const result = selectGenerationKnowledge(trace("answer_then_clarify"), "登录失败");
  assert.equal(result.length, 1);
});

test("多角色 FAQ 只传答案变体，不传检索正文", () => {
  const first = {
    ...candidate("FAQ-ROLE"), knowledgeType: "troubleshooting", apiType: null,
    text: "问题标题\nzh: 问题\nTERM-X\n1\n2",
    metadata: { answerVariants: { client: "客户端排查步骤", end_user: "终端用户说明" } },
  };
  const result = selectGenerationKnowledge({ ...trace("direct"), selectedKnowledge: [first] }, "登录失败");
  assert.equal(result[0].text, "client：客户端排查步骤\nend_user：终端用户说明");
  assert.doesNotMatch(result[0].text, /TERM-X|问题标题/);
});

test("通用问答检索正文与生成答案分离", () => {
  const first = { ...candidate("GFAQ-1"), knowledgeType: "general_faq", apiType: null, text: "question-only search text", metadata: { answer: "Use the curated answer." } };
  const result = selectGenerationKnowledge({ ...trace("direct"), selectedKnowledge: [first] }, "How?");
  assert.equal(result[0].text, "Use the curated answer.");
});

test("功能概览允许生成模型整合同页面的三条互补知识", () => {
  const selectedKnowledge = Array.from({ length: 3 }, (_, index) => ({
    ...candidate(String(index + 1)), knowledgeType: "function", apiType: null,
  }));
  const result = selectGenerationKnowledge({ ...trace("feature_overview"), selectedKnowledge }, "你们有推广奖励活动吗？");
  assert.deepEqual(result.map((item) => item.knowledgeId), ["1", "2", "3"]);
});

test("询问参数时才携带结构化参数且聚合最多五条", () => {
  const result = selectGenerationKnowledge(trace("aggregated"), "请求参数是什么？");
  assert.equal(result.length, 5);
  assert.match(result[0].text, /参数：Path env_id/);
  assert.ok(result[0].text.length < 600);
});

test("只追问不传知识，不支持场景可携带边界知识", () => {
  assert.equal(selectGenerationKnowledge(trace("clarify_only"), "帮我删除它").length, 0);
  assert.equal(selectGenerationKnowledge(trace("confirmation_required"), "需要确认的问题").length, 0);
  assert.equal(selectGenerationKnowledge(trace("unsupported"), "天气如何").length, 2);
});

test("套餐比较不受五个原子知识限制", () => {
  const pricing = Array.from({ length: 8 }, (_, index) => ({ ...candidate(`PRICING:feature:${index}`), knowledgeType: "pricing", apiType: null, metadata: { feature: "feature", planKey: String(index) } }));
  const result = selectGenerationKnowledge({ ...trace("direct"), selectedKnowledge: pricing }, "哪个套餐合适？");
  assert.equal(result.length, 8);
});
