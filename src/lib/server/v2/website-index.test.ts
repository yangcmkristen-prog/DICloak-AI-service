import assert from "node:assert/strict";
import test from "node:test";
import type { KnowledgeBase } from "../../types.ts";
import { buildWebsiteKnowledge, canReuseEmbedding, selectActiveBuildingVersion } from "./website-index.ts";

const emptyKnowledge = (): KnowledgeBase => ({ faqItems: [], troubleshootingItems: [], troubleshootingFlowItems: [], outOfScopeItems: [], mappingItems: [], functionKnowledge: [], termItems: [], apiEndpoints: [], apiParameters: [], pricingPlans: [], lastUpdated: 1 });

test("website knowledge is adapted into stable V2 chunks", () => {
  const knowledge = emptyKnowledge();
  knowledge.faqItems.push({ id: "row-1", faqId: "FAQ-1", source: "feature_faq", category1: "环境", category2: "创建", tags: ["环境"], questionCN: "如何创建环境", questionEN: "How to create a profile", userPhrases: "创建环境", answer: "在环境管理页面创建。" });
  const built = buildWebsiteKnowledge(knowledge, "test-version");
  assert.equal(built.warnings.length, 0);
  assert.equal(built.records.length, 1);
  assert.equal(built.chunks.length, 1);
  assert.equal(built.chunks[0].chunkId, "FAQ-1#entry");
  assert.match(built.chunks[0].text, /如何创建环境/);
});

test("website general FAQ is indexed as an independent fallback source", () => {
  const knowledge = emptyKnowledge();
  knowledge.faqItems.push({ id: "row-g1", faqId: "GFAQ-000001", source: "general_faq", category1: "账号与登录", category2: "账号问题", tags: [], questionCN: "", questionEN: "How much is registration?", userPhrases: "How much is registration?", answer: "Registration is free.", language: "en", supportedProduct: "all", enabled: true, problemType: "账号问题" });
  const built = buildWebsiteKnowledge(knowledge, "test-version");
  assert.equal(built.warnings.length, 0);
  assert.equal(built.records[0].type, "general_faq");
  assert.equal(built.chunks[0].knowledgeId, "GFAQ-000001");
  assert.match(built.chunks[0].text, /Registration is free/);
});

test("website API parameters remain in the same endpoint chunk", () => {
  const knowledge = emptyKnowledge();
  knowledge.apiEndpoints.push({ id: "endpoint-1", apiId: "API-1", apiName: "编辑成员", apiType: "HTTP API", supportedProduct: "dicloak", searchKeywords: "edit member", method: "GET", endpoint: "/gin/v1/api/member/open/edit", description: "编辑成员", module: "member", object: "member", operation: "update", isSupported: true });
  knowledge.apiParameters.push({ id: "parameter-1", apiId: "API-1", paramLocation: "Query", paramName: "time_zone", paramType: "string", isRequired: false, description: "时区" });
  const built = buildWebsiteKnowledge(knowledge, "test-version");
  assert.equal(built.warnings.length, 0);
  assert.equal(built.chunks[0].chunkId, "API-1#endpoint");
  assert.match(built.chunks[0].text, /time_zone/);
});

test("only building versions newer than the published version are shown", () => {
  const published = { version: "published", status: "published", created_at: "2026-09-03T00:00:00.000Z" };
  const versions = [
    published,
    { version: "stale", status: "building", created_at: "2026-09-02T00:00:00.000Z" },
  ];
  const now = new Date("2026-09-04T00:01:00.000Z").getTime();
  assert.equal(selectActiveBuildingVersion(versions, published, now), undefined);

  const active = { version: "active", status: "building", created_at: "2026-09-04T00:00:00.000Z" };
  assert.equal(selectActiveBuildingVersion([active, ...versions], published, now)?.version, "active");
  const longRunning = { version: "long-running", status: "building", created_at: "2026-09-03T23:50:00.000Z" };
  assert.equal(selectActiveBuildingVersion([longRunning, published], published, now)?.version, "long-running");
});

test("embeddings are reused when only metadata changed", () => {
  const previous = { chunk_id: "FUNC-1#0", content_hash: "old", embedding_text: "same semantic text" };
  assert.equal(canReuseEmbedding(previous, "same semantic text"), true);
  assert.equal(canReuseEmbedding(previous, "changed semantic text"), false);
  assert.equal(canReuseEmbedding(undefined, "same semantic text"), false);
});
