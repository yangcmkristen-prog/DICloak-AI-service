import { NextRequest, NextResponse } from 'next/server';
import { getLatestCustomerMessage, validateSnapshot } from '../shared';

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
  try {
    const snapshot = validateSnapshot(await request.json());
    if (!snapshot) {
      return NextResponse.json({ error: '缺少有效的当前聊天快照' }, { status: 400, headers: CORS_HEADERS });
    }

    const latestCustomerMessage = getLatestCustomerMessage(snapshot);
    if (!latestCustomerMessage) {
      return NextResponse.json({ error: '未找到客户消息，无法生成推荐回复' }, { status: 400, headers: CORS_HEADERS });
    }

    const origin = request.nextUrl.origin;
    const [knowledgeRes, systemRes, keywordsRes, classifyRes] = await Promise.all([
      fetch(`${origin}/api/config/knowledge`, { cache: 'no-store' }),
      fetch(`${origin}/api/config/system`, { cache: 'no-store' }),
      fetch(`${origin}/api/keywords`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: latestCustomerMessage }),
      }),
      fetch(`${origin}/api/classify`, {
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

    const response = await fetch(`${origin}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // The chat API detects the reply language from `message`. Keep this field free of
        // Chinese orchestration text; the transcript is already supplied as history.
        message: latestCustomerMessage,
        history: snapshot.messages.slice(-20).map((message) => ({
          role: message.role === 'agent' ? 'assistant' : 'user',
          content: message.text,
        })),
        knowledge: knowledgeData.success && !knowledgeData.isEmpty ? knowledgeData.data : undefined,
        systemPrompt: systemData.success && !systemData.isEmpty ? systemData.data?.systemPrompt : undefined,
        apiConfig: systemData.success && !systemData.isEmpty ? systemData.data?.apiConfig : undefined,
        aiKeywords: keywordsData.englishKeywords || [],
        classification,
        confirmedRole: snapshot.chat.confirmedRole,
        roleSource: snapshot.chat.confirmedRole ? "manual" : undefined,
      }),
    });

    const content = await response.text();
    if (!response.ok) {
      return NextResponse.json({ error: content || '生成推荐回复失败' }, { status: response.status, headers: CORS_HEADERS });
    }

    const metaMatch = content.match(/\[META\]([\s\S]*?)\[\/META\]/);
    let detectedRole: 'client' | 'end_user' | null = null;
    if (metaMatch) {
      try {
        const meta = JSON.parse(metaMatch[1].trim()) as { userRole?: unknown };
        detectedRole = meta.userRole === 'client' || meta.userRole === 'end_user' ? meta.userRole : null;
      } catch (metaError) {
        console.error('[Copilot Reply] 解析角色元数据失败:', metaError);
      }
    }

    return NextResponse.json({
      content,
      sourceMessageHash: snapshot.sourceMessageHash,
      detectedRole: snapshot.chat.confirmedRole || detectedRole,
      roleSource: snapshot.chat.confirmedRole ? 'manual' : (detectedRole ? 'ai' : null),
    }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error('[Copilot Reply] Error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '生成推荐回复失败' }, { status: 500, headers: CORS_HEADERS });
  }
}