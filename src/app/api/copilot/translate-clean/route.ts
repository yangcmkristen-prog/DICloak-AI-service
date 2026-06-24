import { NextRequest, NextResponse } from 'next/server';
import { callExtensionTranslateModel, snapshotToTranscript, validateSnapshot } from '../shared';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  try {
    const snapshot = validateSnapshot(await request.json());
    if (!snapshot) {
      return NextResponse.json({ error: '缺少有效的当前聊天快照' }, { status: 400, headers: CORS_HEADERS });
    }

    const transcript = snapshotToTranscript(snapshot);
    if (!transcript) {
      return NextResponse.json({ error: '当前聊天没有可处理的消息' }, { status: 400, headers: CORS_HEADERS });
    }

    const content = await callExtensionTranslateModel(
      '你是 DICloak 客服助手的语义清洗专家。请把 WhatsApp 聊天记录翻译成中文，并清洗为客服可快速理解的结构化语义。只输出指定三部分内容，不输出分析过程，不输出额外字段。',
      `当前联系人：${snapshot.chat.displayName}\n平台：WhatsApp\n\n聊天记录：\n${transcript}\n\n请严格只输出以下三部分：\n1. 中文翻译\n2. 清洗后语义\n3. 建议下一步客服动作`,
      0.2,
    );

    return NextResponse.json({ content, sourceMessageHash: snapshot.sourceMessageHash }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error('[Copilot Translate Clean] Error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '翻译并清洗失败' }, { status: 500, headers: CORS_HEADERS });
  }
}