import { getSupabaseClient } from '@/storage/database/supabase-client';

export interface CopilotChatMessage {
  id?: string;
  role: 'customer' | 'agent' | 'system' | 'unknown';
  text: string;
  rawTimeText?: string;
  timestamp?: number;
}

export interface CopilotChatInfo {
  platform: 'whatsapp' | 'telegram';
  externalChatId: string;
  displayName: string;
  contactDetail?: string;
  teamId?: string;
  avatarUrl?: string;
  onlineStatus?: string;
  confirmedRole?: 'client' | 'end_user';
}

export interface CopilotSnapshot {
  chat: CopilotChatInfo;
  messages: CopilotChatMessage[];
  sourceMessageHash: string;
}

export interface SummaryCursor {
  lastMessageId?: string;
  summarizedAt?: string;
}

export interface ApiConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  customConfig?: {
    endpoint?: string;
    modelName?: string;
  };
}

const SYSTEM_CONFIG_CACHE_TTL_MS = 10 * 60_000;
let systemConfigCache: { value: Record<string, unknown>; expiresAt: number } | null = null;
let systemConfigRequest: Promise<Record<string, unknown> | null> | null = null;

async function fetchSystemConfigValue(): Promise<Record<string, unknown> | null> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('system_configs')
    .select('config_value')
    .eq('config_key', 'default')
    .maybeSingle();

  if (error || !data?.config_value || typeof data.config_value !== 'object' || Array.isArray(data.config_value)) {
    return null;
  }

  return data.config_value as Record<string, unknown>;
}

async function getSystemConfigValue(): Promise<Record<string, unknown> | null> {
  const now = Date.now();
  if (systemConfigCache && systemConfigCache.expiresAt > now) {
    return systemConfigCache.value;
  }

  if (!systemConfigRequest) {
    systemConfigRequest = fetchSystemConfigValue()
      .then((value) => {
        if (value) {
          systemConfigCache = {
            value,
            expiresAt: Date.now() + SYSTEM_CONFIG_CACHE_TTL_MS,
          };
        }
        return value;
      })
      .finally(() => {
        systemConfigRequest = null;
      });
  }

  return systemConfigRequest;
}

export function invalidateSystemConfigCache(): void {
  systemConfigCache = null;
  systemConfigRequest = null;
}

export function validateSnapshot(value: unknown): CopilotSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const chat = record.chat;
  const messages = record.messages;
  const sourceMessageHash = record.sourceMessageHash;

  if (!chat || typeof chat !== 'object' || !Array.isArray(messages) || typeof sourceMessageHash !== 'string') {
    return null;
  }

  const chatRecord = chat as Record<string, unknown>;
  const displayName = chatRecord.displayName;
  const externalChatId = chatRecord.externalChatId;
  const platform = chatRecord.platform;
  if (typeof displayName !== 'string' || typeof externalChatId !== 'string') return null;
  if (platform !== 'whatsapp' && platform !== 'telegram') return null;

  const normalizedMessages = messages
    .map((message): CopilotChatMessage | null => {
      if (!message || typeof message !== 'object') return null;
      const messageRecord = message as Record<string, unknown>;
      const text = messageRecord.text;
      const role = messageRecord.role;
      if (typeof text !== 'string' || text.trim().length === 0) return null;
      const normalizedRole = role === 'customer' || role === 'agent' || role === 'system' || role === 'unknown' ? role : 'unknown';
      return {
        id: typeof messageRecord.id === 'string' ? messageRecord.id : undefined,
        role: normalizedRole,
        text: text.trim(),
        rawTimeText: typeof messageRecord.rawTimeText === 'string' ? messageRecord.rawTimeText : undefined,
        timestamp: typeof messageRecord.timestamp === 'number' ? messageRecord.timestamp : undefined,
      };
    })
    .filter((message): message is CopilotChatMessage => message !== null);

  return {
    chat: {
      platform,
      externalChatId,
      displayName,
      contactDetail: typeof chatRecord.contactDetail === 'string' ? chatRecord.contactDetail : undefined,
      teamId: typeof chatRecord.teamId === 'string' ? chatRecord.teamId : undefined,
      avatarUrl: typeof chatRecord.avatarUrl === 'string' ? chatRecord.avatarUrl : undefined,
      onlineStatus: typeof chatRecord.onlineStatus === 'string' ? chatRecord.onlineStatus : undefined,
      confirmedRole: chatRecord.confirmedRole === 'client' || chatRecord.confirmedRole === 'end_user' ? chatRecord.confirmedRole : undefined,
    },
    messages: normalizedMessages,
    sourceMessageHash,
  };
}

