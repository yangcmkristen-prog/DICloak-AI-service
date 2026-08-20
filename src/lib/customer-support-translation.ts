export const CUSTOMER_SUPPORT_TRANSLATION_PRIORITY = [
  "1. Meaning accuracy",
  "2. Native naturalness",
  "3. Customer-support politeness",
  "4. Literal correspondence",
] as const;

export function buildCustomerSupportTranslationGuidance(targetLanguageName: string): string[] {
  return [
    "Translate pragmatic intent, not source-language syntax. The result must sound like a native customer-support agent wrote it directly in the target language.",
    `Resolve trade-offs in this exact order: ${CUSTOMER_SUPPORT_TRANSLATION_PRIORITY.join(" > ")}.`,
    `Use the normal conventions of ${targetLanguageName} for requests, instructions, suggestions, refusals, and troubleshooting steps. Adapt modal verbs, sentence structure, and forms of address when a literal rendering would sound commanding, abrupt, cold, or unnatural.`,
    "For example, when Chinese ‘你需要……’ introduces a helpful instruction, use a courteous native construction such as ‘Please…’, ‘You can…’, or ‘You’ll need to…’ in English according to context; do not mechanically use ‘You need to…’. Apply the equivalent pragmatic adaptation in every target language.",
    "Politeness must not change facts or force. Preserve whether an action is required, optional, recommended, or prohibited, and preserve all conditions, warnings, and limitations.",
    "Do not invent greetings, apologies, thanks, promises, honorifics, or extra assistance that is absent from the source. Make the existing message courteous through natural phrasing rather than added content.",
  ];
}

export function customerSupportTranslationDomain(targetLanguageName: string): string {
  return buildCustomerSupportTranslationGuidance(targetLanguageName).join(" ");
}
