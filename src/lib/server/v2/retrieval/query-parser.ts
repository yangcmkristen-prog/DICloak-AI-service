import type { QueryIntent } from "./types.ts";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function detectLanguage(question: string): string {
  if (/\p{Script=Han}/u.test(question)) return "zh";
  if (/\p{Script=Cyrillic}/u.test(question)) return "ru";
  if (/\b(como|perfil|navegador|plano|preço|api local)\b/i.test(question)) return "pt";
  return "en";
}

export function parseQuery(question: string, requestedProduct: "dicloak" | "paraturbo" = "dicloak"): QueryIntent {
  const normalized = question.trim();
  const upper = normalized.toUpperCase();
  const product = /\bparaturbo\b/i.test(normalized) ? "paraturbo" : /\bdicloak\b/i.test(normalized) ? "dicloak" : requestedProduct;
  const localApi = /\b(local api|api local)\b|本地\s*API|localhost|127\.0\.0\.1/i.test(normalized);
  const httpApi = /\b(http api|open api|remote api|http)\b|HTTP\s*接口|开放\s*API|云端\s*API/i.test(normalized);
  const apiType = localApi ? "local" : httpApi ? "http" : null;
  const apiVersion = normalized.match(/(?:^|[\s/])(v\d+)(?:\b|\/)/i)?.[1]?.toLowerCase() ?? null;
  const method = METHODS.find((value) => new RegExp(`\\b${value}\\b`, "i").test(upper)) ?? null;
  const pricing = /套餐|价格|费用|配额|plan|pricing|price|quota|preço/i.test(normalized);
  const knowledgeTypes = apiType ? [apiType === "http" ? "http_api" : "local_api"] : pricing ? ["pricing"] : [];
  const objectMatch = normalized.match(/(?:对象|object)\s*[:：]?\s*([\w-]+)/i);
  const actionMatch = normalized.match(/(?:动作|action)\s*[:：]?\s*([\w-]+)/i);
  const missingConditions = [];
  if (/\bAPI\b|接口/i.test(normalized)) {
    if (!apiType) missingConditions.push("apiType");
    if (!method) missingConditions.push("method");
  }
  const vagueFailure = /^(?:不让我|无法|不能|打不开|我想要访问链接)|\b(?:not working|can't open|cannot open|disabled)\b|无法正常工作/i.test(normalized);
  const hasSpecificEvidence = /["“”]|\b(?:error|code|status|HTTP|API)\b|错误码|提示|显示|返回|失败/i.test(normalized);
  if (vagueFailure && !hasSpecificEvidence) missingConditions.push("symptomDetails");
  return { product, language: detectLanguage(normalized), knowledgeTypes, apiType, apiVersion, method, object: objectMatch?.[1] ?? null, action: actionMatch?.[1] ?? null, missingConditions };
}
