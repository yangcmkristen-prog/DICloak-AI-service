import assert from "node:assert/strict";
import test from "node:test";

import type { TermItem } from "@/lib/types";
import { translateTermPlaceholders } from "@/lib/term-translation";

const createProfileTerm: TermItem = {
  id: "1",
  termId: "profile_create",
  module1: "Profiles",
  module2: "",
  termCN: "创建环境",
  termEN: "Create Profile",
  termPT: "Criar perfil",
  termType: "button",
  definition: "",
  isUiVisible: true,
};

test("translates linked FAQ placeholders using imported TermItem fields", () => {
  assert.equal(
    translateTermPlaceholders("Clique em {{Create Profile}}.", ["profile_create"], "pt", [createProfileTerm]),
    "Clique em Criar perfil."
  );
});

test("does not replace placeholders that are not linked by term id", () => {
  assert.equal(
    translateTermPlaceholders("Clique em {{Create Profile}}.", ["another_term"], "pt", [createProfileTerm]),
    "Clique em {{Create Profile}}."
  );
});

test("does not replace unmarked terminology in standard answers", () => {
  assert.equal(
    translateTermPlaceholders("Clique em Create Profile.", ["profile_create"], "pt", [createProfileTerm]),
    "Clique em Create Profile."
  );
});
