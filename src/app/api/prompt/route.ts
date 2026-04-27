import { NextRequest, NextResponse } from "next/server";
import { getSystemPrompt, saveSystemPrompt, DEFAULT_SYSTEM_PROMPT } from "@/lib/store";

export async function GET() {
  try {
    const prompt = getSystemPrompt();
    return NextResponse.json({ prompt });
  } catch (error) {
    console.error("Get prompt error:", error);
    return NextResponse.json({ error: "获取 Prompt 失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { prompt } = await request.json();
    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "Prompt 不能为空" }, { status: 400 });
    }
    saveSystemPrompt(prompt);
    return NextResponse.json({ success: true, prompt });
  } catch (error) {
    console.error("Save prompt error:", error);
    return NextResponse.json({ error: "保存 Prompt 失败" }, { status: 500 });
  }
}
