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
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: true } });
let versionId; let embedded = 0; let reused = 0; let tokenCount = 0;

await client.connect();
try {
  await client.query('begin');
  const created = await client.query(`insert into ${config.schema}.index_versions(version, knowledge_version, provider, model, dimensions, expected_chunks) values ($1,$2,$3,$4,$5,$6) returning id`, [version, knowledge.manifestVersion, provider.name, provider.model, provider.dimensions, chunks.length]);
  versionId = created.rows[0].id;
  const published = await client.query(`select id from ${config.schema}.index_versions where status='published' limit 1`);
  for (const chunk of chunks) {
    const record = records.get(chunk.knowledgeId);
    let vector;
    if (published.rows[0]) {
      const old = await client.query(`select embedding::text as embedding from ${config.schema}.chunks where index_version_id=$1 and chunk_id=$2 and content_hash=$3`, [published.rows[0].id, chunk.chunkId, chunk.contentHash]);
      if (old.rows[0]) { vector = old.rows[0].embedding; reused += 1; }
    }
    const embeddingText = buildEmbeddingText(record, chunk);
    if (!vector) { const result = await provider.embed([embeddingText]); vector = `[${result.vectors[0].join(',')}]`; tokenCount += result.tokenCount; embedded += 1; }
    const metadata = buildSearchMetadata(record, chunk);
    await client.query(`insert into ${config.schema}.chunks(index_version_id,chunk_id,knowledge_id,ordinal,title,embedding_text,full_text,embedding,products,knowledge_type,enabled,knowledge_version,api_type,api_version,source_language,content_hash,metadata,protected_fields,exact_terms) values($1,$2,$3,$4,$5,$6,$7,$8::vector,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`, [versionId, chunk.chunkId, chunk.knowledgeId, chunk.ordinal, chunk.title, embeddingText, buildFullText(record, chunk), vector, metadata.products, metadata.knowledgeType, metadata.enabled, metadata.knowledgeVersion, metadata.apiType, metadata.apiVersion, metadata.sourceLanguage, metadata.contentHash, chunk.metadata, chunk.protectedFields, [...new Set(chunk.protectedFields.map((field) => field.value))]]);
  }
  await client.query(`update ${config.schema}.index_versions set indexed_chunks=$2 where id=$1`, [versionId, chunks.length]);
  await client.query('commit');
  await client.query(`select ${config.schema}.publish_index($1)`, [version]);
  console.log(JSON.stringify({ version, total: chunks.length, embedded, reused, failed: 0, tokenCount }));
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  if (versionId) await client.query(`update ${config.schema}.index_versions set status='failed', error_summary=$2 where id=$1`, [versionId, error instanceof Error ? error.message : String(error)]).catch(() => undefined);
  throw error;
} finally { await client.end(); }
