export const retrievalConfig = {
  fulltextTopK: 30,
  vectorTopK: 30,
  fusedTopK: 20,
  outputTopK: 5,
  rrfK: 60,
  timeoutMs: 8_000,
  embeddingTimeoutMs: 12_000,
  rerank: { rrf: 0.22, vector: 0.4, text: 0.18, coverage: 0.1, categorical: 0.1 },
  confidence: { high: 0.42, medium: 0.3, low: 0.2, minimum: 0.2, strongGap: 0.06, weakGap: 0.02 },
} as const;
