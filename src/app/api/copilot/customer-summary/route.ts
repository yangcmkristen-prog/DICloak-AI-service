import { NextRequest, NextResponse } from "next/server";
import { callTextModel, snapshotToTranscript, validateSnapshot } from "../shared";
import { getSupabaseClient } from "@/storage/database/supabase-client";

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS_HEADERS }); }

function parseJsonObject(content: string): Record<string, unknown> {
  const normalized = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 未返回有效的客户总结");
  return JSON.parse(normalized.slice(start, end + 1)) as Record<string, unknown>;
}

function extractTeamId(displayName: string): string {
  return displayName.match(/^DIC-([A-Za-z0-9]+)(?:\s|$)/i)?.[1] ?? "";
}

function normalizePlan(value: unknown): string {
  if (typeof value !== "string") return "";
  const plans = ["Free", "Base", "Plus", "Share+", "Share"] as const;
  return plans.find((plan) => plan.toLowerCase() === value.trim().toLowerCase()) ?? "";
}

export async function GET() {
  try {
    const { data, error } = await getSupabaseClient().from("customer_summaries").select("summary_data").order("updated_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ customers: (data ?? []).map((row) => row.summary_data) }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[Customer Summary] 读取失败:", error);
    return NextResponse.json({ customers: [], error: "客户总结读取失败" }, { status: 500, headers: CORS_HEADERS });
  }
}

type EditableSummary = {
  contactName?: string;
  contactMethod?: string;
  contactDetail?: string;
  teamId?: string;
  region?: string;
  customerType?: string;
  customerStatus?: "活跃" | "流失风险" | "已停滞" | "潜在客户";
  useCase?: string;
  userScale?: string;
  accountScale?: string;
  currentPlan?: string;
  notes?: string;
  issues?: unknown[];
  featureRequests?: unknown[];
};

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as { externalChatId?: unknown; updates?: unknown };
    if (typeof body.externalChatId !== "string" || !body.externalChatId.trim() || !body.updates || typeof body.updates !== "object" || Array.isArray(body.updates)) {
      return NextResponse.json({ error: "缺少有效的客户 ID 或修改内容" }, { status: 400, headers: CORS_HEADERS });
    }

    const client = getSupabaseClient();
    const { data: record, error: readError } = await client.from("customer_summaries")
      .select("summary_data")
      .eq("external_chat_id", body.externalChatId)
      .single();
    if (readError || !record) {
      return NextResponse.json({ error: "未找到客户数据" }, { status: 404, headers: CORS_HEADERS });
    }

    const allowedKeys: Array<keyof EditableSummary> = [
      "contactName", "contactMethod", "contactDetail", "teamId", "region", "customerType", "customerStatus", "useCase",
      "userScale", "accountScale", "currentPlan", "notes", "issues", "featureRequests",
    ];
    const requested = body.updates as Record<string, unknown>;
    const updates: EditableSummary = {};
    for (const key of allowedKeys) {
      const value = requested[key];
      if (key === "issues" || key === "featureRequests") {
        if (Array.isArray(value)) updates[key] = value;
      } else if (typeof value === "string") {
        updates[key] = value as never;
      }
    }
    const updatedAt = new Date().toISOString();
    const summary = { ...(record.summary_data as Record<string, unknown>), ...updates, updatedAt };
    const { error: updateError } = await client.from("customer_summaries").update({
      summary_data: summary,
      contact_name: typeof summary.contactName === "string" ? summary.contactName : "",
      updated_at: updatedAt,
    }).eq("external_chat_id", body.externalChatId);
    if (updateError) throw updateError;
    return NextResponse.json({ summary }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[Customer Summary] 修改失败:", error);
    return NextResponse.json({ error: "客户数据保存失败" }, { status: 500, headers: CORS_HEADERS });
  }
}

export async function POST(request: NextRequest) {
  try {
    const snapshot = validateSnapshot(await request.json());
    if (!snapshot) return NextResponse.json({ error: "缺少有效的当前聊天快照" }, { status: 400, headers: CORS_HEADERS });

    // Intentionally do not pass maxMessages: customer intelligence must consider
    // the complete snapshot rather than the 20-message window used by replies.
    const transcript = snapshotToTranscript(snapshot);
    const content = await callTextModel(
      "你是 DICloak 客户运营分析师。仅根据完整聊天记录提取客户画像、历史问题和功能需求。所有总结性、描述性内容必须使用简体中文；品牌名、套餐名、团队 ID、电话号码等专有信息保留原文。未知字段填空字符串，不得编造。只输出 JSON。",
      `请分析以下完整会话（共 ${snapshot.messages.length} 条），输出 JSON：\n{
  "region":"", "customerType":"", "useCase":"", "userScale":"", "accountScale":"",
  "currentPlan":"", "customerStatus":"活跃/流失风险/已停滞/潜在客户", "notes":"",
  "issues":[{"title":"","description":"","resolution":"","status":"已解决/处理中/未处理","occurredAt":""}],
  "featureRequests":[{"title":"","description":"","source":"客户聊天","status":"未评估/已评估/已上线"}]
}\n\n识别规则：\n1. 除品牌名和套餐名外，所有字段内容必须用简体中文填写。\n2. 不要提取或输出联系人名称、WhatsApp 号码和团队 ID，这些字段由系统直接采集。\n3. currentPlan 仅允许填写 Free、Base、Plus、Share+、Share。聊天中明确提及其中一种套餐时使用对应的标准名称；未提及或无法确认时留空，不得猜测。\n\n完整聊天记录：\n${transcript}`,
      0.2,
    );
    const analysis = parseJsonObject(content);
    const updatedAt = new Date().toISOString();
    const inferredTeamId = extractTeamId(snapshot.chat.displayName);
    const summary = {
      externalChatId: snapshot.chat.externalChatId,
      platform: snapshot.chat.platform,
      contactMethod: snapshot.chat.platform === "whatsapp" ? "WhatsApp" : snapshot.chat.platform,
      ...analysis,
      contactName: snapshot.chat.displayName,
      teamId: snapshot.chat.teamId || inferredTeamId,
      contactDetail: snapshot.chat.contactDetail || "",
      currentPlan: normalizePlan(analysis.currentPlan),
      updatedAt,
    };
    const { error } = await getSupabaseClient().from("customer_summaries").upsert({
      external_chat_id: snapshot.chat.externalChatId,
      platform: snapshot.chat.platform,
      contact_name: snapshot.chat.displayName,
      summary_data: summary,
      source_message_hash: snapshot.sourceMessageHash,
      message_count: snapshot.messages.length,
      updated_at: updatedAt,
    }, { onConflict: "external_chat_id" });
    if (error) throw error;

    const webUrl = `${request.nextUrl.origin}/?customer=${encodeURIComponent(snapshot.chat.externalChatId)}`;
    return NextResponse.json({ summary, webUrl }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[Customer Summary] 生成失败:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "客户总结失败" }, { status: 500, headers: CORS_HEADERS });
  }
}