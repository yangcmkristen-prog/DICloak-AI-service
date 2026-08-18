const CUSTOMER_REPLY_MARKERS = /\[\[\/?[a-z_]+\]\]/gi;
const URL_PATTERN = /https?:\/\/\S+/gi;

// These are identifiers rather than prose and may legitimately remain Latin in
// an otherwise Chinese reply. UI labels are deliberately not allowlisted: when
// the term library has no Chinese value, the language QA pass should translate
// the label instead of leaking an English instruction into the reply.
const CHINESE_REPLY_LATIN_IDENTIFIERS = /\b(?:DICloak|Paraturbo|Free|Base|Plus|Share\+|API|HTTP|HTTPS|URL|IP|JSON|FAQ|WebGPU|WebGL)\b/gi;

const SCRIPT_PATTERNS: Record<string, RegExp> = {
  zh: /[\u4e00-\u9fff]/g,
  ru: /[\u0400-\u04ff]/g,
  ar: /[\u0600-\u06ff\u0750-\u077f]/g,
  th: /[\u0e00-\u0e7f]/g,
  ja: /[\u3040-\u30ff]/g,
  ko: /[\uac00-\ud7af\u1100-\u115f]/g,
  // Use explicit Latin blocks. The seemingly convenient À-ỹ range also spans
  // Greek and Cyrillic code points, which caused Russian text to be counted as
  // Latin and falsely reported as bilingual.
  latin: /[A-Za-z\u00c0-\u024f\u1e00-\u1eff]/g,
};

function getCustomerProse(content: string): string {
  return content
    .replace(CUSTOMER_REPLY_MARKERS, " ")
    .replace(URL_PATTERN, " ")
    .replace(CHINESE_REPLY_LATIN_IDENTIFIERS, " ");
}

export function hasUnexpectedChineseReplyEnglish(content: string): boolean {
  return countUnexpectedChineseReplyEnglish(content) > 0;
}

/**
 * Scores untranslated English prose in a Chinese customer reply. A score of
 * zero means that only allowlisted product/technical identifiers remain.
 * Keeping this as a count also lets the language-repair pipeline choose the
 * cleanest result when every model attempt is imperfect.
 */
export function countUnexpectedChineseReplyEnglish(content: string): number {
  const customerText = getCustomerProse(content);
  const latinWords = customerText.match(/[A-Za-z][A-Za-z-]{1,}/g) ?? [];
  const latinCharacters = latinWords.join("").length;

  return latinWords.length >= 2 || latinCharacters >= 12 ? latinCharacters : 0;
}

/** Detect substantial foreign-script prose while allowing canonical terms. */
export function hasUnexpectedReplyScript(content: string, targetLanguage: string): boolean {
  const prose = getCustomerProse(content);
  const counts = Object.fromEntries(
    Object.entries(SCRIPT_PATTERNS).map(([script, pattern]) => [script, prose.match(pattern)?.length ?? 0]),
  );
  const latinTargets = new Set(["en", "es", "pt", "vi", "id"]);
  const normalizedTarget = targetLanguage === "mixed" ? "zh" : targetLanguage;
  const targetScript = latinTargets.has(normalizedTarget) ? "latin" : normalizedTarget;
  const foreignCount = Object.entries(counts)
    .filter(([script]) => script !== targetScript && !(normalizedTarget === "ja" && script === "zh"))
    .reduce((total, [, count]) => total + count, 0);

  if (normalizedTarget === "zh" && hasUnexpectedChineseReplyEnglish(content)) return true;

  return foreignCount >= Math.max(8, (counts[targetScript] ?? 0) * 0.1);
}