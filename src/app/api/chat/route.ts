import { NextRequest, NextResponse } from "next/server";

// 语言检测
function detectLanguage(text: string): string {
  const chineseChars = text.match(/[\u4e00-\u9fff]/g) || [];
  const russianChars = text.match(/[\u0400-\u04ff]/g) || [];
  const vietnameseChars = text.match(/[\u1ea0-\u1ef9]/gi) || [];
  const latinChars = text.match(/[áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]/gi) || [];
  const portugueseMarkers = text.match(/(ão|ção|ção|ês|eza|inho|inha|mente|dade)/gi) || [];
  const spanishMarkers = text.match(/(ción|mente|dad|oso|osa|ente|idad)/gi) || [];

  const totalChars = text.replace(/\s/g, "").length;
  const chineseRatio = chineseChars.length / totalChars;
  const russianRatio = russianChars.length / totalChars;
  const vietnameseRatio = vietnameseChars.length / totalChars;

  // 拉丁语系检测
  const latinScore = latinChars.length;
  const portugueseScore = portugueseMarkers.length + (latinChars.length > 0 ? 1 : 0);
  const spanishScore = spanishMarkers.length;
  const latinTotal = portugueseScore + spanishScore + vietnameseChars.length;

  // 只要有小语种字符就判断为小语种
  if (russianChars.length > 0) return "ru";
  if (vietnameseChars.length > 0) return "vi";
  if (portugueseScore > spanishScore && latinChars.length > 0) return "pt";
  if (spanishScore > 0 && latinChars.length > 0) return "es";

  // 中文字符超过 15% 判断为中文
  if (chineseRatio > 0.15) return "zh";

  // 默认英文
  return "en";
}

// 计算匹配分数
function calculateMatchScore(message: string, item: any): number {
  const msgLower = message.toLowerCase();
  let score = 0;

  const questionCN = (item.questionCN || "").toLowerCase();
  const questionEN = (item.questionEN || "").toLowerCase();
  const keywords = (item.keywords || "").toLowerCase();

  // 完全匹配
  if (questionCN.includes(msgLower) || questionEN.includes(msgLower)) {
    score += 10;
  }

  // 问题包含消息关键词
  const words = msgLower.split(/\s+/).filter(w => w.length > 1);
  for (const word of words) {
    if (questionCN.includes(word) || questionEN.includes(word)) {
      score += 2;
    }
    if (keywords.includes(word)) {
      score += 3;
    }
  }

  return score;
}

// 构建术语翻译映射
function buildTermTranslations(termIds: string[], knowledge: any, targetLang: string): Map<string, string> {
  const translations = new Map<string, string>();
  if (!termIds || termIds.length === 0) return translations;

  const langMap: Record<string, string> = {
    zh: "中文",
    en: "英文",
    pt: "葡萄牙语（巴西）",
    es: "西班牙语",
    ru: "俄语",
    vi: "越南语"
  };
  const langField = langMap[targetLang] || "中文";

  const termItems = knowledge.termItems || [];
  for (const termId of termIds) {
    const termItem = termItems.find((t: any) => t.term_id === termId || t.termId === termId);
    if (termItem) {
      const english = termItem["英文"] || termItem["en"] || termItem["english"] || "";
      const translated = termItem[langField] || english;
      if (english && translated) {
        translations.set(english, translated);
        // 也支持 termId 直接替换
        translations.set(termId, translated);
      }
    }
  }
  return translations;
}

// 替换术语占位符
function replaceTermPlaceholders(text: string, translations: Map<string, string>): string {
  let result = text;
  // 替换 {{英文术语}} 格式
  result = result.replace(/\{\{([^}]+)\}\}/g, (match, termName) => {
    if (translations.has(termName)) {
      return translations.get(termName) || termName;
    }
    return termName; // 移除 {{}} 但保留术语名
  });
  return result;
}

