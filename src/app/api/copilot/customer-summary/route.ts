import { NextRequest, NextResponse } from "next/server";
import { callTextModel, snapshotToTranscript, validateSnapshot } from "../shared";
import { getSupabaseClient } from "@/storage/database/supabase-client";

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

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
  "issues":[{"title":"","description":"","resolution":"","status":"已解决/处理中/待跟进","occurredAt":""}],
  "featureRequests":[{"title":"","description":"","priority":"高/中/低","source":"客户聊天","status":"未评估/开发中/已完成"}]
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