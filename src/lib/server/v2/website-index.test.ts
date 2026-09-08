import assert from "node:assert/strict";
import test from "node:test";
import type { KnowledgeBase } from "../../types.ts";
import { buildWebsiteKnowledge, selectActiveBuildingVersion } from "./website-index.ts";

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

test("website API parameters remain in the same endpoint chunk", () => {
  const knowledge = emptyKnowledge();
  knowledge.apiEndpoints.push({ id: "endpoint-1", apiId: "API-1", apiName: "编辑成员", apiType: "HTTP API", supportedProduct: "dicloak", searchKeywords: "edit member", method: "GET", endpoint: "/gin/v1/api/member/open/edit", description: "编辑成员", module: "member", object: "member", operation: "update", isSupported: true });
  knowledge.apiParameters.push({ id: "parameter-1", apiId: "API-1", paramLocation: "Query", paramName: "time_zone", paramType: "string", isRequired: false, description: "时区" });
  const built = buildWebsiteKnowledge(knowledge, "test-version");
  assert.equal(built.warnings.length, 0);
  assert.equal(built.chunks[0].chunkId, "API-1#endpoint");
  assert.match(built.chunks[0].text, /time_zone/);
});

test("building versions older than the published version are ignored", () => {
  const published = { version: "published", status: "published", created_at: "2026-09-03T00:00:00.000Z" };
  const versions = [
    published,
    { version: "stale", status: "building", created_at: "2026-09-02T00:00:00.000Z" },
  ];
  assert.equal(selectActiveBuildingVersion(versions, published), undefined);

  const active = { version: "active", status: "building", created_at: "2026-09-04T00:00:00.000Z" };
  assert.equal(selectActiveBuildingVersion([active, ...versions], published)?.version, "active");
});
