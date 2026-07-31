import type { ProductName } from './types';

/**
 * Rewrites shared DICloak website and help-center links for the selected product.
 * Paths, query strings, fragments, and non-DICloak domains remain unchanged.
 */
export function rewriteProductDomains(content: string, product: ProductName): string {
  if (product !== 'paraturbo') return content;

  return content.replace(
    /\b(https?:\/\/)((?:[a-z0-9-]+\.)*)dicloak\.com\b/gi,
    (_domain, protocol: string, subdomains: string) => `${protocol}${subdomains}paraturbo.com`
  );
}

/**
 * Keeps the customer-facing brand aligned with the product selected for the
 * conversation. Cross-product comparison replies can opt out explicitly.
 */
export function rewriteProductBrand(
  content: string,
  product: ProductName,
  isProductComparison: boolean = false
): string {
  if (isProductComparison) return content;

  return product === 'paraturbo'
    ? content.replace(/\bDICloak\b/gi, 'Paraturbo')
    : content.replace(/\bParaturbo\b/gi, 'DICloak');
}