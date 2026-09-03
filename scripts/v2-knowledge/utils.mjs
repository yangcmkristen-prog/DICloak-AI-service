import crypto from 'node:crypto';

export const text = (value) => String(value ?? '').trim();
export const compact = (values) => values.map(text).filter(Boolean);
export const unique = (values) => [...new Set(compact(values))];
export const splitList = (value) => unique(text(value).split(/[,，、;；\n\r]+/));
export const splitUtterances = (value) => unique(text(value).split(/(?:\r?\n|；|;)+/).map((item) => item.replace(/^\s*\d+[.)、]\s*/, '')));

export function parseEnabled(value, fallback = true) {
  const normalized = text(value).toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', '是', '启用', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', '否', '禁用', 'disabled'].includes(normalized)) return false;
  return fallback;
}

export function normalizeProductScope(value, fallback = ['dicloak']) {
  const normalized = text(value).toLowerCase();
  if (!normalized) return [...fallback];
  if (['all', '全部', '通用'].includes(normalized)) return ['dicloak', 'paraturbo'];
  const products = [];
  if (normalized.includes('dicloak')) products.push('dicloak');
  if (normalized.includes('paraturbo')) products.push('paraturbo');
  return products.length ? products : [...fallback];
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
  }
  return value;
}

export function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(sortObject(value))).digest('hex');
}

export function source(file, sheet, row) {
  return { file, sheet, row };
}

export function protectedField(kind, value, sourceColumn) {
  const normalized = text(value);
  return normalized ? { kind, value: normalized, ...(sourceColumn ? { sourceColumn } : {}) } : null;
}

export function uniqueProtectedFields(fields) {
  const seen = new Set();
  return fields.filter(Boolean).filter((field) => {
    const key = `${field.kind}\u0000${field.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractTextProtectedFields(value, sourceColumn) {
  const input = text(value);
  const fields = [];
  for (const match of input.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) fields.push(protectedField('placeholder', match[0], sourceColumn));
  for (const match of input.matchAll(/https?:\/\/[^\s<>"')\]，。；：）】]+/g)) fields.push(protectedField('url', match[0].replace(/[.,;:]$/, ''), sourceColumn));
  for (const match of input.matchAll(/```[\s\S]*?```|`[^`\r\n]+`/g)) fields.push(protectedField('code', match[0], sourceColumn));
  for (const match of input.matchAll(/\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) fields.push(protectedField('method', match[0], sourceColumn));
  for (const match of input.matchAll(/\/(?:openapi\/)?v\d+(?:\/[A-Za-z0-9_.{}:-]+)+/g)) fields.push(protectedField('endpoint', match[0], sourceColumn));
  for (const match of input.matchAll(/\b[vV]\d+(?:\.\d+){0,3}\b/g)) fields.push(protectedField('version', match[0], sourceColumn));
  for (const match of input.matchAll(/(?:[$€£¥￥]\s?\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s?(?:USD|EUR|CNY|RMB))\b/gi)) fields.push(protectedField('price', match[0], sourceColumn));
  for (const match of input.matchAll(/\b(?:DICloak|ParaTurbo)\b/gi)) fields.push(protectedField('product', match[0], sourceColumn));
  for (const match of input.matchAll(/"([A-Za-z_][A-Za-z0-9_.-]*)"\s*:/g)) fields.push(protectedField('json_key', match[1], sourceColumn));
  for (const match of input.matchAll(/\b\d+(?:\.\d+)?\b/g)) fields.push(protectedField('number', match[0], sourceColumn));
  return uniqueProtectedFields(fields);
}

export function createRecord(input) {
  const record = {
    id: text(input.id),
    type: input.type,
    productScope: unique(input.productScope),
    enabled: Boolean(input.enabled),
    sourceLanguage: text(input.sourceLanguage),
    title: text(input.title),
    canonicalQuestions: input.canonicalQuestions.filter((item) => text(item.text)).map((item) => ({ language: text(item.language), text: text(item.text) })),
    utterances: unique(input.utterances),
    body: text(input.body),
    termIds: unique(input.termIds),
    tags: unique(input.tags),
    metadata: input.metadata,
    protectedFields: uniqueProtectedFields(input.protectedFields),
    source: input.source,
    knowledgeVersion: input.knowledgeVersion,
  };
  const hashInput = { ...record };
  delete hashInput.source;
  delete hashInput.knowledgeVersion;
  return { ...record, contentHash: sha256(hashInput) };
}

export function valuesBody(sections) {
  return sections.filter(([, value]) => text(value)).map(([label, value]) => `${label}：${text(value)}`).join('\n');
}

export function apiFamily(value) {
  return /^http api$/i.test(text(value)) ? 'http_api' : /^local api/i.test(text(value)) ? 'local_api' : null;
}

export function apiVersion(apiType, endpoint) {
  const explicit = text(apiType).match(/\bV(\d+)\b/i)?.[1];
  const fromPath = text(endpoint).match(/\/(?:openapi\/)?v(\d+)\b/i)?.[1];
  return explicit ? `v${explicit}` : fromPath ? `v${fromPath}` : 'unspecified';
}

export function endpointKey(values) {
  return [values['API类型'], values['请求方法'], values['端点路径']].map((value) => text(value).toLowerCase()).join('|');
}
