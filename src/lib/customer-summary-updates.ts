/**
 * Fields owned by an external synchronization source must never be overwritten
 * by manual edits or spreadsheet imports.
 */
const externallyManagedCustomerFields = new Set(["automaticUpdatedAt"]);

export function mergeManualCustomerUpdate(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const safeUpdates = Object.fromEntries(
    Object.entries(updates).filter(([key]) => !externallyManagedCustomerFields.has(key)),
  );
  return { ...existing, ...safeUpdates };
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
