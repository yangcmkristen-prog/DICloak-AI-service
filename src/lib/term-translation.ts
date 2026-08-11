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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

/** Enforce the imported UI glossary on the completed model reply. */
export function enforceReplyTerminology(text: string, language: string, termItems: TermItem[] = []): string {
  const replacements = termItems
    .map((term) => ({ source: term.termEN.trim(), target: getTermTranslation(term, language) }))
    .filter(({ source, target }) => source && target && source.toLocaleLowerCase() !== target.toLocaleLowerCase())
    .sort((left, right) => right.source.length - left.source.length);

  return text
    .split(/(https?:\/\/\S+)/gi)
    .map((segment) => {
      if (/^https?:\/\//i.test(segment)) return segment;
      return replacements.reduce((content, { source, target }) => {
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(source)}(?![\\p{L}\\p{N}_])`, "giu");
        return content.replace(pattern, target);
      }, segment);
    })
    .join("");
}