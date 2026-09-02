export type RetrievalConfidence = "high" | "medium" | "low" | "none";
export type ApiFamily = "http" | "local";

export interface QueryIntent {
  product: "dicloak" | "paraturbo";
  language: string;
  knowledgeTypes: string[];
  apiType: ApiFamily | null;
  apiVersion: string | null;
  method: string | null;
  object: string | null;
  action: string | null;
  missingConditions: string[];
}

export interface RetrievalCandidate {
  chunkId: string;
  knowledgeId: string;
  title: string;
  text: string;
  metadata: Record<string, unknown>;
  knowledgeType: string;
  apiType: ApiFamily | null;
  apiVersion: string | null;
  products: string[];
  source: "fulltext" | "vector" | "fused";
  sourceRank: number;
  textScore: number;
  vectorScore: number;
  rrfScore: number;
  rerankScore: number;
  matchedBy: string[];
}

export interface RetrievalTrace {
  question: string;
  intent: QueryIntent;
  filters: Record<string, unknown>;
  fulltext: RetrievalCandidate[];
  vector: RetrievalCandidate[];
  fused: RetrievalCandidate[];
  reranked: RetrievalCandidate[];
  top: RetrievalCandidate[];
  filteredReasons: string[];
  confidence: RetrievalConfidence;
  confidenceReasons: string[];
  degradedRoutes: string[];
  timings: Record<string, number>;
}
