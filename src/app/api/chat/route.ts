import { NextRequest, NextResponse } from "next/server";

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

// 默认 System Prompt
const defaultSystemPrompt = `You are a DICloak customer service assistant.

Focus on helping customer service staff quickly generate professional, friendly customer replies.

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

// 计算匹配分数（增强版，支持同义词和模糊匹配）
function calculateMatchScore(userMsg: string, item: { questionCN?: string; questionEN?: string; tags?: string[]; userPhrases?: string }) {
  let score = 0;
  const msgLower = userMsg.toLowerCase();

  // 同义词映射
  const synonyms: Record<string, string[]> = {
    火狐: ['firefox', 'fox', 'mozilla'],
    浏览器: ['browser', 'edge', 'chrome', '360', 'ie', 'opera', 'safari'],
    第三方: ['third', '3rd', 'external'],
    支持: ['support', 'use', 'can i', '是否'],
    内核: ['kernel', 'core', 'engine'],
  };

  // 扩展关键词
  const expandKeywords = (text: string): string[] => {
    const baseKeywords = text.split(/[\s,.!?;:，。！？；：]+/).filter(w => w.length > 1);
    const expanded: string[] = [...baseKeywords];
    baseKeywords.forEach(kw => {
      const kwLower = kw.toLowerCase();
      Object.entries(synonyms).forEach(([, enList]) => {
        if (kwLower.includes(kw) || enList.some(en => kwLower.includes(en))) {
          expanded.push(kw, ...enList);
        }
      });
    });
    return expanded;
  };

  const expandedKeywords = expandKeywords(msgLower);

  // 中文问题匹配
  if (item.questionCN) {
    const cnLower = item.questionCN.toLowerCase();
    if (cnLower.includes(msgLower) || msgLower.includes(cnLower)) {
      score += 15;
    }
    expandedKeywords.forEach(kw => {
      if (cnLower.includes(kw)) score += 3;
    });
    const coreTerms = ['火狐', 'firefox', '浏览器', 'browser', 'chrome', 'edge', '360', '支持', '第三方', '内核'];
    coreTerms.forEach(term => {
      if (msgLower.includes(term) && cnLower.includes(term)) {
        score += 5;
      }
    });
  }

  // 英文问题匹配
  if (item.questionEN) {
    const enLower = item.questionEN.toLowerCase();
    if (enLower.includes(msgLower) || msgLower.includes(enLower)) {
      score += 15;
    }
    expandedKeywords.forEach(kw => {
      if (enLower.includes(kw)) score += 3;
    });
    const browserTerms = ['firefox', 'browser', 'chrome', 'edge', '360', 'microsoft', 'support', 'switch', 'kernel'];
    browserTerms.forEach(term => {
      if (msgLower.includes(term) && enLower.includes(term)) {
        score += 5;
      }
    });
  }

  // 标签匹配
  if (item.tags) {
    item.tags.forEach(tag => {
      if (msgLower.includes(tag.toLowerCase())) score += 4;
    });
  }

  // 多核心词加分
  const coreWords = ['火狐', 'firefox', '浏览器', 'browser', 'chrome', '第三方', '支持', 'diclok'];
  const matchedCoreWords = coreWords.filter(w => msgLower.includes(w.toLowerCase()));
  if (matchedCoreWords.length >= 2) {
    score += 5;
  }

  return score;
}

// 构建知识库上下文
function buildKnowledgeContext(knowledge: any, message: string, languageRule: string) {
  let knowledgeContext = "";

  if (knowledge && (knowledge.faqItems?.length > 0 || knowledge.troubleshootingItems?.length > 0 || knowledge.outOfScopeItems?.length > 0)) {
    type FaqItem = { questionCN: string; questionEN?: string; tags?: string[]; answer: string; functionId?: string; termIds?: string[]; faqId?: string };
    const faqItems = (knowledge.faqItems || []) as FaqItem[];
    let matchedFaq = faqItems
      .map((item: FaqItem) => ({ item, score: calculateMatchScore(message, item) }))
      .filter(m => m.score >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    // Fallback: 如果没有匹配，尝试找浏览器相关的
    if (matchedFaq.length === 0) {
      const browserKeywords = ['firefox', '浏览器', 'browser', 'chrome', 'edge', '360', '内核', 'kernel', '支持'];
      const msgLower = message.toLowerCase();
      const hasBrowserKeyword = browserKeywords.some(kw => msgLower.includes(kw));

      if (hasBrowserKeyword) {
        matchedFaq = faqItems
          .filter(item => {
            const q = ((item.questionCN || '') + ' ' + (item.questionEN || '')).toLowerCase();
            return browserKeywords.some(kw => q.includes(kw));
          })
          .slice(0, 5)
          .map(item => ({ item, score: 1 }));
      }
    }

    type TsItem = { questionCN: string; questionEN?: string; tags?: string[]; answer: string; termIds?: string[]; faqId?: string };
    const tsItems = (knowledge.troubleshootingItems || []) as TsItem[];
    const matchedTs = tsItems
      .map((item: TsItem) => ({ item, score: calculateMatchScore(message, item) }))
      .filter(m => m.score >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    type OosItem = { questionCN: string; questionEN?: string; answer: string; answerClient?: string; answerEndUser?: string };
    const oosItems = (knowledge.outOfScopeItems || []) as OosItem[];
    const matchedOos = oosItems
      .map((item: OosItem) => ({ item, score: calculateMatchScore(message, item) }))
      .filter(m => m.score >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // 构建 FAQ 上下文
    if (matchedFaq.length > 0) {
      knowledgeContext += "## FAQ Knowledge Base\n";
      matchedFaq.forEach((m, index) => {
        const item = m.item;
        knowledgeContext += `[FAQ ${index + 1}]\n`;
        knowledgeContext += `Problem: ${item.questionCN || item.questionEN}\n`;
        knowledgeContext += `StandardAnswer: ${item.answer}\n`;
        if (item.termIds && item.termIds.length > 0) {
          knowledgeContext += `RelatedTerms: ${item.termIds.join(', ')}\n`;
        }
        knowledgeContext += "\n";
      });
    }

    // 构建 Troubleshooting 上下文
    if (matchedTs.length > 0) {
      knowledgeContext += "## Troubleshooting Knowledge Base\n";
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
      knowledgeContext += "## Out of Scope Knowledge Base\n";
      matchedOos.forEach((m, index) => {
        const item = m.item;
        knowledgeContext += `[OutOfScope ${index + 1}]\n`;
        knowledgeContext += `Problem: ${item.questionCN || item.questionEN}\n`;
        knowledgeContext += `StandardAnswer: ${item.answer}\n`;
        if (item.answerClient) {
          knowledgeContext += `ClientAnswer: ${item.answerClient}\n`;
        }
        knowledgeContext += "\n";
      });
    }
  }

  return knowledgeContext;
}

// 构建对话历史上下文
function buildHistoryContext(history: any[]) {
  let historyContext = "";
  if (history && history.length > 0) {
    historyContext = "## Conversation History\n";
    history.forEach((msg: { role: string; content: string }) => {
      if (msg.role === "user") {
        historyContext += `User: ${msg.content}\n`;
      } else if (msg.role === "assistant") {
        const mainMatch = msg.content.match(/\[Main\][\s\S]*?[-–]?[\s]*?([\s\S]+?)(?=\[|$)/);
        if (mainMatch) {
          historyContext += `Assistant: ${mainMatch[1].trim()}\n`;
        }
      }
    });
    historyContext += "\n";
  }
  return historyContext;
}

// Coze Bot 调用
async function callCozeBot(finalSystemPrompt: string, userMessage: string) {
  const COZE_API_ENDPOINT = "https://api.coze.cn";
  const BOT_ID = process.env.COZE_BOT_ID || "7633356097684439091";
  const API_TOKEN = process.env.COZE_API_TOKEN || "pat_c6nS6NTHKVtdVM2ihTBiAN08yYiI8uSlJnXGH7TSrE4CtaBS2renxkKj3B4MZYor";

  const createResponse = await fetch(`${COZE_API_ENDPOINT}/v3/chat`, {
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
    throw new Error(`Coze API error: ${createResponse.status}`);
  }

  return createResponse.body;
}

// OpenAI/GPT 调用
async function callOpenAI(finalSystemPrompt: string, userMessage: string, apiKey: string, model: string) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: finalSystemPrompt },
        { role: 'user', content: userMessage },
      ],
      stream: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  return response.body;
}

export async function POST(request: NextRequest) {
  try {
    const { message, history, knowledge, systemPrompt, apiConfig, detectedLanguage } = await request.json();

    if (!message) {
      return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
    }

    console.log('[DEBUG] Provider:', apiConfig?.provider || 'coze');
    console.log('[DEBUG] FAQ数量:', knowledge?.faqItems?.length || 0);

    const languageRule = languageRules[detectedLanguage] || languageRules.zh;
    const finalSystemPrompt = systemPrompt || defaultSystemPrompt;

    // 构建上下文
    const knowledgeContext = buildKnowledgeContext(knowledge, message, languageRule);
    const historyContext = buildHistoryContext(history);

    const userMessage = `## Current User Question
