import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCustomerSupportTranslationGuidance,
  CUSTOMER_SUPPORT_TRANSLATION_PRIORITY,
  customerSupportTranslationDomain,
} from "./customer-support-translation";

test("translation guidance declares the requested quality priority", () => {
  assert.deepEqual(CUSTOMER_SUPPORT_TRANSLATION_PRIORITY, [
    "1. Meaning accuracy",
    "2. Native naturalness",
    "3. Customer-support politeness",
    "4. Literal correspondence",
  ]);
});

test("translation guidance adapts politeness without weakening requirements", () => {
  const guidance = buildCustomerSupportTranslationGuidance("English").join("\n");
  assert.match(guidance, /你需要/);
  assert.match(guidance, /do not mechanically use ‘You need to…’/);
  assert.match(guidance, /required, optional, recommended, or prohibited/);
  assert.match(guidance, /Do not invent greetings, apologies, thanks/);
  assert.match(customerSupportTranslationDomain("English"), /native customer-support agent/);
});
