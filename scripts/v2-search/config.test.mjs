import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { getSearchConfig, mayRunIndexWrite, mayRunMigration, mayRunProductionWrite } from './config.mjs';

test('database writes require complete configuration, explicit test environment and approval', () => {
  const base = { SUPABASE_URL: 'configured', SUPABASE_SERVICE_ROLE_KEY: 'configured', SUPABASE_DB_URL: 'configured', V2_SEARCH_ENVIRONMENT: 'test', V2_SEARCH_ALLOW_MIGRATION: 'true' };
  assert.equal(mayRunMigration(getSearchConfig(base)), true);
  assert.equal(mayRunMigration(getSearchConfig({ ...base, V2_SEARCH_ENVIRONMENT: 'production' })), false);
  assert.equal(mayRunMigration(getSearchConfig({ ...base, V2_SEARCH_ALLOW_MIGRATION: 'false' })), false);
  const production = { ...base, V2_SEARCH_ENVIRONMENT: 'production', V2_SEARCH_ALLOW_MIGRATION: 'false', V2_SEARCH_ALLOW_PRODUCTION_WRITE: 'true', V2_SEARCH_PRODUCTION_CONFIRM: 'DICLOAK_PRODUCTION_V2' };
  assert.equal(mayRunProductionWrite(getSearchConfig(production)), true);
  assert.equal(mayRunIndexWrite(getSearchConfig(production)), true);
  assert.equal(mayRunProductionWrite(getSearchConfig({ ...production, V2_SEARCH_PRODUCTION_CONFIRM: 'wrong' })), false);
  assert.equal(mayRunProductionWrite(getSearchConfig({ ...production, V2_SEARCH_ALLOW_PRODUCTION_WRITE: 'false' })), false);
  assert.throws(() => getSearchConfig({ V2_SEARCH_SCHEMA: 'v2_search;drop table' }), /只能包含/);
});

test('migration is additive, versioned, filtered and guards atomic publication', () => {
  const sql = fs.readFileSync(new URL('../../supabase/migrations/202609010001_v2_search_index.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /\b(drop|truncate)\b/i);
  for (const expected of ['create extension if not exists vector', 'vector(1536)', 'using hnsw', 'using gin', 'exact_terms', 'search_exact_chunks', "status = 'published'", 'c.enabled', 'product_filter', 'api_type_filter', 'failures > 0 or actual <> expected']) assert.match(sql, new RegExp(expected.replace(/[()]/g, '\\$&'), 'i'));
});
