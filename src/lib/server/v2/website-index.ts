import pg from "pg";
import type { KnowledgeBase } from "@/lib/types";
// The production CLI and website publisher intentionally share the same canonical adapters.
import { adaptApi, adaptFaqWorkbook, adaptFunctions, adaptGeneralFaqWorkbook, adaptPricing, adaptTerminology } from "../../../../scripts/v2-knowledge/adapters.mjs";
import { chunkKnowledge, validateChunks } from "../../../../scripts/v2-knowledge/chunker.mjs";
import { buildEmbeddingText, buildFullText, buildSearchMetadata } from "../../../../scripts/v2-search/embedding-text.mjs";

type Row = Record<string, unknown>;
interface StandardRecord { id: string; type: string; enabled: boolean }
interface StandardChunk { chunkId: string; knowledgeId: string; ordinal: number; title: string; text: string; contentHash: string; termIds: string[]; metadata: Record<string, unknown>; protectedFields: Array<{ kind: string; value: string }>; }
interface IndexPreview { sourceUpdatedAt: string | null; total: number; added: number; changed: number; vectorChanged: number; metadataOnly: number; removed: number; unchanged: number; warnings: Array<{ code?: string; message?: string }>; publishedVersion: string | null; buildingVersion: string | null; buildingIndexed: number; buildingExpected: number; failedVersion: string | null; failedError: string | null }
interface IndexVersionStatus { version: string; status: string; created_at: string | Date; indexed_chunks?: number; expected_chunks?: number; error_summary?: string | null }
interface ExistingChunk { chunk_id: string; content_hash: string; embedding_text: string }
const STALE_BUILD_MS = 7 * 60 * 1000;

export function selectActiveBuildingVersion(versions: IndexVersionStatus[], published: IndexVersionStatus | undefined, now = Date.now()): IndexVersionStatus | undefined {
  const publishedAt = published ? new Date(published.created_at).getTime() : Number.NEGATIVE_INFINITY;
  return versions.find((row) => { const createdAt = new Date(row.created_at).getTime(); return row.status === "building" && createdAt > publishedAt && now - createdAt < STALE_BUILD_MS; });
}

export function canReuseEmbedding(previous: ExistingChunk | undefined, embeddingText: string): boolean {
  return Boolean(previous && previous.embedding_text === embeddingText);
}

const rows = (values: Row[]): { sheetNames: string[]; rows: (sheet: string) => Array<{ values: Row; row: number }> } => ({ sheetNames: ["Sheet1"], rows: () => values.map((value, index) => ({ values: value, row: index + 2 })) });
const sheets = (values: Record<string, Row[]>): { sheetNames: string[]; rows: (sheet: string) => Array<{ values: Row; row: number }> } => ({ sheetNames: Object.keys(values), rows: (sheet) => (values[sheet] ?? []).map((value, index) => ({ values: value, row: index + 2 })) });
const product = (value: string): string => value === "all" ? "dicloak,paraturbo" : value;

function faqRow(item: KnowledgeBase["faqItems"][number]): Row { return { FAQ_ID: item.faqId || item.id, "一级分类": item.category1, "二级分类": item.category2, "标签": item.tags.join(","), "标准问题（中文）": item.questionCN, "标准问题（英文）": item.questionEN, "用户问法": item.userPhrases, "标准答案": item.answer, function_id: item.functionId, term_id: item.termIds?.join(","), "优先级": item.priority }; }
function generalFaqRow(item: KnowledgeBase["faqItems"][number]): Row { return { FAQ_ID: item.faqId || item.id, "问题": item.questionCN || item.questionEN || item.userPhrases, "答案": item.answer, "语言": item.language || (item.questionCN ? 'zh' : 'en'), "产品": item.supportedProduct || 'all', "是否启用": item.enabled !== false, "问题类型": item.problemType || item.category2, "新分类": item.category1 }; }

