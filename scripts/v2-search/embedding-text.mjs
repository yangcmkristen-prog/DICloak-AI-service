import { text, unique } from '../v2-knowledge/utils.mjs';

const lines = (...values) => values.flat().map(text).filter(Boolean);
const namedValues = (values) => Array.isArray(values) ? values.flatMap((value) => typeof value === 'object' && value !== null ? Object.values(value).flatMap((item) => Array.isArray(item) ? item : [item]) : [value]) : values;

export function buildSearchMetadata(record, chunk) {
  const apiType = chunk.type === 'http_api' ? 'http' : chunk.type === 'local_api' ? 'local' : null;
  return {
    products: [...chunk.productScope], knowledgeType: chunk.type, enabled: record.enabled,
    knowledgeVersion: chunk.knowledgeVersion, apiType,
    apiVersion: apiType ? text(chunk.metadata.version) || null : null,
    sourceLanguage: record.sourceLanguage, contentHash: chunk.contentHash,
  };
}

export function buildEmbeddingText(record, chunk) {
  const metadata = chunk.metadata;
  const common = lines(chunk.title, chunk.text, record.canonicalQuestions.map((item) => item.text), record.utterances, record.tags);
  if (chunk.type === 'function') common.push(...lines(metadata.functionName, metadata.module, metadata.page, metadata.keywordsZh, metadata.keywordsEn, metadata.uiLocation));
  if (chunk.type === 'http_api' || chunk.type === 'local_api') common.push(...lines(metadata.apiFamily, metadata.version, metadata.method, metadata.endpoint, namedValues(metadata.parameters), metadata.errorCodes));
  if (chunk.type === 'pricing') common.push(...lines(metadata.planName, metadata.planKey, metadata.feature, metadata.value));
  if (chunk.type === 'terminology') common.push(...lines(record.termIds));
  return unique(common).join('\n');
}

export function buildFullText(record, chunk) {
  const exact = chunk.protectedFields.map((field) => field.value);
  return unique(lines(buildEmbeddingText(record, chunk), exact, record.tags, record.utterances)).join('\n');
}
