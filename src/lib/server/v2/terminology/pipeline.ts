import { createHash } from "node:crypto";
import type {
  PreparedKnowledge, PreparedTerminologyPipeline, RestoreResult, SupportedTermLanguage, TermMarker,
  TerminologyBranchInput, TerminologyIssue, TerminologyKnowledge, V2TermDefinition,
} from "./types.ts";

const FUNCTION_NATURAL_FIELDS = ["module", "page", "functionName", "description", "uiLocation", "prerequisites", "steps"] as const;
const FUNCTION_TECHNICAL_FIELDS = ["entryPath"] as const;
const PLACEHOLDER_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const INTERNAL_MARKER_PATTERN = /⟦V2:[^⟦⟧]+⟧/g;
const normalize = (value: string): string => value.trim().toLocaleLowerCase("en-US");
const text = (value: unknown): string => typeof value === "string" ? value : "";
const stableHash = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 10);
const markerToken = (knowledgeId: string, kind: string, index: number, identity: string): string =>
  `⟦V2:${stableHash(knowledgeId)}:${kind}:${index}:${stableHash(identity)}⟧`;

function issue(severity: "warning" | "error", code: string, message: string, detail: Partial<TerminologyIssue> = {}): TerminologyIssue {
  return { severity, code, message, ...detail };
}

function buildCatalog(terms: V2TermDefinition[], errors: TerminologyIssue[]): Map<string, V2TermDefinition> {
  const catalog = new Map<string, V2TermDefinition>();
  for (const term of [...terms].sort((a, b) => a.termId.localeCompare(b.termId))) {
    const current = catalog.get(term.termId);
    if (!current) {
      catalog.set(term.termId, { ...term, translations: { ...term.translations } });
      continue;
    }
    for (const [language, value] of Object.entries(term.translations)) {
      const previous = current.translations[language as SupportedTermLanguage]?.trim();
      const incoming = value?.trim();
      if (previous && incoming && previous !== incoming) {
        errors.push(issue("error", "TERM_TRANSLATION_CONFLICT", `术语 ${term.termId} 的 ${language} 译法冲突，已阻止正式生成`, { termId: term.termId, source: term.source }));
      } else if (!previous && incoming) {
        current.translations[language as SupportedTermLanguage] = incoming;
      }
    }
  }
  return catalog;
}

function translation(term: V2TermDefinition, language: SupportedTermLanguage, warnings: TerminologyIssue[], knowledge: TerminologyKnowledge): string | null {
  const translated = term.translations[language]?.trim();
  if (translated) return translated;
  const english = term.translations.en?.trim();
  if (english) {
    warnings.push(issue("warning", "TERM_TRANSLATION_FALLBACK_EN", `术语 ${term.termId} 缺少 ${language} 译法，回退英文`, { knowledgeId: knowledge.id, termId: term.termId, source: knowledge.source }));
    return english;
  }
  return null;
}

function replaceLiteral(input: string, sourceValue: string, replacement: string): { value: string; count: number } {
  if (!sourceValue) return { value: input, count: 0 };
  let value = input;
  let cursor = 0;
  let count = 0;
  const lowerInput = input.toLocaleLowerCase("en-US");
  const lowerSource = sourceValue.toLocaleLowerCase("en-US");
  const parts: string[] = [];
  while (true) {
    const index = lowerInput.indexOf(lowerSource, cursor);
    if (index < 0) break;
    parts.push(input.slice(cursor, index), replacement);
    cursor = index + sourceValue.length;
    count += 1;
  }
  if (count) value = `${parts.join("")}${input.slice(cursor)}`;
  return { value, count };
}

function addMarker(markers: TermMarker[], marker: Omit<TermMarker, "marker">): string {
  const token = markerToken(marker.knowledgeId, marker.kind, markers.length, marker.termId ?? `${marker.sourceValue}\0${marker.value}`);
  markers.push({ marker: token, ...marker });
  return token;
}

