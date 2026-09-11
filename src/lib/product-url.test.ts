import assert from "node:assert/strict";
import test from "node:test";
import { rewriteProductBrand, rewriteProductContent, rewriteProductDomains } from "./product-url.ts";

test("rewrites reusable DICloak FAQ branding for a Paraturbo conversation", () => {
  const faqAnswer = "请打开 DICloak，并参考 https://help.dicloak.com/features/profile?from=faq#setup。";
  const linked = rewriteProductDomains(faqAnswer, "paraturbo");

  assert.equal(
    rewriteProductBrand(linked, "paraturbo"),
    "请打开 Paraturbo，并参考 https://help.paraturbo.com/features/profile?from=faq#setup。",
  );
});

test("preserves explicit cross-product comparison branding", () => {
  assert.equal(rewriteProductBrand("DICloak 与 Paraturbo", "paraturbo", true), "DICloak 与 Paraturbo");
});

test("normalizes every DICloak casing and domain to the selected Paraturbo product", () => {
  assert.equal(
    rewriteProductContent("DICloak dicloak Dicloak DICLOAK https://help.DICLOAK.com/a", "paraturbo"),
    "Paraturbo Paraturbo Paraturbo Paraturbo https://help.paraturbo.com/a",
  );
});

test("normalizes Paraturbo branding and domains to the selected DICloak product", () => {
  assert.equal(
    rewriteProductContent("Paraturbo PARATURBO https://help.paraturbo.com/a", "dicloak"),
    "DICloak DICloak https://help.dicloak.com/a",
  );
});
