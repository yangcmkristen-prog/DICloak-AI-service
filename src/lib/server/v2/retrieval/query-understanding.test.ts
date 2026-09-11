import assert from "node:assert/strict";
import test from "node:test";
import { buildQueryUnderstandingMessages, parseQueryUnderstanding, supplementalQueries } from "./query-understanding.ts";

test("query understanding keeps typo uncertainty while producing compact search alternatives", () => {
  const parsed = parseQueryUnderstanding(JSON.stringify({ language: "en", normalizedQuery: "configure simulated input delay", searchQueries: ["simulation input delay", "simulated typing delay", "ignored third query"], possibleIntent: "configure input delay", ambiguity: "display may mean delay or a display setting", confidence: "medium" }));
  assert.equal(parsed?.normalizedQuery, "configure simulated input delay");
  assert.equal(parsed?.searchQueries.length, 2);
  assert.match(parsed?.ambiguity ?? "", /may mean/);
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
});
