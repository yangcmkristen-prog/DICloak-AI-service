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
      `你是 DICloak 客服助手的语义清洗专家。请把 WhatsApp 聊天记录翻译成中文，并清洗为客服可快速理解的结构化语义。

必须遵守：
1. 聊天记录中每一条非中文消息都必须翻译成中文，不能保留西班牙语、英语、葡萄牙语等原文正文。
2. 必须按原始消息顺序逐条翻译完整历史会话，不要只翻译最后一条，也不要省略中间消息。
3. 翻译必须结合上下文语境和客服业务场景，准确还原代词、指代对象、账号/团队/套餐等含义。
4. 保留说话人、时间、邮箱、账号、数字、URL、产品名等客观信息；仅翻译自然语言内容。
5. 对客户的明显拼写错误要结合 DICloak/代理/环境/账号等客服场景纠正理解，不要把错拼技术词音译成新专有名词。例如 poroxy、porxy、proxie、proxi 等应理解为 proxy（代理），\"No me da el proxy/No meda el poroxy\" 应表达为“没有给我/显示代理”或“我拿不到代理”，不能翻译为“收到 Peroxie”。
6. 如果原文已经是中文，可以原样保留。
7. 只输出指定三部分内容，不输出分析过程，不输出额外字段。`,
      `当前联系人：${snapshot.chat.displayName}\n平台：WhatsApp\n\n聊天记录（这是完整历史会话，必须全部翻译）：\n${transcript}\n\n请严格只输出以下三部分：\n1. 中文翻译：按原始顺序逐条输出完整中文译文，格式沿用 [客户/客服 时间]。禁止保留非中文句子。\n2. 清洗后语义：结合上下文总结客户诉求、客服已回复内容、当前进展。\n3. 建议下一步客服动作`,
      0.2,
    );

    return NextResponse.json({ content, sourceMessageHash: snapshot.sourceMessageHash }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error('[Copilot Translate Clean] Error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '翻译并清洗失败' }, { status: 500, headers: CORS_HEADERS });
  }
}