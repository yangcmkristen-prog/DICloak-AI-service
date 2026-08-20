import assert from "node:assert/strict";
import test from "node:test";
import {
  hasOnlySupportedCustomerChannels,
  normalizeCustomerChannels,
  parseCustomerChannels,
} from "./customer-channels";

test("parses and normalizes multiple customer channels", () => {
  assert.deepEqual(parseCustomerChannels("WhatsApp，tg、email,WhatsApp"), ["WhatsApp", "tg", "email"]);
  assert.equal(normalizeCustomerChannels("telegram; wechat"), "tg、wechat");
});

test("validates every imported customer channel", () => {
  assert.equal(hasOnlySupportedCustomerChannels("WhatsApp、crisp"), true);
  assert.equal(hasOnlySupportedCustomerChannels("WhatsApp、sms"), false);
  assert.equal(hasOnlySupportedCustomerChannels(""), false);
});
