import assert from "node:assert/strict";
import test from "node:test";
import { parseTelegramDateLabel, telegramDateTimestamp } from "./telegram-date.ts";

test("uses the current year for Telegram date labels without a year", () => {
  assert.deepEqual(parseTelegramDateLabel("May 22", 2026), { year: 2026, monthIndex: 4, day: 22 });
});

test("keeps the explicit year in older Telegram date labels", () => {
  assert.deepEqual(parseTelegramDateLabel("December 23, 2025", 2026), { year: 2025, monthIndex: 11, day: 23 });
});

test("combines a Telegram date separator with the message bubble time", () => {
  const timestamp = telegramDateTimestamp({ year: 2026, monthIndex: 4, day: 22 }, "20:13");
  const date = new Date(timestamp);
  assert.deepEqual(
    [date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()],
    [2026, 4, 22, 20, 13],
  );
});
