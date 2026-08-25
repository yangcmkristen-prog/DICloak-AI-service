import assert from "node:assert/strict";
import test from "node:test";
import { parseFeishuCustomerUpdates } from "./feishu-customer-webhook";

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
  const result = parseFeishuCustomerUpdates({ body: JSON.stringify({ record: { fields: JSON.stringify({ "团队 ID\u200b": "DIC-100" }) } }) });
  assert.equal(result.updates[0]?.teamId, "DIC-100");
});

test("parses the record.fields envelope used by Feishu automation", () => {
  assert.deepEqual(parseFeishuCustomerUpdates({ record: { fields: { 团队ID: "42", 联系人: "李四", 到期时间: "2027-01-02" } } }).updates[0], {
    teamId: "42", contactName: "李四", contactDetail: undefined, contactMethod: undefined,
    createdAt: undefined, dueDate: "2027-01-02T00:00:00.000Z", currentPlan: undefined,
  });
});