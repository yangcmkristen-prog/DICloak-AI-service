import { NextRequest, NextResponse } from "next/server";
import { encodeStreamEvent } from "@/lib/stream-events";
import { retrieveV2, loadV2Terms, expandPricingKnowledge, preferRetrievalTrace } from "@/lib/server/v2/retrieval/service";
import { buildQueryUnderstandingMessages, parseQueryUnderstanding, supplementalQueries } from "@/lib/server/v2/retrieval/query-understanding";
import { prepareTerminologyPipeline } from "@/lib/server/v2/terminology/pipeline";
import type { SupportedTermLanguage, TerminologyKnowledge } from "@/lib/server/v2/terminology/types";
import { buildV2Messages, confirmationRequiredReply, unsupportedFeatureReply, type V2PromptHistory } from "@/lib/server/v2/prompt";
import { completeV2Json, resolveV2ModelConfig, streamV2Model, type V2ModelUsage } from "@/lib/server/v2/generation/model";
import { selectGenerationKnowledge } from "@/lib/server/v2/generation/context";
import { logV2Route } from "@/lib/server/v2/logger";

export const runtime = "nodejs";
interface V2ChatRequest { message?: unknown; history?: unknown; product?: unknown; conversationId?: unknown; aiEngine?: unknown; aiEngineVersion?: unknown }
const supportedLanguages = new Set<SupportedTermLanguage>(["zh", "en", "ru", "pt", "es", "vi"]);
const safeHistory = (value: unknown): V2PromptHistory[] => Array.isArray(value) ? value.flatMap((item): V2PromptHistory[] => {
  if (!item || typeof item !== "object") return [];
  const entry = item as { role?: unknown; content?: unknown };
  if ((entry.role !== "user" && entry.role !== "assistant") || typeof entry.content !== "string") return [];
  return [{ role: entry.role, content: entry.content.slice(0, 2000) }];
}).slice(-4) : [];

