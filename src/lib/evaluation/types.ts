export type EvaluationTargetKind = 'v1' | 'v2' | 'mock' | 'preview';

export interface EvaluationCaseInput {
  caseId: string;
  question: string;
  history: string;
  product: 'dicloak' | 'paraturbo';
  language: string;
}

export interface EvaluationTargetResult {
  answer: string;
  firstTokenMs?: number;
  totalMs: number;
  modelCalls?: number;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  metadata?: Record<string, string | number | boolean | null>;
}

/** Stable adapter used by V1, V2, deterministic Mock and Preview API evaluators. */
export interface EvaluationTarget {
  readonly kind: EvaluationTargetKind;
  readonly name: string;
  run(input: EvaluationCaseInput, signal?: AbortSignal): Promise<EvaluationTargetResult>;
}
