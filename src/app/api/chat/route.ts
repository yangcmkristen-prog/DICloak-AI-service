import { NextRequest, NextResponse } from "next/server";
import { LLMClient, Config, HeaderUtils } from "coze-coding-dev-sdk";

const SYSTEM_PROMPT = `你是 DICloak 客服助手，专注于帮助客服人员快速生成专业、友好的客户回复。

## 核心职责
根据客户的问题，从知识库和对话历史中提取关键信息，生成3条不同角度的推荐回复。

## 回复要求
1. **专业性**：使用正式、友好的语气
2. **针对性**：针对客户问题给出具体解决方案
3. **多样性**：3条回复要覆盖不同角度（如解释原因、提供步骤、表达关心等）
4. **简洁性**：每条回复控制在50-150字之间
5. **可操作性**：回复中包含具体的操作指引或解决方案

## 输出格式
请直接输出3条推荐回复，每条之间用换行分隔，不要添加序号或额外说明。

示例格式：
"感谢您的反馈，关于您提到的问题，我们已安排专人处理，预计XX小时内给您答复。"
"针对您遇到的情况，建议您尝试以下步骤：1. ... 2. ... 如仍有问题，请联系..."
"非常抱歉给您带来不便，我们非常重视您的问题，将第一时间为您解决。"`;

export async function POST(request: NextRequest) {
  try {
    const { message, history, knowledge } = await request.json();

    if (!message) {
      return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
    }

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
      { role: "system" as const, content: SYSTEM_PROMPT },
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
