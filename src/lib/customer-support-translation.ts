export const CUSTOMER_SUPPORT_TRANSLATION_PRIORITY = [
  "1. Complete source-text coverage",
  "2. Meaning accuracy",
  "3. Terminology and proper-noun preservation",
  "4. Native naturalness",
  "5. Customer-support politeness",
] as const;

export const STRICT_TRANSLATION_FIDELITY_GUIDANCE = [
  "Translate the entire source text. Every sentence, clause, list item, and meaningful word must have a corresponding translation; never summarize, paraphrase away, merge, or skip content.",
  "Preserve discourse markers and short acknowledgements such as 好的, 那么, 另外, 但是, yes, okay, and well when they appear in the source. For example, 好的，感谢您的反馈 must retain both the acknowledgement and the thanks, such as ‘Okay, thank you for your feedback.’, rather than only ‘Thank you for your feedback.’",
  "Copy product names, brands, proper nouns, model names, technical terms, variables, numbers, units, IDs, URLs, email addresses, placeholders, and code exactly unless an explicit terminology entry supplies their translation.",
  "Preserve the source structure, punctuation intent, and line breaks as closely as the target language allows. Do not replace specific wording with a broader interpretation.",
] as const;

export function buildCustomerSupportTranslationGuidance(targetLanguageName: string): string[] {
  return [
    ...STRICT_TRANSLATION_FIDELITY_GUIDANCE,
    "After preserving every source detail, make the result sound like a native customer-support agent wrote it in the target language. Natural phrasing must never remove or generalize source content.",
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
