import { NextRequest, NextResponse } from "next/server";
import { callTextModel, messagesAfterSummary, normalizeMessageTimestamp, snapshotToTranscript, validateSnapshot, type SummaryCursor } from "../shared";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { hasOnlySupportedCustomerChannels, normalizeCustomerChannels } from "@/lib/customer-channels";

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

type SummaryRecord = Record<string, unknown> & { issues?: unknown[]; featureRequests?: unknown[] };

type CustomerImportRow = {
  teamId?: unknown;
  contactName?: unknown;
  contactDetail?: unknown;
  contactMethod?: unknown;
  customerType?: unknown;
  customerSource?: unknown;
  useCase?: unknown;
  userScale?: unknown;
  accountScale?: unknown;
  createdAt?: unknown;
  monthlyFee?: unknown;
  region?: unknown;
  currentPlan?: unknown;
  customerStatus?: unknown;
  dueDate?: unknown;
  competitorUsage?: unknown;
  coreNeeds?: unknown;
  selectionReason?: unknown;
  churnReason?: unknown;
};

const importStatuses = new Set(["活跃", "流失风险", "已停滞", "潜在客户"]);
const importPlans = new Set(["免费版", "基础版", "高阶版", "共享版+", "共享版", "专业版", "协作版", "独享版", "优享版", "进阶版", "明星版", "VIP版", "定制版"]);
const customerProfileKeys = [
  "region", "customerType", "customerSource", "useCase", "userScale", "accountScale",
  "currentPlan", "monthlyFee", "customerStatus", "notes", "competitorUsage", "coreNeeds", "selectionReason", "churnReason",
] as const;

function validateCustomerImportRows(value: unknown): { rows: Array<Record<string, string>>; errors: string[] } {
  if (!Array.isArray(value)) return { rows: [], errors: ["没有可导入的客户记录"] };
  const rows: Array<Record<string, string>> = [];
  const errors: string[] = [];
  const seenTeamIds = new Set<string>();
  value.forEach((rawRow, index) => {
    if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
      errors.push(`第 ${index + 2} 行格式无效`);
      return;
    }
    const input = rawRow as CustomerImportRow;
    const teamId = typeof input.teamId === "string" ? input.teamId.trim() : "";
    const normalized = normalizedTeamId(teamId);
    if (!teamId) {
      errors.push(`第 ${index + 2} 行缺少团队 ID`);
      return;
    }
    if (seenTeamIds.has(normalized)) {
      errors.push(`第 ${index + 2} 行团队 ID“${teamId}”在表格中重复`);
      return;
    }
    const row: Record<string, string> = { teamId };
    for (const key of [
      "contactName", "contactDetail", "contactMethod", "customerType", "customerSource", "useCase", "userScale", "accountScale",
      "createdAt", "dueDate", "monthlyFee", "region", "currentPlan", "customerStatus",
      "competitorUsage", "coreNeeds", "selectionReason", "churnReason",
    ] as const) {
      const fieldValue = input[key];
      if (typeof fieldValue === "string" && fieldValue.trim()) row[key] = fieldValue.trim();
    }
    if (row.createdAt && Number.isNaN(new Date(row.createdAt).getTime())) {
      errors.push(`第 ${index + 2} 行创建时间格式无效`);
      return;
    }
    if (row.dueDate && Number.isNaN(new Date(row.dueDate).getTime())) {
      errors.push(`第 ${index + 2} 行到期时间格式无效`);
      return;
    }
    if (row.customerStatus && !importStatuses.has(row.customerStatus)) {
      errors.push(`第 ${index + 2} 行客户状态无效`);
      return;
    }
    if (row.currentPlan && !importPlans.has(row.currentPlan)) {
      errors.push(`第 ${index + 2} 行当前套餐无效`);
      return;
    }
    if (row.contactMethod && !hasOnlySupportedCustomerChannels(row.contactMethod)) {
      errors.push(`第 ${index + 2} 行渠道无效`);
      return;
    }
    if (row.contactMethod) row.contactMethod = normalizeCustomerChannels(row.contactMethod);
    seenTeamIds.add(normalized);
    rows.push(row);
  });
  return { rows, errors };
}

