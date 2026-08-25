import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { parseFeishuCustomerUpdates } from "@/lib/feishu-customer-webhook";
import { getSupabaseClient } from "@/storage/database/supabase-client";

type SummaryRecord = Record<string, unknown>;

function normalizedTeamId(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function authorized(request: NextRequest): boolean {
  const token = process.env.FEISHU_WEBHOOK_TOKEN ?? process.env.FEISHU_WEBHOOK_SECRET;
  return Boolean(token && request.headers.get("authorization") === `Bearer ${token}`);
}

function externalIdForTeam(teamId: string): string {
  return `feishu-${createHash("sha256").update(normalizedTeamId(teamId)).digest("hex").slice(0, 40)}`;
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Webhook 鉴权失败" }, { status: 401 });
  try {
    const parsed = parseFeishuCustomerUpdates(await request.json() as unknown);
    if (!parsed.updates.length) return NextResponse.json({
      error: "请求中没有有效的团队 ID",
      hint: "请确认 JSON 为 {\"record\":{\"fields\":{\"团队ID\":\"...\"}}}，且团队ID不是空值",
      detectedFields: parsed.detectedFields,
    }, { status: 400 });

    const client = getSupabaseClient();
    const { data, error: readError } = await client.from("customer_summaries").select("external_chat_id, summary_data");
    if (readError) throw readError;
    const existingByTeam = new Map<string, { externalChatId: string; summary: SummaryRecord }>();
    for (const row of data ?? []) {
      const summary = row.summary_data as SummaryRecord;
      const key = normalizedTeamId(summary.teamId);
      if (key && !existingByTeam.has(key)) existingByTeam.set(key, { externalChatId: row.external_chat_id, summary });
    }

    const automaticUpdatedAt = new Date().toISOString();
    let created = 0;
    let updated = 0;
    for (const incoming of parsed.updates) {
      const key = normalizedTeamId(incoming.teamId);
      const existing = existingByTeam.get(key);
      const nonEmptyFields = Object.fromEntries(Object.entries(incoming).filter(([, value]) => typeof value === "string" && value.trim()));
      if (existing) {
        const summary: SummaryRecord = { ...existing.summary, ...nonEmptyFields, teamId: incoming.teamId, automaticUpdatedAt };
        const { error } = await client.from("customer_summaries").update({
          summary_data: summary,
          contact_name: typeof summary.contactName === "string" ? summary.contactName : incoming.teamId,
        }).eq("external_chat_id", existing.externalChatId);
        if (error) throw error;
        updated += 1;
        continue;
      }

      // A team-derived primary identifier makes concurrent/retried webhooks idempotent,
      // while the in-request Set in the parser rejects repeated team IDs in one payload.
      const externalChatId = externalIdForTeam(incoming.teamId);
      const contactName = incoming.contactName || incoming.teamId;
      const summary = {
        externalChatId, platform: "feishu", customerStatus: "活跃", createdAt: incoming.createdAt || automaticUpdatedAt,
        updatedAt: "", ...nonEmptyFields, teamId: incoming.teamId, contactName, automaticUpdatedAt,
      };
      const { error } = await client.from("customer_summaries").upsert({
        external_chat_id: externalChatId,
        platform: "feishu",
        contact_name: contactName,
        summary_data: summary,
        source_message_hash: `feishu:${key}`,
        message_count: 0,
      }, { onConflict: "external_chat_id", ignoreDuplicates: true });
      if (error) throw error;
      existingByTeam.set(key, { externalChatId, summary });
      created += 1;
    }
    return NextResponse.json({ success: true, received: parsed.updates.length, created, updated, skippedDuplicates: parsed.skippedDuplicates });
  } catch (error) {
    console.error("[Feishu Customer Webhook] 同步失败:", error);
    return NextResponse.json({ error: "飞书客户数据同步失败" }, { status: 500 });
  }
}