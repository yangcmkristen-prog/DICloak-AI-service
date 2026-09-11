import assert from "node:assert/strict";
import test from "node:test";
import { buildQueryUnderstandingMessages, knowledgeTypesForTaskType, parseQueryUnderstanding, supplementalQueries } from "./query-understanding.ts";

test("query understanding keeps typo uncertainty while producing compact search alternatives", () => {
  const parsed = parseQueryUnderstanding(JSON.stringify({ language: "en", normalizedQuery: "configure simulated input delay", searchQueries: ["simulation input delay", "simulated typing delay", "ignored third query"], possibleIntent: "configure input delay", ambiguity: "display may mean delay or a display setting", taskType: "feature_operation", confidence: "medium" }));
  assert.equal(parsed?.normalizedQuery, "configure simulated input delay");
  assert.equal(parsed?.searchQueries.length, 2);
  assert.match(parsed?.ambiguity ?? "", /may mean/);
  assert.equal(parsed?.taskType, "feature_operation");
  assert.deepEqual(supplementalQueries(parsed, "simulated input display"), ["configure simulated input delay", "simulation input delay"]);
});

test("invalid understanding safely disables supplemental retrieval", () => {
  assert.equal(parseQueryUnderstanding("not json"), null);
  assert.deepEqual(supplementalQueries(null, "question"), []);
});

test("query understanding receives concise DICloak terminology context", () => {
  const messages = buildQueryUnderstandingMessages("环境打不开", "dicloak");
  assert.match(messages[0].content, /环境 normally means a browser profile/);
  assert.match(messages[0].content, /开发环境/);
  assert.match(messages[0].content, /troubleshooting/);
});

test("task types map to bounded knowledge scopes", () => {
  assert.deepEqual(knowledgeTypesForTaskType("troubleshooting"), ["troubleshooting", "troubleshooting_flow", "user_routing"]);
  assert.deepEqual(knowledgeTypesForTaskType("feature_operation"), ["function"]);
  assert.deepEqual(knowledgeTypesForTaskType("feature_capability"), ["function"]);
  assert.deepEqual(knowledgeTypesForTaskType("pricing"), ["pricing"]);
  assert.deepEqual(knowledgeTypesForTaskType("api"), ["http_api", "local_api"]);
  assert.deepEqual(knowledgeTypesForTaskType("account_or_service"), ["faq", "user_routing", "out_of_scope"]);
  assert.equal(knowledgeTypesForTaskType("unknown"), undefined);
});

test("missing or invalid task type falls back to unrestricted retrieval", () => {
  const parsed = parseQueryUnderstanding(JSON.stringify({ normalizedQuery: "open profile", taskType: "made_up", confidence: "high" }));
  assert.equal(parsed?.taskType, "unknown");
  assert.equal(knowledgeTypesForTaskType(parsed?.taskType ?? "unknown"), undefined);
});