function protectTechnicalValues(input: string, knowledge: TerminologyKnowledge, markers: TermMarker[]): string {
  const fields = knowledge.protectedFields
    .filter((field) => field.value && field.kind !== "placeholder" && field.kind !== "term")
    .sort((a, b) => b.value.length - a.value.length || a.kind.localeCompare(b.kind));
  const occupied = new Array<boolean>(input.length).fill(false);
  const replacements: Array<{ start: number; end: number; token: string }> = [];
  for (const field of fields) {
    const lowerInput = input.toLocaleLowerCase("en-US");
    const lowerValue = field.value.toLocaleLowerCase("en-US");
    const matches: Array<{ start: number; end: number }> = [];
    let cursor = 0;
    while (true) {
      const start = lowerInput.indexOf(lowerValue, cursor);
      if (start < 0) break;
      const end = start + field.value.length;
      if (!occupied.slice(start, end).some(Boolean)) matches.push({ start, end });
      cursor = end;
    }
    if (!matches.length) continue;
    const token = addMarker(markers, { kind: "technical", value: field.value, sourceValue: field.value, knowledgeId: knowledge.id, occurrences: matches.length });
    for (const match of matches) {
      occupied.fill(true, match.start, match.end);
      replacements.push({ ...match, token });
    }
  }
  replacements.sort((a, b) => a.start - b.start);
  let cursor = 0;
  const output: string[] = [];
  for (const replacement of replacements) {
    output.push(input.slice(cursor, replacement.start), replacement.token);
    cursor = replacement.end;
  }
  output.push(input.slice(cursor));
  return output.join("");
}

function prepareFaq(knowledge: TerminologyKnowledge, catalog: Map<string, V2TermDefinition>, language: SupportedTermLanguage, markers: TermMarker[], warnings: TerminologyIssue[], errors: TerminologyIssue[]): string {
  const allowed = [...new Set(knowledge.termIds)].map((termId) => catalog.get(termId)).filter((term): term is V2TermDefinition => Boolean(term));
  return protectTechnicalValues(knowledge.body, knowledge, markers).replace(PLACEHOLDER_PATTERN, (placeholder, rawName: string) => {
    const matches = allowed.filter((term) => normalize(term.translations.en ?? "") === normalize(rawName));
    if (matches.length !== 1) {
      errors.push(issue("error", matches.length ? "FAQ_PLACEHOLDER_DUPLICATE" : "FAQ_PLACEHOLDER_UNLINKED", matches.length ? `占位符 ${placeholder} 在当前 FAQ 的 termIds 中匹配到多个术语` : `占位符 ${placeholder} 无法关联当前 FAQ 的 termIds`, { knowledgeId: knowledge.id, source: knowledge.source, field: "body" }));
      return placeholder;
    }
    const target = translation(matches[0], language, warnings, knowledge);
    if (!target) {
      errors.push(issue("error", "TERM_ENGLISH_MISSING", `术语 ${matches[0].termId} 没有目标语言译法且无法回退英文`, { knowledgeId: knowledge.id, termId: matches[0].termId, source: knowledge.source }));
      return placeholder;
    }
    return addMarker(markers, { kind: "term", value: target, sourceValue: placeholder, knowledgeId: knowledge.id, termId: matches[0].termId, occurrences: 1 });
  });
}

function prepareFunction(knowledge: TerminologyKnowledge, catalog: Map<string, V2TermDefinition>, language: SupportedTermLanguage, markers: TermMarker[], warnings: TerminologyIssue[], errors: TerminologyIssue[]): PreparedKnowledge {
  const naturalLanguageFields: Record<string, string> = {};
  const technicalFields: Record<string, string> = {};
  for (const field of FUNCTION_NATURAL_FIELDS) naturalLanguageFields[field] = protectTechnicalValues(text(knowledge.metadata[field]), knowledge, markers);
  for (const field of FUNCTION_TECHNICAL_FIELDS) {
    const value = text(knowledge.metadata[field]);
    technicalFields[field] = value ? addMarker(markers, { kind: "technical", value, sourceValue: value, knowledgeId: knowledge.id, occurrences: 1 }) : "";
  }
  const sourceLanguage = (knowledge.sourceLanguage === "zh" ? "zh" : "en") satisfies SupportedTermLanguage;
  for (const termId of [...new Set(knowledge.termIds)].sort()) {
    const term = catalog.get(termId);
    if (!term) {
      errors.push(issue("error", "TERM_ID_UNKNOWN", `功能知识引用不存在的 term_id：${termId}`, { knowledgeId: knowledge.id, termId, source: knowledge.source }));
      continue;
    }
    // Non-UI terms are relationship-only IDs used by function knowledge.
    if (term.isUiVisible === false) continue;
    const sourceValue = term.translations[sourceLanguage]?.trim();
    if (!sourceValue) {
      errors.push(issue("error", "TERM_SOURCE_MISSING", `术语 ${termId} 缺少功能知识源语言 ${sourceLanguage} 的正式术语`, { knowledgeId: knowledge.id, termId, source: knowledge.source }));
      continue;
    }
    const target = translation(term, language, warnings, knowledge);
    if (!target) {
      errors.push(issue("error", "TERM_ENGLISH_MISSING", `术语 ${termId} 没有目标语言译法且无法回退英文`, { knowledgeId: knowledge.id, termId, source: knowledge.source }));
      continue;
    }
    const token = addMarker(markers, { kind: "term", value: target, sourceValue, knowledgeId: knowledge.id, termId, occurrences: 0 });
    let count = 0;
    for (const field of FUNCTION_NATURAL_FIELDS) {
      const replaced = replaceLiteral(naturalLanguageFields[field], sourceValue, token);
      naturalLanguageFields[field] = replaced.value;
      count += replaced.count;
    }
    const current = markers.at(-1);
    if (current) current.occurrences = count;
    if (!count) markers.pop();
  }
  const body = Object.entries(naturalLanguageFields).filter(([, value]) => value).map(([field, value]) => `${field}：${value}`).join("\n");
  return { knowledgeId: knowledge.id, body, naturalLanguageFields, technicalFields, markers: markers.filter((marker) => marker.knowledgeId === knowledge.id).map((marker) => marker.marker) };
}

