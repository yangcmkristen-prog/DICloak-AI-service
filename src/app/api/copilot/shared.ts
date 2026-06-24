import { getSupabaseClient } from '@/storage/database/supabase-client';

export interface CopilotChatMessage {
  id?: string;
  role: 'customer' | 'agent' | 'system' | 'unknown';
  text: string;
  rawTimeText?: string;
}

export interface CopilotChatInfo {
  platform: 'whatsapp';
  externalChatId: string;
  displayName: string;
  avatarUrl?: string;
  onlineStatus?: string;
}

export interface CopilotSnapshot {
  chat: CopilotChatInfo;
  messages: CopilotChatMessage[];
  sourceMessageHash: string;
}

export interface ApiConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
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
  if (typeof displayName !== 'string' || typeof externalChatId !== 'string') return null;

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
      };
    })
    .filter((message): message is CopilotChatMessage => message !== null);

  return {
    chat: {
      platform: 'whatsapp',
      externalChatId,
      displayName,
      avatarUrl: typeof chatRecord.avatarUrl === 'string' ? chatRecord.avatarUrl : undefined,
      onlineStatus: typeof chatRecord.onlineStatus === 'string' ? chatRecord.onlineStatus : undefined,
    },
    messages: normalizedMessages,
    sourceMessageHash,
  };
}

export function snapshotToTranscript(snapshot: CopilotSnapshot): string {
  return snapshot.messages
    .slice(-40)
    .map((message) => {
      const speaker = message.role === 'agent' ? '客服' : message.role === 'customer' ? '客户' : '系统';
      const time = message.rawTimeText ? ` ${message.rawTimeText}` : '';
      return `[${speaker}${time}] ${message.text}`;
    })
    .join('\n');
}

export function getLatestCustomerMessage(snapshot: CopilotSnapshot): string {
  const latest = [...snapshot.messages].reverse().find((message) => message.role === 'customer');
  return latest?.text || snapshot.messages.at(-1)?.text || '';
}

export async function getBackendApiConfig(): Promise<ApiConfig | null> {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('system_configs')
      .select('*')
      .eq('config_key', 'default')
      .maybeSingle();

    if (error || !data?.config_value?.apiConfig) {
      return null;
    }

    return data.config_value.apiConfig as ApiConfig;
  } catch (error) {
    console.error('[Copilot] 获取后端配置失败:', error);
    return null;
  }
}

export async function getExtensionTranslateApiConfig(): Promise<ApiConfig | null> {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('system_configs')
      .select('*')
      .eq('config_key', 'default')
      .maybeSingle();

    if (error || !data?.config_value?.extensionTranslateApiConfig) {
      return null;
    }

    return data.config_value.extensionTranslateApiConfig as ApiConfig;
  } catch (error) {
    console.error('[Copilot] 获取扩展翻译配置失败:', error);
    return null;
  }
}

async function callTextModelWithConfig(config: ApiConfig | null, systemPrompt: string, userPrompt: string, temperature: number): Promise<string> {
  if (!config?.apiKey) {
    throw new Error('未配置 API Key，请先在网页端设置中配置');
  }

  const baseUrl = config.baseUrl
    || (config.provider === 'deepseek'
      ? 'https://api.deepseek.com'
      : config.provider === 'aliyun'
        ? 'https://dashscope.aliyuncs.com/compatible-mode/v1'
        : 'https://api.coze.cn/v1');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || 'doubao-seed-2-0-lite-260215',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
    }),
  });

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (!response.ok) {
    throw new Error(data.error?.message || '模型请求失败');
  }

  return data.choices?.[0]?.message?.content?.trim() || '';
}

export async function callTextModel(systemPrompt: string, userPrompt: string, temperature: number): Promise<string> {
  return callTextModelWithConfig(await getBackendApiConfig(), systemPrompt, userPrompt, temperature);
}

export async function callExtensionTranslateModel(systemPrompt: string, userPrompt: string, temperature: number): Promise<string> {
  return callTextModelWithConfig(await getExtensionTranslateApiConfig(), systemPrompt, userPrompt, temperature);
}