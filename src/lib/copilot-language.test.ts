import assert from "node:assert/strict";
import test from "node:test";
import { getCopilotLanguageHint } from "./copilot-language";

test("keeps Chinese extension questions in Chinese when they contain product names", () => {
  assert.equal(
    getCopilotLanguageHint("有些杀毒软件会将 DICloak 的程序识别为有害程序，应如何解释？"),
    "zh",
  );
});

test("does not override a non-Chinese extension question", () => {
  assert.equal(getCopilotLanguageHint("How can I explain this antivirus warning?"), undefined);
});