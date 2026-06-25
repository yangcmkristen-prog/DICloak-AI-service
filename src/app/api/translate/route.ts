import { NextRequest, NextResponse } from "next/server";
import { callExtensionTranslateModel } from "../copilot/shared";

const LANGUAGE_NAMES: Record<string, string> = {
  auto: "自动检测",
  zh: "简体中文",
  en: "英语",
  es: "西班牙语",
  pt: "葡萄牙语",
  ru: "俄语",
  vi: "越南语",
  id: "印尼语",
  th: "泰语",
  ar: "阿拉伯语",
  ja: "日语",
  ko: "韩语",
};

export async function POST(request: NextRequest) {
  try {
    const { text, sourceLanguage = "auto", targetLanguage = "zh" } = await request.json() as {
      text?: unknown;
      sourceLanguage?: unknown;
      targetLanguage?: unknown;
    };
    
    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "缺少文本内容" }, { status: 400 });
    }

    const normalizedSourceLanguage = typeof sourceLanguage === "string" && LANGUAGE_NAMES[sourceLanguage]
      ? sourceLanguage
      : "auto";
    const normalizedTargetLanguage = typeof targetLanguage === "string" && LANGUAGE_NAMES[targetLanguage] && targetLanguage !== "auto"
      ? targetLanguage
      : "zh";

    const sourceLanguageName = LANGUAGE_NAMES[normalizedSourceLanguage];
    const targetLanguageName = LANGUAGE_NAMES[normalizedTargetLanguage];
    const systemPrompt = `你是 DICloak 客服助手的专业翻译助手。请使用网页端与 WhatsApp 扩展共用的翻译模型完成翻译。将用户输入翻译成${targetLanguageName}。${normalizedSourceLanguage === "auto" ? "请自动识别源语言。" : `源语言是${sourceLanguageName}。`}保持原文的语气、格式、换行、数字、邮箱、URL、产品名、账号信息、专有名词和上下文语义。只输出翻译后的内容，不要添加解释、前缀或后缀。`;
    const translation = await callExtensionTranslateModel(systemPrompt, text, 0.3);

    return NextResponse.json({
      translation,
      sourceLanguage: normalizedSourceLanguage,
      targetLanguage: normalizedTargetLanguage,
    });
  } catch (error) {
    console.error("Translation error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "翻译失败" }, { status: 500 });
  }
}
