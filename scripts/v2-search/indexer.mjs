import { buildEmbeddingText, buildFullText, buildSearchMetadata } from './embedding-text.mjs';

export class MemoryVersionedIndex {
  constructor() { this.versions = new Map(); this.publishedVersion = null; }
  begin(version, config) {
    if (this.versions.has(version)) throw new Error(`索引版本已存在：${version}`);
    this.versions.set(version, { version, status: 'building', config, entries: new Map(), error: null });
  }
  fail(version, error) { const target = this.require(version); target.status = 'failed'; target.error = String(error); }
  publish(version) {
    const target = this.require(version);
    if (target.status !== 'building') throw new Error('只有构建中的索引可以发布');
    if (this.publishedVersion) this.require(this.publishedVersion).status = 'retired';
    target.status = 'published'; this.publishedVersion = version;
  }
  require(version) { const value = this.versions.get(version); if (!value) throw new Error(`索引版本不存在：${version}`); return value; }
  searchExact(query, filters = {}) {
    if (!this.publishedVersion) return [];
    const needle = query.toLocaleLowerCase();
    const entries = [...this.require(this.publishedVersion).entries.values()];
    const protectedQuery = entries.some((entry) => entry.chunk.protectedFields.some((field) => field.value.toLocaleLowerCase() === needle));
    return entries.filter((entry) => entry.metadata.enabled && (protectedQuery ? entry.chunk.protectedFields.some((field) => field.value.toLocaleLowerCase() === needle) : entry.fullText.toLocaleLowerCase().includes(needle)) && (!filters.product || entry.metadata.products.includes(filters.product)) && (!filters.apiType || entry.metadata.apiType === filters.apiType));
  }
}

export async function syncIndex({ index, version, records, chunks, provider, previousVersion = null }) {
  index.begin(version, { provider: provider.name, model: provider.model, dimensions: provider.dimensions });
  const target = index.require(version);
  const previous = previousVersion ? index.require(previousVersion) : null;
  const recordsById = new Map(records.map((record) => [record.id, record]));
  let reused = 0; let embedded = 0; let tokenCount = 0;
  try {
    for (const chunk of chunks) {
      const record = recordsById.get(chunk.knowledgeId);
      if (!record) throw new Error(`分块缺少标准知识：${chunk.knowledgeId}`);
      if (!record.enabled) continue;
      const old = previous?.entries.get(chunk.chunkId);
      if (old?.metadata.contentHash === chunk.contentHash && old.embedding.length === provider.dimensions) { target.entries.set(chunk.chunkId, structuredClone(old)); reused += 1; continue; }
      const embeddingText = buildEmbeddingText(record, chunk);
      const result = await provider.embed([embeddingText]);
      tokenCount += result.tokenCount; embedded += 1;
      target.entries.set(chunk.chunkId, { chunk, embeddingText, fullText: buildFullText(record, chunk), metadata: buildSearchMetadata(record, chunk), embedding: result.vectors[0] });
    }
    return { total: target.entries.size, embedded, reused, deleted: previous ? [...previous.entries.keys()].filter((id) => !target.entries.has(id)).length : 0, tokenCount };
  } catch (error) { index.fail(version, error instanceof Error ? error.message : String(error)); throw error; }
}

export async function embedQuery(provider, query) {
  const result = await provider.embed([query]);
  if (result.vectors.length !== 1) throw new Error('查询 embedding 必须返回且只返回一个向量');
  return { vector: result.vectors[0], tokenCount: result.tokenCount };
}