export function prepareTerminologyPipeline(input: { knowledge: TerminologyKnowledge[]; terms: V2TermDefinition[]; targetLanguage: SupportedTermLanguage; branches?: TerminologyBranchInput[] }): PreparedTerminologyPipeline {
  const warnings: TerminologyIssue[] = [];
  const errors: TerminologyIssue[] = [];
  const markers: TermMarker[] = [];
  const catalog = buildCatalog(input.terms, errors);
  const knowledge = [...input.knowledge].sort((a, b) => a.id.localeCompare(b.id)).map((item): PreparedKnowledge => {
    for (const termId of item.termIds) if (!catalog.has(termId)) errors.push(issue("error", "TERM_ID_UNKNOWN", `知识引用不存在的 term_id：${termId}`, { knowledgeId: item.id, termId, source: item.source }));
    if (item.type === "function") return prepareFunction(item, catalog, input.targetLanguage, markers, warnings, errors);
    const body = prepareFaq(item, catalog, input.targetLanguage, markers, warnings, errors);
    return { knowledgeId: item.id, body, naturalLanguageFields: { body }, technicalFields: {}, markers: markers.filter((marker) => marker.knowledgeId === item.id).map((marker) => marker.marker) };
  });
  const knownKnowledgeIds = new Set(knowledge.map((item) => item.knowledgeId));
  const branches = (input.branches ?? []).map((branch) => ({ ...branch, knowledgeIds: [...new Set(branch.knowledgeIds)].filter((id) => knownKnowledgeIds.has(id)).sort() }));
  const uniqueTermIds = new Set(input.knowledge.flatMap((item) => item.termIds));
  return {
    ok: errors.length === 0, targetLanguage: input.targetLanguage, knowledge, branches, markers, warnings, errors,
    stats: {
      knowledgeCount: knowledge.length, referencedTermIds: input.knowledge.reduce((sum, item) => sum + item.termIds.length, 0), uniqueTermIds: uniqueTermIds.size,
      termMarkers: markers.filter((marker) => marker.kind === "term").reduce((sum, marker) => sum + marker.occurrences, 0),
      technicalMarkers: markers.filter((marker) => marker.kind === "technical").reduce((sum, marker) => sum + marker.occurrences, 0),
      fallbackTranslations: warnings.filter((item) => item.code === "TERM_TRANSLATION_FALLBACK_EN").length,
    },
  };
}

export function restoreProtectedResponse(response: string, prepared: PreparedTerminologyPipeline, options: { requireAll?: boolean } = {}): RestoreResult {
  const errors: TerminologyIssue[] = [];
  let output = response;
  for (const marker of prepared.markers) {
    const count = output.split(marker.marker).length - 1;
    if (options.requireAll !== false && count < marker.occurrences) errors.push(issue("error", "MARKER_MISSING_OR_MODIFIED", `内部标记丢失或被修改：${marker.marker}`, { knowledgeId: marker.knowledgeId, termId: marker.termId }));
    if (count > marker.occurrences) errors.push(issue("error", "MARKER_DUPLICATED", `内部标记被额外复制：${marker.marker}`, { knowledgeId: marker.knowledgeId, termId: marker.termId }));
  }
  const known = new Set(prepared.markers.map((marker) => marker.marker));
  for (const marker of response.match(INTERNAL_MARKER_PATTERN) ?? []) if (!known.has(marker)) errors.push(issue("error", "MARKER_UNKNOWN", `回复包含未知内部标记：${marker}`));
  if (errors.length) return { ok: false, errors };
  for (const marker of prepared.markers) output = output.split(marker.marker).join(marker.value);
  if (INTERNAL_MARKER_PATTERN.test(output)) errors.push(issue("error", "MARKER_LEAKED", "客户正文仍包含内部标记"));
  return errors.length ? { ok: false, errors } : { ok: true, text: output, errors: [] };
}
