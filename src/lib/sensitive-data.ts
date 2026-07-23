export type SensitiveCategory = "账号密码" | "邮箱" | "Cookie" | "ID" | "银行信息" | "设备名称";

export interface SensitiveFinding {
  id: string;
  category: SensitiveCategory;
  value: string;
  messageIndex: number;
  start: number;
  end: number;
}

type DetectionRule = { category: SensitiveCategory; pattern: RegExp; valueGroup?: number };

const RULES: DetectionRule[] = [
  { category: "账号密码", pattern: /(?:账号|用户名|user(?:name)?|login)\s*[:：=]\s*([^\s,，;；]{3,})/gi, valueGroup: 1 },
  { category: "账号密码", pattern: /(?:密码|password|passwd|pwd|passcode)\s*[:：=]\s*([^\s,，;；]{3,})/gi, valueGroup: 1 },
  { category: "邮箱", pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { category: "Cookie", pattern: /(?:cookie|set-cookie)\s*[:：=]\s*([^\s,，]+(?:\s*;\s*[^\s,，]+)*)/gi, valueGroup: 1 },
  { category: "银行信息", pattern: /(?:银行卡|卡号|bank\s*(?:account|card)|IBAN|SWIFT|CVV)\s*[:：=]?\s*([A-Z0-9][A-Z0-9\s-]{5,})/gi, valueGroup: 1 },
  { category: "设备名称", pattern: /(?:设备名称|设备名|device\s*name|hostname|主机名)\s*[:：=]\s*([^\n,，;；]+?)(?=\s+(?:(?:team|user|account|profile|environment|env|device|order|团队|用户|账号|环境|设备|订单)[\s_-]*id)\s*[:：=#]|$)/gi, valueGroup: 1 },
  { category: "ID", pattern: /(?:team|user|account|profile|environment|env|device|order|团队|用户|账号|环境|设备|订单)[\s_-]*id\s*[:：=#]?\s*([A-Z0-9_-]{4,})/gi, valueGroup: 1 },
  { category: "ID", pattern: /\b(?=[A-Z0-9_-]{10,}\b)(?=[A-Z0-9_-]*[A-Z])(?=[A-Z0-9_-]*\d)[A-Z0-9_-]+\b/gi },
  { category: "ID", pattern: /\b\d{8,}\b/g },
];

export function detectSensitiveInformation(messages: Array<{ text: string }>): SensitiveFinding[] {
  const findings: SensitiveFinding[] = [];
  messages.forEach((message, messageIndex) => {
    for (const rule of RULES) {
      for (const match of message.text.matchAll(rule.pattern)) {
        const rawValue = rule.valueGroup ? match[rule.valueGroup] : match[0];
        if (!rawValue || match.index === undefined) continue;
        const value = rawValue.trim();
        const offset = rule.valueGroup ? match[0].indexOf(rawValue) + rawValue.indexOf(value) : 0;
        const start = match.index + Math.max(offset, 0);
        const end = start + value.length;
        if (findings.some((finding) => finding.messageIndex === messageIndex && finding.start < end && start < finding.end)) continue;
        findings.push({ id: `${messageIndex}-${start}-${end}-${rule.category}`, category: rule.category, value, messageIndex, start, end });
      }
    }
  });
  return findings;
}

export function redactUnapprovedFindings<T extends { text: string }>(messages: T[], findings: SensitiveFinding[], approvedIds: ReadonlySet<string>): T[] {
  const byMessage = new Map<number, SensitiveFinding[]>();
  for (const finding of findings) {
    if (approvedIds.has(finding.id)) continue;
    const values = byMessage.get(finding.messageIndex) ?? [];
    values.push(finding);
    byMessage.set(finding.messageIndex, values);
  }
  return messages.map((message, index) => {
    const matches = (byMessage.get(index) ?? []).sort((left, right) => right.start - left.start);
    let text = message.text;
    for (const finding of matches) {
      text = `${text.slice(0, finding.start)}[${finding.category}已隐藏]${text.slice(finding.end)}`;
    }
    return { ...message, text };
  });
}