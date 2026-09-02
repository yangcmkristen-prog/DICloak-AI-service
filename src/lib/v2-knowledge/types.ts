export type V2KnowledgeType =
  | "faq"
  | "troubleshooting"
  | "troubleshooting_flow"
  | "user_routing"
  | "out_of_scope"
  | "function"
  | "http_api"
  | "local_api"
  | "pricing"
  | "terminology";

export type V2Product = "dicloak" | "paraturbo";

export type ProtectedFieldKind =
  | "placeholder"
  | "term"
  | "method"
  | "endpoint"
  | "full_path"
  | "parameter"
  | "json_key"
  | "request_field"
  | "response_field"
  | "error_code"
  | "url";

export interface V2KnowledgeSource {
  file: string;
  sheet: string;
  row: number;
}

export interface V2ProtectedField {
  kind: ProtectedFieldKind;
  value: string;
  sourceColumn?: string;
}

export interface V2KnowledgeRecord {
  id: string;
  type: V2KnowledgeType;
  productScope: V2Product[];
  enabled: boolean;
  sourceLanguage: string;
  title: string;
  canonicalQuestions: Array<{ language: string; text: string }>;
  utterances: string[];
  body: string;
  termIds: string[];
  tags: string[];
  metadata: Record<string, unknown>;
  protectedFields: V2ProtectedField[];
  source: V2KnowledgeSource;
  knowledgeVersion: string;
  contentHash: string;
}

export interface V2KnowledgeChunk {
  chunkId: string;
  knowledgeId: string;
  ordinal: number;
  type: V2KnowledgeType;
  productScope: V2Product[];
  title: string;
  text: string;
  termIds: string[];
  metadata: Record<string, unknown>;
  protectedFields: V2ProtectedField[];
  source: V2KnowledgeSource;
  knowledgeVersion: string;
  contentHash: string;
}

export interface V2KnowledgeBuildWarning {
  code: string;
  message: string;
  source?: V2KnowledgeSource;
  knowledgeId?: string;
}

export interface V2KnowledgeBuildResult {
  records: V2KnowledgeRecord[];
  chunks: V2KnowledgeChunk[];
  warnings: V2KnowledgeBuildWarning[];
}