export function snapshotToTranscript(snapshot: CopilotSnapshot, options?: { maxMessages?: number }): string {
  const messages = typeof options?.maxMessages === 'number'
    ? snapshot.messages.slice(-options.maxMessages)
    : snapshot.messages;

  return messages
    .map((message) => {
      const speaker = message.role === 'agent' ? '客服' : message.role === 'customer' ? '客户' : '系统';
      const normalizedTimestamp = normalizeMessageTimestamp(message.timestamp);
      const timeText = normalizedTimestamp
        ? new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
          }).format(new Date(normalizedTimestamp))
        : message.rawTimeText;
      const time = timeText ? ` ${timeText}` : '';
      return `[${speaker}${time}] ${message.text}`;
    })
    .join('\n');
}

export function normalizeMessageTimestamp(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
  const earliest = Date.UTC(2013, 0, 1);
  const latest = Date.now() + 24 * 60 * 60 * 1000;
  return milliseconds >= earliest && milliseconds <= latest ? milliseconds : undefined;
}

export function messagesAfterSummary(
  messages: CopilotChatMessage[], cursor: SummaryCursor | undefined, summarizedAt: number,
): CopilotChatMessage[] {
  if (cursor?.lastMessageId) {
    const boundary = messages.findIndex((message) => message.id === cursor.lastMessageId);
    if (boundary >= 0) return messages.slice(boundary + 1);
  }
  return messages.filter((message) => {
    const timestamp = normalizeMessageTimestamp(message.timestamp);
    return timestamp === undefined || timestamp > summarizedAt;
  });
}

export function getLatestCustomerMessage(snapshot: CopilotSnapshot): string {
  const latest = [...snapshot.messages].reverse().find((message) => message.role === 'customer');
  return latest?.text || snapshot.messages.at(-1)?.text || '';
}

export async function getBackendApiConfig(): Promise<ApiConfig | null> {
  try {
    const configValue = await getSystemConfigValue();
    if (!configValue?.apiConfig) {
      return null;
    }

    return configValue.apiConfig as ApiConfig;
  } catch (error) {
    console.error('[Copilot] 获取后端配置失败:', error);
    return null;
  }
}

export async function getExtensionTranslateApiConfig(): Promise<ApiConfig | null> {
  try {
    const configValue = await getSystemConfigValue();
    if (!configValue?.extensionTranslateApiConfig) {
      return null;
    }

    return configValue.extensionTranslateApiConfig as ApiConfig;
  } catch (error) {
    console.error('[Copilot] 获取扩展翻译配置失败:', error);
    return null;
  }
}

type TranslationTerm = {
  source: string;
  target: string;
};

type TranslationOptions = {
  sourceLang: string;
  targetLang: string;
  terms?: TranslationTerm[];
  domains?: string;
};

