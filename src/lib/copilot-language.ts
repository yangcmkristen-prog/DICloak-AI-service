/**
 * Return a reliable language hint for extension requests.
 *
 * Product names and UI labels often add Latin characters to an otherwise
 * non-English customer message. Treat three characters from a non-Latin script
 * as authoritative so the downstream model cannot mistake it for English.
 */
export type NonLatinLanguage = "zh" | "ru" | "ar" | "th" | "ja" | "ko";

const MIN_LANGUAGE_CHARACTERS = 3;

/** Detect a non-Latin language once at least three of its characters occur. */
export function detectNonLatinLanguage(message: string): NonLatinLanguage | undefined {
  const scripts: Array<{ language: NonLatinLanguage; pattern: RegExp }> = [
    { language: "ru", pattern: /[\u0400-\u04ff]/g },
    { language: "ar", pattern: /[\u0600-\u06ff\u0750-\u077f]/g },
    { language: "th", pattern: /[\u0e00-\u0e7f]/g },
    // Check language-specific Japanese and Korean characters before Han. A
    // Japanese sentence can legitimately contain many shared Han characters.
    { language: "ja", pattern: /[\u3040-\u30ff]/g },
    { language: "ko", pattern: /[\uac00-\ud7af\u1100-\u115f]/g },
    { language: "zh", pattern: /[\u4e00-\u9fff]/g },
  ];

  return scripts.find(({ pattern }) => (message.match(pattern)?.length ?? 0) >= MIN_LANGUAGE_CHARACTERS)?.language;
}

export function getCopilotLanguageHint(message: string): NonLatinLanguage | undefined {
  return detectNonLatinLanguage(message);
}