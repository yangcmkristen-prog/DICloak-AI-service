import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEmbeddingText, buildFullText, buildSearchMetadata } from './embedding-text.mjs';
import { embedQuery, MemoryVersionedIndex, syncIndex } from './indexer.mjs';
import { MockEmbeddingProvider } from './providers.mjs';

const record = (overrides = {}) => ({
  id: 'API-1', type: 'http_api', productScope: ['dicloak'], enabled: true, sourceLanguage: 'en',
  title: 'Create profile', canonicalQuestions: [{ language: 'en', text: 'How to create profile?' }],
  utterances: ['create a profile'], body: 'POST /api/v1/profiles with env_id. Error E1001.', termIds: [], tags: ['profile'],
  metadata: {}, protectedFields: [], source: { file: 'api.xlsx', sheet: 'HTTP', row: 2 }, knowledgeVersion: '1', contentHash: 'record-hash', ...overrides,
});
const chunk = (overrides = {}) => ({
  chunkId: 'API-1#endpoint', knowledgeId: 'API-1', ordinal: 0, type: 'http_api', productScope: ['dicloak'], title: 'Create profile',
  text: 'POST /api/v1/profiles with env_id. Error E1001.', termIds: [], metadata: { apiFamily: 'http', version: 'v1', method: 'POST', endpoint: '/api/v1/profiles', parameters: [{ name: 'env_id' }] },
  protectedFields: [{ kind: 'method', value: 'POST' }, { kind: 'endpoint', value: '/api/v1/profiles' }, { kind: 'parameter', value: 'env_id' }, { kind: 'error_code', value: 'E1001' }],
  source: { file: 'api.xlsx', sheet: 'HTTP', row: 2 }, knowledgeVersion: '1', contentHash: 'chunk-hash', ...overrides,
});

test('embedding text and full text keep useful typed and protected fields without source noise', () => {
  const embedding = buildEmbeddingText(record(), chunk());
  const fullText = buildFullText(record(), chunk());
  assert.match(embedding, /Create profile/); assert.match(embedding, /POST/); assert.doesNotMatch(embedding, /api\.xlsx/); assert.doesNotMatch(embedding, /chunk-hash/);
  for (const value of ['POST', '/api/v1/profiles', 'env_id', 'E1001']) assert.match(fullText, new RegExp(value.replaceAll('/', '\\/')));
});

test('metadata contains required filters and API separation', () => {
  assert.deepEqual(buildSearchMetadata(record(), chunk()), { products: ['dicloak'], knowledgeType: 'http_api', enabled: true, knowledgeVersion: '1', apiType: 'http', apiVersion: 'v1', sourceLanguage: 'en', contentHash: 'chunk-hash' });
  assert.equal(buildSearchMetadata(record({ type: 'local_api' }), chunk({ type: 'local_api' })).apiType, 'local');
});

test('content hash incremental sync embeds only changed chunks and removes deleted chunks', async () => {
  const index = new MemoryVersionedIndex(); const provider = new MockEmbeddingProvider({ dimensions: 8 });
  await syncIndex({ index, version: 'v1', records: [record()], chunks: [chunk(), chunk({ chunkId: 'old', contentHash: 'old' })], provider }); index.publish('v1');
  const stats = await syncIndex({ index, version: 'v2', records: [record()], chunks: [chunk()], provider, previousVersion: 'v1' });
  assert.deepEqual({ embedded: stats.embedded, reused: stats.reused, deleted: stats.deleted }, { embedded: 0, reused: 1, deleted: 1 });
});

test('disabled knowledge is absent and exact search respects product and API filters', async () => {
  const index = new MemoryVersionedIndex(); const provider = new MockEmbeddingProvider({ dimensions: 8 });
  const paraRecord = record({ id: 'LOCAL-1', type: 'local_api', productScope: ['paraturbo'] });
  const paraChunk = chunk({ chunkId: 'LOCAL-1#endpoint', knowledgeId: 'LOCAL-1', type: 'local_api', productScope: ['paraturbo'], text: 'POST /local/status' });
  await syncIndex({ index, version: 'v1', records: [record(), paraRecord, record({ id: 'OFF', enabled: false })], chunks: [chunk(), paraChunk, chunk({ chunkId: 'OFF#entry', knowledgeId: 'OFF' })], provider }); index.publish('v1');
  assert.equal(index.require('v1').entries.has('OFF#entry'), false);
  assert.deepEqual(index.searchExact('POST', { product: 'dicloak', apiType: 'http' }).map((item) => item.chunk.chunkId), ['API-1#endpoint']);
  assert.deepEqual(index.searchExact('/local/status', { product: 'paraturbo', apiType: 'local' }).map((item) => item.chunk.chunkId), ['LOCAL-1#endpoint']);
});

test('failed build never replaces the published version', async () => {
  const index = new MemoryVersionedIndex(); const provider = new MockEmbeddingProvider({ dimensions: 8 });
  await syncIndex({ index, version: 'good', records: [record()], chunks: [chunk()], provider }); index.publish('good');
  await assert.rejects(syncIndex({ index, version: 'bad', records: [], chunks: [chunk()], provider }), /缺少标准知识/);
  assert.equal(index.publishedVersion, 'good'); assert.equal(index.require('bad').status, 'failed'); assert.throws(() => index.publish('bad'));
});

test('index versions publish atomically and query produces exactly one embedding call', async () => {
  const index = new MemoryVersionedIndex(); index.begin('v1', {}); index.publish('v1'); index.begin('v2', {}); index.publish('v2');
  assert.equal(index.require('v1').status, 'retired'); assert.equal(index.require('v2').status, 'published');
  const provider = new MockEmbeddingProvider({ dimensions: 8 }); const result = await embedQuery(provider, 'Como criar um perfil?');
  assert.equal(provider.calls, 1); assert.equal(result.vector.length, 8);
});