function normalizedTeamId(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function mergeUnique(existing: unknown, incoming: unknown): unknown[] {
  const items = [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])];
  const merged = new Map<string, unknown>();
  for (const item of items) {
    const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const key = `${String(value.title ?? "").trim().toLowerCase()}|${String(value.description ?? "").trim().toLowerCase()}`;
    if (!key.replace("|", "")) continue;
    const previous = merged.get(key);
    if (!previous || typeof previous !== "object" || Array.isArray(previous)) {
      merged.set(key, item);
      continue;
    }
    merged.set(key, Object.fromEntries(
      Object.entries({ ...value, ...previous }).map(([field, fieldValue]) => [field, fieldValue || value[field]]),
    ));
  }
  return [...merged.values()];
}

function appendUnique(existing: unknown, incoming: unknown): unknown[] {
  const preserved = Array.isArray(existing) ? existing : [];
  const keys = new Set(preserved.map((item) => {
    const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return `${String(value.title ?? "").trim().toLowerCase()}|${String(value.description ?? "").trim().toLowerCase()}`;
  }));
  const additions: unknown[] = [];
  for (const item of Array.isArray(incoming) ? incoming : []) {
    const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const key = `${String(value.title ?? "").trim().toLowerCase()}|${String(value.description ?? "").trim().toLowerCase()}`;
    if (!key.replace("|", "") || keys.has(key)) continue;
    keys.add(key);
    additions.push(item);
  }
  return [...preserved, ...additions];
}

function fillEmptyCustomerProfile(existing: SummaryRecord, generated: SummaryRecord): SummaryRecord {
  const additions: SummaryRecord = {};
  for (const key of customerProfileKeys) {
    const current = existing[key];
    const incoming = generated[key];
    const currentIsEmpty = current === null || current === undefined || (typeof current === "string" && !current.trim());
    if (currentIsEmpty && typeof incoming === "string" && incoming.trim()) additions[key] = incoming;
  }
  return { ...existing, ...additions };
}

function utc8Date(value: number | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
}

function addMissingItemDates(analysis: Record<string, unknown>, fallbackDate: string): Record<string, unknown> {
  const withDate = (items: unknown, field: "occurredAt" | "requestedAt") => Array.isArray(items)
    ? items.map((item) => item && typeof item === "object" && !Array.isArray(item)
      ? { ...(item as Record<string, unknown>), [field]: String((item as Record<string, unknown>)[field] || fallbackDate) }
      : item)
    : items;
  return {
    ...analysis,
    issues: withDate(analysis.issues, "occurredAt"),
    featureRequests: withDate(analysis.featureRequests, "requestedAt"),
  };
}