export async function POST(request: NextRequest): Promise<Response> {
  let body: V2ChatRequest;
  try { body = await request.json() as V2ChatRequest; } catch { return NextResponse.json({ error: "请求格式无效" }, { status: 400 }); }
  if (typeof body.message !== "string" || !body.message.trim()) return NextResponse.json({ error: "缺少客户消息" }, { status: 400 });
  if (body.aiEngine !== "v2") return NextResponse.json({ error: "V2 路由仅接受 V2 对话" }, { status: 400 });
  const question = body.message.trim(); const history = safeHistory(body.history); const product = body.product === "paraturbo" ? "paraturbo" : "dicloak";
  const requestId = crypto.randomUUID(); const startedAt = performance.now();
  logV2Route(requestId, typeof body.conversationId === "string" ? body.conversationId : undefined);

  const stream = new ReadableStream<Uint8Array>({ async start(controller) {
    const sendStatus = (label: string, detail?: string): void => controller.enqueue(encodeStreamEvent({ type: "status", requestId, label, detail, elapsedMs: Math.round(performance.now() - startedAt) }));
    try {
      sendStatus("正在理解问题并检索知识", "问题理解与原文召回并行执行");
      const modelConfigPromise = resolveV2ModelConfig();
      const [originalRetrieval, modelConfig] = await Promise.all([retrieveV2(question, product, request.signal), modelConfigPromise]);
      let queryUnderstanding = null;
      if (originalRetrieval.evidenceConfidence !== "high" && modelConfig) {
        try {
          const raw = await completeV2Json({ config: modelConfig, model: process.env.V2_QUERY_MODEL || modelConfig.model, signal: request.signal, maxCompletionTokens: 768, messages: buildQueryUnderstandingMessages(question, product) });
          queryUnderstanding = parseQueryUnderstanding(raw);
        } catch { queryUnderstanding = null; }
      }
      const supplementalRetrievals = queryUnderstanding ? await Promise.all(supplementalQueries(queryUnderstanding, question)
        .map((query) => retrieveV2(query, product, request.signal).catch(() => null))) : [];
      const preferredRetrieval = supplementalRetrievals.reduce(preferRetrievalTrace, originalRetrieval);
      const hasUsefulAmbiguousEvidence = Boolean(queryUnderstanding?.ambiguity) && (preferredRetrieval.evidenceConfidence === "high" || preferredRetrieval.evidenceConfidence === "medium") && preferredRetrieval.selectedKnowledge.length > 0;
      const retrievalTrace = {
        ...preferredRetrieval,
        intent: { ...preferredRetrieval.intent, language: originalRetrieval.intent.language },
        ...(queryUnderstanding?.ambiguity ? {
          responseStrategy: hasUsefulAmbiguousEvidence ? "answer_then_clarify" as const : "clarify_only" as const,
          optionalFollowUpFields: [queryUnderstanding.ambiguity],
        } : {}),
      };
      const expandedKnowledge = await expandPricingKnowledge(retrievalTrace.selectedKnowledge, question);
      const selectedKnowledge = selectGenerationKnowledge({ ...retrievalTrace, selectedKnowledge: expandedKnowledge }, question);
      const selectedIds = new Set(selectedKnowledge.map((item) => item.knowledgeId));
      const trace = { ...retrievalTrace, selectedKnowledge, top: selectedKnowledge,
        knowledgeGroups: retrievalTrace.knowledgeGroups.map((group) => ({ ...group, knowledgeIds: group.knowledgeIds.filter((id) => selectedIds.has(id)) })).filter((group) => group.knowledgeIds.length),
        branches: retrievalTrace.branches.map((branch) => ({ ...branch, knowledgeIds: branch.knowledgeIds.filter((id) => selectedIds.has(id)) })).filter((branch) => branch.knowledgeIds.length),
      };
      const targetLanguage = supportedLanguages.has(trace.intent.language as SupportedTermLanguage) ? trace.intent.language as SupportedTermLanguage : "en";
      const terms = await loadV2Terms(trace.selectedKnowledge.flatMap((item) => item.termIds ?? []));
      const terminologyKnowledge: TerminologyKnowledge[] = trace.selectedKnowledge.map((item) => ({ id: item.knowledgeId, type: item.knowledgeType === "function" ? "function" : item.knowledgeType, sourceLanguage: item.sourceLanguage || String(item.metadata.sourceLanguage ?? "en"), body: item.text, termIds: item.termIds ?? [], metadata: item.metadata, protectedFields: item.protectedFields ?? [] }));
      const prepared = prepareTerminologyPipeline({ knowledge: terminologyKnowledge, terms, targetLanguage, branches: trace.branches });
      if (!prepared.ok) throw new Error(`V2 术语准备失败：${prepared.errors.map((item) => item.code).join(",")}`);
      const baseMeta = { engine: "v2", knowledgeIds: trace.selectedKnowledge.map((item) => item.knowledgeId), evidenceConfidence: trace.evidenceConfidence, responseStrategy: trace.responseStrategy, language: targetLanguage, terminologyWarnings: prepared.warnings.map((item) => item.code), retrievalMs: trace.timings.total, queryUnderstanding: queryUnderstanding ? { normalizedQuery: queryUnderstanding.normalizedQuery, ambiguity: queryUnderstanding.ambiguity, confidence: queryUnderstanding.confidence } : undefined };
      controller.enqueue(encodeStreamEvent({ type: "meta", requestId, data: { ...baseMeta, retry: false } }));
      const isUnsupportedFeature = trace.responseStrategy === "unsupported" && trace.intent.knowledgeTypes.length === 1 && trace.intent.knowledgeTypes[0] === "function";
      if (trace.responseStrategy === "confirmation_required") {
        const reply = confirmationRequiredReply(targetLanguage);
        sendStatus("正在完成回复", "该问题需要进一步确认");
        controller.enqueue(encodeStreamEvent({ type: "final", requestId, content: reply }));
        controller.close();
        return;
      }
      if (isUnsupportedFeature) {
        const reply = unsupportedFeatureReply(targetLanguage);
        sendStatus("正在完成回复", "已确认当前功能支持范围");
        controller.enqueue(encodeStreamEvent({ type: "final", requestId, content: reply }));
        controller.close();
        return;
      }
      if (!modelConfig) throw new Error("V2 主模型配置不完整，请配置独立 V2 模型");
      sendStatus("正在生成回复", "已准备选中知识，等待模型首个响应片段");
      let usage: V2ModelUsage = {}; let modelCalls = queryUnderstanding ? 1 : 0; let firstTokenMs: number | null = null; const generationStartedAt = performance.now();
      const run = async () => {
        modelCalls += 1;
        const raw = await streamV2Model({ config: modelConfig, messages: buildV2Messages({ question, history, product, language: targetLanguage, trace, prepared, queryUnderstanding }), signal: request.signal,
          onDelta: () => { if (firstTokenMs === null) { firstTokenMs = Math.round(performance.now() - startedAt); sendStatus("正在生成回复", "已收到模型输出，完成前暂不可使用"); } },
          onUsage: (next) => { usage = { prompt_tokens: (usage.prompt_tokens ?? 0) + (next.prompt_tokens ?? 0), completion_tokens: (usage.completion_tokens ?? 0) + (next.completion_tokens ?? 0), total_tokens: (usage.total_tokens ?? 0) + (next.total_tokens ?? 0) }; },
        });
        const reply = prepared.markers.reduce((text, marker) => text.split(marker.marker).join(marker.value), raw.trim());
        if (!reply) throw new Error("V2 主模型没有返回回复内容");
        return reply;
      };
      let generated: string;
      let generationError: string | undefined;
      try {
        generated = await run();
      } catch (error) {
        if (request.signal.aborted) throw error;
        generationError = error instanceof Error ? error.message : "V2_MODEL_FAILED";
        const groundedFallback = trace.selectedKnowledge[0]?.text?.trim();
        generated = groundedFallback
          ? prepared.markers.reduce((text, marker) => text.split(marker.marker).join(marker.value), groundedFallback)
          : confirmationRequiredReply(targetLanguage);
      }
      const totalMs = Math.round(performance.now() - startedAt);
      controller.enqueue(encodeStreamEvent({ type: "meta", requestId, data: { ...baseMeta, usage, modelCalls, retry: false, validationDisabled: true, generationFallback: Boolean(generationError), generationError, firstTokenMs, generationMs: Math.round(performance.now() - generationStartedAt), totalMs } }));
      sendStatus("正在完成回复", generationError ? "模型调用异常，已使用已命中知识回答" : "模型回复已生成");
      controller.enqueue(encodeStreamEvent({ type: "final", requestId, content: generated })); controller.close();
    } catch (error) { if (!request.signal.aborted) controller.enqueue(encodeStreamEvent({ type: "error", requestId, message: error instanceof Error ? error.message : "V2 生成失败" })); controller.close(); }
  } });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "x-request-id": requestId, "x-ai-engine": "v2", "x-ai-engine-version": typeof body.aiEngineVersion === "string" ? body.aiEngineVersion : "2.0-phase-6" } });
}
