import assert from "node:assert/strict";
import test from "node:test";
import { isFeishuCustomerImport, manualCustomerDatabaseUpdate, mergeFeishuCustomerUpdate, mergeManualCustomerUpdate } from "./customer-summary-updates.ts";

test("legacy imports without a source remain compatible with Feishu", () => {
  assert.equal(isFeishuCustomerImport(undefined), true);
  assert.equal(isFeishuCustomerImport("feishu"), true);
  assert.equal(isFeishuCustomerImport("manual"), false);
  assert.equal(isFeishuCustomerImport("unknown"), false);
});

test("manual customer edits preserve the Feishu synchronization time", () => {
  const automaticUpdatedAt = "2026-09-01T08:00:00.000Z";
  const result = mergeManualCustomerUpdate(
    { contactName: "Old name", automaticUpdatedAt },
    { contactName: "New name", automaticUpdatedAt: "2026-09-08T08:00:00.000Z" },
  );

  assert.equal(result.contactName, "New name");
  assert.equal(result.automaticUpdatedAt, automaticUpdatedAt);
});

test("spreadsheet updates cannot create a Feishu synchronization time", () => {
  const result = mergeManualCustomerUpdate(
    { contactName: "Customer" },
    { currentPlan: "高阶版", automaticUpdatedAt: "2026-09-08T08:00:00.000Z" },
  );

  assert.equal(result.currentPlan, "高阶版");
  assert.equal("automaticUpdatedAt" in result, false);
});

test("manual database updates do not touch the row update timestamp", () => {
  const update = manualCustomerDatabaseUpdate(
    { contactName: "Old name", automaticUpdatedAt: "2026-09-01T08:00:00.000Z" },
    { contactName: "New name" },
  );

  assert.equal(update.contact_name, "New name");
  assert.equal("updated_at" in update, false);
});

test("an explicitly identified Feishu import updates the synchronization time", () => {
  const automaticUpdatedAt = "2026-09-09T03:00:00.000Z";
  const result = mergeFeishuCustomerUpdate(
    { contactName: "Old name", automaticUpdatedAt: "2026-09-08T03:00:00.000Z" },
    { contactName: "New name", automaticUpdatedAt: "untrusted-value" },
    automaticUpdatedAt,
  );

  assert.equal(result.contactName, "New name");
  assert.equal(result.automaticUpdatedAt, automaticUpdatedAt);
});
