export interface QueryUnderstanding {
  language: string;
  normalizedQuery: string;
  searchQueries: string[];
  possibleIntent: string;
  ambiguity: string;
  confidence: "high" | "medium" | "low";
}

const SYSTEM = `Understand noisy customer questions for a software support search system.
Correct likely spelling, grammar, translation and word-form errors, but preserve genuine ambiguity.
Return compact JSON only: {"language":"","normalizedQuery":"","searchQueries":[""],"possibleIntent":"","ambiguity":"","confidence":"high|medium|low"}.
normalizedQuery must express the most likely user goal as object + action. searchQueries may contain at most two short alternatives.
Do not answer the question, invent product capabilities, or assume an uncertain word is definitely a typo. Use an empty ambiguity only when the goal is clear.`;

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

export function buildQueryUnderstandingMessages(question: string, product: string): Array<{ role: "system" | "user"; content: string }> {
  return [{ role: "system", content: SYSTEM }, { role: "user", content: JSON.stringify({ product, customerQuestion: question }) }];
}

export function parseQueryUnderstanding(raw: string): QueryUnderstanding | null {
  try {
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/gi, "")) as Record<string, unknown>;
    const normalizedQuery = text(parsed.normalizedQuery).slice(0, 240);
    if (!normalizedQuery) return null;
    const alternatives = Array.isArray(parsed.searchQueries) ? parsed.searchQueries.map(text).filter(Boolean) : [];
    const searchQueries = [...new Set([normalizedQuery, ...alternatives])].slice(0, 2).map((value) => value.slice(0, 240));
    const confidence = parsed.confidence === "high" || parsed.confidence === "low" ? parsed.confidence : "medium";
    return { language: text(parsed.language), normalizedQuery, searchQueries, possibleIntent: text(parsed.possibleIntent).slice(0, 240), ambiguity: text(parsed.ambiguity).slice(0, 300), confidence };
  } catch { return null; }
}

export function supplementalQueries(understanding: QueryUnderstanding | null, original: string): string[] {
  if (!understanding) return [];
  const normalizedOriginal = original.trim().toLocaleLowerCase();
  const limit = understanding.ambiguity ? 2 : 1;
  return understanding.searchQueries.filter((query) => query.trim().toLocaleLowerCase() !== normalizedOriginal).slice(0, limit);
}
