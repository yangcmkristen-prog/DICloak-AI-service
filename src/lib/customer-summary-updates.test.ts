import assert from "node:assert/strict";
import test from "node:test";
import { mergeManualCustomerUpdate } from "./customer-summary-updates.ts";

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
