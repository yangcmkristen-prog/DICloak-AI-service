export const customerChannelOptions = ["WhatsApp", "tg", "wechat", "crisp", "email"] as const;

export type CustomerChannel = (typeof customerChannelOptions)[number];

const channelAliases: Record<string, CustomerChannel> = {
  whatsapp: "WhatsApp",
  tg: "tg",
  telegram: "tg",
  wechat: "wechat",
  crisp: "crisp",
  email: "email",
};

export function parseCustomerChannels(value: string): CustomerChannel[] {
  const channels = value
    .split(/[、,，;；]+/)
    .map((item) => channelAliases[item.trim().toLowerCase()])
    .filter((item): item is CustomerChannel => Boolean(item));
  return [...new Set(channels)];
}

export function normalizeCustomerChannels(value: string): string {
  return parseCustomerChannels(value).join("、");
}

export function hasOnlySupportedCustomerChannels(value: string): boolean {
  const items = value.split(/[、,，;；]+/).map((item) => item.trim()).filter(Boolean);
  return items.length > 0 && items.every((item) => Boolean(channelAliases[item.toLowerCase()]));
}
