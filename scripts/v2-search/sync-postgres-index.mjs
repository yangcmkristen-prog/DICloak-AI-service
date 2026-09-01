import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { buildEmbeddingText, buildFullText, buildSearchMetadata } from './embedding-text.mjs';
import { getSearchConfig, mayRunMigration } from './config.mjs';
import { OpenAICompatibleEmbeddingProvider } from './providers.mjs';

const config = getSearchConfig();
if (!mayRunMigration(config)) throw new Error('拒绝写入：必须同时配置测试环境、数据库连接，并显式允许 V2 测试 migration/索引写入');
if (!config.provider || !config.model || !config.hasEmbeddingKey) throw new Error('真实 embedding 配置不完整');
if (config.dimensions !== 1536) throw new Error('当前 migration 固定为 1536 维，配置与表结构不一致');

const root = process.cwd();
const knowledge = JSON.parse(await fs.readFile(path.join(root, 'reports/v2-knowledge/knowledge-latest.json'), 'utf8'));
const chunkPayload = JSON.parse(await fs.readFile(path.join(root, 'reports/v2-knowledge/chunks-latest.json'), 'utf8'));
const records = new Map(knowledge.records.map((record) => [record.id, record]));
const chunks = chunkPayload.chunks.filter((chunk) => records.get(chunk.knowledgeId)?.enabled);
const provider = new OpenAICompatibleEmbeddingProvider({ baseUrl: process.env.V2_EMBEDDING_BASE_URL, apiKey: process.env.V2_EMBEDDING_API_KEY, model: config.model, dimensions: config.dimensions });
const version = process.env.V2_INDEX_VERSION ?? `${knowledge.manifestVersion}-${Date.now()}`;
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: config.rejectUnauthorized } });
let versionId; let embedded = 0; let reused = 0; let tokenCount = 0;
const batchSize = 64;
const batches = (items) => Array.from({ length: Math.ceil(items.length / batchSize) }, (_, index) => items.slice(index * batchSize, (index + 1) * batchSize));

await client.connect();
try {
  const created = await client.query(`insert into ${config.schema}.index_versions(version, knowledge_version, provider, model, dimensions, expected_chunks) values ($1,$2,$3,$4,$5,$6) returning id`, [version, knowledge.manifestVersion, provider.name, provider.model, provider.dimensions, chunks.length]);
  versionId = created.rows[0].id;
  const published = await client.query(`select id from ${config.schema}.index_versions where status='published' limit 1`);
  const prior = new Map();
  if (published.rows[0]) {
    const old = await client.query(`select chunk_id, content_hash, embedding::text as embedding from ${config.schema}.chunks where index_version_id=$1`, [published.rows[0].id]);
    for (const row of old.rows) prior.set(row.chunk_id, row);
  }
  const prepared = chunks.map((chunk) => {
    const record = records.get(chunk.knowledgeId);
    const metadata = buildSearchMetadata(record, chunk);
    const old = prior.get(chunk.chunkId);
    return { chunk, embeddingText: buildEmbeddingText(record, chunk), fullText: buildFullText(record, chunk), metadata, vector: old?.content_hash === chunk.contentHash ? old.embedding : null };
  });
  for (const batch of batches(prepared.filter((entry) => !entry.vector))) {
    const result = await provider.embed(batch.map((entry) => entry.embeddingText));
    if (result.vectors.length !== batch.length) throw new Error('批量 embedding 返回数量不正确');
    batch.forEach((entry, index) => { entry.vector = `[${result.vectors[index].join(',')}]`; });
    embedded += batch.length; tokenCount += result.tokenCount;
  }
  reused = prepared.length - embedded;
  for (const batch of batches(prepared)) {
    const rows = batch.map(({ chunk, embeddingText, fullText, metadata, vector }) => ({ chunk_id: chunk.chunkId, knowledge_id: chunk.knowledgeId, ordinal: chunk.ordinal, title: chunk.title, embedding_text: embeddingText, full_text: fullText, embedding: vector, products: metadata.products, knowledge_type: metadata.knowledgeType, enabled: metadata.enabled, knowledge_version: metadata.knowledgeVersion, api_type: metadata.apiType, api_version: metadata.apiVersion, source_language: metadata.sourceLanguage, content_hash: metadata.contentHash, metadata: chunk.metadata, protected_fields: chunk.protectedFields, exact_terms: [...new Set(chunk.protectedFields.map((field) => field.value))] }));
    await client.query('begin');
    await client.query(`insert into ${config.schema}.chunks(index_version_id,chunk_id,knowledge_id,ordinal,title,embedding_text,full_text,embedding,products,knowledge_type,enabled,knowledge_version,api_type,api_version,source_language,content_hash,metadata,protected_fields,exact_terms) select $1,x.chunk_id,x.knowledge_id,x.ordinal,x.title,x.embedding_text,x.full_text,x.embedding::vector,x.products,x.knowledge_type,x.enabled,x.knowledge_version,x.api_type,x.api_version,x.source_language,x.content_hash,x.metadata,x.protected_fields,x.exact_terms from jsonb_to_recordset($2::jsonb) as x(chunk_id text,knowledge_id text,ordinal integer,title text,embedding_text text,full_text text,embedding text,products text[],knowledge_type text,enabled boolean,knowledge_version text,api_type text,api_version text,source_language text,content_hash text,metadata jsonb,protected_fields jsonb,exact_terms text[])`, [versionId, JSON.stringify(rows)]);
    await client.query('commit');
  }
  await client.query(`update ${config.schema}.index_versions set indexed_chunks=$2 where id=$1`, [versionId, chunks.length]);
  await client.query(`select ${config.schema}.publish_index($1)`, [version]);
  console.log(JSON.stringify({ version, total: chunks.length, embedded, reused, failed: 0, tokenCount }));
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  if (versionId) await client.query(`update ${config.schema}.index_versions set status='failed', error_summary=$2 where id=$1`, [versionId, error instanceof Error ? error.message : String(error)]).catch(() => undefined);
  throw error;
} finally { await client.end(); }
