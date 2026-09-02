import type { ProductName } from "./types";

export type SavedPhraseProduct = ProductName;
export type SavedPhraseProductSelection = SavedPhraseProduct | "original";

export type SavedPhraseVersion = {
  sourceText: string;
  translations: Record<string, string>;
};

export type ProductPhraseVersions = Record<SavedPhraseProduct, SavedPhraseVersion>;

const PRODUCT_BRANDS: Record<SavedPhraseProduct, string> = {
  dicloak: "DICloak",
  paraturbo: "Paraturbo",
};

/** Converts brand mentions and official domains without touching URL paths. */
export function convertSavedPhraseProduct(text: string, product: SavedPhraseProduct): string {
  const targetBrand = PRODUCT_BRANDS[product];

  return text.replace(/(?:DICloak|Paraturbo)/gi, (brand) => {
    if (brand === brand.toLowerCase()) return targetBrand.toLowerCase();
    return targetBrand;
  });
}

export function createSavedPhraseProductVersions(
  sourceText: string,
  translations: Record<string, string>,
): ProductPhraseVersions {
  const createVersion = (product: SavedPhraseProduct): SavedPhraseVersion => ({
    sourceText: convertSavedPhraseProduct(sourceText, product),
    translations: Object.fromEntries(
      Object.entries(translations).map(([language, text]) => [language, convertSavedPhraseProduct(text, product)]),
    ),
  });

  return {
    dicloak: createVersion("dicloak"),
    paraturbo: createVersion("paraturbo"),
  };
}
