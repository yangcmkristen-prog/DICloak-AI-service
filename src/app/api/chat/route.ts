import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { message, history, knowledge, systemPrompt, apiConfig, detectedLanguage } = await request.json();

    if (!message) {
      return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
    }

    // 调试知识库数据
    console.log('[DEBUG] 后端接收语言:', detectedLanguage);
    if (knowledge) {
      console.log('[DEBUG] FAQ数量:', knowledge.faqItems?.length || 0);
      console.log('[DEBUG] 术语库数量:', knowledge.termItems?.length || 0);
    }

    // 语言规则映射
    const languageRules: Record<string, string> = {
      zh: "所有回复必须使用中文",
      en: "All replies must be in English",
      es: "Todas las respuestas deben estar en español",
      pt: "Todas as respostas devem estar em português",
      ru: "Все ответы должны быть на русском языке",
      vi: "Tất cả các câu trả lời phải bằng tiếng Việt",
      id: "Semua jawaban harus dalam bahasa Indonesia",
      th: "คำตอบทั้งหมดต้องเป็นภาษาไทย",
      ar: "يجب أن تكون جميع الإجابات باللغة العربية",
      ja: "すべての回答は日本語で作成する必要があります",
      ko: "모든 답변은 한국어로 작성해야 합니다",
      mixed: "用户问题中包含多种语言，请使用中文回复",
    };
    const languageRule = languageRules[detectedLanguage] || languageRules.zh;

    // API 配置
    const config = apiConfig || { provider: 'coze', apiKey: '', model: 'doubao-seed-2-0-lite-260215', baseUrl: '' };

    // 优先使用前端传递的 System Prompt
    const finalSystemPrompt = systemPrompt || `You are a DICloak customer service assistant.

Focus on helping customer service staff quickly generate professional, friendly customer replies.

When a user asks a question:
1. Match the most relevant FAQ from the provided knowledge base
2. Generate replies in the same language as the user's question

## Output Format
When using knowledge base FAQ, must follow this format:
- [Main] -> core answer content
- [Suggestion] -> additional advice (must be on separate line)
- [NeedInfo] -> information needed from user (must be on separate line)

Do NOT put [NeedInfo] inside [Suggestion] content.

## Multi-turn Conversation
- Remember previous conversation context
- If user mentions their role or provides info, use it for targeted advice
- If user asks follow-up, combine with previous context`;

    // 构建知识库上下文（只传递最相关的知识库项）
    let knowledgeContext = "";

    if (knowledge && (knowledge.faqItems?.length > 0 || knowledge.troubleshootingItems?.length > 0 || knowledge.outOfScopeItems?.length > 0)) {
      // 计算匹配分数
      const calculateMatchScore = (userMsg: string, item: { questionCN?: string; questionEN?: string; tags?: string[]; userPhrases?: string }) => {
        let score = 0;
        const msgLower = userMsg.toLowerCase();

        // 中文问题匹配
        if (item.questionCN) {
          const cnLower = item.questionCN.toLowerCase();
          // 完全包含
          if (cnLower.includes(msgLower) || msgLower.includes(cnLower)) {
            score += 10;
          }
          // 关键词匹配
          const keywords = msgLower.split(/[\s,.!?;:]+/).filter(w => w.length > 1);
          keywords.forEach(kw => {
            if (cnLower.includes(kw)) score += 2;
          });
        }

        // 英文问题匹配
        if (item.questionEN) {
          const enLower = item.questionEN.toLowerCase();
          if (enLower.includes(msgLower) || msgLower.includes(enLower)) {
            score += 10;
          }
          const keywords = msgLower.split(/[\s,.!?;:]+/).filter(w => w.length > 1);
          keywords.forEach(kw => {
            if (enLower.includes(kw)) score += 2;
          });
        }

        // 标签匹配
        if (item.tags) {
          item.tags.forEach(tag => {
            if (msgLower.includes(tag.toLowerCase())) score += 3;
          });
        }

        return score;
      };

      // FAQ 匹配过滤
      type FaqItem = { questionCN: string; questionEN?: string; tags?: string[]; userPhrases?: string; answer: string; functionId?: string; termIds?: string[]; faqId?: string };
      const faqItems = (knowledge.faqItems || []) as FaqItem[];
      const matchedFaq = faqItems
        .map((item: FaqItem) => ({ item, score: calculateMatchScore(message, item) }))
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      // Troubleshooting 匹配过滤
      type TsItem = { questionCN: string; questionEN?: string; tags?: string[]; userPhrases?: string; answer: string; termIds?: string[]; faqId?: string };
      const tsItems = (knowledge.troubleshootingItems || []) as TsItem[];
      const matchedTs = tsItems
        .map((item: TsItem) => ({ item, score: calculateMatchScore(message, item) }))
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      // Out of Scope 匹配过滤
      type OosItem = { questionCN: string; questionEN?: string; answer: string; answerClient?: string; answerEndUser?: string };
      const oosItems = (knowledge.outOfScopeItems || []) as OosItem[];
      const matchedOos = oosItems
        .map((item: OosItem) => ({ item, score: calculateMatchScore(message, item) }))
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      // 构建 FAQ 上下文
      if (matchedFaq.length > 0) {
        knowledgeContext += "## FAQ Knowledge Base (matched by your question)\n";
        matchedFaq.forEach((m, index) => {
          const item = m.item;
          knowledgeContext += `[FAQ ${index + 1}]\n`;
          knowledgeContext += `Problem: ${item.questionCN || item.questionEN}\n`;
          knowledgeContext += `StandardAnswer: ${item.answer}\n`;
          if (item.functionId) {
            knowledgeContext += `RelatedFunction: ${item.functionId}\n`;
          }
          if (item.termIds && item.termIds.length > 0) {
            knowledgeContext += `RelatedTerms: ${item.termIds.join(', ')}\n`;
          }
          knowledgeContext += "\n";
        });
      }

      // 构建 Troubleshooting 上下文
      if (matchedTs.length > 0) {
        knowledgeContext += "## Troubleshooting Knowledge Base (matched by your question)\n";
        matchedTs.forEach((m, index) => {
          const item = m.item;
          knowledgeContext += `[Troubleshoot ${index + 1}]\n`;
          knowledgeContext += `Problem: ${item.questionCN || item.questionEN}\n`;
          knowledgeContext += `StandardAnswer: ${item.answer}\n`;
          if (item.termIds && item.termIds.length > 0) {
            knowledgeContext += `RelatedTerms: ${item.termIds.join(', ')}\n`;
          }
          knowledgeContext += "\n";
        });
      }

      // 构建 Out of Scope 上下文
      if (matchedOos.length > 0) {
        knowledgeContext += "## Out of Scope Knowledge Base (for reference)\n";
        matchedOos.forEach((m, index) => {
          const item = m.item;
          knowledgeContext += `[OutOfScope ${index + 1}]\n`;
          knowledgeContext += `Problem: ${item.questionCN || item.questionEN}\n`;
          knowledgeContext += `StandardAnswer: ${item.answer}\n`;
          if (item.answerClient) {
            knowledgeContext += `ClientAnswer: ${item.answerClient}\n`;
          }
          if (item.answerEndUser) {
            knowledgeContext += `EndUserAnswer: ${item.answerEndUser}\n`;
          }
          knowledgeContext += "\n";
        });
      }
    }

    // 构建对话历史上下文
    let historyContext = "";
    if (history && history.length > 0) {
      historyContext = "## Conversation History\n";
      history.forEach((msg: { role: string; content: string }) => {
        if (msg.role === "user") {
          historyContext += `User: ${msg.content}\n`;
        } else if (msg.role === "assistant") {
          // 提取主回复内容
          const mainMatch = msg.content.match(/\[Main\][\s\S]*?[-–]?[\s]*?([\s\S]+?)(?=\[|$)/);
          if (mainMatch) {
            historyContext += `Assistant: ${mainMatch[1].trim()}\n`;
          }
        }
      });
      historyContext += "\n";
    }

    // 构建用户消息
    const userMessage = `## Current User Question
${message}

${languageRule}

${knowledgeContext}
${historyContext}
Please generate reply based on the knowledge base above.`;

    // Coze Bot API 配置
    const COZE_API_ENDPOINT = "https://api.coze.cn";
    const BOT_ID = process.env.COZE_BOT_ID || "7633356097684439091";
    const API_TOKEN = process.env.COZE_API_TOKEN || "pat_c6nS6NTHKVtdVM2ihTBiAN08yYiI8uSlJnXGH7TSrE4CtaBS2renxkKj3B4MZYor";

    // 构建 Coze Bot API 请求
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 第一步：创建对话
          const createResponse = await fetch(`${COZE_API_ENDPOINT}/v3/chat/retrievable`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${API_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              bot_id: BOT_ID,
              user_id: "user_" + Date.now(),
              stream: true,
              auto_save_history: true,
              additional_messages: [
                {
                  role: "user",
                  content: finalSystemPrompt + "\n\n" + userMessage,
                  content_type: "text",
                },
              ],
            }),
          });

          if (!createResponse.ok) {
            const errorText = await createResponse.text();
            console.error("[Coze API Error]:", createResponse.status, errorText);
            controller.error(new Error(`Coze API error: ${createResponse.status}`));
            return;
          }

          const reader = createResponse.body?.getReader();
          if (!reader) {
            controller.error(new Error("Failed to get response reader"));
            return;
          }

          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6);
                if (data === "[DONE]") {
                  controller.close();
                  return;
                }
                try {
                  const parsed = JSON.parse(data);
                  // Coze 格式: parsed.data.content 或 parsed.content
                  const content = parsed.data?.content || parsed.content || "";
                  if (content) {
                    controller.enqueue(new TextEncoder().encode(content));
                  }
                } catch (e) {
                  // 忽略解析错误
                }
              }
            }
          }

          controller.close();
        } catch (error) {
          console.error("[Stream Error]:", error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("[API Error]:", error);
    return NextResponse.json(
      { error: "处理请求失败" },
      { status: 500 }
    );
  }
}
