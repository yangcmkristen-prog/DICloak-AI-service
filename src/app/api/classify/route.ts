import { NextRequest, NextResponse } from "next/server";
import { CLASSIFICATION_PROMPT } from "@/lib/classification-prompt";

type IntentType =
  | "api_problem"
  | "subscription_problem"
  | "troubleshooting"
  | "feature_faq"
  | "info_insufficient"
  | "intent_unclear"
  | "out_of_scope"
  | "user_routing";

type TableId =
  | "faq"
  | "troubleshooting"
  | "out_of_scope"
  | "function_knowledge"
  | "api_endpoints"
  | "pricing_table";

type ClassificationIntent = {
  type: IntentType;
  confidence: number;
  tables: Array<{ id: TableId; action: "full" | "filter" | "match"; filter: Record<string, unknown> | null }>;
  entities?: {
    planNames?: string[];
    apiType?: string | null;
    apiModule?: string | null;
    apiMethod?: string | null;
    action?: string | null;
    feature?: string | null;
    errorMessage?: string | null;
  };
};

type ClassificationResult = {
  primaryIntent: IntentType;
  identityStatus: "client" | "end_user" | "unknown";
  confidence: number;
  reasoning: string;
  intents: ClassificationIntent[];
  needsFollowUp: boolean;
  followUpQuestions: string[];
};

function coerceClassification(raw: unknown): ClassificationResult {
  const fallback: ClassificationResult = {
    primaryIntent: "feature_faq",
    identityStatus: "unknown",
    confidence: 0.75,
    reasoning: "使用默认分类兜底",
    intents: [
      {
        type: "feature_faq",
        confidence: 0.75,
        tables: [{ id: "faq", action: "match", filter: null }],
        entities: {},
      },
    ],
    needsFollowUp: false,
    followUpQuestions: [],
  };

  if (!raw || typeof raw !== "object") return fallback;
  const obj = raw as Record<string, unknown>;

  const intents = Array.isArray(obj.intents) ? (obj.intents as ClassificationIntent[]) : fallback.intents;
  if (intents.length === 0) return fallback;

  return {
    primaryIntent: (obj.primaryIntent as ClassificationResult["primaryIntent"]) || intents[0].type || "feature_faq",
    identityStatus: (obj.identityStatus as ClassificationResult["identityStatus"]) || "unknown",
    confidence: typeof obj.confidence === "number" ? obj.confidence : 0.8,
    reasoning: typeof obj.reasoning === "string" ? obj.reasoning : "分类完成",
    intents,
    needsFollowUp: Boolean(obj.needsFollowUp),
    followUpQuestions: Array.isArray(obj.followUpQuestions) ? (obj.followUpQuestions as string[]) : [],
  };
}

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
        max_tokens: 700,
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
      const parsed = JSON.parse(content);
      return NextResponse.json(coerceClassification(parsed));
    } catch {
      return NextResponse.json({ error: "分类结果解析失败", raw: content }, { status: 500 });
    }
  } catch (error) {
    console.error("[CLASSIFY] 分类请求失败:", error);
    return NextResponse.json({ error: "分类请求失败" }, { status: 500 });
  }
}