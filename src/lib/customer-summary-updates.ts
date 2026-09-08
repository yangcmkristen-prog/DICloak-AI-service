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
