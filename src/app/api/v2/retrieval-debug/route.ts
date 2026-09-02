import { NextRequest, NextResponse } from "next/server";
import { retrieveV2 } from "@/lib/server/v2/retrieval/service";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  if (process.env.V2_RETRIEVAL_DEBUG_ENABLED !== "true") return NextResponse.json({ error: "检索调试功能未启用" }, { status: 404 });
  const body = await request.json() as { question?: unknown; product?: unknown };
  if (typeof body.question !== "string" || !body.question.trim()) return NextResponse.json({ error: "缺少问题" }, { status: 400 });
  const product = body.product === "paraturbo" ? "paraturbo" : "dicloak";
  try { return NextResponse.json(await retrieveV2(body.question.trim(), product, request.signal)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
}
