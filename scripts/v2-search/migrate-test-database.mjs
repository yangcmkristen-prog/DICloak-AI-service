import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { getSearchConfig, mayRunMigration } from './config.mjs';

const config = getSearchConfig();
if (!mayRunMigration(config)) throw new Error('拒绝 migration：仅允许配置完整且显式授权的测试环境');
if (config.schema !== 'v2_search') throw new Error('拒绝 migration：阶段三只允许独立 v2_search Schema');

const sql = await fs.readFile(path.join(process.cwd(), 'supabase', 'migrations', '202609010001_v2_search_index.sql'), 'utf8');
if (/\b(drop|truncate)\b/i.test(sql)) throw new Error('拒绝 migration：检测到破坏性 SQL');

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: config.rejectUnauthorized } });
await client.connect();
try {
  await client.query('begin');
  await client.query(sql);
  await client.query('commit');
  const result = await client.query("select (select extversion from pg_extension where extname='vector') as vector_version, exists(select 1 from information_schema.schemata where schema_name='v2_search') as schema_exists, (select count(*)::int from information_schema.tables where table_schema='v2_search') as table_count");
  console.log(JSON.stringify({ migration: '成功', pgvector: result.rows[0].vector_version, schema: config.schema, schemaExists: result.rows[0].schema_exists, tableCount: result.rows[0].table_count }, null, 2));
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
