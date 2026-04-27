import { NextRequest, NextResponse } from "next/server";
import { LLMClient, Config, HeaderUtils } from "coze-coding-dev-sdk";

export async function POST(request: NextRequest) {
  try {
    const { message, history, knowledge, systemPrompt } = await request.json();

    if (!message) {
      return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
    }

    // 优先使用前端传递的 System Prompt，其次使用默认 Prompt
    const finalSystemPrompt = systemPrompt || `你是 DICloak 客服助手，专注于帮助客服人员快速生成专业、友好的客户回复。

## 核心职责
根据客户的问题，从知识库和对话历史中提取关键信息，生成3条不同角度的推荐回复。

## 回复要求
1. **专业性**：使用正式、友好的语气
2. **针对性**：针对客户问题给出具体解决方案
3. **多样性**：3条回复要覆盖不同角度（如解释原因、提供步骤、表达关心等）
4. **简洁性**：每条回复控制在50-150字之间
5. **可操作性**：回复中包含具体的操作指引或解决方案

## 输出格式
请直接输出3条推荐回复，每条之间用换行分隔，不要添加序号或额外说明。`;

    // 优先使用前端传递的知识库数据
    const knowledgeBase = knowledge || {
      faqItems: [],
      troubleshootingItems: [],
      outOfScopeItems: [],
      mappingItems: [],
      functionKnowledge: [],
      termItems: [],
    };

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new LLMClient(config, customHeaders);

    // 构建知识库上下文
    let knowledgeContext = "";

    // 添加 FAQ 数据
    if (knowledgeBase.faqItems && knowledgeBase.faqItems.length > 0) {
      knowledgeContext += "\n\n## FAQ 知识库\n";
      knowledgeBase.faqItems.forEach((item: { questionCN: string; answer: string; functionId?: string }, index: number) => {
        knowledgeContext += `【FAQ ${index + 1}】\n`;
        knowledgeContext += `问题: ${item.questionCN}\n`;
        knowledgeContext += `标准答案: ${item.answer}\n`;
        if (item.functionId) knowledgeContext += `关联功能: ${item.functionId}\n`;
        knowledgeContext += "\n";
      });
    }

    // 添加 Troubleshooting 数据
    if (knowledgeBase.troubleshootingItems && knowledgeBase.troubleshootingItems.length > 0) {
      knowledgeContext += "\n\n## 排障知识库\n";
      knowledgeBase.troubleshootingItems.forEach((item: { questionCN: string; answer: string; answerClient?: string; answerEndUser?: string }, index: number) => {
        knowledgeContext += `【排障 ${index + 1}】\n`;
        knowledgeContext += `问题: ${item.questionCN}\n`;
        knowledgeContext += `通用答案: ${item.answer}\n`;
        if (item.answerClient) knowledgeContext += `Client答案: ${item.answerClient}\n`;
        if (item.answerEndUser) knowledgeContext += `EndUser答案: ${item.answerEndUser}\n`;
        knowledgeContext += "\n";
      });
    }

    // 添加 Out of Scope 数据
    if (knowledgeBase.outOfScopeItems && knowledgeBase.outOfScopeItems.length > 0) {
      knowledgeContext += "\n\n## 超范围问题库\n";
      knowledgeBase.outOfScopeItems.forEach((item: { questionCN: string; answer: string }, index: number) => {
        knowledgeContext += `【超范围 ${index + 1}】\n`;
        knowledgeContext += `问题: ${item.questionCN}\n`;
        knowledgeContext += `标准回复: ${item.answer}\n`;
        knowledgeContext += "\n";
      });
    }

    // 添加功能知识库
    if (knowledgeBase.functionKnowledge && knowledgeBase.functionKnowledge.length > 0) {
      knowledgeContext += "\n\n## 功能知识库\n";
      knowledgeBase.functionKnowledge.slice(0, 20).forEach((item: { functionName: string; description: string; entryPath?: string; steps?: string }, index: number) => {
        knowledgeContext += `【功能 ${index + 1}】\n`;
        knowledgeContext += `功能名称: ${item.functionName}\n`;
        knowledgeContext += `功能说明: ${item.description}\n`;
        if (item.entryPath) knowledgeContext += `入口路径: ${item.entryPath}\n`;
        if (item.steps) knowledgeContext += `操作步骤: ${item.steps}\n`;
        knowledgeContext += "\n";
      });
      if (knowledgeBase.functionKnowledge.length > 20) {
        knowledgeContext += `(仅显示前20条，共${knowledgeBase.functionKnowledge.length}条)\n`;
      }
    }

    // 添加术语库
    if (knowledgeBase.termItems && knowledgeBase.termItems.length > 0) {
      knowledgeContext += "\n\n## 术语库\n";
      const visibleTerms = knowledgeBase.termItems.filter((t: { isUiVisible: boolean }) => t.isUiVisible).slice(0, 30);
      visibleTerms.forEach((item: { termCN: string; termEN: string }) => {
        knowledgeContext += `- ${item.termCN}: ${item.termEN}\n`;
      });
      if (knowledgeBase.termItems.length > 30) {
        knowledgeContext += `(仅显示前30条，共${knowledgeBase.termItems.length}条)\n`;
      }
    }

    // 添加映射表
    if (knowledgeBase.mappingItems && knowledgeBase.mappingItems.length > 0) {
      knowledgeContext += "\n\n## 问题分类映射\n";
      knowledgeBase.mappingItems.forEach((item: { category2: string; domainKeywords?: string; keywordsEN?: string }) => {
        if (item.category2) {
          knowledgeContext += `- ${item.category2}: ${item.domainKeywords || item.keywordsEN || ''}\n`;
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

请根据以上知识库信息，生成3条推荐回复。如果问题属于"超范围"类别，请先说明无法支持后再给出适当的建议。`;

    const messages = [
      { role: "system" as const, content: finalSystemPrompt },
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
