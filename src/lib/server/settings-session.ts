import { createHmac, timingSafeEqual } from "node:crypto";

export const SETTINGS_SESSION_COOKIE = "diclok_settings_session";
const lifetimeSeconds = 8 * 60 * 60;

function signature(expires: string, secret: string): string {
  return createHmac("sha256", secret).update(expires).digest("base64url");
}

export function createSettingsSession(secret: string): { value: string; maxAge: number } {
  const expires = String(Math.floor(Date.now() / 1000) + lifetimeSeconds);
  return { value: `${expires}.${signature(expires, secret)}`, maxAge: lifetimeSeconds };
}

export function isValidSettingsSession(value: string | undefined, secret: string): boolean {
  if (!value || !secret) return false;
  const [expires, supplied] = value.split(".");
  if (!expires || !supplied || Number(expires) <= Math.floor(Date.now() / 1000)) return false;
  const expected = signature(expires, secret);
  const left = Buffer.from(supplied); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
