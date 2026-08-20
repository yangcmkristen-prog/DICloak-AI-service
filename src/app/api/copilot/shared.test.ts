import assert from "node:assert/strict";
import test from "node:test";
import { messagesAfterSummary, normalizeMessageTimestamp, snapshotToTranscript, type CopilotChatMessage } from "./shared";

const messages: CopilotChatMessage[] = [
  { id: "old", role: "customer", text: "old", timestamp: 1_700_000_000_000 },
  { id: "new", role: "customer", text: "new", timestamp: 1_700_000_060_000 },
];

test("incremental summaries use the saved message boundary", () => {
  assert.deepEqual(messagesAfterSummary(messages, { lastMessageId: "old" }, Date.now()), [messages[1]]);
});

test("legacy summaries retain undated Telegram messages", () => {
  const undated = { id: "tg-new", role: "customer" as const, text: "new request" };
  assert.deepEqual(messagesAfterSummary([messages[0], undated], undefined, 1_800_000_000_000), [undated]);
});

test("invalid Telegram IDs are not interpreted as timestamps", () => {
  assert.equal(normalizeMessageTimestamp(99_999_999_999_999), undefined);
});

test("AI transcripts use complete Shanghai dates", () => {
  const transcript = snapshotToTranscript({
    chat: { platform: "telegram", externalChatId: "chat", displayName: "Customer" },
    messages: [{ ...messages[0], timestamp: Date.UTC(2026, 7, 18, 16, 30), rawTimeText: "00:30" }],
    sourceMessageHash: "hash",
  });
  assert.match(transcript, /2026\/08\/19 00:30/);
});
