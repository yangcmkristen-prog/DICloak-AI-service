import { NextRequest, NextResponse } from "next/server";
import { LLMClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import { getSystemPrompt } from "@/lib/store";

export async function POST(request: NextRequest) {
  try {
    const { message, history, knowledge } = await request.json();

    if (!message) {
      return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
    }

    // 获取存储的系统 Prompt
    const systemPrompt = getSystemPrompt();

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new LLMClient(config, customHeaders);

    // 构建知识库上下文
    let knowledgeContext = "";
    if (knowledge && knowledge.length > 0) {
      knowledgeContext = "\n\n## 知识库信息\n";
      knowledge.forEach((item: { name: string; content?: string; url?: string }) => {
        if (item.content) {
          knowledgeContext += `- [${item.name}]: ${item.content}\n`;
        } else if (item.url) {
          knowledgeContext += `- [${item.name}]: ${item.url}\n`;
        }
      });
    }

    // 构建对话历史上下文
    let historyContext = "";
    if (history && history.length > 0) {
      historyContext = "\n\n## 当前对话历史\n";
      history.forEach((msg: { role: string; content: string }) => {
        historyContext += `${msg.role === 'user' ? '客户' : '客服'}: ${msg.content}\n`;
      });
    }

    const fullPrompt = `客户问题: ${message}${knowledgeContext}${historyContext}

请根据以上信息，生成3条推荐回复。`;

    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: fullPrompt },
    ];

    // 使用流式输出
    const stream = client.stream(messages, {
      model: "doubao-seed-2-0-lite-260215",
      temperature: 0.7,
    });

    let fullContent = "";
    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            if (chunk.content) {
              const text = chunk.content.toString();
              fullContent += text;
              controller.enqueue(encoder.encode(text));
            }
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "生成回复失败，请稍后重试" },
      { status: 500 }
    );
  }
}
