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

test("询问参数时才携带结构化参数且聚合最多五条", () => {
  const result = selectGenerationKnowledge(trace("aggregated"), "请求参数是什么？");
  assert.equal(result.length, 5);
  assert.match(result[0].text, /参数：Path env_id/);
  assert.ok(result[0].text.length < 600);
});

test("只追问不传知识，不支持场景可携带边界知识", () => {
  assert.equal(selectGenerationKnowledge(trace("clarify_only"), "帮我删除它").length, 0);
  assert.equal(selectGenerationKnowledge(trace("unsupported"), "天气如何").length, 2);
});