async function callTextModelWithConfig(config: ApiConfig | null, systemPrompt: string, userPrompt: string, temperature: number, translationOptions?: TranslationOptions): Promise<string> {
  if (!config?.apiKey) {
    throw new Error('未配置 API Key，请先在网页端设置中配置');
  }
  if (!['deepseek', 'gpt', 'aliyun', 'custom'].includes(config.provider)) {
    throw new Error('当前模型提供商已不受支持，请在网页端设置中重新选择模型');
  }

  const baseUrl = config.baseUrl
    || (config.provider === 'deepseek'
      ? 'https://api.deepseek.com'
      : config.provider === 'gpt'
        ? 'https://api.tokenlab.sh/v1'
        : 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  const isAliyunTranslationModel = config.provider === 'aliyun' && config.model.startsWith('qwen-mt-') && translationOptions;
  const messages = isAliyunTranslationModel
    ? [{ role: 'user', content: userPrompt }]
    : config.provider === 'aliyun'
      ? [{ role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }]
      : [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ];
  const requestBody: Record<string, unknown> = {
    model: config.model || (config.provider === 'gpt' ? 'gpt-5.4' : 'doubao-seed-2-0-lite-260215'),
    messages,
    temperature,
  };

  if (isAliyunTranslationModel) {
    requestBody.translation_options = {
      source_lang: translationOptions.sourceLang,
      target_lang: translationOptions.targetLang,
      ...(translationOptions.terms && translationOptions.terms.length > 0 ? { terms: translationOptions.terms } : {}),
      ...(translationOptions.domains ? { domains: translationOptions.domains } : {}),
    };
  }

  const endpoint = config.provider === 'custom' && config.customConfig?.endpoint
    ? config.customConfig.endpoint
    : `${baseUrl}/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (!response.ok) {
    throw new Error(data.error?.message || '模型请求失败');
  }

  return data.choices?.[0]?.message?.content?.trim() || '';
}

function getModelRequest(config: ApiConfig, systemPrompt: string, userPrompt: string, temperature: number, translationOptions?: TranslationOptions): { endpoint: string; requestBody: Record<string, unknown> } {
  if (!config.apiKey) throw new Error('未配置 API Key，请先在网页端设置中配置');
  if (!['deepseek', 'gpt', 'aliyun', 'custom'].includes(config.provider)) {
    throw new Error('当前模型提供商已不受支持，请在网页端设置中重新选择模型');
  }

  const baseUrl = config.baseUrl
    || (config.provider === 'deepseek'
      ? 'https://api.deepseek.com'
      : config.provider === 'gpt'
        ? 'https://api.tokenlab.sh/v1'
        : 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  const isAliyunTranslationModel = config.provider === 'aliyun' && config.model.startsWith('qwen-mt-') && translationOptions;
  const messages = isAliyunTranslationModel
    ? [{ role: 'user', content: userPrompt }]
    : config.provider === 'aliyun'
      ? [{ role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }]
      : [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }];
  const requestBody: Record<string, unknown> = {
    model: config.model || (config.provider === 'gpt' ? 'gpt-5.4' : 'doubao-seed-2-0-lite-260215'),
    messages,
    temperature,
  };
  if (isAliyunTranslationModel) {
    requestBody.translation_options = {
      source_lang: translationOptions.sourceLang,
      target_lang: translationOptions.targetLang,
      ...(translationOptions.terms?.length ? { terms: translationOptions.terms } : {}),
      ...(translationOptions.domains ? { domains: translationOptions.domains } : {}),
    };
  }
  return {
    endpoint: config.provider === 'custom' && config.customConfig?.endpoint
      ? config.customConfig.endpoint
      : `${baseUrl}/chat/completions`,
    requestBody,
  };
}

function readStreamDelta(payload: string): string {
  try {
    const data = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
    return data.choices?.[0]?.delta?.content || data.choices?.[0]?.message?.content || '';
  } catch {
    return '';
  }
}

export async function callExtensionTranslateModelStream(
  config: ApiConfig | null,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  translationOptions?: TranslationOptions,
): Promise<ReadableStream<Uint8Array>> {
  if (!config) throw new Error('未配置 API Key，请先在网页端设置中配置');
  const { endpoint, requestBody } = getModelRequest(config, systemPrompt, userPrompt, temperature, translationOptions);
  requestBody.stream = true;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch((): { error?: { message?: string } } => ({}));
    throw new Error(data.error?.message || '模型请求失败');
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  return response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        const delta = readStreamDelta(payload);
        if (delta) controller.enqueue(encoder.encode(delta));
      }
    },
    flush(controller) {
      const trimmed = buffer.trim();
      if (!trimmed.startsWith('data:')) return;
      const delta = readStreamDelta(trimmed.slice(5).trim());
      if (delta) controller.enqueue(encoder.encode(delta));
    },
  }));
}

export async function callTextModel(systemPrompt: string, userPrompt: string, temperature: number): Promise<string> {
  return callTextModelWithConfig(await getBackendApiConfig(), systemPrompt, userPrompt, temperature);
}

export async function callExtensionTranslateModel(systemPrompt: string, userPrompt: string, temperature: number, translationOptions?: TranslationOptions, config?: ApiConfig | null): Promise<string> {
  return callTextModelWithConfig(config === undefined ? await getExtensionTranslateApiConfig() : config, systemPrompt, userPrompt, temperature, translationOptions);
}
