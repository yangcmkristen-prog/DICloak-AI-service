const CUSTOMER_REPLY_MARKERS = /\[\[\/?[a-z_]+\]\]/gi;
const URL_PATTERN = /https?:\/\/\S+/gi;

// These are identifiers rather than prose and may legitimately remain Latin in
// an otherwise Chinese reply. UI labels are deliberately not allowlisted: when
// the term library has no Chinese value, the language QA pass should translate
// the label instead of leaking an English instruction into the reply.
const CHINESE_REPLY_LATIN_IDENTIFIERS = /\b(?:DICloak|Paraturbo|Free|Base|Plus|Share\+|API|HTTP|HTTPS|URL|IP|JSON|FAQ)\b/gi;

export function hasUnexpectedChineseReplyEnglish(content: string): boolean {
  const customerText = content
    .replace(CUSTOMER_REPLY_MARKERS, " ")
    .replace(URL_PATTERN, " ")
    .replace(CHINESE_REPLY_LATIN_IDENTIFIERS, " ");
  const latinWords = customerText.match(/[A-Za-z][A-Za-z-]{1,}/g) ?? [];
  const latinCharacters = latinWords.join("").length;

  return latinWords.length >= 2 || latinCharacters >= 12;
}