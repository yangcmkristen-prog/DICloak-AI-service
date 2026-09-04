export interface V2Claim { text: string; knowledgeIds: string[] }
export interface V2GeneratedEnvelope { reply: string; claims: V2Claim[] }

const REPLY_START = "<<<V2_REPLY>>>";
const REPLY_END = "<<<END_V2_REPLY>>>";
const CLAIMS_START = "<<<V2_CLAIMS>>>";
const CLAIMS_END = "<<<END_V2_CLAIMS>>>";

export function parseV2Envelope(raw: string): V2GeneratedEnvelope {
  const replyStart = raw.indexOf(REPLY_START); const replyEnd = raw.indexOf(REPLY_END);
  const claimsStart = raw.indexOf(CLAIMS_START); const claimsEnd = raw.indexOf(CLAIMS_END);
  if (replyStart < 0 || replyEnd <= replyStart || claimsStart < 0 || claimsEnd <= claimsStart) throw new Error("V2_OUTPUT_PROTOCOL_INVALID");
  const reply = raw.slice(replyStart + REPLY_START.length, replyEnd).trim();
  const claimsText = raw.slice(claimsStart + CLAIMS_START.length, claimsEnd).trim();
  let parsed: unknown = null;
  try { parsed = JSON.parse(claimsText); }
  catch {
    const start = claimsText.indexOf("{");
    let depth = 0; let quoted = false; let escaped = false; let end = -1;
    for (let index = start; start >= 0 && index < claimsText.length; index += 1) {
      const char = claimsText[index];
      if (escaped) { escaped = false; continue; }
      if (char === "\\" && quoted) { escaped = true; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (quoted) continue;
      if (char === "{") depth += 1;
      if (char === "}" && --depth === 0) { end = index + 1; break; }
    }
    if (end > start) try { parsed = JSON.parse(claimsText.slice(start, end)); } catch { parsed = null; }
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { claims?: unknown }).claims)) parsed = { claims: [] };
  const claims = (parsed as { claims: unknown[] }).claims.flatMap((claim): V2Claim[] => {
    if (!claim || typeof claim !== "object") return [];
    const value = claim as { text?: unknown; knowledgeIds?: unknown };
    if (typeof value.text !== "string" || !Array.isArray(value.knowledgeIds) || !value.knowledgeIds.every((id) => typeof id === "string")) return [];
    return [{ text: value.text.trim(), knowledgeIds: [...new Set(value.knowledgeIds)] }];
  });
  if (!reply) throw new Error("V2_REPLY_EMPTY");
  return { reply, claims };
}

export class V2VisibleStreamFilter {
  private raw = ""; private emitted = "";
  private readonly replacements: Map<string, string>;
  constructor(replacements: Map<string, string>) { this.replacements = replacements; }
  push(delta: string): string {
    this.raw += delta;
    const start = this.raw.indexOf(REPLY_START); if (start < 0) return "";
    let visible = this.raw.slice(start + REPLY_START.length);
    const end = visible.indexOf(REPLY_END); if (end >= 0) visible = visible.slice(0, end);
    const unfinished = visible.lastIndexOf("⟦"); if (unfinished >= 0 && visible.indexOf("⟧", unfinished) < 0) visible = visible.slice(0, unfinished);
    for (const [marker, value] of this.replacements) visible = visible.split(marker).join(value);
    visible = visible.replace(/⟦V2:[^⟦⟧]+⟧/g, "").trimStart();
    if (!visible.startsWith(this.emitted)) return "";
    const next = visible.slice(this.emitted.length); this.emitted = visible; return next;
  }
  getRaw(): string { return this.raw; }
}
