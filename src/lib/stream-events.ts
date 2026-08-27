export type ChatStreamEvent =
  | { type: "meta"; requestId: string; data: Record<string, unknown> }
  | { type: "status"; requestId: string; label: string; detail?: string; elapsedMs: number }
  | { type: "delta"; requestId: string; content: string }
  | { type: "final"; requestId: string; content: string }
  | { type: "error"; requestId: string; message: string };

export function encodeStreamEvent(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

export async function consumeEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const consumeLine = (line: string): void => {
    if (!line.trim()) return;
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== "object" || !("type" in value) || !("requestId" in value)) {
      throw new Error("无效的流事件");
    }
    onEvent(value as ChatStreamEvent);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(consumeLine);
    }
    buffer += decoder.decode();
    if (buffer) consumeLine(buffer);
  } finally {
    reader.releaseLock();
  }
}
