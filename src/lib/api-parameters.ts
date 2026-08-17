import type { ProductName, SupportedProduct } from "./types";

type ProductScoped = { supportedProduct?: SupportedProduct };
type ApiParameterWithId = { apiId?: string };
type SearchableApiEndpoint = ProductScoped & { searchKeywords?: string };

function supportsProduct(item: ProductScoped, product: ProductName): boolean {
  return !item.supportedProduct || item.supportedProduct === "all" || item.supportedProduct === product;
}

export function splitSearchKeywords(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,，;；\n]+/)
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Find every endpoint for the selected product that shares a keyword found in
 * the customer's question. If no configured keyword is hit, preserve the
 * deterministic action/object matches supplied by the caller.
 */
export function selectApiEndpointsByProductAndKeywords<T extends SearchableApiEndpoint>(
  allEndpoints: T[],
  directlyMatchedEndpoints: T[],
  product: ProductName,
  question: string,
): T[] {
  const compatibleEndpoints = allEndpoints.filter((endpoint) => supportsProduct(endpoint, product));
  const normalizedQuestion = question.toLowerCase();
  const hitKeywords = new Set(
    compatibleEndpoints
      .flatMap((endpoint) => splitSearchKeywords(endpoint.searchKeywords))
      .filter((keyword) => normalizedQuestion.includes(keyword)),
  );

  if (hitKeywords.size > 0) {
    return compatibleEndpoints.filter((endpoint) =>
      splitSearchKeywords(endpoint.searchKeywords).some((keyword) => hitKeywords.has(keyword)),
    );
  }

  const directMatches = new Set(directlyMatchedEndpoints);
  return compatibleEndpoints.filter((endpoint) => directMatches.has(endpoint));
}

/** Keep every parameter for matched api_ids plus every unscoped parameter row. */
export function selectApiParameters<T extends ApiParameterWithId>(
  parameters: T[],
  matchedApiIds: string[],
): T[] {
  const matchedIds = new Set(matchedApiIds.filter(Boolean));
  return parameters.filter((parameter) => {
    const apiId = parameter.apiId?.trim() ?? "";
    return apiId.length === 0 || matchedIds.has(apiId);
  });
}