export function buildWebsiteKnowledge(knowledge: KnowledgeBase, version: string): { records: StandardRecord[]; chunks: StandardChunk[]; warnings: Array<{ code?: string; message?: string }> } {
  const warnings: Array<{ code?: string; message?: string }> = [];
  const regularFaq = knowledge.faqItems.filter((item) => item.source === "feature_faq").map(faqRow);
  const generalFaq = knowledge.faqItems.filter((item) => item.source === "general_faq").map(generalFaqRow);
  const routing = knowledge.faqItems.filter((item) => item.source === "user_routing").map(faqRow);
  const troubleshooting = knowledge.troubleshootingItems.map((item) => ({ ...faqRow(item), "标准答案（通用）": item.answer, "标准答案（client）": item.answerClient, "标准答案（end_user）": item.answerEndUser, "用户问法（英文）": item.userPhrases }));
  const outOfScope = knowledge.outOfScopeItems.map((item) => ({ ...faqRow(item), "标准答案（英文）": item.answer, sub_type: item.subType, "匹配规则": item.matchRule }));
  const flow = knowledge.troubleshootingFlowItems.map((item) => ({ FLOW_ID: item.flowId, FLOW_NAME: item.flowName, NODE_ID: item.nodeId, NODE_NAME: item.nodeName, NODE_TYPE: item.nodeType, "标准问题（中文）": item.questionCN, "用户问法": item.userPhrases, "标签": item.tags.join(","), "是否启用": item.enabled, PREREQUISITES: item.prerequisites, QUESTION: item.question, COLLECT_FIELD: item.collectField, MATCH_VALUE: item.matchValue, MATCH_KEYWORDS: item.matchKeywords, NEXT_NODE_ID: item.nextNodeId, SOLUTION: item.solution }));
  const faqWorkbook = sheets({ feature_faq: regularFaq, troubleshooting, user_routing: routing, out_of_scope: outOfScope, troubleshooting_flow: flow });
  const generalFaqWorkbook = rows(generalFaq);
  const terms = rows(knowledge.termItems.map((item) => ({ term_id: item.termId || item.id, "一级模块": item.module1, "二级模块": item.module2, "中文": item.termCN, "英文": item.termEN, "俄语": item.termRU, "葡萄牙语（巴西）": item.termPT, "西班牙语": item.termES, "越南语": item.termVI, "术语类型": item.termType, "定义说明": item.definition, is_ui_visible: item.isUiVisible })));
  const functions = rows(knowledge.functionKnowledge.map((item) => ({
    function_id: item.functionId || item.id,
    "一级模块": item.module1, "页面名称": item.pageName, "功能类型": item.functionType, "功能点名称": item.functionName,
    "功能说明": item.description, "入口路径": item.entryPath, "界面位置": item.uiPosition, "前置条件": item.prerequisites, "操作步骤": item.steps, "标准组织答案": item.standardAnswer,
    "常见问题FAQ_ID": item.faqIds, "关键词（中文）": item.keywordsCN, "关键词（英文）": item.keywordsEN,
    "一级模块术语ID": item.moduleTermIds, "页面名称术语ID": item.pageTermIds, "功能点术语ID": item.functionTermIds,
    "术语匹配词": item.termMatchWords, "是否高频": item.isHighFrequency, "备注": item.notes, "已支持产品": product(item.supportedProduct),
  })));
  const endpointRows = knowledge.apiEndpoints.map((item) => ({
    api_id: item.apiId || item.id, "API类型": item.apiType, "已支持产品": product(item.supportedProduct), "检索关键词": item.searchKeywords,
    "请求方法": item.method, "端点路径": item.endpoint, "完整路径规则": item.fullpathRule, "鉴权方式": item.authMethod,
    "请求参数位置": item.paramLocation, "是否需要env_id": item.needsEnvId, "主要用途": item.description,
    "成功响应核心字段": item.responseFields, "备注": item.remark, "接口模块": item.module, "功能": item.apiName, "是否支持": item.isSupported,
  }));
  const parameterRows = knowledge.apiParameters.map((item) => ({ api_id: item.apiId, "API类型": item.apiType, "接口模块": item.module, "功能": item.functionName, "请求方法": item.method, "端点路径": item.endpoint, "参数位置": item.paramLocation, "参数名": item.paramName, "数据类型": item.paramType, "是否必填": item.isRequired, "说明": item.description, "可选值/示例": item.example, "适用场景": item.validationRule, "备注": item.remark }));
  const api = sheets({ "API 端点总表": endpointRows, "API 参数明细表": parameterRows });
  const pricing = rows(knowledge.pricingRawTable?.rows ?? []);
  const records = [
    ...adaptFaqWorkbook({ workbook: faqWorkbook, file: "website", version, warnings }), ...adaptGeneralFaqWorkbook({ workbook: generalFaqWorkbook, file: "website-general-faq", version, warnings }), ...adaptTerminology({ workbook: terms, file: "website", version, warnings }),
    ...adaptFunctions({ workbook: functions, file: "website", version, warnings }), ...adaptApi({ workbook: api, file: "website", version, warnings }),
    ...adaptPricing({ workbook: pricing, file: "website", version, warnings }),
  ] as StandardRecord[];
  const chunks = chunkKnowledge(records) as StandardChunk[];
  warnings.push(...validateChunks(records, chunks));
  return { records, chunks, warnings };
}

function databaseConfig(): { connectionString: string; rejectUnauthorized: boolean; schema: string } {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error("SUPABASE_DB_URL 未配置");
  return { connectionString, rejectUnauthorized: process.env.SUPABASE_DB_SSL_REJECT_UNAUTHORIZED !== "false", schema: process.env.V2_SEARCH_SCHEMA || "v2_search" };
}

