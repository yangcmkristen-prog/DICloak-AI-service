import { NextRequest, NextResponse } from "next/server";
import { LLMClient, Config } from "coze-coding-dev-sdk";

export async function POST(request: NextRequest) {
  try {
    const { message, apiConfig } = await request.json();

    if (!message) {
      return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
    }

    // API 配置
    const config = apiConfig || { provider: 'coze', apiKey: '', model: 'doubao-seed-2-0-lite-260215', baseUrl: '' };

    // 关键词提取的 System Prompt
    const systemPrompt = `You are a keyword extraction assistant.

Your task is to extract 5-10 meaningful keywords from the user's question.

## Rules:
1. Extract words that are essential for understanding the user's intent
2. Focus on: nouns, verbs, technical terms
3. Ignore: common words like "how", "what", "is", "the", "a", "我", "如何", "什么"
4. For Chinese: extract meaningful 2-4 character words
5. For mixed language: extract keywords from all languages present

## Output Format:
Return ONLY a JSON array of keywords, nothing else.
Example: ["create", "member", "account", "team", "API"]`;

    const userPrompt = `Extract keywords from this question:
"${message}"

Return only a JSON array of 5-10 keywords.`;

    // 调用 AI API
    const llmConfig = new Config({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || "https://api.coze.cn/v1",
    });

    const client = new LLMClient(llmConfig);
    const llmConfigStream = {
      model: config.model || "doubao-seed-2-0-lite-260215",
      temperature: 0.3, // 低温度，更稳定
    };

    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userPrompt },
    ];

    // 收集完整响应
    let fullContent = "";
    for await (const chunk of client.stream(messages, llmConfigStream)) {
      const content = Array.isArray(chunk.content)
        ? chunk.content.map(c => 'text' in c ? c.text : '').join('')
        : chunk.content;
      if (content) {
        fullContent += content;
      }
    }

    // 解析关键词
    console.log("[KEYWORDS] AI response:", fullContent);

    // 尝试提取 JSON 数组
    const jsonMatch = fullContent.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      try {
        const keywords = JSON.parse(jsonMatch[0]);
        if (Array.isArray(keywords)) {
          console.log("[KEYWORDS] Extracted:", keywords);
          return NextResponse.json({ keywords });
        }
      } catch (e) {
        console.error("[KEYWORDS] Parse error:", e);
      }
    }

    // 备用：从响应中提取单词
    const fallbackKeywords = fullContent
      .replace(/[\[\]"]/g, '')
      .split(/[,，\s\n]+/)
      .filter((w: string) => w.length > 1)
      .slice(0, 10);

    console.log("[KEYWORDS] Fallback:", fallbackKeywords);
    return NextResponse.json({ keywords: fallbackKeywords });

  } catch (error) {
    console.error("[KEYWORDS API Error]:", error);
    return NextResponse.json(
      { error: "关键词提取失败" },
      { status: 500 }
    );
  }
}
