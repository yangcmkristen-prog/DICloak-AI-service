import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCustomerSupportTranslationGuidance,
  CUSTOMER_SUPPORT_TRANSLATION_PRIORITY,
  customerSupportTranslationDomain,
  STRICT_TRANSLATION_FIDELITY_GUIDANCE,
} from "./customer-support-translation";

test("translation guidance declares the requested quality priority", () => {
  assert.deepEqual(CUSTOMER_SUPPORT_TRANSLATION_PRIORITY, [
    "1. Complete source-text coverage",
    "2. Meaning accuracy",
    "3. Terminology and proper-noun preservation",
    "4. Native naturalness",
    "5. Customer-support politeness",
  ]);
});

test("translation guidance forbids interpreting away source content", () => {
  const guidance = STRICT_TRANSLATION_FIDELITY_GUIDANCE.join("\n");
  assert.match(guidance, /never summarize, paraphrase away, merge, or skip content/);
  assert.match(guidance, /好的，感谢您的反馈/);
  assert.match(guidance, /Okay, thank you for your feedback\./);
  assert.match(guidance, /product names, brands, proper nouns, model names/);
  assert.match(guidance, /line breaks/);
});

test("translation guidance adapts politeness without weakening requirements", () => {
  const guidance = buildCustomerSupportTranslationGuidance("English").join("\n");
  assert.match(guidance, /你需要/);
  assert.match(guidance, /do not mechanically use ‘You need to…’/);
  assert.match(guidance, /required, optional, recommended, or prohibited/);
  assert.match(guidance, /Do not invent greetings, apologies, thanks/);
  assert.match(customerSupportTranslationDomain("English"), /native customer-support agent/);
  assert.match(customerSupportTranslationDomain("English"), /Every sentence, clause, list item/);
});
