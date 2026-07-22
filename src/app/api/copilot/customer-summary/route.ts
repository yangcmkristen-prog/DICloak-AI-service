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
  teamId?: string;
  region?: string;
  customerType?: string;
  customerStatus?: "活跃" | "跟进中" | "潜在客户";
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
      "contactName", "contactMethod", "teamId", "region", "customerType", "customerStatus", "useCase",
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
      "你是 DICloak 客户运营分析师。仅根据完整聊天记录提取客户画像、历史问题和功能需求。未知字段填空字符串，不得编造。只输出 JSON。",
      `请分析以下完整会话（共 ${snapshot.messages.length} 条），输出 JSON：\n{
  "teamId":"", "region":"", "customerType":"", "useCase":"", "userScale":"", "accountScale":"",
  "currentPlan":"", "customerStatus":"", "notes":"",
  "issues":[{"title":"","description":"","resolution":"","status":"已解决/处理中/未处理","occurredAt":""}],
  "featureRequests":[{"title":"","description":"","source":"客户聊天","status":"未评估/已评估/已上线"}]
}\n\n完整聊天记录：\n${transcript}`,
      0.2,
    );
    const analysis = parseJsonObject(content);
    const updatedAt = new Date().toISOString();
    const summary = {
      externalChatId: snapshot.chat.externalChatId,
      platform: snapshot.chat.platform,
      contactName: snapshot.chat.displayName,
      contactMethod: snapshot.chat.platform === "whatsapp" ? "WhatsApp" : snapshot.chat.platform,
      ...analysis,
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