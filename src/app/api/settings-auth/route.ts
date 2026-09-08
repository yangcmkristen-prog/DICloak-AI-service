import { NextRequest, NextResponse } from "next/server";
import { createSettingsSession, SETTINGS_SESSION_COOKIE } from "@/lib/server/settings-session";

export async function POST(request: NextRequest) {
  try {
    const configuredPassword = process.env.SETTINGS_ACCESS_PASSWORD || "";

    if (!configuredPassword) {
      return NextResponse.json({ success: true, enabled: false });
    }

    const body = await request.json() as { password?: unknown };
    const password = typeof body.password === "string" ? body.password : "";

    if (password !== configuredPassword) {
      return NextResponse.json({ success: false, message: "密码错误" }, { status: 401 });
    }

    const session = createSettingsSession(configuredPassword);
    const response = NextResponse.json({ success: true, enabled: true });
    response.cookies.set(SETTINGS_SESSION_COOKIE, session.value, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: session.maxAge });
    return response;
  } catch (error) {
    console.error("设置访问密码校验失败:", error);
    return NextResponse.json({ success: false, message: "校验失败" }, { status: 500 });
  }
}
