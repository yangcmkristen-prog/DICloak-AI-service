import { NextRequest, NextResponse } from 'next/server';
import { encodeStreamEvent } from '@/lib/stream-events';
import { createV2TestReply } from '@/lib/server/v2/test-reply';
import { logV2Route } from '@/lib/server/v2/logger';

interface V2ChatRequest {
  message?: unknown;
  product?: unknown;
  conversationId?: unknown;
  aiEngine?: unknown;
  aiEngineVersion?: unknown;
}

export async function POST(request: NextRequest): Promise<Response> {
  const body = await request.json() as V2ChatRequest;
  if (typeof body.message !== 'string' || !body.message.trim()) {
    return NextResponse.json({ error: '缺少客户消息' }, { status: 400 });
  }
  if (body.aiEngine !== 'v2') {
    return NextResponse.json({ error: 'V2 路由仅接受 V2 对话' }, { status: 400 });
  }

  const requestId = crypto.randomUUID();
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : undefined;
  const product = body.product === 'paraturbo' ? 'paraturbo' : 'dicloak';
  const reply = createV2TestReply(product);
  logV2Route(requestId, conversationId);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encodeStreamEvent({ type: 'status', requestId, label: 'V2 测试链路已连接', elapsedMs: 0 }));
      controller.enqueue(encodeStreamEvent({ type: 'delta', requestId, content: reply }));
      controller.enqueue(encodeStreamEvent({ type: 'final', requestId, content: reply }));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'x-ai-engine': 'v2',
      'x-ai-engine-version': typeof body.aiEngineVersion === 'string' ? body.aiEngineVersion : '2.0-phase-1',
    },
  });
}
