import { NextRequest, NextResponse } from 'next/server';
import { getLatestCustomerMessage, validateSnapshot } from '../shared';
import { getCopilotLanguageHint } from '@/lib/copilot-language';
import { getRequestId, logTiming } from '@/lib/server/request-telemetry';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

async function readJson<T>(response: Response, fallback: T): Promise<T> {
  const contentType = response.headers.get('content-type');
  if (!contentType?.includes('application/json')) return fallback;
  return await response.json() as T;
}

export async function POST(request: NextRequest) {
  const requestStartedAt = Date.now();
  const requestId = getRequestId(request.headers);
  try {
    const snapshot = validateSnapshot(await request.json());
    if (!snapshot) {
      return NextResponse.json({ error: '缺少有效的当前聊天快照' }, { status: 400, headers: CORS_HEADERS });
    }

    const latestCustomerMessage = getLatestCustomerMessage(snapshot);
    if (!latestCustomerMessage) {
      return NextResponse.json({ error: '未找到客户消息，无法生成推荐回复' }, { status: 400, headers: CORS_HEADERS });
    }

    if (snapshot.aiEngine === 'v2') {
      const response = await fetch(`${request.nextUrl.origin}/api/v2/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-request-id': requestId },
        body: JSON.stringify({
          message: latestCustomerMessage,
          history: snapshot.messages,
          product: 'dicloak',
          conversationId: snapshot.chat.externalChatId,
          aiEngine: snapshot.aiEngine,
          aiEngineVersion: snapshot.aiEngineVersion || '2.0-phase-1',
        }),
        signal: request.signal,
      });
      return new Response(response.body, { status: response.status, headers: { ...CORS_HEADERS, 'Content-Type': response.headers.get('content-type') || 'application/x-ndjson; charset=utf-8', 'x-ai-engine': 'v2' } });
    }

    const origin = request.nextUrl.origin;
    const timedFetch = async (stage: string, input: string, init?: RequestInit): Promise<Response> => {
      const startedAt = Date.now();
      try {
        return await fetch(input, { ...init, headers: { ...init?.headers, 'x-request-id': requestId } });
      } finally {
        logTiming(requestId, stage, Date.now() - startedAt);
      }
    };
    const [knowledgeRes, systemRes, keywordsRes, classifyRes] = await Promise.all([
      timedFetch('knowledge_read', `${origin}/api/config/knowledge`, { cache: 'no-store' }),
      timedFetch('system_config_read', `${origin}/api/config/system`, { cache: 'no-store' }),
      timedFetch('keyword_extraction', `${origin}/api/keywords`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: latestCustomerMessage }),
      }),
      timedFetch('intent_classification', `${origin}/api/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: latestCustomerMessage,
          history: snapshot.messages.slice(-20).map((message) => ({
            role: message.role === 'agent' ? 'assistant' : 'user',
            content: message.text,
          })),
        }),
      }),
    ]);

    const knowledgeData = await readJson<{ success?: boolean; data?: unknown; isEmpty?: boolean }>(knowledgeRes, {});
    const systemData = await readJson<{ success?: boolean; data?: { systemPrompt?: string; apiConfig?: unknown }; isEmpty?: boolean }>(systemRes, {});
    const keywordsData = await readJson<{ originalKeywords?: string[]; englishKeywords?: string[] }>(keywordsRes, {});
    const classification = classifyRes.ok ? await readJson<Record<string, unknown> | null>(classifyRes, null) : null;

    const response = await timedFetch('chat_pipeline', `${origin}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // The chat API detects the reply language from `message`. Keep this field free of
        // Chinese orchestration text; the transcript is already supplied as history.
        message: latestCustomerMessage,
        detectedLanguage: getCopilotLanguageHint(latestCustomerMessage),
        history: snapshot.messages.slice(-20).map((message) => ({
          role: message.role === 'agent' ? 'assistant' : 'user',
          content: message.text,
        })),
        knowledge: knowledgeData.success && !knowledgeData.isEmpty ? knowledgeData.data : undefined,
        systemPrompt: systemData.success && !systemData.isEmpty ? systemData.data?.systemPrompt : undefined,
        apiConfig: systemData.success && !systemData.isEmpty ? systemData.data?.apiConfig : undefined,
        aiKeywords: keywordsData.englishKeywords || [],
        classification,
        requestId,
        confirmedRole: snapshot.chat.confirmedRole,
        roleSource: snapshot.chat.confirmedRole ? "manual" : undefined,
      }),
      signal: request.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return NextResponse.json({ error: errorBody || '生成推荐回复失败' }, { status: response.status, headers: CORS_HEADERS });
    }
    if (!response.body) throw new Error('生成接口未返回响应流');
    logTiming(requestId, 'upstream_stream_ready', Date.now() - requestStartedAt);
    return new Response(response.body, {
      status: response.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': response.headers.get('content-type') || 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'x-request-id': requestId,
        'x-source-message-hash': snapshot.sourceMessageHash,
      },
    });
  } catch (error) {
    console.error('[Copilot Reply] Error:', { requestId, error });
    logTiming(requestId, 'complete_request', Date.now() - requestStartedAt, { success: false });
    return NextResponse.json({ error: error instanceof Error ? error.message : '生成推荐回复失败' }, { status: 500, headers: CORS_HEADERS });
  }
}
