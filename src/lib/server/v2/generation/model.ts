import { getSupabaseClient } from "@/storage/database/supabase-client";
import { consumeOpenAIStream } from "@/lib/server/openai-stream";

export interface V2ModelUsage { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
export interface V2ModelConfig { baseUrl: string; apiKey: string; model: string }

interface StoredConfig { apiKey?: unknown; baseUrl?: unknown; v2Model?: unknown; customConfig?: { endpoint?: unknown } }

export async function resolveV2ModelConfig(): Promise<V2ModelConfig | null> {
  let stored: StoredConfig | null = null;
  if (!process.env.V2_CHAT_API_KEY || !process.env.V2_CHAT_BASE_URL) {
    try {
      const { data } = await getSupabaseClient().from("system_configs").select("config_value").eq("config_key", "default").maybeSingle();
      const value = data?.config_value as { apiConfig?: StoredConfig } | undefined;
      stored = value?.apiConfig ?? null;
    } catch { stored = null; }
  }
  const apiKey = process.env.V2_CHAT_API_KEY || (typeof stored?.apiKey === "string" ? stored.apiKey : "");
  const baseUrl = process.env.V2_CHAT_BASE_URL || (typeof stored?.baseUrl === "string" ? stored.baseUrl : "");
  const model = process.env.V2_CHAT_MODEL || (typeof stored?.v2Model === "string" ? stored.v2Model : "gpt-5.6");
  return apiKey && baseUrl && model ? { apiKey, baseUrl, model } : null;
}

function completionsUrl(config: V2ModelConfig): string {
  const base = config.baseUrl.replace(/\/$/, "");
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
}

export async function streamV2Model(input: { config: V2ModelConfig; messages: Array<{ role: "system" | "user"; content: string }>; signal: AbortSignal; onDelta: (delta: string) => void; onUsage: (usage: V2ModelUsage) => void }): Promise<string> {
  const reasoningEffort = process.env.V2_CHAT_REASONING_EFFORT;
  const configuredLimit = Number(process.env.V2_CHAT_MAX_COMPLETION_TOKENS ?? "2048");
  const maxCompletionTokens = Number.isInteger(configuredLimit) && configuredLimit >= 256 ? configuredLimit : 2048;
  const response = await fetch(completionsUrl(input.config), {
    method: "POST", signal: input.signal,
    headers: { authorization: `Bearer ${input.config.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: input.config.model, messages: input.messages, temperature: 0.1, max_completion_tokens: maxCompletionTokens, ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}), stream: true, stream_options: { include_usage: true } }),
  });
  if (!response.ok) throw new Error(`V2 主模型调用失败：HTTP ${response.status}`);
  if (!response.body) throw new Error("V2 主模型没有返回响应流");
  return consumeOpenAIStream(response.body, input.onDelta, { signal: input.signal, onUsage: (usage) => input.onUsage(usage as V2ModelUsage) });
}
