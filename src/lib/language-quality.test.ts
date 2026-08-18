import assert from "node:assert/strict";
import test from "node:test";
import {
  countUnexpectedChineseReplyEnglish,
  hasUnexpectedChineseReplyEnglish,
  hasUnexpectedReplyScript,
} from "./language-quality";

test("detects English clauses mixed into a Chinese customer reply", () => {
  const reply = "目前可以确认的是：What I can currently confirm is that DICloak 支持本地接口。";

  assert.equal(hasUnexpectedChineseReplyEnglish(reply), true);
  assert.ok(countUnexpectedChineseReplyEnglish(reply) > 0);
});

test("detects English clauses in non-Latin replies but allows technical identifiers", () => {
  assert.equal(hasUnexpectedReplyScript("DICloak поддерживает API. Please configure it first.", "ru"), true);
  assert.equal(hasUnexpectedReplyScript("DICloak поддерживает API и WebGPU.", "ru"), false);
});

test("detects foreign-script clauses in Latin-language replies", () => {
  assert.equal(hasUnexpectedReplyScript("Puede configurar la API. 请先打开设置页面。", "es"), true);
});

test("detects non-English foreign clauses in Chinese replies", () => {
  assert.equal(hasUnexpectedReplyScript("请先确认当前配置。Пожалуйста, откройте настройки.", "zh"), true);
});

test("allows product names and technical identifiers in a Chinese reply", () => {
  const reply = "DICloak 的 Open API 可以返回 JSON，通过 HTTPS URL 调用 Plus，并配置 WebGPU 与 WebGL 指纹。";

  assert.equal(hasUnexpectedChineseReplyEnglish(reply), false);
  assert.equal(countUnexpectedChineseReplyEnglish(reply), 0);
});

test("ignores section markers and URLs during language QA", () => {
  const reply = "[[main]]请查看 https://help.dicloak.com/api/setup 获取 API 配置说明。[[/main]]";

  assert.equal(hasUnexpectedChineseReplyEnglish(reply), false);
});