export async function expireStaleWebsiteBuilds(): Promise<void> {
  const config = databaseConfig(); const client = new pg.Client({ connectionString: config.connectionString, ssl: { rejectUnauthorized: config.rejectUnauthorized } });
  await client.connect();
  try { await client.query(`update ${config.schema}.index_versions set status='failed',error_summary='PUBLISH_TIMEOUT' where status='building' and version like 'website-%' and created_at < now() - interval '7 minutes'`); }
  finally { await client.end(); }
}

export async function previewWebsiteIndex(knowledge: KnowledgeBase, sourceUpdatedAt: string | null): Promise<IndexPreview> {
  const built = buildWebsiteKnowledge(knowledge, sourceUpdatedAt || new Date().toISOString());
  const config = databaseConfig(); const client = new pg.Client({ connectionString: config.connectionString, ssl: { rejectUnauthorized: config.rejectUnauthorized } });
  await client.connect();
  try {
    const versions = await client.query<IndexVersionStatus>(`select version,status,created_at,indexed_chunks,expected_chunks,error_summary from ${config.schema}.index_versions where status in ('published','building') or (status='failed' and version like 'website-%') order by created_at desc`);
    const published = versions.rows.find((row) => row.status === "published"); const building = selectActiveBuildingVersion(versions.rows, published); const failed = versions.rows.find((row) => row.status === "failed");
    const old = published ? await client.query<ExistingChunk>(`select chunk_id,content_hash,embedding_text from ${config.schema}.chunks where index_version_id=(select id from ${config.schema}.index_versions where version=$1)`, [published.version]) : { rows: [] as ExistingChunk[] };
    const oldChunks = new Map(old.rows.map((row) => [row.chunk_id, row])); const nextIds = new Set(built.chunks.map((chunk) => chunk.chunkId)); const records = new Map(built.records.map((record) => [record.id, record]));
    const added = built.chunks.filter((chunk) => !oldChunks.has(chunk.chunkId)).length; const changedChunks = built.chunks.filter((chunk) => oldChunks.has(chunk.chunkId) && oldChunks.get(chunk.chunkId)?.content_hash !== chunk.contentHash);
    const metadataOnly = changedChunks.filter((chunk) => canReuseEmbedding(oldChunks.get(chunk.chunkId), buildEmbeddingText(records.get(chunk.knowledgeId), chunk))).length; const vectorChanged = changedChunks.length - metadataOnly;
    return { sourceUpdatedAt, total: built.chunks.length, added, changed: changedChunks.length, vectorChanged, metadataOnly, removed: [...oldChunks.keys()].filter((id) => !nextIds.has(id)).length, unchanged: built.chunks.length - added - changedChunks.length, warnings: built.warnings, publishedVersion: published?.version ?? null, buildingVersion: building?.version ?? null, buildingIndexed: building?.indexed_chunks ?? 0, buildingExpected: building?.expected_chunks ?? 0, failedVersion: failed?.version ?? null, failedError: failed?.error_summary ?? null };
  } finally { await client.end(); }
}

