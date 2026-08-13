import assert from "node:assert/strict";
import test from "node:test";
import { detectNonLatinLanguage, getCopilotLanguageHint } from "./copilot-language";

test("keeps Chinese extension questions in Chinese when they contain product names", () => {
  assert.equal(
    getCopilotLanguageHint("有些杀毒软件会将 DICloak 的程序识别为有害程序，应如何解释？"),
    "zh",
  );
});

test("detects Chinese from three characters even when English occupies most of the message", () => {
  assert.equal(getCopilotLanguageHint("local api version one and version two 有什么区别"), "zh");
});

test("does not infer a language from fewer than three non-Latin characters", () => {
  assert.equal(getCopilotLanguageHint("local api v1 和 v2"), undefined);
});

test("detects other non-Latin scripts using the same three-character rule", () => {
  assert.equal(detectNonLatinLanguage("API version difference какая"), "ru");
  assert.equal(detectNonLatinLanguage("APIの違いは何ですか"), "ja");
});

test("does not override a non-Chinese extension question", () => {
  assert.equal(getCopilotLanguageHint("How can I explain this antivirus warning?"), undefined);
});