import { NextRequest, NextResponse } from "next/server";
import { LLMClient, Config, HeaderUtils, Message } from "coze-coding-dev-sdk";

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();
    
    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "缺少文本内容" }, { status: 400 });
    }

    // 检测是否主要是中文（包含超过30%的中文字符）
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const totalChars = text.replace(/\s/g, "").length;
    const chineseRatio = totalChars > 0 ? chineseChars / totalChars : 0;
    
    if (chineseRatio > 0.3) {
      return NextResponse.json({ 
        translation: null, 
        isChinese: true,
        message: "内容已是中文，无需翻译" 
      });
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new LLMClient(config, customHeaders);

    const messages: Message[] = [
      {
        role: "system",
        content: "你是一个专业的翻译助手。请将用户输入的文本翻译成中文，保持原文的语气和格式。只需输出翻译后的中文内容，不要添加任何解释、前缀或后缀。"
      },
      { role: "user", content: text }
    ];

    const response = await client.invoke(messages, {
      model: "doubao-seed-2-0-lite-260215",
      temperature: 0.3
    });

    return NextResponse.json({
      translation: response.content.trim(),
      isChinese: false
    });
  } catch (error) {
    console.error("Translation error:", error);
    return NextResponse.json({ error: "翻译失败" }, { status: 500 });
  }
}
