export type SupportedTermLanguage = "zh" | "en" | "ru" | "pt" | "es" | "vi";

export interface V2TermDefinition {
  termId: string;
  translations: Partial<Record<SupportedTermLanguage, string>>;
  isUiVisible?: boolean;
  source?: { file: string; sheet: string; row: number };
}

export interface V2ProtectedField {
  kind: string;
  value: string;
  sourceColumn?: string;
}

export interface TerminologyKnowledge {
  id: string;
  type: string;
  sourceLanguage: string;
  body: string;
  termIds: string[];
  metadata: Record<string, unknown>;
  protectedFields: V2ProtectedField[];
  source?: { file: string; sheet: string; row: number };
}

export interface TermMarker {
  marker: string;
  kind: "term" | "technical";
  value: string;
  sourceValue: string;
  knowledgeId: string;
  termId?: string;
  occurrences: number;
}

export interface TerminologyIssue {
  severity: "warning" | "error";
  code: string;
  message: string;
  knowledgeId?: string;
  termId?: string;
  field?: string;
  source?: { file: string; sheet: string; row: number };
}

export interface PreparedKnowledge {
  knowledgeId: string;
  body: string;
  naturalLanguageFields: Record<string, string>;
  technicalFields: Record<string, string>;
  markers: string[];
}

export interface TerminologyBranchInput {
  label: string;
  knowledgeIds: string[];
}

export interface PreparedTerminologyPipeline {
  ok: boolean;
  targetLanguage: SupportedTermLanguage;
  knowledge: PreparedKnowledge[];
  branches: TerminologyBranchInput[];
  markers: TermMarker[];
  warnings: TerminologyIssue[];
  errors: TerminologyIssue[];
  stats: {
    knowledgeCount: number;
    referencedTermIds: number;
    uniqueTermIds: number;
    termMarkers: number;
    technicalMarkers: number;
    fallbackTranslations: number;
  };
}

export interface RestoreResult {
  ok: boolean;
  text?: string;
  errors: TerminologyIssue[];
}
