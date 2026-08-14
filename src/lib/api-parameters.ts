type ApiParameterWithId = { apiId?: string };

/** Keep shared rows without api_id available for every matched API endpoint. */
export function selectApiParameters<T extends ApiParameterWithId>(parameters: T[], matchedApiIds: string[]): T[] {
  const matchedIds = new Set(matchedApiIds.filter(Boolean));
  return parameters.filter((parameter) => {
    const apiId = parameter.apiId?.trim() ?? "";
    return apiId.length === 0 || matchedIds.has(apiId);
  });
}