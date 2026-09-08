import { after, NextRequest, NextResponse } from "next/server";
import pg from "pg";
import type { KnowledgeBase } from "@/lib/types";
import { isValidSettingsSession, SETTINGS_SESSION_COOKIE } from "@/lib/server/settings-session";
import { previewWebsiteIndex, publishWebsiteIndex } from "@/lib/server/v2/website-index";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  return isValidSettingsSession(request.cookies.get(SETTINGS_SESSION_COOKIE)?.value, process.env.SETTINGS_ACCESS_PASSWORD || "");
}

async function loadKnowledge(): Promise<{ knowledge: KnowledgeBase; updatedAt: string | null }> {
  const connectionString = process.env.SUPABASE_DB_URL; if (!connectionString) throw new Error("SUPABASE_DB_URL 未配置");
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: process.env.SUPABASE_DB_SSL_REJECT_UNAUTHORIZED !== "false" } });
  await client.connect();
  try {
    const result = await client.query("select knowledge_data,updated_at from public.knowledge_configs where config_key='default' limit 1"); const data = result.rows[0];
    if (!data?.knowledge_data) throw new Error("知识库为空");
    return { knowledge: data.knowledge_data as KnowledgeBase, updatedAt: data.updated_at ? new Date(data.updated_at).toISOString() : null };
  } finally { await client.end(); }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) return NextResponse.json({ error: "请先通过设置密码验证" }, { status: 401 });
  try { const source = await loadKnowledge(); return NextResponse.json({ success: true, preview: await previewWebsiteIndex(source.knowledge, source.updatedAt) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "检测失败" }, { status: 500 }); }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) return NextResponse.json({ error: "请先通过设置密码验证" }, { status: 401 });
  try {
    const source = await loadKnowledge(); const preview = await previewWebsiteIndex(source.knowledge, source.updatedAt);
    if (preview.buildingVersion) return NextResponse.json({ error: "已有 V2 索引正在发布", preview }, { status: 409 });
    if (!preview.added && !preview.changed && !preview.removed) return NextResponse.json({ success: true, unchanged: true, preview });
    if (preview.warnings.length) return NextResponse.json({ error: "知识检查存在告警，已阻止发布", preview }, { status: 422 });
    const version = `website-${new Date().toISOString().replace(/[-:.TZ]/g, "")}`;
    after(async () => { try { await publishWebsiteIndex(source.knowledge, source.updatedAt, version); } catch (error) { console.error("[v2-index] 后台发布失败", error); } });
    return NextResponse.json({ success: true, started: true, version, preview }, { status: 202 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "发布失败" }, { status: 500 }); }
}
