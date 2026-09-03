export type EvidenceConfidence = "high" | "medium" | "low" | "none";
/** @deprecated Use EvidenceConfidence. */
export type RetrievalConfidence = EvidenceConfidence;
export type ResponseStrategy = "direct" | "aggregated" | "conditional" | "answer_then_clarify" | "clarify_only" | "unsupported";
export type QuestionMode = "precise" | "broad_troubleshooting" | "ambiguous_with_safe_branches" | "missing_critical_information" | "unsupported";
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
  termIds?: string[];
  protectedFields?: Array<{ kind: string; value: string; sourceColumn?: string }>;
  sourceLanguage?: string;
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

export interface KnowledgeGroup {
  key: string;
  label: string;
  knowledgeIds: string[];
}

export interface KnowledgeBranch {
  label: string;
  knowledgeIds: string[];
}

export interface RejectedKnowledge {
  candidate: RetrievalCandidate;
  reason: string;
}

export interface RetrievalTrace {
  question: string;
  intent: QueryIntent;
  filters: Record<string, unknown>;
  fulltext: RetrievalCandidate[];
  vector: RetrievalCandidate[];
  fused: RetrievalCandidate[];
  reranked: RetrievalCandidate[];
  debugCandidates: RetrievalCandidate[];
  selectedKnowledge: RetrievalCandidate[];
  rejectedCandidates: RejectedKnowledge[];
  knowledgeGroups: KnowledgeGroup[];
  branches: KnowledgeBranch[];
  questionMode: QuestionMode;
  evidenceConfidence: EvidenceConfidence;
  responseStrategy: ResponseStrategy;
  missingCriticalInformation: string[];
  optionalFollowUpFields: string[];
  decisionReasons: string[];
  top: RetrievalCandidate[];
  filteredReasons: string[];
  confidence: RetrievalConfidence;
  confidenceReasons: string[];
  degradedRoutes: string[];
  timings: Record<string, number>;
}