// 构建知识库上下文
function buildKnowledgeContext(message: string, knowledge: any, targetLang: string): string {
  let context = "";
  
  if (!knowledge) return context;

  // 匹配 FAQ
  const faqItems = knowledge.faqItems || [];
  const matchedFaq = faqItems
    .map((item: any) => ({ item, score: calculateMatchScore(message, item) }))
    .filter((m: any) => m.score >= 1)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 5);

  if (matchedFaq.length > 0) {
    context += "## FAQ Knowledge Base\n";
    context += "以下是匹配到的常见问题及标准答案，请基于这些内容生成回复：\n\n";
    
    matchedFaq.forEach((m: any, index: number) => {
      const item = m.item;
      const termIds = item.termIds || item.term_id || [];
      const translations = buildTermTranslations(
        typeof termIds === 'string' ? termIds.split(/[,，、]/) : termIds,
        knowledge,
        targetLang
      );
      const translatedAnswer = replaceTermPlaceholders(item.answer || '', translations);
      
      context += `[FAQ ${index + 1}]\n`;
      context += `问题: ${item.questionCN || item.questionEN}\n`;
      context += `标准答案: ${translatedAnswer}\n\n`;
    });
  }

  // 匹配 Troubleshooting
  const tsItems = knowledge.troubleshootingItems || [];
  const matchedTs = tsItems
    .map((item: any) => ({ item, score: calculateMatchScore(message, item) }))
    .filter((m: any) => m.score >= 1)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 5);

  if (matchedTs.length > 0) {
    context += "## Troubleshooting Knowledge Base\n";
    context += "以下是匹配到的故障排除内容：\n\n";
    
    matchedTs.forEach((m: any, index: number) => {
      const item = m.item;
      const termIds = item.termIds || item.term_id || [];
      const translations = buildTermTranslations(
        typeof termIds === 'string' ? termIds.split(/[,，、]/) : termIds,
        knowledge,
        targetLang
      );
      const translatedAnswer = replaceTermPlaceholders(item.answer || '', translations);
      
      context += `[故障 ${index + 1}]\n`;
      context += `问题: ${item.questionCN || item.questionEN}\n`;
      context += `解决方案: ${translatedAnswer}\n\n`;
    });
  }

  return context;
}

// 构建对话历史
function buildHistoryContext(history: any[]): string {
  if (!history || history.length === 0) return "";
  
  let context = "## 对话历史\n";
  history.forEach((msg) => {
    if (msg.role === "user") {
      context += `用户: ${msg.content}\n`;
    } else if (msg.role === "assistant") {
      context += `助手: ${msg.content}\n`;
    }
  });
  return context + "\n";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      message, 
      history = [], 
      knowledge, 
      systemPrompt, 
      apiConfig,
      role 
    } = body;

    // 语言检测
    const detectedLang = detectLanguage(message);
    const targetLang = detectedLang;

    // 构建知识库上下文
    const knowledgeContext = buildKnowledgeContext(message, knowledge, targetLang);
    const historyContext = buildHistoryContext(history);

    // System Prompt
    const defaultSystemPrompt = `你是 DICloak 客服助手，专门帮助客服人员生成专业回复。

## 核心规则（必须遵守）

1. **必须使用知识库的标准答案**：当知识库有匹配的 FAQ 或故障排除内容时，必须基于标准答案生成回复，不要编造答案。

2. **回复格式要求**：
   - 主回复：直接回答用户问题，使用知识库标准答案
   - 补充建议：可选，提供额外操作建议
   - 需补充的信息：可选，询问需要的信息

3. **语言要求**：用用户提问的语言回复

4. **如果知识库没有相关内容**：输出"未找到相关知识"`;

    const finalSystemPrompt = `${defaultSystemPrompt}

${knowledgeContext}

${historyContext}

用户角色: ${role || '客服'}`;

    // 确定提供商和模型
    const provider = apiConfig?.provider || 'coze';
    const model = apiConfig?.model || 'doubao-seed-2-0-lite-260215';

    // 调用 AI API
    const COZE_API_ENDPOINT = process.env.COZE_API_ENDPOINT || "https://api.coze.cn";
    const API_TOKEN = process.env.COZE_API_TOKEN || "pat_c6nS6NTHKVtdVM2ihTBiAN08yYiI8uSlJnXGH7TSrE4CtaBS2renxkKj3B4MZYor";

    const response = await fetch(`${COZE_API_ENDPOINT}/v3/chat`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: finalSystemPrompt },
          { role: "user", content: message }
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    // 流式返回
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;

            // 解析 SSE 事件
            const events = buffer.split('\n\n');
            buffer = events.pop() || '';

            for (const event of events) {
              const lines = event.split('\n');
              let eventData = '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('data:')) {
                  eventData = trimmed.slice(5).trim();
                }
              }

              if (!eventData || eventData === '[DONE]') continue;

              try {
                const parsed = JSON.parse(eventData);
                const content = parsed.data?.content || 
                               parsed.content || 
                               parsed.choices?.[0]?.delta?.content || '';

                if (content) {
                  controller.enqueue(encoder.encode(content));
                }
              } catch (e) {
                // 忽略解析错误
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
