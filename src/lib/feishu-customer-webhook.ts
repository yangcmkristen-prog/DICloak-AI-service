export type FeishuCustomerUpdate = {
  teamId: string;
  contactName?: string;
  contactDetail?: string;
  contactMethod?: string;
  createdAt?: string;
  dueDate?: string;
  currentPlan?: string;
};

type UnknownRecord = Record<string, unknown>;

function objectValue(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function fieldText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(fieldText).filter(Boolean).join("、");
  const object = objectValue(value);
  if (!object) return "";
  for (const key of ["text", "name", "value", "label", "phone", "email"]) {
    const text = fieldText(object[key]);
    if (text) return text;
  }
  return "";
}

function fieldDate(value: unknown): string {
  const raw = fieldText(value);
  if (!raw) return "";
  const numeric = Number(raw);
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
}

function recordsFromPayload(payload: unknown): UnknownRecord[] {
  if (Array.isArray(payload)) return payload.flatMap(recordsFromPayload);
  const object = objectValue(payload);
  if (!object) return [];
  for (const key of ["records", "items", "data"]) {
    if (Array.isArray(object[key])) return recordsFromPayload(object[key]);
  }
  const record = objectValue(object.record);
  if (record) return [record];
  return [object];
}

/** Accepts both the Feishu automation `record.fields` envelope and a plain fields object. */
export function parseFeishuCustomerUpdates(payload: unknown): { updates: FeishuCustomerUpdate[]; skippedDuplicates: number } {
  const updates: FeishuCustomerUpdate[] = [];
  const seen = new Set<string>();
  let skippedDuplicates = 0;
  for (const record of recordsFromPayload(payload)) {
    const fields = objectValue(record.fields) ?? record;
    const teamId = fieldText(fields["团队ID"] ?? fields.teamId).trim();
    if (!teamId) continue;
    const normalizedTeamId = teamId.toLowerCase();
    if (seen.has(normalizedTeamId)) {
      skippedDuplicates += 1;
      continue;
    }
    seen.add(normalizedTeamId);
    const optionalText = (names: string[]): string | undefined => {
      const text = fieldText(names.map((name) => fields[name]).find((value) => value !== undefined));
      return text || undefined;
    };
    const optionalDate = (names: string[]): string | undefined => {
      const date = fieldDate(names.map((name) => fields[name]).find((value) => value !== undefined));
      return date || undefined;
    };
    updates.push({
      teamId,
      contactName: optionalText(["联系人", "团队名字", "contactName"]),
      contactDetail: optionalText(["联系方式", "用户联系方式", "contactDetail"]),
      contactMethod: optionalText(["渠道", "私域渠道", "contactMethod"]),
      createdAt: optionalDate(["创建时间", "createdAt"]),
      dueDate: optionalDate(["到期时间", "dueDate"]),
      currentPlan: optionalText(["当前套餐", "套餐", "currentPlan"]),
    });
  }
  return { updates, skippedDuplicates };
}
