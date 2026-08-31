import assert from "node:assert/strict";
import test from "node:test";
import { changedFeishuCustomerFields, parseFeishuCustomerUpdates } from "./feishu-customer-webhook.ts";

test("parses Feishu fields and keeps only the first duplicate team", () => {
  const result = parseFeishuCustomerUpdates({ records: [
    { fields: { 团队ID: " Team-1 ", 团队名字: [{ text: "张三" }], 用户联系方式: "13800000000", 私域渠道: { name: "微信" }, 套餐: { text: "高阶版" }, 创建时间: 1_700_000_000_000 } },
    { fields: { 团队ID: "team-1", 团队名字: "不应覆盖" } },
  ] });
  assert.equal(result.skippedDuplicates, 1);
  assert.ok(result.detectedFields.includes("团队ID"));
  assert.deepEqual(result.updates, [{
    teamId: "Team-1", contactName: "张三", contactDetail: "13800000000", contactMethod: "微信",
    createdAt: "2023-11-14T22:13:20.000Z", dueDate: undefined, currentPlan: "高阶版",
  }]);
});

test("accepts whitespace in field names and JSON encoded Feishu fields", () => {
  const result = parseFeishuCustomerUpdates({ body: JSON.stringify({ record: { fields: JSON.stringify({ "团队 ID\u200b": "DIC-100", 联系方式: "dic@example.com" }) } }) });
  assert.equal(result.updates[0]?.teamId, "DIC-100");
});

test("accepts ASCII field names for encoding-safe Windows curl requests", () => {
  const result = parseFeishuCustomerUpdates({ record: { fields: {
    teamId: "jB327xG6", contactName: "Test", contactDetail: "test@example.com", contactMethod: "WhatsApp",
    createdAt: "2026-08-01", dueDate: "2027-08-01", currentPlan: "Plus",
  } } });
  assert.equal(result.updates[0]?.teamId, "jB327xG6");
  assert.equal(result.updates[0]?.currentPlan, "Plus");
});

test("parses the record.fields envelope used by Feishu automation", () => {
  assert.deepEqual(parseFeishuCustomerUpdates({ record: { fields: { 团队ID: "42", 联系人: "李四", 渠道: "微信", 到期时间: "2027-01-02" } } }).updates[0], {
    teamId: "42", contactName: "李四", contactDetail: undefined, contactMethod: "微信",
    createdAt: undefined, dueDate: "2027-01-02T00:00:00.000Z", currentPlan: undefined,
  });
});

test("ignores records when both contact detail and channel are empty", () => {
  const result = parseFeishuCustomerUpdates({ records: [
    { fields: { 团队ID: "empty-contact", 联系方式: "  ", 渠道: [] } },
    { fields: { 团队ID: "has-contact", 联系方式: "customer@example.com" } },
    { fields: { 团队ID: "has-channel", 渠道: { name: "WhatsApp" } } },
  ] });

  assert.equal(result.skippedMissingContact, 1);
  assert.deepEqual(result.updates.map((update) => update.teamId), ["has-contact", "has-channel"]);
});

test("detects only non-empty Feishu fields whose values actually changed", () => {
  assert.deepEqual(changedFeishuCustomerFields(
    { contactName: "张三", contactDetail: "13800000000", contactMethod: "微信", currentPlan: "基础版" },
    { teamId: "team-1", contactName: " 张三 ", contactDetail: "13800000000", contactMethod: "微信", currentPlan: "高阶版", dueDate: "2027-01-01T00:00:00.000Z" },
  ), ["dueDate", "currentPlan"]);
});
