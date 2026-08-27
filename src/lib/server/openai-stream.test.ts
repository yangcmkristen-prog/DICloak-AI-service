import assert from "node:assert/strict";
import test from "node:test";
import { consumeOpenAIStream } from "./openai-stream.ts";
import { consumeEventStream, encodeStreamEvent, type ChatStreamEvent } from "../stream-events.ts";

const encoder = new TextEncoder();

function mockModelStream(parts: string[], failAfter?: number): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      for (const [index, part] of parts.entries()) {
        await new Promise((resolve) => setTimeout(resolve, 2));
        if (failAfter === index) {
          controller.error(new Error("mock model interrupted"));
          return;
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

function chunkBytes(bytes: Uint8Array, sizes: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      let offset = 0;
      for (const size of sizes) {
        if (offset >= bytes.length) break;
        controller.enqueue(bytes.slice(offset, offset + size));
        offset += size;
      }
      if (offset < bytes.length) controller.enqueue(bytes.slice(offset));
      controller.close();
    },
  });
}

test("sends the first body delta before the model completes and preserves final content", async () => {
  let completed = false;
  let firstWasEarly = false;
  const expected = "你好 Привет مرحبا 😀 https://dicloak.com/?a=1&b=<x>\n特殊字符 []{}";
  const promise = consumeOpenAIStream(mockModelStream(["你好 ", "Привет مرحبا ", "😀 https://dicloak.com/?a=1&b=<x>\n特殊字符 []{}"]), () => {
    if (!completed) firstWasEarly = true;
  }).finally(() => { completed = true; });
  assert.equal(await promise, expected);
  assert.equal(firstWasEarly, true);
});

test("arbitrary byte chunk boundaries do not lose, duplicate, reorder, or corrupt text", async () => {
  const expected = "中文Русскийالعربية🧪URL:https://example.com/a?x=1&y=%20 <> & \\\"";
  const wire = encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: expected } }] })}\n\ndata: [DONE]\n\n`);
  for (const sizes of [[1], [2, 3, 1, 7], Array.from({ length: wire.length }, () => 1)]) {
    const deltas: string[] = [];
    const result = await consumeOpenAIStream(chunkBytes(wire, sizes), (delta) => deltas.push(delta));
    assert.equal(result, expected);
    assert.equal(deltas.join(""), expected);
  }
});

test("cancellation stops subsequent model output", async () => {
  const abortController = new AbortController();
  const received: string[] = [];
  await assert.rejects(
    consumeOpenAIStream(mockModelStream(["first", "second", "third"]), (delta) => {
      received.push(delta);
      abortController.abort();
    }, { signal: abortController.signal }),
    (error: unknown) => error instanceof DOMException && error.name === "AbortError",
  );
  assert.deepEqual(received, ["first"]);
});

test("two concurrent model streams remain isolated", async () => {
  const left: string[] = [];
  const right: string[] = [];
  const [leftFinal, rightFinal] = await Promise.all([
    consumeOpenAIStream(mockModelStream(["A1", "A2"]), (value) => left.push(value)),
    consumeOpenAIStream(mockModelStream(["B1", "B2"]), (value) => right.push(value)),
  ]);
  assert.equal(leftFinal, "A1A2");
  assert.equal(rightFinal, "B1B2");
  assert.deepEqual(left, ["A1", "A2"]);
  assert.deepEqual(right, ["B1", "B2"]);
});

test("a mid-stream model error is explicit to the pipeline", async () => {
  await assert.rejects(consumeOpenAIStream(mockModelStream(["ok", "never"], 1), () => undefined), /mock model interrupted/);
});

test("metadata and status events are never treated as customer body", async () => {
  const events: ChatStreamEvent[] = [
    { type: "meta", requestId: "r1", data: { internal: "do not show" } },
    { type: "status", requestId: "r1", label: "internal status", elapsedMs: 2 },
    { type: "delta", requestId: "r1", content: "customer " },
    { type: "final", requestId: "r1", content: "customer answer" },
  ];
  const bytes = encoder.encode(events.map((event) => new TextDecoder().decode(encodeStreamEvent(event))).join(""));
  let displayed = "";
  await consumeEventStream(chunkBytes(bytes, Array.from({ length: bytes.length }, (_, index) => index % 5 + 1)), (event) => {
    if (event.type === "delta") displayed += event.content;
    if (event.type === "final") displayed = event.content;
  });
  assert.equal(displayed, "customer answer");
  assert.doesNotMatch(displayed, /internal/);
});
