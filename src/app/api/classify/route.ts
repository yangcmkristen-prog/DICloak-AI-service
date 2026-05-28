import { NextRequest, NextResponse } from "next/server";
import { CLASSIFICATION_PROMPT } from "@/lib/classification-prompt";

export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json();

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "缺少消息内容" }, { status: 400 });
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "未配置 DEEPSEEK_API_KEY" }, { status: 500 });
    }

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: CLASSIFICATION_PROMPT.replace("{userMessage}", message) },
          { role: "user", content: message },
        ],
        temperature: 0.1,
        max_tokens: 500,
      }),
    });

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (!response.ok) {
      return NextResponse.json({ error: data.error?.message || "分类请求失败" }, { status: response.status });
    }

    const content = data.choices?.[0]?.message?.content ?? "";

    try {
      return NextResponse.json(JSON.parse(content));
    } catch {
      return NextResponse.json({ error: "分类结果解析失败", raw: content }, { status: 500 });
    }
  } catch (error) {
    console.error("[CLASSIFY] 分类请求失败:", error);
    return NextResponse.json({ error: "分类请求失败" }, { status: 500 });
  }
}