function mergeLegacySummaries(records: SummaryRecord[]): SummaryRecord[] {
  const merged = new Map<string, SummaryRecord>();
  for (const record of records) {
    const teamId = normalizedTeamId(record.teamId);
    const key = teamId || `chat:${String(record.externalChatId ?? "")}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, record);
      continue;
    }
    const latest = String(current.updatedAt ?? "") >= String(record.updatedAt ?? "") ? current : record;
    merged.set(key, {
      ...latest,
      issues: mergeUnique(current.issues, record.issues),
      featureRequests: mergeUnique(current.featureRequests, record.featureRequests),
    });
  }
  return [...merged.values()];
}

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

function extractContactName(displayName: string): string {
  const match = displayName.trim().match(/^DIC-[A-Za-z0-9]+\s+(.+)$/i);
  return match?.[1].trim() || displayName.trim();
}

function normalizePlan(value: unknown): string {
  if (typeof value !== "string") return "";
  const plans: Record<string, string> = { free: "免费版", base: "基础版", plus: "高阶版", "share+": "共享版+", share: "共享版" };
  const normalized = value.trim();
  return plans[normalized.toLowerCase()] ?? (importPlans.has(normalized) ? normalized : "");
}

function sixMonthsAgoTimestamp(now = new Date()): number {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - 6);
  return cutoff.getTime();
}

export async function GET() {
  try {
    const { data, error } = await getSupabaseClient().from("customer_summaries").select("summary_data, created_at").order("updated_at", { ascending: false });
    if (error) throw error;
    const records = (data ?? []).map((row) => {
      const summary = row.summary_data as SummaryRecord;
      return { ...summary, createdAt: summary.createdAt || row.created_at };
    });
    return NextResponse.json({ customers: mergeLegacySummaries(records) }, { headers: CORS_HEADERS });
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
  customerSource?: string;
  customerStatus?: "活跃" | "流失风险" | "已停滞" | "潜在客户";
  useCase?: string;
  userScale?: string;
  accountScale?: string;
  currentPlan?: string;
  monthlyFee?: string;
  createdAt?: string;
  dueDate?: string;
  notes?: string;
  issues?: unknown[];
  featureRequests?: unknown[];
  competitorUsage?: string;
  coreNeeds?: string;
  selectionReason?: string;
  churnReason?: string;
  followUpStatus?: "待跟进" | "无需跟进" | "已跟进";
  followUps?: unknown[];
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
      "contactName", "contactMethod", "contactDetail", "teamId", "region", "customerType", "customerSource", "customerStatus", "useCase",
      "userScale", "accountScale", "currentPlan", "monthlyFee", "createdAt", "dueDate", "notes", "issues", "featureRequests",
      "competitorUsage", "coreNeeds", "selectionReason", "churnReason", "followUpStatus", "followUps",
    ];
    const requested = body.updates as Record<string, unknown>;
    if (typeof requested.teamId === "string" && requested.teamId.trim()) {
      const { data: teamRows, error: teamLookupError } = await client.from("customer_summaries").select("external_chat_id, summary_data");
      if (teamLookupError) throw teamLookupError;
      const duplicate = (teamRows ?? []).find((row) => row.external_chat_id !== body.externalChatId && normalizedTeamId((row.summary_data as SummaryRecord).teamId) === normalizedTeamId(requested.teamId));
      if (duplicate) return NextResponse.json({ error: "该团队 ID 已有客户记录，请前往已有记录编辑" }, { status: 409, headers: CORS_HEADERS });
    }
    const updates: EditableSummary = {};
    for (const key of allowedKeys) {
      const value = requested[key];
      if (key === "issues" || key === "featureRequests" || key === "followUps") {
        if (Array.isArray(value)) updates[key] = value;
      } else if (typeof value === "string") {
        updates[key] = value as never;
      }
    }
    const savedAt = new Date().toISOString();
    const summary = { ...(record.summary_data as Record<string, unknown>), ...updates };
    const { error: updateError } = await client.from("customer_summaries").update({
      summary_data: summary,
      contact_name: typeof summary.contactName === "string" ? summary.contactName : "",
      updated_at: savedAt,
    }).eq("external_chat_id", body.externalChatId);
    if (updateError) throw updateError;
    return NextResponse.json({ summary }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[Customer Summary] 修改失败:", error);
    return NextResponse.json({ error: "客户数据保存失败" }, { status: 500, headers: CORS_HEADERS });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const externalChatId = request.nextUrl.searchParams.get("externalChatId")?.trim();
    if (!externalChatId) {
      return NextResponse.json({ error: "缺少有效的客户 ID" }, { status: 400, headers: CORS_HEADERS });
    }
    const { data, error } = await getSupabaseClient().from("customer_summaries")
      .delete()
      .eq("external_chat_id", externalChatId)
      .select("external_chat_id");
    if (error) throw error;
    if (!data?.length) {
      return NextResponse.json({ error: "未找到客户数据" }, { status: 404, headers: CORS_HEADERS });
    }
    return NextResponse.json({ deleted: true }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[Customer Summary] 删除失败:", error);
    return NextResponse.json({ error: "客户删除失败" }, { status: 500, headers: CORS_HEADERS });
  }
}

export async function POST(request: NextRequest) {
  try {
    const requestBody = await request.json() as unknown;
    if (requestBody && typeof requestBody === "object" && !Array.isArray(requestBody) && "customerImport" in requestBody) {
      const body = requestBody as { customerImport?: unknown; commit?: unknown };
      const parsed = validateCustomerImportRows(body.customerImport);
      const client = getSupabaseClient();
      const { data: existingRows, error: lookupError } = await client.from("customer_summaries")
        .select("external_chat_id, summary_data");
      if (lookupError) throw lookupError;
      const existingByTeamId = new Map<string, { external_chat_id: string; summary_data: SummaryRecord }>();
      for (const existingRow of existingRows ?? []) {
        const summary = existingRow.summary_data as SummaryRecord;
        const teamId = normalizedTeamId(summary.teamId);
        if (teamId && !existingByTeamId.has(teamId)) existingByTeamId.set(teamId, { ...existingRow, summary_data: summary });
      }
      const updated = parsed.rows.filter((row) => existingByTeamId.has(normalizedTeamId(row.teamId))).length;
      const created = parsed.rows.length - updated;
      if (body.commit !== true) {
        return NextResponse.json({ recognized: parsed.rows.length, created, updated, errors: parsed.errors }, { headers: CORS_HEADERS });
      }

      const savedAt = new Date().toISOString();
      for (const row of parsed.rows) {
        const existing = existingByTeamId.get(normalizedTeamId(row.teamId));
        const updates = Object.fromEntries(Object.entries(row).filter(([key]) => key !== "teamId"));
        if (existing) {
          const summary: SummaryRecord = { ...existing.summary_data, ...updates, teamId: row.teamId };
          const { error } = await client.from("customer_summaries").update({
            summary_data: summary,
            contact_name: typeof summary["contactName"] === "string" ? summary["contactName"] : "",
            updated_at: savedAt,
          })
            .eq("external_chat_id", existing.external_chat_id);
          if (error) throw error;
          continue;
        }
        const externalChatId = `manual-${crypto.randomUUID()}`;
        const createdAt = row.createdAt || savedAt;
        const contactName = row.contactName || row.teamId;
        const summary = {
          externalChatId, platform: "manual", contactName, contactMethod: "批量导入", teamId: row.teamId,
          customerStatus: "活跃", ...updates, createdAt, updatedAt: "",
        };
        const { error } = await client.from("customer_summaries").insert({
          external_chat_id: externalChatId, platform: "manual", contact_name: contactName, summary_data: summary,
          source_message_hash: "customer-import", message_count: 0, created_at: createdAt, updated_at: savedAt,
        });
        if (error) throw error;
      }
      return NextResponse.json({ recognized: parsed.rows.length, created, updated, errors: parsed.errors }, { headers: CORS_HEADERS });
    }
    if (requestBody && typeof requestBody === "object" && !Array.isArray(requestBody) && "customer" in requestBody) {
      const customer = (requestBody as { customer?: unknown }).customer;
      if (!customer || typeof customer !== "object" || Array.isArray(customer)) {
        return NextResponse.json({ error: "缺少客户信息" }, { status: 400, headers: CORS_HEADERS });
      }
      const input = customer as Record<string, unknown>;
      const teamId = typeof input.teamId === "string" ? input.teamId.trim() : "";
      const contactName = typeof input.contactName === "string" ? input.contactName.trim() : "";
      if (!teamId || !contactName) return NextResponse.json({ error: "团队 ID 和联系人不能为空" }, { status: 400, headers: CORS_HEADERS });
      const client = getSupabaseClient();
      const { data: rows, error: lookupError } = await client.from("customer_summaries").select("external_chat_id, summary_data");
      if (lookupError) throw lookupError;
      const duplicate = (rows ?? []).find((row) => normalizedTeamId((row.summary_data as SummaryRecord).teamId) === normalizedTeamId(teamId));
      if (duplicate) return NextResponse.json({ error: "该团队 ID 已有客户记录", existingId: duplicate.external_chat_id }, { status: 409, headers: CORS_HEADERS });
      const externalChatId = `manual-${crypto.randomUUID()}`;
      const createdAt = new Date().toISOString();
      const summary = { ...input, externalChatId, teamId, contactName, platform: "manual", createdAt, updatedAt: createdAt };
      const { error } = await client.from("customer_summaries").insert({ external_chat_id: externalChatId, platform: "manual", contact_name: contactName, summary_data: summary, source_message_hash: "manual", message_count: 0 });
      if (error) throw error;
      return NextResponse.json({ summary }, { headers: CORS_HEADERS });
    }

    const snapshot = validateSnapshot(requestBody);
    if (!snapshot) return NextResponse.json({ error: "缺少有效的当前聊天快照" }, { status: 400, headers: CORS_HEADERS });

    // Intentionally do not pass maxMessages: customer intelligence must consider
    // the complete snapshot rather than the 20-message window used by replies.
    const inferredTeamId = extractTeamId(snapshot.chat.displayName);
    const teamId = (snapshot.chat.teamId || inferredTeamId).trim();
    const contactName = teamId ? extractContactName(snapshot.chat.displayName) : snapshot.chat.displayName.trim();
    const client = getSupabaseClient();
    const { data: rows, error: lookupError } = await client.from("customer_summaries").select("external_chat_id, summary_data, message_count");
    if (lookupError) throw lookupError;
    const existingRow = (rows ?? []).find((row) => teamId
      ? normalizedTeamId((row.summary_data as SummaryRecord).teamId) === normalizedTeamId(teamId)
      : row.external_chat_id === snapshot.chat.externalChatId);
    const existing = existingRow?.summary_data as SummaryRecord | undefined;
    const lastSyncedAt = existing && typeof existing.updatedAt === "string" ? Date.parse(existing.updatedAt) : 0;
    const initialMessages = snapshot.chat.platform === "telegram"
      ? snapshot.messages.filter((message) => typeof message.timestamp !== "number" || message.timestamp >= sixMonthsAgoTimestamp())
      : snapshot.messages;
    const summaryCursor = existing?.summaryCursor as SummaryCursor | undefined;
    const messages = existing && lastSyncedAt > 0
      ? messagesAfterSummary(snapshot.messages, summaryCursor, lastSyncedAt)
      : initialMessages;
    if (existing && messages.length === 0) {
      return NextResponse.json({ summary: existing, webUrl: `${request.nextUrl.origin}/?customer=${encodeURIComponent(String(existing.externalChatId))}`, noNewMessages: true }, { headers: CORS_HEADERS });
    }
    const transcript = snapshotToTranscript({ ...snapshot, messages });
    const outputSchema = `{
  "region":"", "customerType":"", "customerSource":"", "useCase":"", "userScale":"", "accountScale":"",
  "currentPlan":"", "monthlyFee":"", "customerStatus":"活跃/流失风险/已停滞/潜在客户", "notes":"",
  "competitorUsage":"", "coreNeeds":"", "selectionReason":"", "churnReason":"",
  "issues":[{"title":"","description":"","resolution":"","status":"已解决/处理中/未处理","occurredAt":""}],
  "featureRequests":[{"title":"","description":"","source":"客户聊天","status":"未评估/已评估/已有可实现方案/暂无法实现/已上线","requestedAt":""}]
}`;
    const content = await callTextModel(
      existing
        ? "你是 DICloak 客户运营分析师。仅从上次总结后的新增聊天中提取新增信息。客户画像字段只用于补充原记录中的空字段，系统会保护已有内容；历史问题和功能需求只提取新增项。所有描述使用简体中文，只输出 JSON。"
        : "你是 DICloak 客户运营分析师。仅根据完整聊天记录提取客户画像、历史问题和功能需求。所有总结性、描述性内容必须使用简体中文；品牌名、套餐名、团队 ID、电话号码等专有信息保留原文。未知字段填空字符串，不得编造。只输出 JSON。",
      `请分析以下新增会话（共 ${messages.length} 条），输出 JSON：\n${outputSchema}\n\n识别规则：\n1. 除品牌名和套餐名外，所有字段内容必须用简体中文填写。\n2. 不要提取或输出联系人名称、${snapshot.chat.platform === "telegram" ? "Telegram 联系方式" : "WhatsApp 号码"}和团队 ID，这些字段由系统直接采集。\n3. ${existing ? "本次是增量总结：可从新增聊天补充客户画像，但只填写新增聊天中明确出现的信息；不得改写此前的问题或需求。" : "仅提取聊天中明确出现的客户画像。"} currentPlan 仅允许填写 Free、Base、Plus、Share+、Share，无法确认时留空；monthlyFee 未明确提及时留空；customerSource 可填写来源类型，也可填写“来源类型：具体内容”，不明确时留空。\n4. 只有与 DICloak 产品直接相关、且必须由技术人员开发或改造产品才能实现的诉求，才可放入 featureRequests；咨询、故障、套餐诉求、第三方网站或代理需求一律不要归为功能需求。\n5. occurredAt 和 requestedAt 必须根据聊天记录填写对应问题或需求首次出现的日期，格式为 YYYY-MM-DD；无法精确判断时填写最接近的消息日期，不得留空。\n\n新增聊天记录：\n${transcript}`,
      0.2,
    );
    const latestMessageTimestamp = messages.reduce<number>((latest, message) => {
      const timestamp = normalizeMessageTimestamp(message.timestamp);
      return timestamp ? Math.max(latest, timestamp) : latest;
    }, 0);
    const fallbackItemDate = utc8Date(latestMessageTimestamp || Date.now());
    const analysis = addMissingItemDates(parseJsonObject(content), fallbackItemDate);
    const updatedAt = new Date().toISOString();
    const generated: SummaryRecord = {
      externalChatId: snapshot.chat.externalChatId,
      platform: snapshot.chat.platform,
      contactMethod: snapshot.chat.platform === "telegram" ? "tg" : "WhatsApp",
      ...analysis,
      contactName,
      teamId,
      contactDetail: snapshot.chat.contactDetail || "",
      currentPlan: normalizePlan(analysis.currentPlan),
      createdAt: existing?.createdAt || updatedAt,
      updatedAt,
      summaryCursor: { lastMessageId: snapshot.messages.at(-1)?.id, summarizedAt: updatedAt },
    };
    const summary = existing ? {
      ...fillEmptyCustomerProfile(existing, generated),
      issues: appendUnique(existing.issues, generated.issues),
      featureRequests: appendUnique(existing.featureRequests, generated.featureRequests),
      updatedAt,
      summaryCursor: generated.summaryCursor,
    } : generated;
    const recordId = existingRow?.external_chat_id ?? snapshot.chat.externalChatId;
    const { error } = await client.from("customer_summaries").upsert({
      external_chat_id: recordId,
      platform: snapshot.chat.platform,
      contact_name: existing && typeof existing.contactName === "string" ? existing.contactName : contactName,
      summary_data: summary,
      source_message_hash: snapshot.sourceMessageHash,
      message_count: (existingRow?.message_count ?? 0) + messages.length,
      updated_at: updatedAt,
    }, { onConflict: "external_chat_id" });
    if (error) throw error;

    const webUrl = `${request.nextUrl.origin}/?customer=${encodeURIComponent(recordId)}`;
    return NextResponse.json({ summary, webUrl }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[Customer Summary] 生成失败:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "客户总结失败" }, { status: 500, headers: CORS_HEADERS });
  }
}
