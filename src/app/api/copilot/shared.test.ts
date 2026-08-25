import assert from "node:assert/strict";
import test from "node:test";
import { createStreamContentAccumulator, getModelRequest, messagesAfterSummary, normalizeMessageTimestamp, snapshotToTranscript, type CopilotChatMessage } from "./shared";

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

test("stream accumulator appends real token deltas", () => {
  const accumulate = createStreamContentAccumulator();
  assert.equal(accumulate("I thought"), "I thought");
  assert.equal(accumulate(" so"), " so");
  assert.equal(accumulate(" too."), " too.");
});

test("stream accumulator removes repeated cumulative snapshots", () => {
  const accumulate = createStreamContentAccumulator();
  assert.equal(accumulate("That"), "That");
  assert.equal(accumulate("That explains"), " explains");
  assert.equal(accumulate("That explains it."), " it.");
  assert.equal(accumulate("That explains it."), "");
});

test("TokenLab Qwen MT models receive translation options", () => {
  const { endpoint, requestBody } = getModelRequest(
    { provider: "gpt", apiKey: "test-key", model: "qwen-mt-plus", baseUrl: "https://api.tokenlab.sh/v1" },
    "system instructions",
    "我说呢",
    0.1,
    { sourceLang: "Chinese", targetLang: "English", terms: [{ source: "环境", target: "profile" }] },
  );

  assert.equal(endpoint, "https://api.tokenlab.sh/v1/chat/completions");
  assert.deepEqual(requestBody.messages, [{ role: "user", content: "我说呢" }]);
  assert.deepEqual(requestBody.translation_options, {
    source_lang: "Chinese",
    target_lang: "English",
    terms: [{ source: "环境", target: "profile" }],
  });
});