${message}

${languageRule}

${knowledgeContext}
${historyContext}
Please generate reply based on the knowledge base above.`;

    // 根据 provider 选择调用方式
    const provider = apiConfig?.provider || 'coze';

    let responseBody: ReadableStream<Uint8Array> | null = null;

    if (provider === 'openai' || provider === 'gpt') {
      const apiKey = apiConfig?.apiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return NextResponse.json({ error: "OpenAI API Key 未配置" }, { status: 400 });
      }
      responseBody = await callOpenAI(finalSystemPrompt, userMessage, apiKey, apiConfig?.model || 'gpt-4o-mini');
    } else {
      // 默认使用 Coze
      responseBody = await callCozeBot(finalSystemPrompt, userMessage);
    }

    if (!responseBody) {
      throw new Error("Failed to get response stream");
    }

    // 流式返回
    const stream = new ReadableStream({
      async start(controller) {
        const reader = responseBody!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            if (provider === 'openai' || provider === 'gpt') {
              // OpenAI 格式
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data === '[DONE]') {
                    controller.close();
                    return;
                  }
                  try {
                    const parsed = JSON.parse(data);
                    const content = parsed.choices?.[0]?.delta?.content || '';
                    if (content) {
                      controller.enqueue(new TextEncoder().encode(content));
                    }
                  } catch (e) {
                    // 忽略解析错误
                  }
                }
              }
            } else {
              // Coze 格式
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data === '[DONE]') {
                    controller.close();
                    return;
                  }
                  try {
                    const parsed = JSON.parse(data);
                    const content = parsed.data?.content || parsed.content || '';
                    if (content) {
                      controller.enqueue(new TextEncoder().encode(content));
                    }
                  } catch (e) {
                    // 忽略解析错误
                  }
                }
              }
            }
          }
          controller.close();
        } catch (error) {
          console.error('[Stream Error]:', error);
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
      { error: error instanceof Error ? error.message : "处理请求失败" },
      { status: 500 }
    );
  }
}
