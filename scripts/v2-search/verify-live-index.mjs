import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { getSearchConfig, mayRunMigration } from './config.mjs';
import { OpenAICompatibleEmbeddingProvider } from './providers.mjs';

const config = getSearchConfig();
if (!mayRunMigration(config)) throw new Error('拒绝真实检索：仅允许配置完整且显式授权的测试环境');
const provider = new OpenAICompatibleEmbeddingProvider({ baseUrl: process.env.V2_EMBEDDING_BASE_URL, apiKey: process.env.V2_EMBEDDING_API_KEY, model: config.model, dimensions: config.dimensions });
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: config.rejectUnauthorized } });
const started = performance.now(); let tokenCount = 0;
const queries = [
  { language: 'zh', query: '如何创建浏览器配置文件？' },
  { language: 'en', query: 'How do I create a browser profile?' },
  { language: 'pt', query: 'Como criar um perfil de navegador?' },
  { language: 'ru', query: 'Как создать профиль браузера?' },
];

await client.connect();
try {
  const published = await client.query(`select id,version,knowledge_version,indexed_chunks,failed_chunks,published_at from ${config.schema}.index_versions where status='published' limit 1`);
  if (!published.rows[0]) throw new Error('没有已发布的测试索引');
  const semantic = [];
  for (const probe of queries) {
    const embedded = await provider.embed([probe.query]); tokenCount += embedded.tokenCount;
    const vector = `[${embedded.vectors[0].join(',')}]`;
    const matches = await client.query(`select * from ${config.schema}.search_chunks($1::vector,$2,$3,$4,$5)`, [vector, probe.query, 5, 'dicloak', null]);
    semantic.push({ ...probe, matches: matches.rows.map((row) => ({ chunkId: row.chunk_id, knowledgeId: row.knowledge_id, title: row.title, semanticScore: Number(row.semantic_score), textRank: Number(row.text_rank) })) });
  }
  const protectedValue = await client.query(`select distinct on (field->>'kind') field->>'kind' as kind,field->>'value' as value from ${config.schema}.chunks c join ${config.schema}.index_versions v on v.id=c.index_version_id cross join lateral jsonb_array_elements(c.protected_fields) field where v.status='published' and field->>'kind' in ('endpoint','method') order by field->>'kind',c.chunk_id`);
  const exact = [];
  for (const item of protectedValue.rows) {
    const matches = await client.query(`select * from ${config.schema}.search_exact_chunks($1,$2,$3,$4)`, [item.value, 5, null, null]);
    exact.push({ kind: item.kind, value: item.value, matches: matches.rows.map((row) => ({ chunkId: row.chunk_id, knowledgeId: row.knowledge_id, title: row.title })) });
  }
  const report = { generatedAt: new Date().toISOString(), mode: 'live-test', realIndexExecuted: true, index: published.rows[0], stats: { queries: queries.length, embeddingCalls: provider.calls, embeddingTokens: tokenCount, milliseconds: Math.round(performance.now() - started) }, semantic, exact };
  const output = path.join(process.cwd(), 'reports', 'v2-index'); await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'live-latest.json'), `${JSON.stringify(report, null, 2)}\n`);
  const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>V2 真实测试索引报告</title><style>body{font:14px system-ui;margin:32px;color:#17333c}table{border-collapse:collapse;width:100%;margin-bottom:28px}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}</style><h1>V2 真实测试索引报告</h1><p>索引版本：${escape(report.index.version)}；分块：${report.index.indexed_chunks}；查询 embedding：${report.stats.embeddingCalls} 次 / ${report.stats.embeddingTokens} tokens。</p>${semantic.map((probe) => `<h2>${escape(probe.language)} · ${escape(probe.query)}</h2><table><tr><th>排名</th><th>知识</th><th>标题</th><th>语义分数</th></tr>${probe.matches.map((match, index) => `<tr><td>${index + 1}</td><td>${escape(match.chunkId)}</td><td>${escape(match.title)}</td><td>${match.semanticScore.toFixed(4)}</td></tr>`).join('')}</table>`).join('')}<h2>精确技术字段</h2><table><tr><th>类型</th><th>原值</th><th>命中</th></tr>${exact.map((probe) => `<tr><td>${escape(probe.kind)}</td><td>${escape(probe.value)}</td><td>${probe.matches.map((match) => escape(match.chunkId)).join('<br>')}</td></tr>`).join('')}</table></html>`;
  await fs.writeFile(path.join(output, 'live-latest.html'), html);
  console.log(JSON.stringify({ version: report.index.version, indexedChunks: report.index.indexed_chunks, failedChunks: report.index.failed_chunks, queries: report.stats.queries, embeddingCalls: report.stats.embeddingCalls, embeddingTokens: report.stats.embeddingTokens, milliseconds: report.stats.milliseconds, topMatches: Object.fromEntries(semantic.map((probe) => [probe.language, probe.matches[0]?.chunkId ?? null])), exactChecks: exact.map((probe) => ({ kind: probe.kind, value: probe.value, matches: probe.matches.length })) }, null, 2));
} finally {
  await client.end();
}
