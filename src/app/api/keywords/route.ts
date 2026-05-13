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

    // 关键词提取的 System Prompt（方案3：一次调用同时提取+翻译）
    const systemPrompt = `You are a keyword extraction and translation assistant.

Your task is to extract keywords from the user's question AND translate them to English.

## Rules:
1. Extract 5-10 meaningful keywords from the original text
2. Focus on: nouns, verbs, technical terms, error messages
3. Ignore: common words like "how", "what", "is", "the", "我", "如何", "什么"
4. Translate ALL keywords to English (even if original is already English)

## Examples:

Input (Chinese): "如何创建成员账号"
Output: {"original_keywords": ["创建", "成员", "账号"], "english_keywords": ["create", "member", "account"]}

Input (Portuguese): "Por que o ambiente mostra extensão anormal?"
Output: {"original_keywords": ["ambiente", "mostra", "extensão", "anormal"], "english_keywords": ["environment", "show", "extension", "abnormal"]}

Input (Russian): "Как добавить расширение?"
Output: {"original_keywords": ["добавить", "расширение"], "english_keywords": ["add", "extension"]}

Input (Mixed): "为什么打开环境时显示检测到扩展有异常"
Output: {"original_keywords": ["打开", "环境", "显示", "检测", "扩展", "异常"], "english_keywords": ["open", "environment", "show", "detect", "extension", "error"]}

## Output Format:
Return ONLY a JSON object with two arrays, nothing else.`;

    const userPrompt = `Extract keywords and translate to English:
"${message}"

Return JSON format: {"original_keywords": [...], "english_keywords": [...]}`;

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

    // 尝试提取 JSON 对象
    const jsonMatch = fullContent.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const result = JSON.parse(jsonMatch[0]);
        if (result.original_keywords && result.english_keywords) {
          console.log("[KEYWORDS] Original:", result.original_keywords);
          console.log("[KEYWORDS] English:", result.english_keywords);
          return NextResponse.json({ 
            originalKeywords: result.original_keywords,
            englishKeywords: result.english_keywords 
          });
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
