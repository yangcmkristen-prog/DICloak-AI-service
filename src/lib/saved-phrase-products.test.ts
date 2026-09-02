import assert from "node:assert/strict";
import test from "node:test";
import { convertSavedPhraseProduct, createSavedPhraseProductVersions } from "./saved-phrase-products.ts";

test("creates canonical product text and preserves URL paths", () => {
  const original = "打开 DICloak：https://help.dicloak.com/guide/dicloak-start?from=dicloak#top";
  assert.equal(
    convertSavedPhraseProduct(original, "paraturbo"),
    "打开 Paraturbo：https://help.paraturbo.com/guide/paraturbo-start?from=paraturbo#top",
  );
});

test("converts mixed historical brands in both directions", () => {
  assert.equal(convertSavedPhraseProduct("Paraturbo / paraturbo.com", "dicloak"), "DICloak / dicloak.com");
  assert.equal(convertSavedPhraseProduct("DICLOAK / help.dicloak.com", "paraturbo"), "Paraturbo / help.paraturbo.com");
});

test("prebuilds every translated product version", () => {
  const versions = createSavedPhraseProductVersions("Use DICloak", { en: "Use DICloak", zh: "使用 DICloak" });
  assert.equal(versions.paraturbo.translations.zh, "使用 Paraturbo");
  assert.equal(versions.dicloak.translations.en, "Use DICloak");
});
