import { createHash } from 'node:crypto';

export class MockEmbeddingProvider {
  constructor({ dimensions = 64, model = 'deterministic-mock-v1' } = {}) {
    this.name = 'mock'; this.model = model; this.dimensions = dimensions; this.calls = 0;
  }
  async embed(texts) {
    this.calls += 1;
    const vectors = texts.map((value) => {
      const bytes = createHash('sha256').update(value).digest();
      const vector = Array.from({ length: this.dimensions }, (_, index) => (bytes[index % bytes.length] - 127.5) / 127.5);
      const length = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)) || 1;
      return vector.map((item) => item / length);
    });
    return { vectors, tokenCount: texts.reduce((sum, value) => sum + Math.ceil(value.length / 4), 0) };
  }
}

export class OpenAICompatibleEmbeddingProvider {
  constructor({ baseUrl, apiKey, model, dimensions = 1536 }) {
    if (!baseUrl || !apiKey || !model) throw new Error('真实 embedding Provider 配置不完整');
    this.name = 'openai-compatible'; this.baseUrl = baseUrl.replace(/\/$/, ''); this.apiKey = apiKey; this.model = model; this.dimensions = dimensions; this.calls = 0;
  }
  async embed(texts) {
    this.calls += 1;
    const response = await fetch(`${this.baseUrl}/embeddings`, { method: 'POST', headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: this.model, input: texts, dimensions: this.dimensions }) });
    if (!response.ok) throw new Error(`Embedding 请求失败：HTTP ${response.status}`);
    const payload = await response.json();
    const vectors = [...payload.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
    if (vectors.length !== texts.length || vectors.some((vector) => vector.length !== this.dimensions)) throw new Error('Embedding 返回数量或维度不正确');
    return { vectors, tokenCount: payload.usage?.total_tokens ?? 0 };
  }
}
