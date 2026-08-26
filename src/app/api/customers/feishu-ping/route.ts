import { NextResponse } from "next/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export function GET() {
  const response = NextResponse.json({ ok: true, service: "feishu-webhook" });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