export async function publishWebsiteIndex(knowledge: KnowledgeBase, sourceUpdatedAt: string | null, version: string): Promise<void> {
  const built = buildWebsiteKnowledge(knowledge, sourceUpdatedAt || version); if (built.warnings.length) throw new Error(`知识检查失败：${built.warnings.map((item) => item.code).join(",")}`);
  const config = databaseConfig(); const baseUrl = process.env.V2_EMBEDDING_BASE_URL?.replace(/\/$/, ""); const apiKey = process.env.V2_EMBEDDING_API_KEY; const model = process.env.V2_EMBEDDING_MODEL || "text-embedding-3-small";
  if (!baseUrl || !apiKey) throw new Error("V2 embedding 配置不完整");
  const client = new pg.Client({ connectionString: config.connectionString, ssl: { rejectUnauthorized: config.rejectUnauthorized } }); let versionId: string | null = null;
  await client.connect();
  try {
    const locked = await client.query("select pg_try_advisory_lock(hashtext('diclok-v2-index-publish')) locked"); if (!locked.rows[0]?.locked) throw new Error("已有 V2 索引正在发布");
    const current = await client.query(`select id from ${config.schema}.index_versions where status='published' limit 1`); const oldId = current.rows[0]?.id ?? null;
    const resumable = await client.query(`select id from ${config.schema}.index_versions where status='failed' and error_summary='PUBLISH_TIMEOUT' and version like 'website-%' order by created_at desc limit 1`); const resumeId = resumable.rows[0]?.id ?? null;
    const created = await client.query(`insert into ${config.schema}.index_versions(version,knowledge_version,provider,model,dimensions,expected_chunks) values($1,$2,'openai-compatible',$3,1536,$4) returning id`, [version, sourceUpdatedAt || version, model, built.chunks.length]); versionId = created.rows[0].id;
    const old = oldId ? await client.query<ExistingChunk>(`select chunk_id,content_hash,embedding_text from ${config.schema}.chunks where index_version_id=$1`, [oldId]) : { rows: [] as ExistingChunk[] };
    const resumed = resumeId ? await client.query<ExistingChunk>(`select chunk_id,content_hash,embedding_text from ${config.schema}.chunks where index_version_id=$1`, [resumeId]) : { rows: [] as ExistingChunk[] }; const oldChunks = new Map(old.rows.map((row) => [row.chunk_id, row])); for (const row of resumed.rows) oldChunks.set(row.chunk_id, row);
    const records = new Map(built.records.map((record) => [record.id, record])); const prepared = built.chunks.map((chunk) => { const record = records.get(chunk.knowledgeId); const embeddingText = buildEmbeddingText(record, chunk); return { chunk, embeddingText, fullText: buildFullText(record, chunk), metadata: buildSearchMetadata(record, chunk), reused: canReuseEmbedding(oldChunks.get(chunk.chunkId), embeddingText), vector: null as number[] | null }; });
    for (let offset = 0; offset < prepared.length; offset += 256) {
      const batch = prepared.slice(offset, offset + 256); const changed = batch.filter((item) => !item.reused);
      for (let embeddingOffset = 0; embeddingOffset < changed.length; embeddingOffset += 64) { const embeddingBatch = changed.slice(embeddingOffset, embeddingOffset + 64); const response = await fetch(`${baseUrl}/embeddings`, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model, input: embeddingBatch.map((item) => item.embeddingText), dimensions: 1536 }) }); if (!response.ok) throw new Error(`Embedding HTTP ${response.status}`); const payload = await response.json() as { data?: Array<{ embedding?: number[] }> }; if (payload.data?.length !== embeddingBatch.length) throw new Error("Embedding 返回数量不正确"); embeddingBatch.forEach((item, index) => { item.vector = payload.data?.[index]?.embedding ?? null; }); }
      const values = batch.map(({ chunk, embeddingText, fullText, metadata, vector }) => ({ chunk_id: chunk.chunkId, knowledge_id: chunk.knowledgeId, ordinal: chunk.ordinal, title: chunk.title, embedding_text: embeddingText, full_text: fullText, embedding: vector ? `[${vector.join(",")}]` : null, products: metadata.products, knowledge_type: metadata.knowledgeType, enabled: metadata.enabled, knowledge_version: sourceUpdatedAt || version, api_type: metadata.apiType, api_version: metadata.apiVersion, source_language: metadata.sourceLanguage, content_hash: metadata.contentHash, metadata: { ...chunk.metadata, termIds: chunk.termIds }, protected_fields: chunk.protectedFields, exact_terms: [...new Set(chunk.protectedFields.map((field) => field.value))] }));
      await client.query(`insert into ${config.schema}.chunks(index_version_id,chunk_id,knowledge_id,ordinal,title,embedding_text,full_text,embedding,products,knowledge_type,enabled,knowledge_version,api_type,api_version,source_language,content_hash,metadata,protected_fields,exact_terms) select $1,x.chunk_id,x.knowledge_id,x.ordinal,x.title,x.embedding_text,x.full_text,coalesce(x.embedding::vector,resume.embedding,old.embedding),x.products,x.knowledge_type,x.enabled,x.knowledge_version,x.api_type,x.api_version,x.source_language,x.content_hash,x.metadata,x.protected_fields,x.exact_terms from jsonb_to_recordset($2::jsonb) as x(chunk_id text,knowledge_id text,ordinal integer,title text,embedding_text text,full_text text,embedding text,products text[],knowledge_type text,enabled boolean,knowledge_version text,api_type text,api_version text,source_language text,content_hash text,metadata jsonb,protected_fields jsonb,exact_terms text[]) left join ${config.schema}.chunks old on old.index_version_id=$3 and old.chunk_id=x.chunk_id and old.embedding_text=x.embedding_text left join ${config.schema}.chunks resume on resume.index_version_id=$4 and resume.chunk_id=x.chunk_id and resume.embedding_text=x.embedding_text`, [versionId, JSON.stringify(values), oldId, resumeId]);
      await client.query(`update ${config.schema}.index_versions set indexed_chunks=$2 where id=$1`, [versionId, Math.min(offset + batch.length, prepared.length)]);
    }
    await client.query(`select ${config.schema}.publish_index($1)`, [version]);
  } catch (error) { if (versionId) await client.query(`update ${config.schema}.index_versions set status='failed',error_summary=$2 where id=$1`, [versionId, error instanceof Error ? error.message : String(error)]).catch(() => undefined); throw error; }
  finally { await client.query("select pg_advisory_unlock(hashtext('diclok-v2-index-publish'))").catch(() => undefined); await client.end(); }
}
