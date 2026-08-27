import type { TermItem } from "@/lib/types";

const LANGUAGE_TERM_FIELDS = {
  zh: "termCN",
  cn: "termCN",
  chinese: "termCN",
  en: "termEN",
  english: "termEN",
  pt: "termPT",
  portuguese: "termPT",
  es: "termES",
  spanish: "termES",
  ru: "termRU",
  russian: "termRU",
  vi: "termVI",
  vietnamese: "termVI",
} as const satisfies Record<string, keyof TermItem>;

function getTermTranslation(term: TermItem, language: string): string {
  const field = LANGUAGE_TERM_FIELDS[language.toLowerCase() as keyof typeof LANGUAGE_TERM_FIELDS];
  if (!field) return "";
  const value = term[field];
  return typeof value === "string" ? value.trim() : "";
}

export function translateTermPlaceholders(
  text: string,
  termIds: string[] = [],
  language: string,
  termItems: TermItem[] = []
): string {
  if (!text || termIds.length === 0 || termItems.length === 0) return text;

  const allowedTerms = new Map(
    termItems
      .filter((term) => termIds.includes(term.termId) && term.termEN)
      .map((term) => [term.termEN.trim().toLowerCase(), getTermTranslation(term, language)])
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
  );

  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (placeholder, source: string) => {
    return allowedTerms.get(source.trim().toLowerCase()) || placeholder;
  });
}
