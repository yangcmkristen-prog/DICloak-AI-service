import { NextRequest, NextResponse } from "next/server";
import { encodeStreamEvent } from "@/lib/stream-events";
import { retrieveV2, loadV2Terms, expandPricingKnowledge } from "@/lib/server/v2/retrieval/service";
import { prepareTerminologyPipeline } from "@/lib/server/v2/terminology/pipeline";
import type { SupportedTermLanguage, TerminologyKnowledge } from "@/lib/server/v2/terminology/types";
import { buildV2Messages, type V2PromptHistory } from "@/lib/server/v2/prompt";
import { parseV2Envelope, V2VisibleStreamFilter } from "@/lib/server/v2/generation/protocol";
import { validateV2Generation } from "@/lib/server/v2/generation/validation";
import { resolveV2ModelConfig, streamV2Model, type V2ModelUsage } from "@/lib/server/v2/generation/model";
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
      sendStatus("正在检索相关知识", "并行执行全文和向量召回");
      const [retrievalTrace, modelConfig] = await Promise.all([retrieveV2(question, product, request.signal), resolveV2ModelConfig()]);
      if (!modelConfig) throw new Error("V2 主模型配置不完整，请配置独立 V2 模型");
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
      const baseMeta = { engine: "v2", knowledgeIds: trace.selectedKnowledge.map((item) => item.knowledgeId), evidenceConfidence: trace.evidenceConfidence, responseStrategy: trace.responseStrategy, language: targetLanguage, terminologyWarnings: prepared.warnings.map((item) => item.code) };
      controller.enqueue(encodeStreamEvent({ type: "meta", requestId, data: { ...baseMeta, retry: false } }));
      sendStatus("正在生成回复", "已准备选中知识，等待模型首个响应片段");
      let usage: V2ModelUsage = {}; let modelCalls = 0; let firstTokenMs: number | null = null;
      const run = async (retryErrors?: string[], streamCustomer = false) => {
        modelCalls += 1;
        const filter = new V2VisibleStreamFilter(new Map(prepared.markers.map((marker) => [marker.marker, marker.value])));
        const raw = await streamV2Model({ config: modelConfig, messages: buildV2Messages({ question, history, product, language: targetLanguage, trace, prepared, retryErrors }), signal: request.signal,
          onDelta: (delta) => { if (firstTokenMs === null) { firstTokenMs = Math.round(performance.now() - startedAt); sendStatus("正在生成回复", "已收到模型输出，完成前暂不可使用"); } const visible = filter.push(delta); if (streamCustomer && visible) controller.enqueue(encodeStreamEvent({ type: "delta", requestId, content: visible })); },
          onUsage: (next) => { usage = { prompt_tokens: (usage.prompt_tokens ?? 0) + (next.prompt_tokens ?? 0), completion_tokens: (usage.completion_tokens ?? 0) + (next.completion_tokens ?? 0), total_tokens: (usage.total_tokens ?? 0) + (next.total_tokens ?? 0) }; },
        });
        const envelope = parseV2Envelope(raw); return { validation: validateV2Generation(envelope, trace, prepared), claims: envelope.claims };
      };
      let generated = await run(undefined, true); let retried = false;
      if (!generated.validation.ok) { retried = true; sendStatus("正在受控修正", "事实或格式验证未通过，仅使用同一批选中知识重试一次"); generated = await run(generated.validation.errors, false); }
      if (!generated.validation.ok || !generated.validation.reply) throw new Error(`V2 回复验证失败：${generated.validation.errors.join(",")}`);
      const totalMs = Math.round(performance.now() - startedAt);
      controller.enqueue(encodeStreamEvent({ type: "meta", requestId, data: { ...baseMeta, usage, modelCalls, retry: retried, firstTokenMs, totalMs, claims: generated.claims } }));
      sendStatus("正在完成回复", "事实、术语和技术字段验证通过");
      controller.enqueue(encodeStreamEvent({ type: "final", requestId, content: generated.validation.reply })); controller.close();
    } catch (error) { if (!request.signal.aborted) controller.enqueue(encodeStreamEvent({ type: "error", requestId, message: error instanceof Error ? error.message : "V2 生成失败" })); controller.close(); }
  } });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "x-request-id": requestId, "x-ai-engine": "v2", "x-ai-engine-version": typeof body.aiEngineVersion === "string" ? body.aiEngineVersion : "2.0-phase-6" } });
}
