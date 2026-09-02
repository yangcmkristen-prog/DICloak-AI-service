import type { V2KnowledgeChunk, V2KnowledgeType, V2Product } from "../v2-knowledge/types";

export type V2IndexStatus = "building" | "published" | "failed" | "retired";

export interface V2SearchMetadata {
  products: V2Product[];
  knowledgeType: V2KnowledgeType;
  enabled: boolean;
  knowledgeVersion: string;
  apiType: "http" | "local" | null;
  apiVersion: string | null;
  sourceLanguage: string;
  contentHash: string;
}

export interface V2IndexedChunk {
  chunk: V2KnowledgeChunk;
  embeddingText: string;
  fullText: string;
  metadata: V2SearchMetadata;
  embedding: number[];
}

export interface V2EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<{ vectors: number[][]; tokenCount: number }>;
}
