import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { parseFeishuCustomerUpdates } from "@/lib/feishu-customer-webhook";
import { getSupabaseClient } from "@/storage/database/supabase-client";

type SummaryRecord = Record<string, unknown>;
type ExistingCustomer = { externalChatId: string; summary: SummaryRecord };

function normalizedTeamId(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function authorized(request: NextRequest): boolean {
  const token = process.env.FEISHU_WEBHOOK_TOKEN ?? process.env.FEISHU_WEBHOOK_SECRET;
  const bearerToken = request.headers.get("authorization");
  const webhookToken = request.headers.get("x-webhook-token");
  return Boolean(token && (bearerToken === `Bearer ${token}` || webhookToken === token));
}

function externalIdForTeam(teamId: string): string {
  return `feishu-${createHash("sha256").update(normalizedTeamId(teamId)).digest("hex").slice(0, 40)}`;
}

function escapedIlikeValue(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "/api/customers/feishu-webhook",
    message: "Feishu customer webhook is reachable; use POST to synchronize data.",
  });
}

async function findCustomerByTeamId(teamId: string): Promise<ExistingCustomer | undefined> {
  const { data, error } = await getSupabaseClient().from("customer_summaries")
    .select("external_chat_id, summary_data")
    .ilike("summary_data->>teamId", escapedIlikeValue(teamId.trim()))
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return undefined;
  return { externalChatId: data.external_chat_id, summary: data.summary_data as SummaryRecord };
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Webhook 鉴权失败" }, { status: 401 });
  try {
    const parsed = parseFeishuCustomerUpdates(await request.json() as unknown);
    const hasEncodingDamage = parsed.detectedFields.some((field) => field.includes("�"));
    if (!parsed.updates.length) return NextResponse.json({
      error: "请求中没有有效的团队 ID",
      hint: hasEncodingDamage
        ? "字段名在发送前发生了字符编码损坏；Windows 终端测试请改用 teamId、contactName 等英文字段名，或从 UTF-8 文件发送请求体"
        : "请确认 JSON 为 {\"record\":{\"fields\":{\"团队ID\":\"...\"}}}，且团队ID不是空值",
      detectedFields: parsed.detectedFields,
    }, { status: 400 });

    const client = getSupabaseClient();
    const existingByTeam = new Map<string, ExistingCustomer>();
    const automaticUpdatedAt = new Date().toISOString();
    let created = 0;
    let updated = 0;
    for (const incoming of parsed.updates) {
      const key = normalizedTeamId(incoming.teamId);
      const existing = existingByTeam.get(key) ?? await findCustomerByTeamId(incoming.teamId);
      if (existing) existingByTeam.set(key, existing);
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