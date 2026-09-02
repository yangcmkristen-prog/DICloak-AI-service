import { sha256, text, unique } from './utils.mjs';

function buildChunk(record, ordinal, semanticPart, title, body, metadata = {}) {
  const chunk = {
    chunkId: `${record.id}#${semanticPart}`,
    knowledgeId: record.id,
    ordinal,
    type: record.type,
    productScope: [...record.productScope],
    title: text(title),
    text: text(body),
    termIds: [...record.termIds],
    metadata: { ...record.metadata, ...metadata, semanticPart },
    protectedFields: record.protectedFields.filter((field) => field.kind === 'term' || text(body).includes(field.value)),
    source: { ...record.source },
    knowledgeVersion: record.knowledgeVersion,
  };
  const hashInput = { ...chunk };
  delete hashInput.source;
  delete hashInput.knowledgeVersion;
  return { ...chunk, contentHash: sha256(hashInput) };
}

function faqText(record) {
  const questions = record.canonicalQuestions.map((item) => `${item.language}: ${item.text}`).join('\n');
  const utterances = record.utterances.length ? `用户问法：\n${record.utterances.join('\n')}` : '';
  return [record.title, questions, utterances, record.body].filter(Boolean).join('\n\n');
}

function functionChunks(record) {
  const metadata = record.metadata;
  const overview = [
    `模块：${text(metadata.module)}`, `页面：${text(metadata.page)}`, `功能名称：${text(metadata.functionName)}`,
    text(metadata.description) ? `说明：${text(metadata.description)}` : '',
    text(metadata.entryPath) ? `入口：${text(metadata.entryPath)}` : '',
    text(metadata.uiLocation) ? `界面位置：${text(metadata.uiLocation)}` : '',
    text(metadata.prerequisites) ? `前置条件：${text(metadata.prerequisites)}` : '',
  ].filter(Boolean).join('\n');
  const chunks = [buildChunk(record, 0, 'overview', `${record.title} · 功能概览`, overview, { boundary: 'function_overview' })];
  if (text(metadata.steps)) {
    const steps = [`功能：${record.title}`, `操作步骤：${text(metadata.steps)}`].join('\n');
    chunks.push(buildChunk(record, 1, 'steps', `${record.title} · 操作步骤`, steps, { boundary: 'complete_steps' }));
  }
  return chunks;
}

export function chunkKnowledge(records) {
  const chunks = [];
  for (const record of records) {
    if (!record.enabled) continue;
    if (record.type === 'function') chunks.push(...functionChunks(record));
    else if (record.type === 'http_api' || record.type === 'local_api') {
      chunks.push(buildChunk(record, 0, 'endpoint', record.title, record.body, {
        boundary: 'endpoint_with_parameters', apiFamily: record.metadata.apiFamily, version: record.metadata.version,
        method: record.metadata.method, endpoint: record.metadata.endpoint,
      }));
    } else if (record.type === 'pricing') {
      chunks.push(buildChunk(record, 0, 'plan-feature', record.title, record.body, { boundary: 'single_plan_feature' }));
    } else if (record.type === 'terminology') {
      chunks.push(buildChunk(record, 0, 'term', record.title, record.body, { boundary: 'single_term' }));
    } else {
      chunks.push(buildChunk(record, 0, 'entry', record.title, faqText(record), { boundary: record.type === 'troubleshooting_flow' ? 'single_flow_node' : 'single_faq' }));
    }
  }
  return chunks;
}

export function validateChunks(records, chunks) {
  const warnings = [];
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const chunkIds = new Set();
  for (const chunk of chunks) {
    const record = recordsById.get(chunk.knowledgeId);
    if (!record) warnings.push({ code: 'CHUNK_RECORD_MISSING', message: `分块引用不存在的知识：${chunk.knowledgeId}`, knowledgeId: chunk.knowledgeId, source: chunk.source });
    if (chunkIds.has(chunk.chunkId)) warnings.push({ code: 'CHUNK_ID_DUPLICATE', message: `分块 ID 重复：${chunk.chunkId}`, knowledgeId: chunk.knowledgeId, source: chunk.source });
    chunkIds.add(chunk.chunkId);
    if (!chunk.text) warnings.push({ code: 'CHUNK_TEXT_EMPTY', message: '分块正文为空', knowledgeId: chunk.knowledgeId, source: chunk.source });
    if (!chunk.productScope.length) warnings.push({ code: 'CHUNK_PRODUCT_EMPTY', message: '分块产品范围为空', knowledgeId: chunk.knowledgeId, source: chunk.source });
    if (record && unique(chunk.productScope).join('|') !== unique(record.productScope).join('|')) warnings.push({ code: 'CHUNK_PRODUCT_CROSSED', message: '分块产品范围与源知识不一致', knowledgeId: chunk.knowledgeId, source: chunk.source });
    if (record && unique(chunk.termIds).join('|') !== unique(record.termIds).join('|')) warnings.push({ code: 'CHUNK_TERM_IDS_CHANGED', message: '分块破坏了源知识 termIds', knowledgeId: chunk.knowledgeId, source: chunk.source });
    if (record && (record.type === 'http_api' || record.type === 'local_api') && chunk.type !== record.type) warnings.push({ code: 'CHUNK_API_TYPE_CROSSED', message: '分块跨越 API 类型', knowledgeId: chunk.knowledgeId, source: chunk.source });
    for (const field of chunk.protectedFields) {
      if (['placeholder', 'method', 'endpoint', 'full_path', 'url'].includes(field.kind) && !chunk.text.includes(field.value)) {
        warnings.push({ code: 'PROTECTED_FIELD_NOT_IN_CHUNK', message: `受保护字段未原样保留：${field.kind} ${field.value}`, knowledgeId: chunk.knowledgeId, source: chunk.source });
      }
    }
  }
  return warnings;
}
