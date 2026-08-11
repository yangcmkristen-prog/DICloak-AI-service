import assert from "node:assert/strict";
import test from "node:test";

import type { TermItem } from "@/lib/types";
import { enforceReplyTerminology, translateTermPlaceholders } from "@/lib/term-translation";

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

test("replaces leaked English UI labels in the completed reply", () => {
  assert.equal(
    enforceReplyTerminology('Clique em "Create Profile" e não em Create Profiles.', "pt", [createProfileTerm]),
    'Clique em "Criar perfil" e não em Create Profiles.'
  );
});

test("does not rewrite terminology inside URLs", () => {
  assert.equal(
    enforceReplyTerminology("Create Profile: https://help.test/Create%20Profile", "pt", [createProfileTerm]),
    "Criar perfil: https://help.test/Create%20Profile"
  );
});