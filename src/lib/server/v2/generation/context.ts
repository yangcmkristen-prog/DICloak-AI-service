import type { RetrievalCandidate, RetrievalTrace } from "../retrieval/types.ts";

const STRATEGY_LIMITS: Record<RetrievalTrace["responseStrategy"], number> = {
  direct: 3,
  aggregated: 5,
  conditional: 3,
  answer_then_clarify: 4,
  clarify_only: 0,
  unsupported: 2,
};

const stringValue = (value: unknown): string => typeof value === "string" ? value.trim() : "";

function asksForParameters(question: string): boolean {
  return /参数|字段|请求体|响应|body|query|parameter|field|response|request/i.test(question);
}

function compactApi(candidate: RetrievalCandidate, question: string): string {
  const metadata = candidate.metadata;
  const lines = [
    candidate.title,
    `API 类型：${stringValue(metadata.apiType) || (candidate.apiType === "http" ? "HTTP API" : "Local API")}`,
    `版本：${stringValue(metadata.version) || candidate.apiVersion || ""}`,
    `Method：${stringValue(metadata.method)}`,
    `Endpoint：${stringValue(metadata.endpoint)}`,
    `Full Path：${stringValue(metadata.fullPath)}`,
    `对象：${stringValue(metadata.object)}`,
    `动作：${stringValue(metadata.action)}`,
    `鉴权：${stringValue(metadata.authentication)}`,
    `请求参数位置：${stringValue(metadata.requestLocation)}`,
  ].filter((line) => !line.endsWith("："));

  const semanticLines = candidate.text.split(/\r?\n/).filter((line) => /^(用途|说明|备注|支持|不支持|文档)[：:]/.test(line)).slice(0, 4);
  lines.push(...semanticLines);

  const fullPath = stringValue(metadata.fullPath);
  const usefulLinks = [...new Set((candidate.protectedFields ?? []).filter((field) => field.kind === "url" && field.value !== fullPath).map((field) => field.value))];
  lines.push(...usefulLinks.map((link) => `帮助链接：${link}`));

  if (Array.isArray(metadata.parameters)) {
    const includeAll = asksForParameters(question);
    const normalizedQuestion = question.toLocaleLowerCase("en-US");
    const mentionsAnyParameter = metadata.parameters.some((item) => item && typeof item === "object" && normalizedQuestion.includes(stringValue((item as Record<string, unknown>).name).toLocaleLowerCase("en-US")));
    const parameters = metadata.parameters.filter((item) => {
      if (!item || typeof item !== "object") return false;
      const parameter = item as Record<string, unknown>;
      const name = stringValue(parameter.name);
      return includeAll || (mentionsAnyParameter && ((name && normalizedQuestion.includes(name.toLocaleLowerCase("en-US"))) || /^(是|true|required)$/i.test(stringValue(parameter.required))));
    }).slice(0, 30).flatMap((item): string[] => {
      if (!item || typeof item !== "object") return [];
      const parameter = item as Record<string, unknown>;
      const name = stringValue(parameter.name);
      if (!name) return [];
      return [`参数：${stringValue(parameter.location)} ${name} (${stringValue(parameter.dataType)}, ${stringValue(parameter.required)})：${stringValue(parameter.description)}`];
    });
    if (parameters.length) lines.push(...parameters);
  }
  return lines.join("\n");
}

export function selectGenerationKnowledge(trace: RetrievalTrace, question: string): RetrievalCandidate[] {
  const limit = STRATEGY_LIMITS[trace.responseStrategy];
  const candidates = trace.selectedKnowledge.some((candidate) => candidate.knowledgeType === "pricing") ? trace.selectedKnowledge : trace.selectedKnowledge.slice(0, limit);
  return candidates.map((candidate) => {
    if (candidate.knowledgeType === "pricing") {
      const plan = stringValue(candidate.metadata.planName) || stringValue(candidate.metadata.planKey);
      const feature = stringValue(candidate.metadata.feature);
      const rawValue = candidate.metadata.value;
      const value = typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "boolean" ? String(rawValue) : "";
      return { ...candidate, text: `${plan} · ${feature}：${value}`, protectedFields: (candidate.protectedFields ?? []).filter((field) => value.includes(field.value)) };
    }
    const isApi = candidate.knowledgeType.includes("api") || candidate.apiType !== null;
    if (!isApi) return candidate;
    const compactText = compactApi(candidate, question);
    const presentProtectedFields = (candidate.protectedFields ?? []).filter((field) => compactText.includes(field.value));
    return { ...candidate, text: compactText, protectedFields: presentProtectedFields };
  });
}
