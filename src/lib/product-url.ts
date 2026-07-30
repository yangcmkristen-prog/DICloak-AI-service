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