import { randomUUID } from 'node:crypto';

export type ModelUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
};

export function getRequestId(headers: Headers): string {
  return headers.get('x-request-id')?.trim() || randomUUID();
}

export function logTiming(requestId: string, stage: string, durationMs: number, extra: Record<string, unknown> = {}): void {
  console.info(JSON.stringify({ event: 'request_timing', requestId, stage, durationMs, ...extra }));
}

export function logModelCall(input: {
  requestId: string;
  stage: string;
  provider: string;
  model: string;
  durationMs: number;
  success: boolean;
  retry?: boolean;
  usage?: ModelUsage;
}): void {
  console.info(JSON.stringify({
    event: 'model_call',
    requestId: input.requestId,
    stage: input.stage,
    provider: input.provider,
    model: input.model,
    inputTokens: input.usage?.prompt_tokens ?? null,
    outputTokens: input.usage?.completion_tokens ?? null,
    durationMs: input.durationMs,
    success: input.success,
    retry: input.retry ?? false,
  }));
}
