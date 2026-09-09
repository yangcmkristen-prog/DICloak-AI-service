/**
 * Fields owned by an external synchronization source must never be overwritten
 * by manual edits or spreadsheet imports.
 */
const externallyManagedCustomerFields = new Set(["automaticUpdatedAt"]);

/** Preserve compatibility with the existing Feishu automation, which cannot
 * currently add a source marker. First-party spreadsheet imports must identify
 * themselves explicitly as manual. */
export function isFeishuCustomerImport(source: unknown): boolean {
  return source === undefined || source === "feishu";
}

export function mergeManualCustomerUpdate(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const safeUpdates = Object.fromEntries(
    Object.entries(updates).filter(([key]) => !externallyManagedCustomerFields.has(key)),
  );
  return { ...existing, ...safeUpdates };
}

export function mergeFeishuCustomerUpdate(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>,
  automaticUpdatedAt: string,
): Record<string, unknown> {
  return {
    ...mergeManualCustomerUpdate(existing, updates),
    automaticUpdatedAt,
  };
}

export function manualCustomerDatabaseUpdate(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>,
): { summary_data: Record<string, unknown>; contact_name: string } {
  const summary = mergeManualCustomerUpdate(existing, updates);
  return {
    summary_data: summary,
    contact_name: typeof summary.contactName === "string" ? summary.contactName : "",
  };
}
