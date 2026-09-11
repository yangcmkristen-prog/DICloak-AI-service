export interface V2Claim { text: string; knowledgeIds: string[] }
export interface V2GeneratedEnvelope { reply: string; claims: V2Claim[] }

function unwrapJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1] ?? trimmed;
}

export function parseV2Envelope(raw: string): V2GeneratedEnvelope {
  let parsed: unknown;
  try { parsed = JSON.parse(unwrapJson(raw)); }
  catch { throw new Error("V2_OUTPUT_PROTOCOL_INVALID"); }
  if (!parsed || typeof parsed !== "object") throw new Error("V2_OUTPUT_PROTOCOL_INVALID");
  const value = parsed as { reply?: unknown; claims?: unknown };
  if (typeof value.reply !== "string" || !value.reply.trim() || value.claims !== undefined && !Array.isArray(value.claims)) throw new Error("V2_OUTPUT_PROTOCOL_INVALID");
  const claims = (value.claims ?? []).flatMap((claim): V2Claim[] => {
    if (!claim || typeof claim !== "object") return [];
    const item = claim as { text?: unknown; knowledgeIds?: unknown };
    if (typeof item.text !== "string" || !Array.isArray(item.knowledgeIds) || !item.knowledgeIds.every((id) => typeof id === "string")) return [];
    return [{ text: item.text.trim(), knowledgeIds: [...new Set(item.knowledgeIds)] }];
  });
  return { reply: value.reply.trim(), claims };
}

/** Incrementally exposes only the decoded `reply` JSON string. Other fields never reach the browser. */
export class V2VisibleStreamFilter {
  private raw = "";
  private cursor: number | null = null;
  private done = false;
  private pendingVisible = "";
  private readonly replacements: Map<string, string>;

  constructor(replacements: Map<string, string>) { this.replacements = replacements; }

  push(delta: string): string {
    if (this.done) return "";
    this.raw += delta;
    if (this.cursor === null) {
      const match = /"reply"\s*:\s*"/.exec(this.raw);
      if (!match) return "";
      this.cursor = match.index + match[0].length;
    }

    let next = "";
    while (this.cursor < this.raw.length) {
      const char = this.raw[this.cursor];
      if (char === '"') { this.done = true; break; }
      if (char !== "\\") { next += char; this.cursor += 1; continue; }
      if (this.cursor + 1 >= this.raw.length) break;
      const escaped = this.raw[this.cursor + 1];
      const simple: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
      if (escaped in simple) { next += simple[escaped]; this.cursor += 2; continue; }
      if (escaped === "u") {
        const code = this.raw.slice(this.cursor + 2, this.cursor + 6);
        if (code.length < 4) break;
        if (!/^[0-9a-f]{4}$/i.test(code)) { this.done = true; break; }
        next += String.fromCharCode(Number.parseInt(code, 16)); this.cursor += 6; continue;
      }
      this.done = true; break;
    }

    this.pendingVisible += next;
    const unfinishedMarker = this.pendingVisible.lastIndexOf("⟦");
    const hasUnfinishedMarker = unfinishedMarker >= 0 && this.pendingVisible.indexOf("⟧", unfinishedMarker) < 0;
    const safeEnd = hasUnfinishedMarker && !this.done ? unfinishedMarker : this.pendingVisible.length;
    let visible = this.pendingVisible.slice(0, safeEnd);
    this.pendingVisible = this.pendingVisible.slice(safeEnd);
    if (this.done && hasUnfinishedMarker) this.pendingVisible = "";
    for (const [marker, value] of this.replacements) visible = visible.split(marker).join(value);
    return visible.replace(/⟦V2:[^⟦⟧]+⟧/g, "");
  }

  getRaw(): string { return this.raw; }
}
