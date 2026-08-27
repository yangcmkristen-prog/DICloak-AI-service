export async function consumeOpenAIStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (content: string) => void,
  options: { signal?: AbortSignal; onUsage?: (usage: unknown) => void } = {},
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const consumeLine = (line: string): void => {
    const normalized = line.trim();
    if (!normalized.startsWith("data:")) return;
    const data = normalized.slice(5).trimStart();
    if (!data || data === "[DONE]") return;
    const parsed = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: unknown } }>;
      usage?: unknown;
      error?: { message?: string };
    };
    if (parsed.error) throw new Error(parsed.error.message || "模型流式输出失败");
    if (parsed.usage) options.onUsage?.(parsed.usage);
    const delta = parsed.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta) {
      content += delta;
      onDelta(delta);
    }
  };

  const abort = (): void => { void reader.cancel(options.signal?.reason); };
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      lines.forEach(consumeLine);
    }
    buffer += decoder.decode();
    if (buffer) consumeLine(buffer);
    return content;
  } finally {
    options.signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
