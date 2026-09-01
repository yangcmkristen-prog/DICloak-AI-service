import pg from 'pg';
import { getSearchConfig } from './config.mjs';

const config = getSearchConfig();
if (!config.hasDatabaseUrl) throw new Error('缺少 SUPABASE_DB_URL');

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: config.rejectUnauthorized } });
await client.connect();
try {
  await client.query('begin read only');
  const server = await client.query("select current_database() as database, current_setting('server_version') as server_version, current_setting('transaction_read_only') as transaction_read_only");
  const vector = await client.query("select extversion from pg_extension where extname = 'vector'");
  const schema = await client.query("select exists(select 1 from information_schema.schemata where schema_name = 'v2_search') as schema_exists");
  await client.query('rollback');
  console.log(JSON.stringify({ connection: '可用', database: server.rows[0].database, serverVersion: server.rows[0].server_version, transactionReadOnly: server.rows[0].transaction_read_only, pgvector: vector.rows[0]?.extversion ?? '未安装', v2SearchSchemaExists: schema.rows[0].schema_exists }, null, 2));
} finally {
  await client.end();
}
