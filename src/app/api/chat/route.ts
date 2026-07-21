import { NextRequest, NextResponse } from "next/server";
import { LLMClient, Config } from "coze-coding-dev-sdk";
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { KnowledgeBase } from '@/lib/types';
import { callExtensionTranslateModel } from "../copilot/shared";

function sanitizeCustomerFacingContent(content: string, language: string = 'zh'): string {
  let sanitized = content
    .replace(/\[(?:FAQ_ID|TS_ID|FUNCTION_ID):\s*[^\]]+\]\s*/gi, '')
    .replace(/\bDIClo\b(?!ak)/g, 'DICloak')
    .replace(/https?:\/\/help\.diclo\.com/gi, 'https://help.dicloak.com')
    .replace(/popup\s*-?\s*appears/gi, 'popup-appears')
    .replace(/根据(?:当前)?(?:价格功能表|Pricing Feature Comparison Table|pricing table)(?:中的)?(?:信息|数据)?[，,：:]?/gi, '')
    .replace(/(?:当前)?(?:价格功能表|Pricing Feature Comparison Table|pricing table)(?:显示|中显示|记录|中记录)[，,：:]?/gi, '')
    .replace(/(?:FAQ|价格功能表|Pricing Feature Comparison Table|pricing table|检索结果|表格显示)[：:]/gi, '')
    .replace(/(?:很遗憾，?\s*)?(?:目前|当前)?DICloak的知识库中尚未提供[^。！？\n]*(?:。|！|？)?/g, '')
    .replace(/(?:知识库|内部资料)(?:未检索到|没有检测到|尚未提供|未提供)[^。！？\n]*(?:。|！|？)?/g, '')
    .replace(/[^。！？\n]*(?:建议|推荐|可以)?(?:您|你)?(?:联系|咨询|询问|求助)(?:我们|我们的)?(?:技术支持|客服|人工客服|支持团队)[^。！？\n]*(?:。|！|？)?/g, '')
    .replace(/[^.\n]*(?:contact|consult|ask|reach out to) (?:our )?(?:technical support|support team|customer support)[^.\n]*(?:\.)?/gi, '')
    .replace(/[^.\n]*(?:уточнить|обратиться|связаться)[^.\n]*(?:техподдержк|служб[а-я]* поддержки)[^.\n]*(?:\.)?/gi, '')
    .replace(/(?:the\s+)?(?:current\s+)?(?:DICloak\s+)?knowledge base (?:does not|doesn't|has not|hasn't|doesn't currently|does not currently)[^.\n]*(?:\.)?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (language !== 'zh' && language !== 'mixed') {
    sanitized = sanitized
      .replace(/(Free)\s*[（(]免费版[）)]/gi, '$1')
      .replace(/(Base)\s*[（(]基础版[）)]/gi, '$1')
      .replace(/(Plus)\s*[（(]高阶版[）)]/gi, '$1')
      .replace(/(Share\+)\s*[（(]共享版\+[）)]/gi, '$1')
      .replace(/免费版\s*[（(](Free)[）)]/gi, '$1')
      .replace(/基础版\s*[（(](Base)[）)]/gi, '$1')
      .replace(/高阶版\s*[（(](Plus)[）)]/gi, '$1')
      .replace(/共享版\+\s*[（(](Share\+)[）)]/gi, '$1');
  }

  return sanitized;
}

function extractActualUserCount(message: string): number | null {
  const normalized = message.toLowerCase();
  const userCountPatterns = [
    /\b(\d{1,5})\s*(?:users?|members?|people|persons?|seats?|devices?)\b/i,
    /\b(?:team|команд[аыеу]?|пользовател[ьяей]*|человек|участник[а-я]*|成员|用户|人|设备)\D{0,20}(\d{1,5})\b/i,
    /\b(\d{1,5})\D{0,20}(?:users?|members?|people|persons?|seats?|devices?|команд[аыеу]?|пользовател[ьяей]*|человек|участник[а-я]*|成员|用户|人|设备)\b/i,
  ];
  for (const pattern of userCountPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  const digitMatches = Array.from(normalized.matchAll(/\b(\d{1,5})\b/g))
    .map((match) => Number.parseInt(match[1], 10))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (digitMatches.length > 0) {
    return digitMatches[0];
  }

  const textualNumbers: Array<[RegExp, number]> = [
    [/(?:^|\s)(?:ten|десять|десяти|десятерых)(?:\s|$)/i, 10],
    [/(?:^|\s)(?:nine|девять|девяти)(?:\s|$)/i, 9],
    [/(?:^|\s)(?:eight|восемь|восьми)(?:\s|$)/i, 8],
    [/(?:^|\s)(?:seven|семь|семи)(?:\s|$)/i, 7],
    [/(?:^|\s)(?:six|шесть|шести)(?:\s|$)/i, 6],
    [/(?:^|\s)(?:five|пять|пяти)(?:\s|$)/i, 5],
    [/(?:^|\s)(?:four|четыре|четырех|четырёх)(?:\s|$)/i, 4],
    [/(?:^|\s)(?:three|три|трех|трёх)(?:\s|$)/i, 3],
    [/(?:^|\s)(?:two|два|двух)(?:\s|$)/i, 2],
    [/(?:^|\s)(?:one|один|одного)(?:\s|$)/i, 1],
    [/十(?:个|位|名|人)?/, 10],
  ];

  const matchedNumber = textualNumbers.find(([pattern]) => pattern.test(normalized));
  return matchedNumber ? matchedNumber[1] : null;
}

function buildSeatCalculationFacts(userCount: number | null): string {
  if (!userCount) {
    return "";
  }

  const plusSeats = 1 + Math.ceil(Math.max(userCount - 1, 0) / 100);

  return `## Deterministic Seat Calculation Facts (HIGHEST PRIORITY)
The customer provided ${userCount} actual user(s)/team member(s)/device(s). These facts are calculated by backend code and MUST NOT be changed by the model:
- Base required member seats: ${userCount}.
- Plus required member seats: ${plusSeats}. Formula: 1 + ceil((${userCount} - 1) / 100).
- Share+ member seats: unlimited.
- If recommending Plus, do NOT calculate it as one member seat per actual user. For ${userCount} user(s), Plus requires ${plusSeats} total member seat(s) under the configured rule.
- You may mention that multiple users sharing one internal member account can be less convenient for management/supervision than Base or Share+.
`;
}

function enforceSeatCalculationCorrections(content: string, userCount: number | null, language: string): string {
  if (!userCount) {
    return content;
  }

  const plusSeats = 1 + Math.ceil(Math.max(userCount - 1, 0) / 100);
  const normalized = content.toLowerCase();
  const mentionsPlus = normalized.includes('plus');
  const additionalSeatMatch = content.match(/\b(\d{1,4})\b[^.\n。]*(?:additional|extra|дополнительн|добавочн|额外|доп购|加购|докуп)/i);
  const mentionedAdditionalSeats = additionalSeatMatch ? Number.parseInt(additionalSeatMatch[1], 10) : null;
  const allowedAdditionalSeats = Math.max(plusSeats - 1, 0);
  const mentionsWrongAdditionalSeats = mentionedAdditionalSeats !== null && mentionedAdditionalSeats !== allowedAdditionalSeats;

  if (!mentionsPlus || !mentionsWrongAdditionalSeats) {
    return content;
  }

  const correctionByLanguage: Record<string, string> = {
    zh: `更正：按当前成员席位规则，${userCount} 个实际用户使用 Plus 时需要 ${plusSeats} 个成员席位；如果 Plus 默认包含 1 个超管席位，则只需按价格表核对是否补充 ${allowedAdditionalSeats} 个内部成员席位，而不是按每人 1 席位计算。`,
    ru: `Исправление: по текущему правилу расчёта мест для ${userCount} фактических пользователей на Plus требуется ${plusSeats} места участника; если Plus уже включает 1 место супер-администратора, нужно сверить по прайс-листу только ${allowedAdditionalSeats} внутреннее место, а не считать по одному месту на каждого пользователя.`,
    en: `Correction: under the current member-seat rule, ${userCount} actual users on Plus require ${plusSeats} total member seat(s); if Plus includes 1 super-admin seat by default, only ${allowedAdditionalSeats} internal seat(s) should be checked against pricing, not one seat per user.`,
  };
  const correction = correctionByLanguage[language] || correctionByLanguage.en;

  return `${content}\n\n${correction}`;
}

function getSubscriptionSourceClarificationReply(language: string): string {
  if (language === 'zh' || language === 'mixed') {
    return '你之前是在 DICloak 软件中的费用中心订阅的，还是在其他经销商或平台订阅的？';
  }

  return 'Did you subscribe through the Billing Center in the DICloak software, or through another reseller or platform?';
}

type StructuredReplySectionType = "question" | "identity" | "main" | "common" | "client" | "end_user" | "supplement" | "info";

type StructuredReplySection = {
  type: StructuredReplySectionType;
  content: string;
};

const STRUCTURED_REPLY_SECTION_TYPES: StructuredReplySectionType[] = [
  "question",
  "identity",
  "main",
  "common",
  "client",
  "end_user",
  "supplement",
  "info",
];

function isStructuredReplySectionType(value: string): value is StructuredReplySectionType {
  return STRUCTURED_REPLY_SECTION_TYPES.includes(value as StructuredReplySectionType);
}

function normalizeMachineSectionMarkers(content: string): string {
  return content
    .replace(/<<<\s*DICLO(?:AK|K)?_(?:S|SECT(?:ION)?|SECTION)\s*:\s*([a-z_]+)\s*>>>/gi, (_, type: string) => `<<<DICLOAK_SECTION:${type.toLowerCase()}>>>`)
    .replace(/<<<\s*END_DICLO(?:AK|K)?_(?:S|SECT(?:ION)?|ECTION|SECTION)\s*:\s*([a-z_]+)\s*>>>/gi, (_, type: string) => `<<<END_DICLOAK_SECTION:${type.toLowerCase()}>>>`);
}

function stripMachineSectionMarkers(content: string): string {
  return content
    .replace(/<<<\s*(?:END_)?DICLOAK_[A-Z_]*\s*:\s*[a-z_]+\s*>>>/gi, "")
    .replace(/\[\[\/?\s*(?:question|identity|main|common|client|end_user|supplement|info)\s*\]\]/gi, "")
    .trim();
}

function sanitizeStructuredReplyText(text: string): string {
  return stripMachineSectionMarkers(text)
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,，。]|$)/g, "$1$2")
    .replace(/\{\{\s*([^{}]+?)\s*\}\}/g, "$1")
    .replace(/\{\{\s*([^{}\n]+?)(?=(?:[。！？；;,.，、]|\s|$))/g, "$1")
    .replace(/[{}]/g, "")
    .trim();
}

function normalizeReplyHeaderText(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[【】〖〗\[\]{}()（）:：|｜\-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getStructuredSectionTypeFromHeader(header: string): StructuredReplySectionType | null {
  const normalizedHeader = normalizeReplyHeaderText(header);
  if (/问题类型|回复类型|tipo de problema|problem type|loai van de|jenis masalah|ประเภทปัญหา|نوع المشكلة|問題タイプ|문제 유형/i.test(normalizedHeader)) return "question";
  if (/身份状态|身份识别|estado de identidad|identity status|trang thai danh tinh|status identitas|สถานะตัวตน|حالة الهوية|本人確認|신원 상태/i.test(normalizedHeader)) return "identity";
  if (/主回复|主要回复|优先发送|回复\s*1|respuesta general|main reply|primary reply|cau tra loi chinh|balasan utama|คำตอบหลัก|الرد الرئيسي|主な返信|주요 답변/i.test(normalizedHeader)) return "main";
  if (/通用回复|respuesta general|general reply|cau tra loi chung|balasan umum|คำตอบทั่วไป|رد عام|一般的な返信|일반 답변/i.test(normalizedHeader)) return "common";
  if (/客户回复|respuesta para cliente|client reply|customer reply|cau tra loi cho khach hang|balasan klien|คำตอบสำหรับลูกค้า|رد العميل|顧客向け返信|고객 답변/i.test(normalizedHeader)) return "client";
  if (/终端用户回复|最终用户回复|respuesta para usuario final|end user reply|final user reply|cau tra loi cho nguoi dung cuoi|balasan pengguna akhir|คำตอบสำหรับผู้ใช้ปลายทาง|رد المستخدم النهائي|エンドユーザー向け返信|최종 사용자 답변/i.test(normalizedHeader)) return "end_user";
  if (/补充建议|补充说明|建议|可选发送|回复\s*2|sugerencia complementaria|sugerencia|suggestion|supplement|additional advice|goi y bo sung|saran tambahan|ข้อเสนอแนะเพิ่มเติม|اقتراحات اضافية|補足提案|추가 제안/i.test(normalizedHeader)) return "supplement";
  if (/需要补充的信息|需补充信息|补充信息|回复\s*3|informacion que necesitamos|informacion necesaria|need.*information|required information|additional information|thong tin can bo sung|informasi yang diperlukan|ข้อมูลที่ต้องการเพิ่มเติม|معلومات مطلوبة|必要な追加情報|필요한 추가 정보/i.test(normalizedHeader)) return "info";
  return null;
}

function getStructuredSectionTypeFromIcon(icon: string): StructuredReplySectionType | null {
  const iconMap: Record<string, StructuredReplySectionType> = {
    "📌": "question",
    "🛠️": "question",
    "⚠️": "identity",
    "✅": "main",
    "🟡": "common",
    "🔵": "client",
    "🟣": "end_user",
    "💡": "supplement",
    "📝": "info",
    "📎": "info",
  };

  return iconMap[icon] || null;
}

function buildStructuredReplyPayload(content: string): string {
  const normalizedContent = normalizeMachineSectionMarkers(content.replace(/\[META\][\s\S]*?\[\/META\]/g, "").trim());
  const sections: StructuredReplySection[] = [];
  const foundTypes = new Set<StructuredReplySectionType>();
  const appendSection = (typeValue: string, value: string): void => {
    const type = typeValue.toLowerCase();
    if (!isStructuredReplySectionType(type) || foundTypes.has(type)) return;

    const sectionContent = sanitizeStructuredReplyText(value);
    if (!sectionContent) return;

    foundTypes.add(type);
    sections.push({ type, content: sectionContent });
  };

  const simpleTagRegex = /\[\[\s*(question|identity|main|common|client|end_user|supplement|info)\s*\]\]\s*([\s\S]*?)\s*\[\[\/\s*\1\s*\]\]/gi;
  for (const match of normalizedContent.matchAll(simpleTagRegex)) {
    appendSection(match[1], match[2] || "");
  }

  const markerRegex = /<<<DICLOAK_SECTION:(question|identity|main|common|client|end_user|supplement|info)>>>\s*([\s\S]*?)\s*<<<END_DICLOAK_SECTION:\1>>>/gi;
  for (const match of normalizedContent.matchAll(markerRegex)) {
    appendSection(match[1], match[2] || "");
  }

  if (sections.length === 0) {
    const markerlessContent = stripMachineSectionMarkers(normalizedContent);
    const sectionHeaderRegex = /(?:^|\n)\s*(📌|⚠️|✅|🟡|🔵|🟣|💡|📝|🛠️|👤|☑️|📎)?\s*(?:【|〖|\[)\s*([^\n【】〖〗\[\]]{1,120}?)\s*(?:】|〗|\])\s*(?=\n|$)/gu;
    const matches = [...markerlessContent.matchAll(sectionHeaderRegex)]
      .map((match) => ({
        fullText: match[0],
        index: match.index ?? 0,
        icon: match[1] || "",
        header: match[2] || "",
      }))
      .filter((match) => getStructuredSectionTypeFromHeader(match.header) || getStructuredSectionTypeFromIcon(match.icon));

    for (let index = 0; index < matches.length; index++) {
      const match = matches[index];
      const type = getStructuredSectionTypeFromHeader(match.header) || getStructuredSectionTypeFromIcon(match.icon);
      if (!type || foundTypes.has(type)) continue;

      const contentStart = match.index + match.fullText.length;
      const nextMatch = matches[index + 1];
      const contentEnd = nextMatch?.index ?? markerlessContent.length;
      const sectionContent = sanitizeStructuredReplyText(markerlessContent.slice(contentStart, contentEnd));
      if (!sectionContent) continue;

      foundTypes.add(type);
      sections.push({ type, content: sectionContent });
    }
  }

  if (sections.length === 0) {
    const fallbackContent = sanitizeStructuredReplyText(normalizedContent);
    if (fallbackContent) {
      sections.push({ type: "question", content: fallbackContent });
    }
  }

  return `\n[STRUCTURED_REPLY]${JSON.stringify({ sections })}[/STRUCTURED_REPLY]`;
}

function replaceSectionContent(content: string, sectionType: string, sectionContent: string): string {
  const sectionRegexes = [
    new RegExp(`\\[\\[\\s*${sectionType}\\s*\\]\\][\\s\\S]*?\\[\\[\\/\\s*${sectionType}\\s*\\]\\]`, 'i'),
    new RegExp(`<<<DICLOAK_SECTION:${sectionType}>>>[\\s\\S]*?<<<END_DICLOAK_SECTION:${sectionType}>>>`, 'i'),
  ];
  const replacement = `[[${sectionType}]]\n${sectionContent}\n[[/${sectionType}]]`;

  for (const sectionRegex of sectionRegexes) {
    if (sectionRegex.test(content)) {
      return content.replace(sectionRegex, replacement);
    }
  }

  return `${content.trim()}\n\n${replacement}`;
}

function enforceSubscriptionSourceClarificationContent(content: string, language: string): string {
  let normalized = replaceSectionContent(content, 'question', '意图不明确');
  normalized = replaceSectionContent(
    normalized,
    'main',
    getSubscriptionSourceClarificationReply(language)
  );

  return normalized;
}

function hasStepByStepRequest(message: string): boolean {
  const normalized = message.toLowerCase();
  return [
    '步骤', '教程', '逐步', '怎么设置', '如何设置', '怎么配置', '如何配置',
    'step by step', 'step-by-step', 'instructions', 'setup guide',
    'инструкция', 'инструкции', 'поэтап', 'по этап', 'настроить', 'настройка',
  ].some((signal) => normalized.includes(signal));
}

type CustomerBusinessType = 'account_sharing' | 'multi_account_management' | 'unknown';

function detectCustomerBusinessType(message: string): CustomerBusinessType {
  const normalized = message.toLowerCase();
  const accountSharingSignals = [
    '账号共享', '共享账号', '账号分享', '分发', '分享', '订阅', '团队使用',
    'share account', 'account sharing', 'subscription', 'team access', 'distribute',
    'раздать', 'поделиться', 'доступ', 'подписк', 'команда', 'команде',
    'claude', 'chatgpt',
  ];
  const multiAccountSignals = [
    '多账号', '多账户', '批量账号', '账号矩阵', '店铺', '社媒', '社交媒体', '电商',
    'multi-account', 'multiple accounts', 'account management', 'e-commerce', 'social media',
    'много аккаунтов', 'несколько аккаунтов', 'управление аккаунтами',
  ];

  const hasAccountSharing = accountSharingSignals.some((signal) => normalized.includes(signal));
  const hasMultiAccount = multiAccountSignals.some((signal) => normalized.includes(signal));

  if (hasAccountSharing && !hasMultiAccount) return 'account_sharing';
  if (hasMultiAccount && !hasAccountSharing) return 'multi_account_management';
  if (hasAccountSharing && hasMultiAccount) return 'account_sharing';
  return 'unknown';
}

function buildPlanRecommendationRules(businessType: CustomerBusinessType, userCount: number | null): string {
  const userCountText = userCount ? `${userCount}` : 'unknown';
  return `## Deterministic Plan Recommendation Rules (HIGHEST PRIORITY)
Backend-detected customer business type: ${businessType}. Actual user count: ${userCountText}.
Recommendation algorithm:
1. Use the pricing data in the provided context to find plans that satisfy the customer's stated requirements.
2. Among suitable plans, recommend the lowest total price first. Do NOT recommend Share+ first only because it is convenient if Base or Plus is cheaper and satisfies the stated needs.
3. If the customer has not explicitly requested advanced features, API, window synchronization, RPA, unlimited members, or stronger per-member supervision, treat lower price as the primary decision factor.
4. For account-sharing customers:
   - If the customer only mentions sharing/distributing an existing third-party subscription to a team and does not ask for advanced features, recommend Base first as the lowest-price suitable starting option, then explain Plus and Share+ as upgrade alternatives.
   - Base can be recommended when the customer mainly needs a low-cost solution. Explain that Base members do not support simultaneous multi-device login; actual users require one member seat each; it does not support disabling website password viewing, window synchronization, Open API, and other advanced features.
   - Plus can be recommended when the customer needs all feature modules or multi-device use under shared internal member accounts. Explain that it does not support purchasing the cookie-encryption add-on, and shared-account member management/supervision is less convenient than Base or Share+.
   - Share+ can be recommended when the customer prioritizes account-sharing operations, independent member accounts, unlimited members, and easier supervision. Explain that it is best suited for account-sharing business, but not for window synchronization or large-scale RPA needs.
5. For multi-account-management customers:
   - Usually do not recommend Share+ unless the customer explicitly asks for account-sharing business, unlimited members, or each user needing an independent member account.
   - Choose between Base and Plus according to stated feature needs, with the lower-priced suitable plan first.
6. If exact total price requires extra-seat pricing and the pricing data does not provide it, do not invent the final total; compare qualitatively and ask the customer to confirm extra-seat pricing on the official pricing page.
`;
}

function buildAccountSharingEnvironmentRules(businessType: CustomerBusinessType): string {
  if (businessType !== 'account_sharing') {
    return "";
  }

  return `## Account-sharing Environment/Profile Rules (HIGHEST PRIORITY)
For account-sharing customers, do NOT equate team member count with browser environment/profile count.
- Required environment/profile count is based on the number of third-party tool accounts that need to be shared, not the number of DICloak members/users who will access them.
- Example: if 10 team members share 1 Claude account, normally only 1 DICloak environment/profile is needed for that Claude account, then access can be shared/assigned according to the available plan capabilities.
- Accounts from different platforms can usually be configured in the same environment/profile when appropriate.
- Different accounts on the same platform should usually be placed in separate environments/profiles to reduce account-association risk.
- Do NOT tell the customer to create one environment/profile per user unless the customer explicitly says each user has a separate third-party account or the provided knowledge context states that one profile per user is required.
`;
}

function countLatinLanguageSignals(text: string, words: string[]): number {
  return words.reduce((count, word) => {
    const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return count + (new RegExp(`\\b${escapedWord}\\b`, "i").test(text) ? 1 : 0);
  }, 0);
}

type LanguageDetectionResult = {
  language: string;
  confidence: number;
  source: "provided" | "script" | "latin-rules" | "fallback" | "ai" | "history";
};

const SUPPORTED_LANGUAGE_CODES = new Set(["zh", "en", "es", "pt", "ru", "vi", "id", "th", "ar", "ja", "ko", "mixed", "other"]);
const LATIN_LANGUAGE_CODES = new Set(["en", "es", "pt", "vi", "id"]);
const VIETNAMESE_EXCLUSIVE_PATTERN = /[ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;

function detectLatinRequestLanguage(text: string): LanguageDetectionResult | null {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (VIETNAMESE_EXCLUSIVE_PATTERN.test(text)) {
    return { language: "vi", confidence: 0.95, source: "latin-rules" };
  }
  if (/[ãõç]/i.test(text)) {
    return { language: "pt", confidence: 0.9, source: "latin-rules" };
  }

  const portugueseScore = countLatinLanguageSignals(normalized, [
    "tem", "alguma", "forma", "ficarem", "visiveis", "membros", "perfil", "perfis", "cookies",
    "nao", "sim", "voce", "voces", "posso", "pode", "podem", "para", "por", "favor", "conta",
    "compartilhar", "equipe", "assinatura", "preciso", "ajuda", "como", "porque", "quando", "onde",
    "estou", "usando", "fica", "ficando", "saindo", "desconectando", "tudo", "consigo", "consegue",
    "conseguem", "minha", "meu", "sua", "seu", "obrigado", "obrigada",
  ]);
  const spanishScore = countLatinLanguageSignals(normalized, [
    "hay", "alguna", "forma", "visibles", "miembros", "perfil", "perfiles", "cookies", "no", "si",
    "puedo", "puede", "pueden", "para", "por", "favor", "cuenta", "compartir", "equipo", "suscripcion",
    "necesito", "ayuda", "como", "porque", "cuando", "donde",
  ]);
  const indonesianScore = countLatinLanguageSignals(normalized, [
    "apakah", "bagaimana", "bisa", "tidak", "untuk", "anggota", "profil", "akun", "berbagi",
    "tim", "langganan", "tolong", "yang", "dengan", "dimana", "kapan",
  ]);

  const scores: Array<{ language: string; score: number }> = [
    { language: "pt", score: portugueseScore },
    { language: "es", score: spanishScore },
    { language: "id", score: indonesianScore },
  ];
  const best = scores.reduce((currentBest, candidate) => candidate.score > currentBest.score ? candidate : currentBest);
  const sortedScores = [...scores].sort((left, right) => right.score - left.score);
  const runnerUpScore = sortedScores[1]?.score || 0;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length || 1;
  const confidence = Math.min(0.95, 0.45 + (best.score / wordCount) + Math.max(0, best.score - runnerUpScore) * 0.15);
  return best.score >= 2 ? { language: best.language, confidence, source: "latin-rules" } : null;
}

function detectRequestLanguageByRules(text: string, provided?: string): LanguageDetectionResult {
  const cleanText = text.trim();
  const providedLanguage = provided?.trim().toLowerCase();
  const hasLatinLetter = /[a-zA-ZÀ-ỹ]/.test(cleanText);
  const shouldVerifyProvidedLatinLanguage = Boolean(providedLanguage && LATIN_LANGUAGE_CODES.has(providedLanguage) && hasLatinLetter);

  if (providedLanguage && providedLanguage !== 'other' && providedLanguage !== 'en' && !shouldVerifyProvidedLatinLanguage) {
    return { language: providedLanguage, confidence: 0.95, source: "provided" };
  }

  const totalChars = cleanText.replace(/\s/g, '').length;
  if (totalChars === 0) {
    return { language: "zh", confidence: 0.95, source: "fallback" };
  }

  const scripts: Array<[string, RegExp]> = [
    ['ru', /[\u0400-\u04FF]/g],
    ['ar', /[\u0600-\u06ff\u0750-\u077f]/g],
    ['th', /[\u0e00-\u0e7f]/g],
    ['ja', /[\u3040-\u30ff]/g],
    ['ko', /[\uac00-\ud7af\u1100-\u115f]/g],
    ['zh', /[\u4e00-\u9fa5]/g],
  ];

  for (const [language, pattern] of scripts) {
    const count = (cleanText.match(pattern) || []).length;
    if (count / totalChars >= 0.2) {
      return { language, confidence: Math.min(0.99, count / totalChars), source: "script" };
    }
  }

  const latinLanguage = detectLatinRequestLanguage(cleanText);
  if (latinLanguage) return latinLanguage;

  if (providedLanguage && providedLanguage !== "other" && providedLanguage !== "en" && shouldVerifyProvidedLatinLanguage) {
    return { language: providedLanguage, confidence: 0.45, source: "provided" };
  }

  if (providedLanguage === "en") {
    return { language: "en", confidence: 0.45, source: "provided" };
  }
  return /[a-zA-Z]/.test(cleanText)
    ? { language: "en", confidence: 0.45, source: "fallback" }
    : { language: "zh", confidence: 0.5, source: "fallback" };
}

function parseLanguageDetectionJson(rawContent: string): LanguageDetectionResult | null {
  const jsonText = rawContent.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText) as { language?: unknown; confidence?: unknown };
    const language = typeof parsed.language === "string" ? parsed.language.trim().toLowerCase() : "";
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : Number(parsed.confidence);
    if (!SUPPORTED_LANGUAGE_CODES.has(language) || Number.isNaN(confidence)) return null;
    return { language, confidence: Math.max(0, Math.min(1, confidence)), source: "ai" };
  } catch (error) {
    console.log("[DEBUG] AI语种识别JSON解析失败:", error);
    return null;
  }
}

async function classifyLanguageWithTranslationModel(text: string): Promise<LanguageDetectionResult | null> {
  const systemPrompt = [
    "You are a strict language identification engine.",
    "Return ONLY valid JSON with keys language and confidence.",
    "Allowed language codes: zh, en, es, pt, ru, vi, id, th, ar, ja, ko, mixed, other.",
    "Do not translate, answer, explain, or add markdown.",
    "For Portuguese vs Spanish, pay attention to verb forms and sentence patterns such as estou, fica, saindo, você, não.",
  ].join("\n");
  const userPrompt = `Identify the language of this customer message:\n\n${text}`;
  const rawContent = await callExtensionTranslateModel(systemPrompt, userPrompt, 0);
  return parseLanguageDetectionJson(rawContent);
}

function shouldUseAiLanguageDetection(text: string, provided: string | undefined, ruleResult: LanguageDetectionResult): boolean {
  if (!/[a-zA-Z]/.test(text)) return false;
  if (ruleResult.source === "script") return false;
  const providedLanguage = provided?.trim().toLowerCase();
  if (providedLanguage && LATIN_LANGUAGE_CODES.has(providedLanguage) && ruleResult.confidence < 0.8) return true;
  if (providedLanguage === "other") return true;
  return ruleResult.confidence < 0.7;
}

function detectRecentContextLanguage(history?: Array<{ role: string; content: string }>): LanguageDetectionResult | null {
  const recentMessages = [...(history || [])].reverse().slice(0, 4);
  for (const item of recentMessages) {
    if (!item.content.trim()) continue;
    const result = detectRequestLanguageByRules(item.content);
    if (result.language !== "en" && result.language !== "zh" && result.confidence >= 0.7) {
      return { ...result, source: "history", confidence: Math.min(0.85, result.confidence) };
    }
  }
  return null;
}

async function resolveRequestLanguage(text: string, provided: string | undefined, contextLanguage: LanguageDetectionResult | null): Promise<LanguageDetectionResult> {
  const ruleResult = detectRequestLanguageByRules(text, provided);
  if (!shouldUseAiLanguageDetection(text, provided, ruleResult)) {
    return ruleResult;
  }
  try {
    const aiResult = await classifyLanguageWithTranslationModel(text);
    if (aiResult && aiResult.confidence >= 0.65 && aiResult.language !== "other") {
      return aiResult;
    }
  } catch (error) {
    console.log("[DEBUG] AI语种二次识别失败，使用规则结果:", error);
  }
  if (contextLanguage && ruleResult.confidence < 0.65) {
    return contextLanguage;
  }
  return ruleResult;
}

// ==================== 后端获取 API 配置 ====================

async function getBackendApiConfig(): Promise<{
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
} | null> {
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

    return data.config_value.apiConfig;
  } catch (error) {
    console.error('[API Config] 获取后端配置失败:', error);
    return null;
  }
}

// 获取系统配置版本信息

type ChatApiConfig = {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
};

function getOpenAICompatibleBaseUrl(config: ChatApiConfig): string {
  if (config.baseUrl) return config.baseUrl;
  if (config.provider === 'aliyun') return 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  if (config.provider === 'gpt') return 'https://api.tokenlab.sh/v1';
  return 'https://api.deepseek.com';
}

function getDefaultModelForProvider(config: ChatApiConfig): string {
  if (config.model) return config.model;
  if (config.provider === 'aliyun') return 'qwen-mt-flash';
  if (config.provider === 'gpt') return 'gpt-5.4';
  if (config.provider === 'deepseek') return 'deepseek-chat';
  return 'doubao-seed-2-0-lite-260215';
}

async function callModelOnce(config: ChatApiConfig, messages: Array<{ role: 'system' | 'user'; content: string }>, temperature: number): Promise<string> {
  const isOpenAICompatibleProvider = config.provider === 'deepseek' || config.provider === 'aliyun' || config.provider === 'gpt';

  if (isOpenAICompatibleProvider) {
    const requestMessages = config.provider === 'aliyun'
      ? messages.map((message) => ({ role: message.role === 'system' ? 'user' : message.role, content: message.content }))
      : messages;
    const response = await fetch(`${getOpenAICompatibleBaseUrl(config)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: getDefaultModelForProvider(config),
        messages: requestMessages,
        temperature,
      }),
    });
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
    if (!response.ok) {
      throw new Error(data.error?.message || `模型质检失败: ${response.status} ${response.statusText}`);
    }
    return data.choices?.[0]?.message?.content?.trim() || '';
  }

  const llmConfig = new Config({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl || 'https://api.coze.cn/v1',
  });
  const client = new LLMClient(llmConfig);
  let fullContent = '';
  for await (const chunk of client.stream(messages, { model: getDefaultModelForProvider(config), temperature })) {
    const content = extractTextFromLlmChunk(chunk);
    if (content) fullContent += content;
  }
  return fullContent.trim();
}

function shouldReviewCustomerFacingReply(config: ChatApiConfig, draft: string, referenceContext: string): boolean {
  if (config.provider !== 'gpt' || !config.apiKey || !draft.trim()) return false;

  const reviewSignals = [
    /https?:\/\//i,
    /\b(?:Free|Base|Plus|Share\+)\b/i,
    /\b(?:DIClo|DICloak|Open API|Share profile|Transfer profile)\b/i,
    /(?:\d+(?:\.\d+)?\s*(?:美元|USD|\$|元|月|年|席位|成员|环境))/i,
    /(?:教程|指南|帮助|help|guide|quick start|入门)/i,
  ];

  return reviewSignals.some((pattern) => pattern.test(draft) || pattern.test(referenceContext));
}

async function reviewCustomerFacingReply(config: ChatApiConfig, draft: string, referenceContext: string, languageRule: string): Promise<string> {
  if (!shouldReviewCustomerFacingReply(config, draft, referenceContext)) return draft;

  const systemPrompt = `You are a strict QA editor for DICloak customer-service replies.
Only fix factual/formatting corruption introduced during generation. Output only the corrected reply.

Checklist:
- Preserve the original reply structure and section tags exactly.
- Compare the draft against the reference context.
- Fix missing punctuation that changes sentence boundaries.
- Restore incomplete product/function names from the reference context, such as DICloak and Open API.
- Restore decimal points in prices and exact numeric values from the pricing/reference context.
- Restore help-center URLs exactly from the reference context.
- Do not add new facts, new steps, source markers, explanations, or Markdown fences.
- ${languageRule}`;

  const reviewed = await callModelOnce(config, [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Reference context (authoritative, may contain internal IDs; do not output IDs):\n${referenceContext.slice(0, 18000)}\n\nDraft reply to QA and correct:\n${draft}`,
    },
  ], 0);

  return reviewed || draft;
}

async function getSystemConfigVersion(): Promise<{ version: number; updatedAt: string } | null> {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('system_configs')
      .select('version, updated_at')
      .eq('config_key', 'default')
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return {
      version: data.version || 1,
      updatedAt: data.updated_at || new Date().toISOString(),
    };
  } catch (error) {
    console.error('[Config Version] 获取版本信息失败:', error);
    return null;
  }
}

// ==================== 问题类型与身份识别 ====================

type ProblemType = 
  | 'api_problem'           // API 问题
  | 'subscription_problem'  // 套餐/价格/订阅问题
  | 'troubleshooting'       // 故障排查
  | 'info_insufficient'     // 信息不足
  | 'intent_unclear'        // 意图不明确
  | 'out_of_scope'          // 超出支持范围
  | 'feature_faq'           // 功能咨询
  | 'user_routing';         // 终端用户问题
type UserRole = 'client' | 'end_user' | 'unknown';

type TableId = "faq" | "troubleshooting" | "out_of_scope" | "function_knowledge" | "api_endpoints" | "pricing_table";

type ClassificationIntent = {
  type: ProblemType;
  confidence: number;
  tables: Array<{ id: TableId; action?: "full" | "filter" | "match"; filter?: Record<string, unknown> | null }>;
  entities?: {
    planNames?: string[];
    apiType?: string | null;
    apiModule?: string | null;
    apiMethod?: string | null;
    action?: string | null;
    feature?: string | null;
    errorMessage?: string | null;
  };
};

type ClassificationResult = {
  problemType?: ProblemType;
  primaryIntent?: ProblemType;
  identityStatus?: UserRole;
  tables?: Array<{ id?: TableId; action?: 'full' | 'filter' | 'match'; filter?: Record<string, unknown> | null }>;
  confidence?: number;
  reasoning?: string;
  intents?: ClassificationIntent[];
  needsFollowUp?: boolean;
  followUpQuestions?: string[];
};

function readStringField(source: Record<string, unknown>, field: string): string {
  const value = source[field];
  return typeof value === "string" ? value : "";
}

function extractTextFromContentParts(parts: unknown[]): string {
  return parts.map((part) => {
    if (typeof part === "string") {
      return part;
    }

    if (part && typeof part === "object") {
      return readStringField(part as Record<string, unknown>, "text");
    }

    return "";
  }).join("");
}

function extractTextFromLlmChunk(chunk: unknown): string {
  if (typeof chunk === "string") {
    return chunk;
  }

  if (!chunk || typeof chunk !== "object") {
    return "";
  }

  const chunkRecord = chunk as Record<string, unknown>;

  const content = chunkRecord.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return extractTextFromContentParts(content);
  }

  const text = readStringField(chunkRecord, "text");
  if (text) {
    return text;
  }

  const delta = chunkRecord.delta;
  if (delta && typeof delta === "object") {
    const deltaContent = (delta as Record<string, unknown>).content;

    if (typeof deltaContent === "string") {
      return deltaContent;
    }

    if (Array.isArray(deltaContent)) {
      return extractTextFromContentParts(deltaContent);
    }
  }

  return "";
}

// ==================== 信息不足检测 ====================

/**
 * 检测是否为信息不足场景
 */
function checkInfoInsufficient(message: string): { isInsufficient: boolean; missingInfo: string[] } {
  const msgLower = message.toLowerCase().trim();
  const missingInfo: string[] = [];
  
  // 宽泛描述关键词
  const vaguePhrases = [
    '打不开', '进不去', '有问题', '失败了', '不能用', '不工作', 
    '异常', '报错', 'error', 'failed', 'not working', 'broken',
    '不行', '无法', '不能', '出问题'
  ];
  
  // 检查是否只有宽泛描述
  const hasVaguePhrase = vaguePhrases.some(p => msgLower.includes(p));
  
  // 检查是否缺少具体信息
  const hasErrorDetail = msgLower.length > 30 && 
    (msgLower.includes('错误') || msgLower.includes('error code') || 
     msgLower.includes('err_') || msgLower.includes('0x'));
  const hasOperationSteps = msgLower.includes('步骤') || msgLower.includes('操作') || 
    msgLower.includes('点击') || msgLower.includes('选择') || msgLower.includes('step');
  const hasScreenshot = msgLower.includes('截图') || msgLower.includes('录屏') || 
    msgLower.includes('screenshot') || msgLower.includes('图片');
  const hasSpecificModule = msgLower.includes('环境') || msgLower.includes('成员') || 
    msgLower.includes('代理') || msgLower.includes('扩展') || msgLower.includes('分组');
  const hasIdentity = msgLower.includes('管理员') || msgLower.includes('成员') || 
    msgLower.includes('终端用户') || msgLower.includes('我购买');
  
  // 收集缺少的信息
  if (!hasErrorDetail) missingInfo.push('具体报错内容或错误代码');
  if (!hasOperationSteps) missingInfo.push('操作步骤描述');
  if (!hasScreenshot) missingInfo.push('截图或录屏');
  if (!hasSpecificModule) missingInfo.push('具体功能模块');
  if (!hasIdentity) missingInfo.push('使用身份（管理员/成员/终端用户）');
  
  // 判断是否为信息不足
  const isInsufficient = hasVaguePhrase && 
    message.length < 50 && 
    !hasErrorDetail && 
    !hasOperationSteps &&
    missingInfo.length >= 3;
  
  return { isInsufficient, missingInfo };
}

// ==================== API 问题检测 ====================

const API_KEYWORDS = [
  'api', '接口', 'endpoint', 'request', 'response', 
  'parameter', '参数', 'http', 'rest', 'webhook',
  '调用', '请求', '返回', 'json', 'curl'
];

function checkApiProblem(message: string): { isApiProblem: boolean; apiAction?: string; apiObject?: string } {
  const msgLower = message.toLowerCase();
  
  // 检查是否包含 API 相关关键词
  const hasApiKeyword = API_KEYWORDS.some(kw => msgLower.includes(kw));
  if (!hasApiKeyword) {
    return { isApiProblem: false };
  }
  
  // 识别操作动作
  const actionPatterns: Record<string, string[]> = {
    'create': ['创建', '新增', '添加', 'create', 'add', 'new', 'post'],
    'read': ['查询', '获取', '读取', 'get', 'read', 'list', 'fetch', '获取'],
    'update': ['修改', '更新', '编辑', 'update', 'edit', 'modify', 'put', 'patch'],
    'delete': ['删除', '移除', 'delete', 'remove', 'del'],
    'start': ['启动', '开启', 'start', 'launch', 'open'],
    'stop': ['停止', '关闭', 'stop', 'close', 'shutdown'],
    'import': ['导入', 'import', 'upload'],
    'export': ['导出', 'export', 'download']
  };
  
  let apiAction: string | undefined;
  for (const [action, patterns] of Object.entries(actionPatterns)) {
    if (patterns.some(p => msgLower.includes(p))) {
      apiAction = action;
      break;
    }
  }
  
  // 识别操作对象
  const objectPatterns: Record<string, string[]> = {
    'environment': ['环境', 'environment', 'profile', '浏览器'],
    'member': ['成员', 'member', '用户', 'user'],
    'group': ['分组', 'group', '群组'],
    'proxy': ['代理', 'proxy'],
    'extension': ['扩展', 'extension', '插件', 'plugin'],
    'account': ['账号', 'account'],
    'tag': ['标签', 'tag', '标记']
  };
  
  let apiObject: string | undefined;
  for (const [obj, patterns] of Object.entries(objectPatterns)) {
    if (patterns.some(p => msgLower.includes(p))) {
      apiObject = obj;
      break;
    }
  }
  
  return { isApiProblem: true, apiAction, apiObject };
}

/**
 * 检索 API 端点表
 * 根据 apiAction 和 apiObject 检索 API 端点与参数明细表
 */
function searchApiEndpoints(
  apiAction: string | undefined,
  apiObject: string | undefined,
  apiEndpoints: Array<{
    apiId?: string;
    apiName?: string;
    apiType?: string;
    method?: string;
    endpoint?: string;
    description?: string;
    module?: string;
    object?: string;
    operation?: string;
    isSupported?: boolean;
  }>,
  apiParameters: Array<{
    apiId?: string;
    paramName?: string;
    paramType?: string;
    isRequired?: boolean;
    defaultValue?: string;
    description?: string;
    validationRule?: string;
    example?: string;
  }> = []
): {
  found: boolean;
  endpoints: typeof apiEndpoints;
  parameters: typeof apiParameters;
  summary: string;
} {
  if (!apiEndpoints || apiEndpoints.length === 0) {
    return { found: false, endpoints: [], parameters: [], summary: 'API 端点表未加载' };
  }

  // 过滤匹配的端点
  const matchedEndpoints = apiEndpoints.filter(ep => {
    // 从 apiName 推断操作和对象
    const apiNameLower = (ep.apiName || '').toLowerCase();
    const methodLower = (ep.method || '').toLowerCase();
    const apiIdLower = (ep.apiId || '').toLowerCase();
    
    // 匹配操作类型
    let actionMatch = true;
    if (apiAction) {
      const actionKeywords: Record<string, string[]> = {
        'create': ['创建', '新增', '添加', 'create', 'add', 'new'],
        'read': ['查询', '获取', '读取', 'get', 'read', 'list', 'fetch'],
        'update': ['修改', '更新', '编辑', 'update', 'edit', 'modify'],
        'delete': ['删除', '移除', 'delete', 'remove', 'del'],
        'start': ['启动', '开启', 'start', 'launch', 'open', '打开'],
        'stop': ['停止', '关闭', 'stop', 'close'],
        'import': ['导入', 'import', 'upload'],
        'export': ['导出', 'export', 'download']
      };
      const keywords = actionKeywords[apiAction] || [apiAction];
      actionMatch = keywords.some(k => 
        apiNameLower.includes(k.toLowerCase()) || 
        methodLower.includes(k.toLowerCase()) ||
        apiIdLower.includes(k.toLowerCase())
      );
    }
    
    // 匹配操作对象
    let objectMatch = true;
    if (apiObject) {
      const objectKeywords: Record<string, string[]> = {
        'environment': ['环境', 'environment', 'profile', '浏览器', 'env'],
        'member': ['成员', 'member', '用户', 'user'],
        'group': ['分组', 'group', '群组'],
        'proxy': ['代理', 'proxy'],
        'extension': ['扩展', 'extension', '插件', 'plugin'],
        'account': ['账号', 'account'],
        'tag': ['标签', 'tag']
      };
      const keywords = objectKeywords[apiObject] || [apiObject];
      objectMatch = keywords.some(k => 
        apiNameLower.includes(k.toLowerCase()) || 
        apiIdLower.includes(k.toLowerCase()) ||
        (ep.endpoint || '').toLowerCase().includes(k.toLowerCase())
      );
    }
    
    return actionMatch && objectMatch;
  });

  if (matchedEndpoints.length === 0) {
    return { 
      found: false, 
      endpoints: [], 
      parameters: [], 
      summary: `未找到匹配的 API 端点 (操作: ${apiAction || '未知'}, 对象: ${apiObject || '未知'})` 
    };
  }

  // 获取关联的参数
  const matchedApiIds = matchedEndpoints.map(ep => ep.apiId).filter(Boolean);
  const matchedParameters = apiParameters.filter(p => 
    p.apiId && matchedApiIds.includes(p.apiId)
  );

  // 生成摘要
  const summary = matchedEndpoints.map(ep => {
    const params = matchedParameters.filter(p => p.apiId === ep.apiId);
    const requiredParams = params.filter(p => p.isRequired).map(p => p.paramName);
    return `${ep.apiName || ep.apiId}: ${ep.method} ${ep.endpoint}${requiredParams.length > 0 ? ` (必填: ${requiredParams.join(', ')})` : ''}`;
  }).join('\n');

  return {
    found: true,
    endpoints: matchedEndpoints,
    parameters: matchedParameters,
    summary
  };
}

/**
 * 检索价格功能表
 */
function searchPricingPlans(
  pricingPlans: Array<{
    planName?: string;
    planNameCN?: string;
    price?: number;
    priceUnit?: string;
    memberLimit?: number;
    environmentLimit?: number;
    profileLimit?: number;
    features?: string[];
    description?: string;
  }>,
  query?: string
): {
  found: boolean;
  plans: typeof pricingPlans;
  summary: string;
} {
  if (!pricingPlans || pricingPlans.length === 0) {
    return { found: false, plans: [], summary: '价格功能表未加载' };
  }

  // 如果有查询关键词，过滤匹配的套餐
  let matchedPlans = pricingPlans;
  if (query) {
    const queryLower = query.toLowerCase();
    matchedPlans = pricingPlans.filter(plan => 
      (plan.planName && plan.planName.toLowerCase().includes(queryLower)) ||
      (plan.planNameCN && plan.planNameCN.includes(query)) ||
      (plan.features && plan.features.some(f => f.toLowerCase().includes(queryLower)))
    );
  }

  if (matchedPlans.length === 0) {
    return { found: false, plans: [], summary: '未找到匹配的套餐信息' };
  }

  // 生成摘要
  const summary = matchedPlans.map(plan => {
    const features = plan.features?.slice(0, 3).join(', ') || '';
    return `${plan.planNameCN || plan.planName}: ¥${plan.price}/${plan.priceUnit}${plan.memberLimit ? `, 成员数: ${plan.memberLimit}` : ''}${plan.environmentLimit ? `, 环境数: ${plan.environmentLimit}` : ''}${features ? `\n  功能: ${features}...` : ''}`;
  }).join('\n\n');

  return {
    found: true,
    plans: matchedPlans,
    summary
  };
}

// ==================== 套餐/价格问题检测 ====================

const SUBSCRIPTION_KEYWORDS = [
  '订阅', '套餐', '价格', '购买', 'plan', 'price', 
  'billing', 'upgrade', '付费', '订阅', '续费', '续订', '取消订阅', '退订',
  'subscription', 'pricing', '多少钱', '收费', 'renew', 'renewal', 'cancel', 'unsubscribe', 'cancellation', 'renovar', 'renovación',
  'подписка', 'подписку', 'подписки', 'тариф', 'тарифы', 'цена', 'стоимость', 'купить', 'продлить',
];

const DICLOAK_OWN_SUBSCRIPTION_ACTION_SIGNALS = [
  '账单', 'billing center', 'my billing',
];

const SUBSCRIPTION_SOURCE_CLARIFICATION_SIGNALS = [
  '取消订阅', '取消套餐', '退订', 'cancel my subscription', 'cancel subscription',
  'unsubscribe', 'cancellation',
];

// 套餐名称关键词（用于识别套餐功能对比问题）
const PLAN_NAME_KEYWORDS = [
  '免费版', 'free', '基础版', 'base', '高阶版', 'plus', 
  '共享版', 'share', '专业版', 'pro', '企业版', 'enterprise',
  'free plan', 'base plan', 'plus plan', 'share plan'
];

// 这些是第三方工具/用途名称，不代表一定是非 DICloak 业务；
// 只有在后续规则排除 DICloak/账号管理上下文后，才可能用于超范围判断。
const EXTERNAL_TOOL_KEYWORDS = [
  'chatgpt', 'gpt', 'claude', 'ai写作', 'ai生成',
  '编程', '写代码', '视频制作', '剪辑', '绘图',
  'midjourney', 'runway', 'freepik', 'canva',
  '文案', '翻译', '配音'
];

const DICLOAK_CONTEXT_SIGNALS = [
  'dicloak', '浏览器', '环境', '账号共享', '多账号', 'profile', 'env', 'environment',
];

const ACCOUNT_MANAGEMENT_SIGNALS = [
  '团队', '成员', '分发', '分享', '共享', '管理', '配置', '设置', '环境', 'profile',
  '多人', '额度', '席位', 'seat', 'member', 'team', 'share', 'distribute', 'manage',
  '已有账号', '账号分配', '账号分享', '给成员使用', 'share account', 'account sharing', 'assign account',
  'команда', 'команд', 'человек', 'пользовател', 'раздать', 'выдать', 'поделиться',
  'распределить', 'предоставить', 'дать доступ', 'доступ', 'настроить', 'настрой', 'профиль', 'аккаунт', 'учетн',
];

function hasAnySignal(text: string, signals: string[]): boolean {
  return signals.some((signal) => text.includes(signal));
}

function hasExternalToolMention(text: string): boolean {
  return EXTERNAL_TOOL_KEYWORDS.some((keyword) => text.includes(keyword));
}

function hasOutOfScopeExternalToolMention(text: string): boolean {
  return hasExternalToolMention(text) &&
    !hasAnySignal(text, DICLOAK_CONTEXT_SIGNALS) &&
    !hasAnySignal(text, ACCOUNT_MANAGEMENT_SIGNALS);
}

function isExternalToolAccountManagementRequest(text: string): boolean {
  return hasExternalToolMention(text) && hasAnySignal(text, ACCOUNT_MANAGEMENT_SIGNALS);
}

function needsSubscriptionSourceClarification(message: string): boolean {
  const msgLower = message.toLowerCase();
  return hasAnySignal(msgLower, SUBSCRIPTION_SOURCE_CLARIFICATION_SIGNALS) &&
    !hasAnySignal(msgLower, DICLOAK_CONTEXT_SIGNALS) &&
    !hasExternalToolMention(msgLower);
}

function checkSubscriptionProblem(message: string): { 
  isSubscriptionProblem: boolean; 
  isDicloak: boolean | null;  // true=明确是DICloak, false=明确不是, null=不明确
  nonDicloakPurpose?: string;
} {
  const msgLower = message.toLowerCase();
  
  // 检查是否包含订阅/价格相关关键词
  const hasSubscriptionKeyword = SUBSCRIPTION_KEYWORDS.some(kw => msgLower.includes(kw));
  
  // 检查是否包含套餐名称（用于识别"基础版支持XX功能"类问题）
  const hasPlanName = PLAN_NAME_KEYWORDS.some(kw => msgLower.includes(kw.toLowerCase()));
  
  if (!hasSubscriptionKeyword && !hasPlanName) {
    return { isSubscriptionProblem: false, isDicloak: null };
  }
  
  const hasDicloakContext = hasAnySignal(msgLower, DICLOAK_CONTEXT_SIGNALS);
  const hasAccountManagementContext = hasAnySignal(msgLower, ACCOUNT_MANAGEMENT_SIGNALS);
  const externalToolMention = hasExternalToolMention(msgLower);

  if (hasDicloakContext || hasAccountManagementContext) {
    return { isSubscriptionProblem: true, isDicloak: true };
  }

  if (needsSubscriptionSourceClarification(message)) {
    return { isSubscriptionProblem: true, isDicloak: null };
  }

  // 用户在 DICloak 客服场景中询问“账单/费用中心”等自身订阅操作时，
  // 默认按 DICloak 订阅问题处理；只有明确提到第三方工具订阅时才继续澄清。
  if (!externalToolMention && hasAnySignal(msgLower, DICLOAK_OWN_SUBSCRIPTION_ACTION_SIGNALS)) {
    return { isSubscriptionProblem: true, isDicloak: true };
  }

  // 多语言输入无法靠有限关键词穷尽识别“管理/分发账号”的语义。
  // 因此，订阅/套餐问题只要提到第三方工具，就保持意图不明确并带上价格表，交由后续追问或 LLM 语义分类处理，
  // 避免把多语言的 Claude/ChatGPT 账号管理问题误判为超范围。
  if (externalToolMention) {
    return { isSubscriptionProblem: true, isDicloak: null, nonDicloakPurpose: 'external_tool_subscription' };
  }
  
   // 意图不明确
  return { isSubscriptionProblem: true, isDicloak: null };
}

function hasAmbiguousExternalToolTrouble(message: string): boolean {
  const msgLower = message.toLowerCase();
  const hasExternalToolName = hasExternalToolMention(msgLower);
  if (!hasExternalToolName) {
    return false;
  }

  const troubleKeywords = [
    '打不开', '无法打开', '开不了', '不能打开', '进不去', '无法访问', '访问不了',
    '登录不了', '登不上', '不能登录', '无法登录', '报错', '错误', '异常', '失败',
    'cannot open', 'can not open', "can't open", 'cannot access', 'can not access',
    "can't access", 'not opening', 'not working', 'login failed', 'error', 'failed',
  ];

  return troubleKeywords.some((kw) => msgLower.includes(kw));
}

/**
 * 识别问题类型（后端规则分类，AI 不能改变）
 */
function identifyProblemType(
  message: string,
  matchedFaqScore: number,
  matchedTsScore: number,
  matchedOosScore: number
): { type: ProblemType; reason: string; apiInfo?: ReturnType<typeof checkApiProblem>; subscriptionInfo?: ReturnType<typeof checkSubscriptionProblem> } {
  const msgLower = message.toLowerCase().trim();
  
  // 1. 信息不足检测（优先级最高）
  const infoCheck = checkInfoInsufficient(message);
  if (infoCheck.isInsufficient) {
    return { 
      type: 'info_insufficient', 
      reason: `信息不足，缺少：${infoCheck.missingInfo.join('、')}` 
    };
  }
  
  // 2. API 问题检测
  const apiCheck = checkApiProblem(message);
  if (apiCheck.isApiProblem) {
    return { 
      type: 'api_problem', 
      reason: `API问题 - 动作: ${apiCheck.apiAction || '未知'}, 对象: ${apiCheck.apiObject || '未知'}`,
      apiInfo: apiCheck
    };
  }
  
  // 3. 套餐/价格问题检测
  const subscriptionCheck = checkSubscriptionProblem(message);
  if (subscriptionCheck.isSubscriptionProblem) {
    // 明确不是 DICloak 用途 → 超出支持范围
    if (subscriptionCheck.isDicloak === false) {
      return { 
        type: 'out_of_scope', 
        reason: `超出支持范围 - 用户询问: ${subscriptionCheck.nonDicloakPurpose}`,
        subscriptionInfo: subscriptionCheck
      };
    }
    // 意图不明确 → 需要澄清
    if (subscriptionCheck.isDicloak === null) {
      return { 
        type: 'intent_unclear', 
        reason: '订阅/价格问题但意图不明确，需澄清是否为 DICloak',
        subscriptionInfo: subscriptionCheck
      };
    }
    // 明确是 DICloak → 套餐问题
    return { 
      type: 'subscription_problem', 
      reason: 'DICloak 套餐/价格问题',
      subscriptionInfo: subscriptionCheck
    };
  }
  
  // 4. 第三方工具账号管理/分发/共享场景：不要被外部工具名误导成超范围。
  // 例如俄语“给 10 人分配 Claude 订阅/账号并配置 profile”，应视为 DICloak 客户想管理/共享已有工具账号。
  if (isExternalToolAccountManagementRequest(msgLower)) {
    return {
      type: 'feature_faq',
      reason: '第三方工具账号管理/分发场景，按 DICloak 客户功能咨询处理'
    };
  }

  // 5. 第三方工具名称 + 打不开/访问异常是歧义故障：可能是 DICloak 环境/profile 名称，不直接判为 user_routing 或超范围
  if (hasAmbiguousExternalToolTrouble(message)) {
    return {
      type: 'info_insufficient',
      reason: '第三方工具名称伴随打不开/访问异常，需澄清是 DICloak 环境/profile 还是外部平台本身'
    };
  }

  /// 6. 检查是否超出支持范围（非 API/订阅场景）。
  // 注意：第三方工具名称本身不等于非 DICloak 业务；只有没有 DICloak/账号管理上下文时才判超范围。
  if (hasOutOfScopeExternalToolMention(msgLower)) {
    return { type: 'out_of_scope', reason: '超出 DICloak 支持范围' };
  }
  
  // 7. 根据匹配分数判断类型
  if (matchedTsScore >= matchedFaqScore && matchedTsScore >= matchedOosScore && matchedTsScore > 0) {
    return { type: 'troubleshooting', reason: '匹配到故障排查知识库' };
  }
  
  if (matchedOosScore > 0 && matchedOosScore > matchedFaqScore) {
    return { type: 'out_of_scope', reason: '匹配到超出支持范围知识库' };
  }
  
  if (matchedFaqScore > 0) {
    return { type: 'feature_faq', reason: '匹配到功能FAQ知识库' };
  }
  
  // 8. 默认返回信息不足
  return { type: 'info_insufficient', reason: '未匹配到相关知识库' };
}

/**
 * 识别用户身份
 */
function identifyUserRole(message: string, history?: Array<{ role: string; content: string }>): { role: UserRole; reason: string } {
  const allText = (message + ' ' + (history?.map(h => h.content).join(' ') || '')).toLowerCase();
  
  // 终端用户特征
  const endUserIndicators = [
    '账号是别人给的', '账号来自', '第三方', '不是管理员', 
    '服务商', '别人提供的', '管理员给的', '老师给的',
    'account was given', 'from third party', 'not admin'
  ];
  if (endUserIndicators.some(ind => allText.includes(ind))) {
    return { role: 'end_user', reason: '用户提到账号来自第三方或他人' };
  }
  
  // 客户/管理员特征
  const clientIndicators = [
    '我是管理员', '我的团队', '管理成员', '设置环境', 
    '我购买的', '我的套餐', '管理代理', '数据同步', '分发', '分享账号', '共享账号', '团队', '成员', '环境额度',
    'i am admin', 'my team', 'i purchased', 'manage members'
  ];
  if (clientIndicators.some(ind => allText.includes(ind))) {
    return { role: 'client', reason: '用户提到自己是管理员或在进行管理操作' };
  }
  
  return { role: 'unknown', reason: '用户身份不明确' };
}

/**
 * 获取输出格式类型（返回给前端，用于生成格式标题）
 */
function getOutputFormatType(problemType: ProblemType, userRole: UserRole): 'A' | 'B' | 'C' {
  // A. 非故障类问题（feature_faq, out_of_scope, intent_unclear, info_insufficient）
  if (problemType === 'feature_faq' || problemType === 'out_of_scope' || 
      problemType === 'intent_unclear' || problemType === 'info_insufficient') {
    return 'A';
  }
  
  // B. 故障排查 + 身份明确
  if (problemType === 'troubleshooting' && userRole !== 'unknown') {
    return 'B';
  }
  
  // C. 故障排查 + 身份不明确
  return 'C';
}

/**
 * 生成问题类型展示文案。
 */
function getProblemTypeOutputLabel(problemType: ProblemType): string {
  const labels: Record<ProblemType, string> = {
    api_problem: '功能咨询',
    subscription_problem: '套餐/订阅问题',
    troubleshooting: '故障排查',
    feature_faq: '功能咨询',
    info_insufficient: '信息不足',
    intent_unclear: '意图不明确',
    out_of_scope: '超出支持范围',
    user_routing: '终端用户问题',
  };

  return labels[problemType] || '功能咨询';
}

/**
 * 生成 AI 输出格式要求。使用短 section 标签降低模型拼写错误率，前端再渲染固定标题。
 */
function generateAIOutputFormat(problemType: ProblemType, userRole: UserRole): string {
  const problemTypeLabel = getProblemTypeOutputLabel(problemType);

  // A 格式：非故障类问题
  if (problemType === 'feature_faq' || problemType === 'out_of_scope' ||
      problemType === 'intent_unclear' || problemType === 'info_insufficient' ||
      problemType === 'api_problem' || problemType === 'subscription_problem' ||
      problemType === 'user_routing') {
    return `## 输出格式要求（必须使用 短 section 标签输出，前端只按 type 归属显示）

[[question]]
${problemTypeLabel}
[[/question]]

[[main]]
完整主回复。若命中标准答案，必须严格基于标准答案改写/翻译，不得新增标准答案没有的按钮、路径、权限、密码、有效期、限制或操作步骤。主回复必须完整，不要拆分到补充建议中。
[[/main]]

[[supplement]]
独立的补充建议；不得继续补充主回复没有依据的操作步骤。没有合适补充建议时写：无。
[[/supplement]]

[[info]]
需要客户补充的信息；不需要补充信息时写：无。
[[/info]]`;
  }
  
  // B 格式：故障排查 + 身份明确
  if (problemType === 'troubleshooting' && userRole !== 'unknown') {
    const identityLabel = userRole === 'client' ? 'DICloak 客户' : '终端用户';
    const roleAnswer = userRole === 'client' ? 'client' : 'end_user';
    return `## 输出格式要求（必须使用 短 section 标签输出，前端只按 type 归属显示）

[[question]]
故障排查
[[/question]]

[[identity]]
${identityLabel}
[[/identity]]

[[main]]
完整输出匹配资料中的「标准答案（${roleAnswer}）」，如为空则用「标准答案（通用）」；必须严格基于标准答案改写/翻译，不得新增标准答案没有的按钮、路径、权限、密码、有效期、限制或操作步骤；主回复必须完整，不要拆分到补充建议中。
[[/main]]

[[supplement]]
独立的补充建议；不得继续补充主回复没有依据的操作步骤。没有合适补充建议时写：无。
[[/supplement]]

[[info]]
需要客户补充的信息；不需要补充信息时写：无。
[[/info]]`;
  }
  
  // C 格式：故障排查 + 身份不明确
  return `## 输出格式要求（必须使用 短 section 标签输出，前端只按 type 归属显示）

[[question]]
故障排查
[[/question]]

[[identity]]
身份不明确，需要客服进一步确认
[[/identity]]

[[common]]
完整输出匹配资料中的「标准答案（通用）」，不得新增标准答案没有的操作步骤；如为空则写：无。
[[/common]]

[[client]]
完整输出匹配资料中的「标准答案（client）」，不得新增标准答案没有的操作步骤；如为空则写：无。
[[/client]]

[[end_user]]
输出「标准答案（end_user）」的简短版，重点说明需联系账号/服务提供方；不得新增标准答案没有的操作步骤；如为空则写：无。
[[/end_user]]

[[info]]
生成追问，收集身份相关信息（如：账号是自己管理的还是他人提供的）。
[[/info]]`;
}

type UncoveredKnowledgePolicy = {
  isRelevant: boolean;
  isDICloakTechnicalLogic: boolean;
  isGeneralNetworkOrWebsite: boolean;
  prompt: string;
};

function buildUncoveredKnowledgePolicy(
  question: string,
  problemType: ProblemType,
  scores: { faq: number; functionKnowledge: number; troubleshooting: number; outOfScope: number; apiFound: boolean; pricingFound: boolean }
): UncoveredKnowledgePolicy {
  const isFeatureOrTroubleshooting = problemType === 'feature_faq' || problemType === 'troubleshooting';
  const bestInternalScore = Math.max(scores.faq, scores.functionKnowledge, scores.troubleshooting, scores.outOfScope);
  const noRelevantInternalKnowledge = bestInternalScore < 10 && !scores.apiFound && !scores.pricingFound;

  if (!isFeatureOrTroubleshooting || !noRelevantInternalKnowledge) {
    return { isRelevant: false, isDICloakTechnicalLogic: false, isGeneralNetworkOrWebsite: false, prompt: '' };
  }

  const normalizeText = (value: string): string => value.toLowerCase().replace(/[\s_\-]+/g, " ").trim();
  const normalizedQuestion = normalizeText(question);
  const dicloakSignals = [
    'dicloak', 'profile', 'profiles', 'browser profile', 'environment', 'fingerprint', 'fingerprints',
    'proxy', 'proxies', 'member', 'members', 'team', 'seat', 'seats', 'api', 'open api', 'extension',
    'sync', 'synchronizer', 'window synchronizer', 'cookie', 'cookies', 'account sharing', 'multi open',
    '环境', '环境管理', '浏览器环境', '指纹', '代理', '成员', '团队', '席位', '扩展', '插件', '同步',
    '窗口同步', '账号共享', '多开', 'cookie', 'cookies', '开放接口', '接口', '工作台', '权限', '登录环境'
  ];
  const generalNetworkSignals = [
    'network', 'internet', 'dns', 'ssl', 'tls', 'certificate', 'cert', 'http', 'https', 'status code',
    '403', '404', '429', '500', '502', '503', '504', 'timeout', 'timed out', 'connection reset',
    'cloudflare', 'captcha', 'recaptcha', 'website', 'site', 'web page', 'webpage', 'server',
    '网络', '网站', '网页', '站点', '服务器', '域名', '解析', '证书', '超时', '连接重置', '验证码',
    '打不开网页', '访问网站', '网页报错'
  ];
  const isDICloakTechnicalLogic = dicloakSignals.some((signal) => normalizedQuestion.includes(normalizeText(signal)));
  const isGeneralNetworkOrWebsite = !isDICloakTechnicalLogic && generalNetworkSignals.some((signal) => normalizedQuestion.includes(normalizeText(signal)));

  const prompt = `## 未收录问题处理策略（最高优先级）
当前问题类型是功能咨询或故障报错，但内部知识库没有检索到可靠收录内容（最高相关分低于阈值）。必须按以下规则处理：
1. 如果问题涉及 DICloak 软件本身的技术逻辑、产品机制、环境/profile、指纹、代理配置、成员/团队、扩展、同步、Open API、权限、Cookie、账号共享等内部实现或产品行为，不要自行编造结论；直接回复该问题我们需进一步跟技术人员确认。可以礼貌补充“确认后再给您准确答复”。不要让客户自行联系技术人员。
2. 如果问题是网络、网站本身、通用 HTTP/SSL/DNS/Cloudflare/CAPTCHA/状态码/服务器访问等非 DICloak 专属技术逻辑，可以基于通用公开网络知识自行组织排查建议；但面向客户的第一句必须一字不差使用中文：知识库未检索到相关知识，该回复由AI生成，请核实后回复客户
3. 上述固定提示句即使客户使用非中文提问，也必须放在第一句并保持中文原文；其后的正文再使用客户语言。
4. 不要输出内部评分、阈值、知识库文件名或本策略名称。
Backend classification: ${isDICloakTechnicalLogic ? 'DICloak technical logic' : isGeneralNetworkOrWebsite ? 'general network/website issue' : 'uncertain; prefer DICloak technical confirmation if the answer would depend on DICloak product behavior'}.`;

  return { isRelevant: true, isDICloakTechnicalLogic, isGeneralNetworkOrWebsite, prompt };
}

export async function POST(request: NextRequest) {
  const t0 = Date.now();
  try {
    const body = await request.json();
    console.log(`[PERF][CHAT] body_parsed_ms=${Date.now() - t0}`);
    const { message, history, knowledge, systemPrompt, detectedLanguage, aiKeywords, classification, imageOcrResults, confirmedRole, roleSource } = body as {
      message?: string;
      history?: Array<{ role: string; content: string }>;
      knowledge?: Partial<KnowledgeBase>;
      systemPrompt?: string;
      detectedLanguage?: string;
      aiKeywords?: string[];
      classification?: ClassificationResult;
      imageOcrResults?: Array<{ id: string; name: string; text: string }>;
      confirmedRole?: UserRole;
      roleSource?: "manual" | "ai" | null;
    };
    
    // 调试：检查接收到的 knowledge
    console.log('[DEBUG] 后端接收到的请求体字段:', Object.keys(body));
    console.log('[DEBUG] knowledge 类型:', typeof knowledge);
    console.log('[DEBUG] knowledge 是否为数组:', Array.isArray(knowledge));
    console.log('[DEBUG] knowledge 是否为对象:', knowledge && typeof knowledge === 'object');
    if (knowledge && typeof knowledge === 'object') {
      console.log('[DEBUG] knowledge 的键:', Object.keys(knowledge));
      console.log('[DEBUG] knowledge.faqItems 数量:', knowledge.faqItems?.length || 0);
    }

    if (!message && (!imageOcrResults || imageOcrResults.length === 0)) {
      return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
    }

    const currentMessageText = message || imageOcrResults?.map((item) => item.text).join("\n") || "";

    console.log(`[PERF][CHAT] pre_config_ms=${Date.now() - t0}`);

    // API 配置
    // 从后端获取 API 配置（安全：API Key 不暴露给前端）
    const backendConfig = await getBackendApiConfig();
    const config = backendConfig || { provider: 'coze', apiKey: '', model: 'doubao-seed-2-0-lite-260215', baseUrl: '' };
    
    // 调试知识库数据
    const contextLanguage = detectRecentContextLanguage(history);
    const languageDetection = await resolveRequestLanguage(currentMessageText, detectedLanguage, contextLanguage);
    const effectiveLanguage = languageDetection.language;
    const actualUserCount = extractActualUserCount(`${message || ""}\n${imageOcrResults?.map((item) => item.text).join("\n") || ""}`);
    const stepByStepRequested = hasStepByStepRequest(message || "");
    const customerBusinessType = detectCustomerBusinessType(message || "");
    console.log('[DEBUG] 后端接收语言:', detectedLanguage, '=>', effectiveLanguage, '置信度:', languageDetection.confidence, '来源:', languageDetection.source, '上下文语言:', contextLanguage?.language || null);
    console.log('[DEBUG] 解析到实际用户数:', actualUserCount);
    console.log('[DEBUG] 是否请求步骤说明:', stepByStepRequested);
    console.log('[DEBUG] 客户业务类型:', customerBusinessType);
    console.log('[DEBUG] AI 关键词:', aiKeywords);
    if (knowledge) {
      console.log('[DEBUG] FAQ数量:', knowledge.faqItems?.length || 0);
      console.log('[DEBUG] 术语库数量:', knowledge.termItems?.length || 0);
      console.log('[DEBUG] pricingPlans数量:', knowledge.pricingPlans?.length || 0);
      console.log('[DEBUG] pricingRawTable行数:', knowledge.pricingRawTable?.rows.length || 0);
    }

    // 语言规则映射
    const languageRules: Record<string, string> = {
      zh: "所有回复必须使用中文",
      en: "All replies must be in English",
      es: "Todas las respuestas deben estar en español",
      pt: "Todas as respostas devem estar em português",
      ru: "Все ответы должны быть на русском языке",
      vi: "Tất cả các câu trả lời phải bằng tiếng Việt",
      id: "Semua jawaban harus dalam bahasa Indonesia",
      th: "คำตอบทั้งหมดต้องเป็นภาษาไทย",
      ar: "يجب أن تكون جميع الإجابات باللغة العربية",
      ja: "すべての回答は日本語で作成する必要があります",
      ko: "모든 답변은 한국어로 작성해야 합니다",
      mixed: "用户问题中包含多种语言，请使用中文回复",
    };
    const languageRule = languageRules[effectiveLanguage] || languageRules.zh;
    const multilingualQualityGuardrail = `## 多语种一致性硬性要求
1. 先基于中文高质量客服口径确定事实、结论、限制和下一步，再用目标语种自然表达；不要因为目标语种不是中文而减少关键信息或改变结论。
2. 目标语种回复必须与中文口径保持同等完整度：相同的问题类型、相同的事实依据、相同的风险提示、相同的追问点和相同的客服语气。
3. 最终只输出目标语种正文和规定 section 标签；不要输出中文草稿、翻译说明或语言标签。
4. 如果客户使用葡萄牙语、西班牙语、越南语、印尼语、俄语、泰语、阿拉伯语、日语或韩语，所有面向客户的正文必须使用该语种，不得夹杂中文或英文句子；产品名、URL 除外。`;

    let uncoveredKnowledgePolicy: UncoveredKnowledgePolicy = { isRelevant: false, isDICloakTechnicalLogic: false, isGeneralNetworkOrWebsite: false, prompt: "" };

    // 精简版 System Prompt（复杂逻辑已由前端/后端处理）
    const baseSystemPrompt = `You are a DICloak customer service assistant.

## Core Rules
1. Generate professional, friendly customer replies
2. Use the FAQ StandardAnswer as the basis for your reply; do not add UI buttons, paths, permissions, password/expiry settings, limits, or operation steps that are not explicitly present in the provided answer/context
3. Do NOT expose internal logic (FAQ, knowledge base, matching, etc.)
4. Reply in the same language as the user's question
5. Tool names such as ChatGPT or Claude do not by themselves mean end-user or out-of-scope; account management/sharing/distribution questions are DICloak client questions
6. If the customer says they want to distribute/share/provide access to Claude/ChatGPT subscriptions or accounts for their team, interpret it as sharing/managing existing third-party tool accounts through DICloak. Do not say DICloak cannot help distribute the subscription; only clarify that DICloak does not sell or purchase the third-party subscription itself.
7. Client = person managing/sharing AI or other tool accounts; end user = person using an account sold or assigned by the client; if role is uncertain, ask for the role before giving role-specific steps
8. You ARE DICloak technical support in this conversation. Do NOT tell the customer to contact/consult/ask our customer support or a human agent. If details are missing, ask the customer for the missing details directly. Exception: when the backend marks an uncovered DICloak technical-logic question, state that we need to further confirm with technical personnel, without asking the customer to contact them.

## FAQ Selection
- Choose the FAQ with HIGHEST Score
- Prefer FAQs with Score >= 10
- Use provided knowledge IDs only for internal source selection. Do NOT output [FAQ_ID: xxx], [TS_ID: xxx], [FUNCTION_ID: xxx], file names, or any other source marker in customer-facing replies
- Preserve punctuation, decimal points, product/function names, and URLs exactly as provided by the knowledge base or pricing data. Do not shorten DICloak to DIClo, do not change Open API to Open, do not drop the decimal point in prices such as 28.8, and copy help-center URLs verbatim

## Term Translation
- Replace {{UI terms}} with translated terms
- Remove {{}} symbols in output
- For languages not in term library, translate the entire content

## Pricing Rules
- For plan, price, member quota, environment quota, or recommendation questions, the Pricing Feature Comparison Table has highest priority
- Except Free, paid plans can adjust member/environment quotas when the pricing table indicates configurable or purchasable quotas; do not claim Base cannot buy extra members unless the table explicitly says so
- When recommending plans by user/member count, compare against the pricing table and do not exclude Base only because the team has more than 2 users
- You may share official website or help-guide links when useful for the customer to verify details
- Do not expose internal file/table names such as FAQ file names, pricing table names, or Pricing Feature Comparison Table in customer-facing replies; answer directly as DICloak support`;

    // 优先使用前端传递的 System Prompt，否则使用精简版
    const finalSystemPrompt = systemPrompt || baseSystemPrompt;

    const outputFormatGuardrail = `## 输出格式硬性要求
    1. 输出格式必须使用本次用户消息中提供的短 section 标签；禁止使用“【主回复】”等可见标题替代标签。
    2. 每个板块必须用独占一行的开始标签和结束标签包裹，例如：[[main]] 与 [[/main]]。
    3. type 只能使用本次输出格式要求中列出的值：question、identity、main、supplement、info、common、client、end_user；不要翻译、改写或新增 type。
    4. 开始标签和结束标签必须一一对应；正文只能写在对应标签之间；不要把下一个板块内容写进上一个 type。
    5. 标签行本身禁止翻译、禁止添加 emoji、禁止添加 Markdown 标题符号；前端会隐藏标签并按 type 显示固定中文标题。
    6. 只能翻译正文内容，禁止翻译 section 标签。
    7. 正文必须是纯文本，不要使用 Markdown 加粗/斜体/标题符号，例如不要输出 **文本**、__文本__、# 标题。
    8. 正文不得保留术语占位符花括号；如果内部资料出现 {{Equipo}}、{{Members}}，输出时必须变成 Equipo、Members 或目标语言译文。`;

    const evidenceGuardrail = `## 知识依据与防编造硬性要求
    1. 回复只能基于上方提供的内部资料和同会话历史；这些资料名称仅供内部生成使用。
    2. 禁止编造内部资料中没有出现的套餐权益、容量、配额、限制、价格、入口路径、按钮名称、操作步骤或功能结论。
    3. 如果使用标准答案，必须只基于标准答案改写或翻译；不得添加标准答案没有的“分享按钮、权限设置、密码、有效期、团队管理路径、成员名额、超级管理员占位”等细节，除非这些细节在本次提供的内部资料中明确出现。
    4. 当用户询问“是否有限制/容量/配额/上限/limit/quota/capacity/storage”等问题时，只有内部资料明确给出具体限制，才允许回答具体数值或套餐差异。
    5. 如果当前用户没有明确询问某个缺少证据的细节，直接忽略该细节，不要主动提及“知识库未检索到/未提供/此回复来源为 AI 生成”等内部话术；只有用户明确追问该细节时，才用对外口径直接追问客户缺失信息或说明“我需要你补充具体配置后再给你准确步骤/结论”。
    6. DICloak 不存在已知的云存储空间容量套餐限制；除非知识库明确提供容量上限，否则不得输出 Free/Base/Plus/Share 等套餐对应的云存储容量数值。
    7. 套餐问题必须优先使用内部价格数据；除免费版外，成员和环境额度是否可调整、是否可购买额外额度，以内部价格数据为准，不得沿用旧结论。
    8. 可以提供官网或操作指南链接，帮助客户自行核对具体信息。
    9. 面向客户的正文不得透露内部具体文件/表名称或工作流，例如“FAQ 文件/价格功能表/Pricing Feature Comparison Table/表格显示/知识库尚未提供”。信息不足时直接向客户追问缺失信息，或在聚合回复中直接省略该细节。例外：如果本次用户消息中出现“未收录问题处理策略”，必须严格按该策略使用指定的“知识库未检索到相关知识，该回复由AI生成，请核实后回复客户”提示语。
    10. 如果客户说要给团队/成员分配、分享、发放 Claude/ChatGPT 等第三方工具账号或订阅，必须理解为“通过 DICloak 管理/共享已有第三方工具账号”的客户场景；不要回复 DICloak 无法协助分配订阅。可以说明 DICloak 不销售或代购第三方订阅，但可以协助进行账号管理、环境/profile 配置、成员使用安排。
    11. 客户要求“步骤/教程/怎么设置/по этапной инструкции”等操作说明时，只能输出内部资料明确提供的 Steps、EntryPath、UIPosition、标准答案步骤或官方帮助链接；如果资料没有明确步骤，不要编造按钮、菜单路径、权限设置、扩展设置、账号导入方式或分享流程，也不要提“知识库未提供”，应直接追问客户缺失配置或给出已有资料中的高层建议。
    12. 如果必须给出下一步，只能给安全的高层建议（例如确认要共享的第三方账号数量、是否每个用户独立账号、是否需要代理、参考已提供的官方链接），不得伪造具体 UI 操作路径。
    13. 你就是 DICloak 技术支持/客服助手。禁止建议客户“咨询我们的技术支持/联系客服/询问人工客服/support team/техподдержка”。如果信息不足，直接向客户追问。例外：如果本次用户消息中出现“未收录问题处理策略”并判定为 DICloak 软件技术逻辑未收录问题，可以代表客服说明“该问题我们需进一步跟技术人员确认”，但不要让客户自行联系技术人员。`;

    const pricingGuardrail = `## 套餐/成员席位计算硬性要求
    1. 计划名称是产品专有名词。中文回复可写“Plus（高阶版）”；非中文回复必须只使用英文计划名 Free、Base、Plus、Share+，不得输出“高阶版/基础版/共享版+/免费版”等中文版本名称。
    2. 客户提供用户数量、团队成员或设备数量时，视为实际用户数。
    3. Base: 每个实际用户需要 1 个成员席位，所需成员席位 = 实际用户数。
    4. Plus: 超管占用 1 个成员席位；每个内部成员席位最多支持 100 个实际用户/设备；所需成员席位 = 1 + 向上取整((实际用户数 - 1) / 100)。例如 10 个用户使用 Plus 时，需要 2 个成员席位，不是 10 个成员席位，也不需要额外购买 9 个成员席位；但要提醒多个用户共用同一成员账户，成员管理和监管没有 Base 和 Share+ 方便。
    5. Share+: 成员席位无限制，每个用户使用独立成员账户，更便于管理和监管。
    6. 如果内部价格数据与旧 FAQ 或历史回复冲突，以本段计算规则和内部价格数据为准；禁止输出“Plus 10 人需要购买 9 个额外席位”这类结论。`;

    const deterministicSeatFacts = buildSeatCalculationFacts(actualUserCount);
    const planRecommendationRules = buildPlanRecommendationRules(customerBusinessType, actualUserCount);
    const accountSharingEnvironmentRules = buildAccountSharingEnvironmentRules(customerBusinessType);

    const stepEvidenceGuardrail = stepByStepRequested
      ? `## Step-by-step Evidence Gate (HIGHEST PRIORITY)
The customer requested step-by-step setup instructions. Before giving any numbered setup workflow, verify that Function Knowledge, Troubleshooting, FAQ StandardAnswer, or an official help link in the provided context explicitly contains those steps.
- If explicit steps are absent, do not mention knowledge base/internal data and do not redirect the customer to support. Either omit the unsupported detailed workflow in an aggregated answer, or directly ask the customer for the missing configuration details needed to give precise steps.
- Do NOT invent UI menu paths, button names, permission toggles, extension settings, profile-sharing steps, or account-import methods.
- You are the support assistant; never say "consult our technical support" or similar.
`
      : "";
  
    const intentGuardrail = (classification?.intents && classification.intents.length > 0)
      ? `
    ## Intent Coverage Rules (MUST)
    You MUST address ALL intents below in one response, each with a clear subsection:
    ${classification.intents.map((it, idx) => `${idx + 1}. ${it.type}`).join("\n")}
    For EACH intent include:
    - conclusion
    - evidence from knowledge context
    - actionable next step
    If evidence is insufficient for any intent, explicitly ask follow-up for that intent.
    Do NOT skip any intent.
    `
      : "";

    const finalPromptWithCoverage = `${finalSystemPrompt}\n${intentGuardrail}\n${outputFormatGuardrail}\n${evidenceGuardrail}\n${pricingGuardrail}\n${deterministicSeatFacts}\n${planRecommendationRules}\n${accountSharingEnvironmentRules}\n${stepEvidenceGuardrail}\n${languageRule}\n${multilingualQualityGuardrail}`;
    // 构建知识库上下文（只传递最相关的知识库项）
    let knowledgeContext = "";
    let responseShouldUsePricingTable = false;

    // 关键词来源：优先使用 AI 提取的关键词，否则使用本地提取
    const extractKeywords = (text: string): string[] => {
      const lower = text.toLowerCase();
      // 分词
      const words = lower.split(/[\s,.!?;:，。！？；：、]+/).filter(w => w.length > 1);
      // 中文提取2-4字子串
      const subs: string[] = [];
      for (let i = 0; i < lower.length - 1; i++) {
        for (let len = 2; len <= 4; len++) {
          if (i + len <= lower.length) {
            const sub = lower.substring(i, i + len);
            if (/^[\u4e00-\u9fa5]+$/.test(sub)) subs.push(sub);
          }
        }
      }
      return [...new Set([...words, ...subs])];
    };

    const expandDomainKeywords = (keywords: string[], userMessage: string): string[] => {
      const text = userMessage.toLowerCase();
      const expanded = new Set(keywords.map((keyword) => keyword.toLowerCase()).filter(Boolean));
      const windowSyncSignals = [
        "дублирование экранов",
        "несколько профилей",
        "разных профилях",
        "одним щелчком",
        "одну и ту же ссылку",
        "одно и тоже действие",
        "одно и то же действие",
        "лайк",
        "multi profile",
        "multiple profiles",
        "same link",
        "same action",
        "simultaneously",
        "同步",
        "多个环境",
        "多个窗口",
        "同一链接",
        "相同操作",
      ];

      if (windowSyncSignals.some((signal) => text.includes(signal))) {
        [
          "window synchronizer",
          "window synchronization",
          "window_synchronizer",
          "multi_profile_control",
          "sync_operations",
          "multiple profiles",
          "same link",
          "same action",
          "simultaneous operation",
          "窗口同步",
          "多环境同步",
          "多窗口同步",
        ].forEach((keyword) => expanded.add(keyword));
      }

      const accountSharingSignals = [
        "раздать",
        "подписк",
        "команда",
        "команде",
        "доступ",
        "поделиться",
        "share account",
        "account sharing",
        "shared account",
        "team share",
        "team access",
        "shared subscription",
        "platform account",
        "tool account",
        "compartir cuenta",
        "cuenta compartida",
        "equipo",
        "suscripción",
        "compartilhar conta",
        "conta compartilhada",
        "equipe",
        "assinatura",
        "chia sẻ tài khoản",
        "nhóm",
        "đăng ký",
        "berbagi akun",
        "akun bersama",
        "tim",
        "langganan",
        "บัญชี",
        "ทีม",
        "اشتراك",
        "حساب",
        "فريق",
        "アカウント共有",
        "チーム",
        "サブスクリプション",
        "계정 공유",
        "팀",
        "구독",
        "账号共享",
        "共享账号",
        "分享账号",
        "团队共享",
        "分发账号",
      ];

      if (accountSharingSignals.some((signal) => text.includes(signal))) {
        [
          "account_sharing",
          "shared_account",
          "multi_open_mode",
          "team_collaboration",
          "member_account",
          "setting",
          "share account",
          "shared account",
          "platform account",
          "tool account",
          "team share",
          "account sharing",
          "multi-open mode",
          "member account",
          "data sync",
          "账号共享",
          "共享账号",
          "团队协作",
          "成员账号",
          "多开模式",
          "数据同步",
        ].forEach((keyword) => expanded.add(keyword));
      }

      return [...expanded];
    };

    const normalizeForMatch = (value: string): string => value.toLowerCase().replace(/[\s_\-]+/g, " ").trim();
    
    // 同时使用 AI 提取关键词和原始问题关键词，避免中文功能知识库被英文关键词覆盖而无法命中
    const messageKeywords = extractKeywords(currentMessageText);
    const baseKeywords: string[] = aiKeywords && aiKeywords.length > 0
      ? [...new Set([...aiKeywords.map((k: string) => k.toLowerCase()), ...messageKeywords])]
      : messageKeywords;
    const userKeywords = expandDomainKeywords(baseKeywords, currentMessageText);
    
    console.log('[DEBUG] 使用的关键词（英语）:', userKeywords);

    // 术语翻译函数：根据 term_id 在术语库中查找对应语言的翻译
    const translateTerms = (
      text: string, 
      termIds: string[] = [], 
      userLang: string,
      termItems: Array<{ termId?: string; zh?: string; en?: string; pt?: string; es?: string; ru?: string; vi?: string }> = []
    ): string => {
      if (!text || termIds.length === 0 || termItems.length === 0) return text;
      
      // 支持的语言字段映射
      const langFieldMap: Record<string, string> = {
        'zh': 'zh',
        'cn': 'zh',
        'chinese': 'zh',
        'en': 'en',
        'english': 'en',
        'pt': 'pt',
        'portuguese': 'pt',
        'es': 'es',
        'spanish': 'es',
        'ru': 'ru',
        'russian': 'ru',
        'vi': 'vi',
        'vietnamese': 'vi'
      };
      
      const field = langFieldMap[userLang.toLowerCase()] || 'en';
      
      console.log(`[TERM DEBUG] 翻译术语 - 用户语言: ${userLang}, 字段: ${field}, termIds: ${termIds.join(', ')}`);
      
      // 构建 term_id 到翻译的映射
      const termMap: Record<string, string> = {};
      termItems.forEach(term => {
        if (term.termId) {
          const translation = (term as Record<string, unknown>)[field] as string || term.en || term.zh;
          if (translation) {
            termMap[term.termId] = translation;
          }
        }
      });
      
      // 替换 {{xxx}} 格式的术语
      let result = text;
      
      // 方法1: 根据 term_id 精确匹配术语库中的翻译
      termIds.forEach(termId => {
        const translation = termMap[termId];
        if (translation) {
          // 匹配 {{xxx}} 格式，其中 xxx 可能是任何文本
          const bracketPattern = /\{\{[^}]+\}\}/g;
          const matches = text.match(bracketPattern);
          if (matches) {
            matches.forEach(match => {
              const innerText = match.slice(2, -2); // 提取 {{ 和 }} 之间的内容
              // 如果术语库中的英文术语匹配 {{ }} 内的内容，则替换
              const termEn = termItems.find(t => t.termId === termId)?.en;
              if (termEn && innerText.toLowerCase() === termEn.toLowerCase()) {
                result = result.replace(match, translation);
                console.log(`[TERM DEBUG] 替换术语: ${match} -> ${translation} (termId: ${termId})`);
              }
            });
          }
        }
      });
      
      // 方法2: 直接用术语库中的英文匹配 {{ }} 内的内容
      const bracketPattern = /\{\{[^}]+\}\}/g;
      const matches = result.match(bracketPattern);
      if (matches) {
        matches.forEach(match => {
          const innerText = match.slice(2, -2).toLowerCase();
          // 在术语库中查找英文匹配的术语
          const matchedTerm = termItems.find(t => t.en && t.en.toLowerCase() === innerText);
          if (matchedTerm && matchedTerm.termId) {
            const translation = (matchedTerm as Record<string, unknown>)[field] as string || matchedTerm.en;
            if (translation) {
              result = result.replace(match, translation);
              console.log(`[TERM DEBUG] 直接匹配替换: ${match} -> ${translation}`);
            }
          }
        });
      }
      
      return result;
    };

    // 处理术语定位符和残留占位符，确保传给模型的知识库上下文不包含 {{}}
    const processTermMarkers = (text: string): string => {
      return text
        // 匹配 [已翻译:原文->译文] 格式，只保留译文
        .replace(/\[已翻译:[^>]*->([^\]]+)\]/g, '$1')
        // 兜底移除术语占位符花括号：{{Team}} -> Team
        .replace(/\{\{\s*([^{}]+?)\s*\}\}/g, '$1')
        .replace(/[{}]/g, '')
        // 避免知识库 Markdown 加粗符号诱导模型原样输出
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/__(.*?)__/g, '$1');
    };

    // 初始化问题类型和格式（默认值）
    let problemType: ProblemType = 'info_insufficient';
    const lockedRole: UserRole | null = confirmedRole === 'client' || confirmedRole === 'end_user' ? confirmedRole : null;
    let userRole: UserRole = lockedRole || 'unknown';
    let outputFormatType: 'A' | 'B' | 'C' = 'A';
    let aiOutputFormat = generateAIOutputFormat(problemType, userRole);

    const tKnowledgeStart = Date.now();
    if (knowledge && ((knowledge.faqItems?.length ?? 0) > 0 || (knowledge.troubleshootingItems?.length ?? 0) > 0 || (knowledge.troubleshootingFlowItems?.length ?? 0) > 0 || (knowledge.outOfScopeItems?.length ?? 0) > 0 || (knowledge.functionKnowledge?.length ?? 0) > 0)) {
      // 计算匹配分数（增强标签匹配）
      const calculateMatchScore = (userMsg: string, item: { questionCN?: string; questionEN?: string; tags?: string[]; userPhrases?: string }, keywords: string[]) => {
        let score = 0;
        const msgLower = userMsg.toLowerCase();
        const normalizedMsg = normalizeForMatch(userMsg);
        const normalizedKeywords = keywords.map(normalizeForMatch);

        // 1. 问题文本匹配
        if (item.questionCN) {
          const cnLower = item.questionCN.toLowerCase();
          if (cnLower.includes(msgLower) || msgLower.includes(cnLower)) score += 10;
          normalizedKeywords.forEach(kw => {
            if (normalizeForMatch(cnLower).includes(kw)) score += 2;
          });
        }
        if (item.questionEN) {
          const enLower = item.questionEN.toLowerCase();
          if (enLower.includes(msgLower) || msgLower.includes(enLower)) score += 10;
          normalizedKeywords.forEach(kw => {
            if (normalizeForMatch(enLower).includes(kw)) score += 2;
          });
        }

        // 2. 标签匹配（关键词与标签匹配）
        if (item.tags && item.tags.length > 0) {
          item.tags.forEach(tag => {
            const tagLower = tag.toLowerCase();
            const normalizedTag = normalizeForMatch(tag);
            // 用户消息直接包含标签
            if (msgLower.includes(tagLower) || normalizedMsg.includes(normalizedTag)) score += 5;
            // 关键词匹配标签
            normalizedKeywords.forEach(kw => {
              if (normalizedTag.includes(kw) || kw.includes(normalizedTag)) score += 3;
            });
          });
        }

        // 3. 用户问法匹配
        if (item.userPhrases) {
          const phrases = item.userPhrases.split(/[,，;；\n]+/).map(p => p.trim().toLowerCase());
          phrases.forEach(phrase => {
            if (phrase && (msgLower.includes(phrase) || normalizedMsg.includes(normalizeForMatch(phrase)))) score += 4;
          });
        }

        const searchableText = normalizeForMatch([
          item.questionCN,
          item.questionEN,
          item.userPhrases,
          ...(item.tags || []),
        ].filter(Boolean).join(" "));
        if (normalizedKeywords.includes("window synchronizer") && searchableText.includes("window synchronizer")) score += 12;
        if (normalizedKeywords.includes("window synchronization") && searchableText.includes("window synchronization")) score += 12;
        if (normalizedKeywords.includes("multi profile control") && searchableText.includes("multi profile control")) score += 8;
        if (normalizedKeywords.includes("sync operations") && searchableText.includes("sync operations")) score += 8;

        return score;
      };

      type FunctionKnowledgeItem = {
        id?: string;
        functionId?: string;
        module1?: string;
        pageName?: string;
        functionType?: string;
        functionName?: string;
        description?: string;
        entryPath?: string;
        uiPosition?: string;
        prerequisites?: string;
        steps?: string;
        faqIds?: string;
        keywordsCN?: string;
        keywordsEN?: string;
      };

      const normalizeFunctionText = (value?: string) => (value || '').toLowerCase();
      const calculateFunctionKnowledgeScore = (userMsg: string, item: FunctionKnowledgeItem, keywords: string[]) => {
        let score = 0;
        const msgLower = userMsg.toLowerCase();
        const searchableFields = [
          item.functionName,
          item.description,
          item.keywordsCN,
          item.keywordsEN,
          item.module1,
          item.pageName,
          item.functionType,
          item.entryPath,
          item.uiPosition,
          item.prerequisites,
          item.steps,
        ];
        const searchableText = searchableFields.map(normalizeFunctionText).filter(Boolean).join(' ');
        const compactMessage = msgLower.replace(/[\s,，。！？?；;、]/g, '');
        const compactSearchableText = searchableText.replace(/[\s,，。！？?；;、]/g, '');

        if (searchableText.includes(msgLower) || msgLower.includes(searchableText) || compactSearchableText.includes(compactMessage)) {
          score += 12;
        }

        keywords.forEach((kw) => {
          const keyword = kw.toLowerCase();
          if (!keyword) return;
          if (normalizeFunctionText(item.functionName).includes(keyword)) score += 5;
          if (normalizeFunctionText(item.description).includes(keyword)) score += 4;
          if (normalizeFunctionText(item.keywordsCN).includes(keyword) || normalizeFunctionText(item.keywordsEN).includes(keyword)) score += 5;
          if (normalizeFunctionText(item.steps).includes(keyword) || normalizeFunctionText(item.prerequisites).includes(keyword)) score += 3;
          if (normalizeFunctionText(item.module1).includes(keyword) || normalizeFunctionText(item.pageName).includes(keyword)) score += 2;
        });

        const userQuestionTokens = msgLower.split(/[\s,，。！？?；;、]+/).filter((token) => token.length >= 2);
        userQuestionTokens.forEach((token) => {
          if (searchableText.includes(token)) score += 2;
        });

        return score;
      };

      // FAQ 匹配过滤并排序，避免弱相关 FAQ 排在前面干扰模型
      type FaqItem = { questionCN: string; questionEN?: string; tags?: string[]; userPhrases?: string; answer: string; functionId?: string; termIds?: string[]; faqId?: string };
      const faqItems = (knowledge.faqItems || []) as FaqItem[];
      const matchedFaq = faqItems
        .map((item: FaqItem) => ({ item, score: calculateMatchScore(currentMessageText, item, userKeywords) }))
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score); // 按相关度排序，避免弱相关 FAQ 排在前面干扰模型

      // 功能知识库匹配过滤
      const functionKnowledgeItems = (knowledge.functionKnowledge || []) as FunctionKnowledgeItem[];
      const matchedFunctionKnowledge = functionKnowledgeItems
        .map((item: FunctionKnowledgeItem) => ({ item, score: calculateFunctionKnowledgeScore(currentMessageText, item, userKeywords) }))
        .filter((m) => m.score > 0)
        .sort((a, b) => b.score - a.score);

      // Troubleshooting 匹配过滤
      type TsItem = { questionCN: string; questionEN?: string; tags?: string[]; userPhrases?: string; answer: string; answerClient?: string; answerEndUser?: string; functionId?: string; termIds?: string[]; faqId?: string };
      const tsItems = (knowledge.troubleshootingItems || []) as TsItem[];
      const matchedTs = tsItems
        .map((item: TsItem) => ({ item, score: calculateMatchScore(currentMessageText, item, userKeywords) }))
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score);

      // 多轮排障流程按整段对话匹配，确保客户简短回答后仍能继续此前命中的流程。
      type FlowItem = NonNullable<KnowledgeBase['troubleshootingFlowItems']>[number];
      const conversationText = [
        ...(history || []).map((item) => item.content),
        currentMessageText,
      ].join('\n');
      const enabledFlowItems = (knowledge.troubleshootingFlowItems || []).filter((item) => item.enabled);
      const flowScores = new Map<string, number>();
      enabledFlowItems.forEach((item) => {
        const score = calculateMatchScore(conversationText, {
          questionCN: item.questionCN,
          userPhrases: item.userPhrases,
          tags: item.tags,
        }, userKeywords);
        flowScores.set(item.flowId, Math.max(flowScores.get(item.flowId) || 0, score));
      });
      const matchedFlowIds = [...flowScores.entries()]
        .filter(([, score]) => score > 0)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3)
        .map(([flowId]) => flowId);
      const matchedFlowItems: FlowItem[] = enabledFlowItems.filter((item) => matchedFlowIds.includes(item.flowId));

      // Out of Scope 匹配过滤
      type OosItem = { questionCN: string; questionEN?: string; userPhrases?: string; tags?: string[]; answer: string; answerClient?: string; answerEndUser?: string; faqId?: string };
      const oosItems = (knowledge.outOfScopeItems || []) as OosItem[];
      const matchedOos = oosItems
        .map((item: OosItem) => ({ item, score: calculateMatchScore(currentMessageText, item, userKeywords) }))
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score);

      // ==================== 问题类型与身份识别 ====================
      const topFaqScore = matchedFaq.length > 0 ? Math.max(...matchedFaq.map(m => m.score)) : 0;
      const topTsScore = matchedTs.length > 0 ? Math.max(...matchedTs.map(m => m.score)) : 0;
      const topFlowScore = matchedFlowIds.length > 0 ? Math.max(...matchedFlowIds.map((flowId) => flowScores.get(flowId) || 0)) : 0;
      const topTroubleshootingScore = Math.max(topTsScore, topFlowScore);
      const topOosScore = matchedOos.length > 0 ? Math.max(...matchedOos.map(m => m.score)) : 0;
      const topFunctionKnowledgeScore = matchedFunctionKnowledge.length > 0 ? Math.max(...matchedFunctionKnowledge.map(m => m.score)) : 0;
      
      const problemTypeResult = identifyProblemType(currentMessageText, Math.max(topFaqScore, topFunctionKnowledgeScore), topTroubleshootingScore, topOosScore);
      const userRoleResult = identifyUserRole(currentMessageText, history);

      const intents = classification?.intents || [];
      const selectedTables = new Set<TableId>(
        intents.flatMap((it) => (it.tables || []).map((t) => t.id)).filter((id): id is TableId => Boolean(id))
      );

      // API + 套餐共现强规则：强制双表
      const lowerMessage = currentMessageText.toLowerCase();
      const apiSignals = ["api", "endpoint", "key", "create", "post", "member", "成员"];
      const planSignals = ["plan", "tier", "subscription", "pricing", "upgrade", "套餐", "权限"];
      const hasApiSignal = apiSignals.some((k) => lowerMessage.includes(k));
      const hasPlanSignal = planSignals.some((k) => lowerMessage.includes(k));
      if (hasApiSignal && hasPlanSignal) {
        selectedTables.add("api_endpoints");
        selectedTables.add("pricing_table");
        selectedTables.add("faq");
      }
      
      const classifiedProblemType = classification?.problemType || classification?.primaryIntent;
      const backendRequiresClarification = problemTypeResult.type === 'intent_unclear' || problemTypeResult.type === 'info_insufficient';
      const classificationLooksLikeMisroutedEndUser = classifiedProblemType === 'user_routing' && userRoleResult.role !== 'end_user';

      // 更新块外变量：后端的澄清/信息不足规则优先，避免分类器把模糊续订、ChatGPT profile 打不开误判为功能咨询或终端用户问题
      problemType = matchedFlowIds.length > 0
        ? 'troubleshooting'
        : backendRequiresClarification || classificationLooksLikeMisroutedEndUser
        ? problemTypeResult.type
        : classifiedProblemType || problemTypeResult.type;
      const inferredRole = classification?.identityStatus || userRoleResult.role;
      userRole = lockedRole || inferredRole;
      outputFormatType = getOutputFormatType(problemType, userRole);
      aiOutputFormat = generateAIOutputFormat(problemType, userRole);
      if (matchedFlowIds.length > 0) {
        outputFormatType = 'A';
        aiOutputFormat = `## 多轮排障流程输出格式（必须使用短 section 标签）
[[question]]
故障排查
[[/question]]
[[main]]
严格输出流程连续推进后到达的第一个未解决节点的 QUESTION；如果已经满足终点节点的全部前置条件，则输出该节点的 SOLUTION。只输出其中一项，不得同时展示后续问题、其他分支或内部判断。
[[/main]]
[[supplement]]
无。
[[/supplement]]
[[info]]
无。
[[/info]]`;
      }
      
      console.log("[TYPE DEBUG] 问题类型:", problemType, "-", problemTypeResult.reason);
      console.log("[TYPE DEBUG] 用户身份:", userRole, lockedRole ? `- 已确认角色(${roleSource || "manual"})，跳过后续覆盖` : `- ${userRoleResult.reason}`);
      console.log("[TYPE DEBUG] 输出格式:", outputFormatType);
      console.log("[TYPE DEBUG] 匹配分数 - FAQ:", topFaqScore, "Function:", topFunctionKnowledgeScore, "TS:", topTsScore, "Flow:", topFlowScore, "OOS:", topOosScore);

      uncoveredKnowledgePolicy = buildUncoveredKnowledgePolicy(currentMessageText, problemType, {
        faq: topFaqScore,
        functionKnowledge: topFunctionKnowledgeScore,
        troubleshooting: topTroubleshootingScore,
        outOfScope: topOosScore,
        apiFound: false,
        pricingFound: false,
      });
      console.log("[UNCOVERED DEBUG] 未收录策略:", uncoveredKnowledgePolicy.isRelevant, uncoveredKnowledgePolicy.isDICloakTechnicalLogic ? "dicloak_technical" : uncoveredKnowledgePolicy.isGeneralNetworkOrWebsite ? "general_network" : "uncertain");

      // ==================== API 端点表检索 ====================
      // 当检测到 API 相关问题时，始终检索 API 端点表
      // 不再仅依赖 problemType === 'api_problem'，因为 API 功能查询可能被归类为其他类型
      let apiSearchResult: { found: boolean; endpoints: unknown[]; parameters: unknown[]; summary: string } | null = null;
      const apiIntent = intents.find((it) => it.type === "api_problem");
      const isApiQuestion =
        problemType === "api_problem" ||
        selectedTables.has("api_endpoints") ||
        (problemTypeResult.apiInfo !== undefined);

      if (isApiQuestion) {
        const apiAction = apiIntent?.entities?.action || problemTypeResult.apiInfo?.apiAction;
        const apiObject = apiIntent?.entities?.apiModule || problemTypeResult.apiInfo?.apiObject;

        apiSearchResult = searchApiEndpoints(
          apiAction || undefined,
          apiObject || undefined,
          knowledge.apiEndpoints || [],
          knowledge.apiParameters || []
        );
        console.log("[API DEBUG] API 检索结果:", apiSearchResult.found ? "找到" : "未找到");
        console.log("[API DEBUG] 匹配端点数:", apiSearchResult.endpoints.length);
        console.log("[API DEBUG] 摘要:", apiSearchResult.summary);
      }

      // ==================== 价格功能表检索 ====================
      // 当检测到套餐/价格相关问题时，始终检索价格功能表
      // 不再依赖 problemType === 'subscription_problem'，因为套餐功能对比问题可能被归类为其他类型
      let pricingSearchResult: { found: boolean; plans: unknown[]; summary: string } | null = null;
      const isPricingQuestion = problemType === 'subscription_problem' || 
                          problemType === 'intent_unclear' || 
                          selectedTables.has("pricing_table") ||
                          (problemTypeResult.subscriptionInfo !== undefined);
      if (isPricingQuestion) {
        // 套餐推荐类问题，不使用关键词过滤，直接返回所有套餐供 AI 参考
        const subscriptionKeywords = ['推荐', '哪个', '适合', '选择', '比较', 'difference', 'compare', 'recommend', 'which', '支持', '能否', '可以', '功能', 'subscription', 'tier', 'plan', '套餐', '订阅'];
        const isRecommendQuestion = subscriptionKeywords.some(k => currentMessageText.toLowerCase().includes(k));
        
        // 当检测为价格/套餐问题时，始终返回所有套餐供 AI 判断（不做关键词过滤）
        // 因为用户问题通常是自然语言句子，很难精确匹配 planName/features
        const queryForPricing = undefined;
        
        pricingSearchResult = searchPricingPlans(knowledge.pricingPlans || [], queryForPricing);
        console.log("[PRICING DEBUG] 价格检索结果:", pricingSearchResult.found ? "找到" : "未找到");
        console.log("[PRICING DEBUG] 推荐问题:", isRecommendQuestion);
        console.log("[PRICING DEBUG] 匹配套餐数:", pricingSearchResult.plans.length);
      }

      // 调试日志
      console.log("[MATCH DEBUG] User message:", message);
      console.log("[MATCH DEBUG] User keywords:", userKeywords.slice(0, 10).join(', '));
      console.log("[MATCH DEBUG] Matched FAQ count:", matchedFaq.length);
      matchedFaq.slice(0, 10).forEach((m, i) => {
        console.log(`[MATCH DEBUG] FAQ ${i+1}: ${m.item.faqId}, score: ${m.score}, question: ${m.item.questionCN}, tags: ${m.item.tags?.join(',')}`);
      });
      if (matchedFaq.length > 10) {
        console.log(`[MATCH DEBUG] ... and ${matchedFaq.length - 10} more FAQs`);
      }
      console.log("[MATCH DEBUG] Matched TS count:", matchedTs.length);
      console.log("[MATCH DEBUG] Matched Function Knowledge count:", matchedFunctionKnowledge.length);
      matchedFunctionKnowledge.slice(0, 10).forEach((m, i) => {
        console.log(`[MATCH DEBUG] Function ${i+1}: ${m.item.functionId || m.item.id || 'unknown'}, score: ${m.score}, name: ${m.item.functionName || ''}, module: ${m.item.module1 || ''}`);
      });
      console.log("[MATCH DEBUG] Matched OOS count:", matchedOos.length);

      uncoveredKnowledgePolicy = buildUncoveredKnowledgePolicy(currentMessageText, problemType, {
        faq: topFaqScore,
        functionKnowledge: topFunctionKnowledgeScore,
        troubleshooting: topTroubleshootingScore,
        outOfScope: topOosScore,
        apiFound: Boolean(apiSearchResult?.found),
        pricingFound: Boolean(pricingSearchResult?.found),
      });
      console.log("[UNCOVERED DEBUG] 最终未收录策略:", uncoveredKnowledgePolicy.isRelevant, uncoveredKnowledgePolicy.isDICloakTechnicalLogic ? "dicloak_technical" : uncoveredKnowledgePolicy.isGeneralNetworkOrWebsite ? "general_network" : "uncertain");

      // ==========================================
      // 根据问题类型决定上下文构建顺序
      // API 问题：API 端点表优先
      // 套餐问题：价格功能表优先
      // 其他问题：FAQ 优先
      // ==========================================
      
      // 更新优先级判断（考虑检索结果）
      const finalIsApiQuestion = isApiQuestion || apiSearchResult?.found;
      const finalIsPricingQuestion = isPricingQuestion || pricingSearchResult?.found;
      responseShouldUsePricingTable = Boolean(finalIsPricingQuestion);
      
      console.log("[PRIORITY DEBUG] isApiQuestion:", finalIsApiQuestion, "isPricingQuestion:", finalIsPricingQuestion);

      // 使用临时变量存储优先上下文
      let priorityContext = "";
      if (deterministicSeatFacts) {
        priorityContext += deterministicSeatFacts + "\n";
      }
      priorityContext += planRecommendationRules + "\n";
      if (accountSharingEnvironmentRules) {
        priorityContext += accountSharingEnvironmentRules + "\n";
      }
      if (stepEvidenceGuardrail) {
        priorityContext += stepEvidenceGuardrail + "\n";
      }
      
      // 优先构建 API 端点上下文（如果是 API 问题）
      if (apiSearchResult && apiSearchResult.found) {
        priorityContext += "## API Endpoints (from API Table - HIGHEST PRIORITY)\n";
        priorityContext += "IMPORTANT: For API questions, you MUST use this API table data first. FAQ is supplementary.\n";
        priorityContext += "DO NOT fabricate API endpoints, methods, or parameters not in this table.\n\n";
        apiSearchResult.endpoints.forEach((ep: unknown, index: number) => {
          const endpoint = ep as {
            apiId?: string;
            apiName?: string;
            apiType?: string;
            method?: string;
            fullpathRule?: string;
            endpoint?: string;
            authMethod?: string;
            description?: string;
            module?: string;
            requestParamLocation?: string;
            needEnvId?: string;
            isSupported?: string;
            successResponse?: string;
            remarks?: string;
          };
          priorityContext += `[API ${index + 1}] ${endpoint.apiName || 'Unknown'}\n`;
          priorityContext += `  API ID: ${endpoint.apiId || ''}\n`;
          priorityContext += `  Type: ${endpoint.apiType || 'HTTP API'}\n`;
          priorityContext += `  Method: ${endpoint.method || 'GET'}\n`;
          priorityContext += `  Endpoint: ${endpoint.endpoint || ''}\n`;
          if (endpoint.fullpathRule) priorityContext += `  Full Path: ${endpoint.fullpathRule}\n`;
          if (endpoint.authMethod) priorityContext += `  Auth: ${endpoint.authMethod}\n`;
          if (endpoint.description) priorityContext += `  Description: ${endpoint.description}\n`;
          if (endpoint.module) priorityContext += `  Module: ${endpoint.module}\n`;
          if (endpoint.requestParamLocation) priorityContext += `  Param Location: ${endpoint.requestParamLocation}\n`;
          if (endpoint.needEnvId) priorityContext += `  Need env_id: ${endpoint.needEnvId}\n`;
          if (endpoint.isSupported !== undefined) priorityContext += `  Supported: ${endpoint.isSupported}\n`;
          if (endpoint.successResponse) priorityContext += `  Success Response: ${endpoint.successResponse}\n`;
          if (endpoint.remarks) priorityContext += `  Remarks: ${endpoint.remarks}\n`;
          
          // 添加参数信息
          const params = (apiSearchResult.parameters as unknown[]).filter((p): p is { apiId?: string } => {
            const param = p as { apiId?: string };
            return param.apiId === endpoint.apiId;
          });
          if (params.length > 0) {
            priorityContext += `  Parameters:\n`;
            params.forEach((p) => {
              const param = p as {
                paramName?: string;
                paramNameCn?: string;
                paramType?: string;
                isRequired?: boolean;
                description?: string;
                example?: string;
                validationRule?: string;
                applicableScenarios?: string;
              };
              const required = param.isRequired ? ' [REQUIRED]' : '';
              priorityContext += `    - ${param.paramName || ''} (${param.paramType || 'any'})${required}\n`;
              if (param.paramNameCn) priorityContext += `      Name CN: ${param.paramNameCn}\n`;
              if (param.description) priorityContext += `      Description: ${param.description}\n`;
              if (param.example) priorityContext += `      Example/Options: ${param.example}\n`;
              if (param.validationRule) priorityContext += `      Validation: ${param.validationRule}\n`;
              if (param.applicableScenarios) priorityContext += `      Applicable: ${param.applicableScenarios}\n`;
            });
          }
          priorityContext += "\n";
        });
      }

      // 优先构建价格功能表上下文（如果是套餐问题）
      if (pricingSearchResult && pricingSearchResult.found) {
        priorityContext += "## Pricing Feature Comparison Table (HIGHEST PRIORITY, INTERNAL KNOWLEDGE BASE)\n";
        priorityContext += "IMPORTANT: For subscription/plan questions, you MUST use this imported pricing table first. This is not live website content.\n";
        priorityContext += "Use FAQ as supplementary only. If FAQ conflicts with this table, the table wins. Paid plans other than Free may have adjustable member/environment quotas when shown here; do not invent Base restrictions.\n";
        priorityContext += "Customer-facing wording: you may provide official website/help-guide links when useful, but do NOT expose internal file/table names such as FAQ file, pricing table, or Pricing Feature Comparison Table. Answer directly as DICloak support.\n\n";
        
        // 输出原始横向表格
        if (knowledge.pricingRawTable) {
          const rawTable = knowledge.pricingRawTable;
          priorityContext += "| " + rawTable.columns.join(" | ") + " |\n";
          priorityContext += "| " + rawTable.columns.map(() => "---").join(" | ") + " |\n";
          rawTable.rows.forEach((row: Record<string, string>) => {
            priorityContext += "| " + rawTable.columns.map((col: string) => row[col] || "").join(" | ") + " |\n";
          });
        } else if (pricingSearchResult.plans) {
          // 如果没有原始表格，使用解析后的套餐数据
          pricingSearchResult.plans.forEach((plan, index) => {
            const planData = plan as { planName?: string; planNameCN?: string; price?: number; priceUnit?: string; features?: string[] };
            priorityContext += `[Plan ${index + 1}] ${planData.planNameCN || planData.planName}\n`;
            if (planData.price) priorityContext += `  Price: ${planData.price}/${planData.priceUnit || 'month'}\n`;
            if (planData.features && planData.features.length > 0) {
              priorityContext += `  Features: ${planData.features.join(', ')}\n`;
            }
            priorityContext += "\n";
          });
        }
        priorityContext += "\n";
      }

      // 将优先上下文添加到最前面
      knowledgeContext = priorityContext + knowledgeContext;

      // 构建功能知识库上下文
      const shouldUseFunctionKnowledge = problemType === 'feature_faq' || selectedTables.has('function_knowledge') || matchedFunctionKnowledge.length > 0;
      if (shouldUseFunctionKnowledge && matchedFunctionKnowledge.length > 0) {
        knowledgeContext += "## Function Knowledge Base (sorted by relevance score)\n";
        knowledgeContext += "IMPORTANT: For feature capability / function usage questions, you MUST use this function knowledge before saying no related knowledge was found.\n";
        knowledgeContext += "Use EntryPath, UIPosition, Prerequisites and Steps to answer how the feature works.\n";
        knowledgeContext += "INTERNAL: Each item has a FUNCTION ID for source selection only. Do NOT output [FUNCTION_ID: xxx] or any source marker.\n\n";

        matchedFunctionKnowledge.slice(0, 12).forEach((m, index) => {
          const item = m.item;
          knowledgeContext += `[FUNCTION ${index + 1}] ID: ${item.functionId || item.id || 'unknown'} | Score: ${m.score}\n`;
          if (item.module1) knowledgeContext += `Module: ${item.module1}\n`;
          if (item.pageName) knowledgeContext += `Page: ${item.pageName}\n`;
          if (item.functionType) knowledgeContext += `FunctionType: ${item.functionType}\n`;
          if (item.functionName) knowledgeContext += `FunctionName: ${item.functionName}\n`;
          if (item.description) knowledgeContext += `Description: ${item.description}\n`;
          if (item.entryPath) knowledgeContext += `EntryPath: ${item.entryPath}\n`;
          if (item.uiPosition) knowledgeContext += `UIPosition: ${item.uiPosition}\n`;
          if (item.prerequisites) knowledgeContext += `Prerequisites: ${item.prerequisites}\n`;
          if (item.steps) knowledgeContext += `Steps: ${item.steps}\n`;
          if (item.keywordsCN) knowledgeContext += `KeywordsCN: ${item.keywordsCN}\n`;
          if (item.keywordsEN) knowledgeContext += `KeywordsEN: ${item.keywordsEN}\n`;
          if (item.faqIds) knowledgeContext += `RelatedFAQ: ${item.faqIds}\n`;
          knowledgeContext += "\n";
        });
      }

      // 构建 FAQ 上下文
      const faqContextLabel = finalIsApiQuestion || finalIsPricingQuestion ? "FAQ Knowledge Base (SUPPLEMENTARY)" : "FAQ Knowledge Base (sorted by relevance score)";
      const isRelevantSupplementaryFaq = (item: FaqItem): boolean => {
        const searchableText = normalizeForMatch([
          item.questionCN,
          item.questionEN,
          item.userPhrases,
          item.answer,
          ...(item.tags || []),
        ].filter(Boolean).join(" "));
        const relevantSignals = [
          "subscription", "pricing", "price", "plan", "billing", "member", "seat",
          "team", "account", "share", "profile", "environment", "claude", "chatgpt",
          "订阅", "套餐", "价格", "成员", "席位", "团队", "账号", "共享", "环境",
        ];
        return relevantSignals.some((signal) => searchableText.includes(normalizeForMatch(signal)));
      };
      const faqForContext = matchedFaq
        .filter((m) => {
          if (!finalIsPricingQuestion) return true;
          return m.score >= 10 && isRelevantSupplementaryFaq(m.item);
        })
        .slice(0, finalIsPricingQuestion ? 8 : 20);
      
      if (faqForContext.length > 0) {
        knowledgeContext += `## ${faqContextLabel}\n`;
        if (finalIsApiQuestion || finalIsPricingQuestion) {
          knowledgeContext += "NOTE: This is SUPPLEMENTARY information. Priority data and deterministic backend facts above override FAQ content when there is any conflict.\n";
        }
        knowledgeContext += "INTERNAL: Each item has a FAQ ID for source selection only. Do NOT output [FAQ_ID: xxx] or any source marker.\n";
        knowledgeContext += "STRICT: For FAQ answers, use StandardAnswer as the factual boundary. Do NOT add buttons, paths, permissions, password/expiry settings, quota details, or extra steps that are not explicitly in StandardAnswer or another provided context item. Preserve StandardAnswer punctuation, feature names, decimal prices, and URLs exactly.\n";
        knowledgeContext += "HINT: Higher score = more relevant. Prefer FAQs with score >= 10.\n\n";
        faqForContext.forEach((m, index) => {
          const item = m.item;
          // 翻译术语：根据 term_id 在术语库中查找对应语言的翻译
          const translatedAnswer = translateTerms(
            item.answer, 
            item.termIds, 
            effectiveLanguage,
            knowledge.termItems || []
          );
          // 处理术语定位符
          const processedAnswer = processTermMarkers(translatedAnswer);
          knowledgeContext += `[FAQ ${index + 1}] ID: ${item.faqId || 'unknown'} | Score: ${m.score}\n`;
          knowledgeContext += `Problem: ${item.questionCN || item.questionEN}\n`;
          if (item.userPhrases) {
            knowledgeContext += `UserPhrases: ${item.userPhrases}\n`;
          }
          knowledgeContext += `StandardAnswer: ${processedAnswer}\n`;
          if (item.tags && item.tags.length > 0) {
            knowledgeContext += `Tags: ${item.tags.join(', ')}\n`;
          }
          if (item.functionId) {
            knowledgeContext += `RelatedFunction: ${item.functionId}\n`;
          }
          knowledgeContext += "\n";
        });
      }

      // 构建 Troubleshooting 上下文
      if (matchedTs.length > 0) {
        knowledgeContext += "## Troubleshooting Knowledge Base (sorted by relevance score)\n";
        knowledgeContext += "INTERNAL: Each item has a TS ID for source selection only. Do NOT output [TS_ID: xxx] or any source marker.\n";
        knowledgeContext += "STRICT: Use provided StandardAnswer fields as the factual boundary. Do NOT add unprovided buttons, paths, permissions, password/expiry settings, quota details, or extra steps. Preserve StandardAnswer punctuation, feature names, decimal prices, and URLs exactly.\n";
        knowledgeContext += "HINT: Higher score = more relevant. Prefer items with score >= 10.\n\n";
        matchedTs.slice(0, 20).forEach((m, index) => {
          const item = m.item;
          // 翻译术语
          const translatedAnswer = translateTerms(
            item.answer, 
            item.termIds, 
            effectiveLanguage,
            knowledge.termItems || []
          );
          const processedAnswer = processTermMarkers(translatedAnswer);
          
          // 翻译 client 和 end_user 答案
          const translatedAnswerClient = item.answerClient ? processTermMarkers(translateTerms(
            item.answerClient, 
            item.termIds, 
            effectiveLanguage,
            knowledge.termItems || []
          )) : '';
          const translatedAnswerEndUser = item.answerEndUser ? processTermMarkers(translateTerms(
            item.answerEndUser, 
            item.termIds, 
            effectiveLanguage,
            knowledge.termItems || []
          )) : '';
          
          knowledgeContext += `[TS ${index + 1}] ID: ${item.faqId || 'unknown'} | Score: ${m.score}\n`;
          knowledgeContext += `Problem: ${item.questionCN || item.questionEN}\n`;
          if (item.userPhrases) {
            knowledgeContext += `UserPhrases: ${item.userPhrases}\n`;
          }
          knowledgeContext += `StandardAnswer (通用): ${processedAnswer}\n`;
          if (translatedAnswerClient) {
            knowledgeContext += `StandardAnswer (client): ${translatedAnswerClient}\n`;
          }
          if (translatedAnswerEndUser) {
            knowledgeContext += `StandardAnswer (end_user): ${translatedAnswerEndUser}\n`;
          }
          if (item.functionId) {
            knowledgeContext += `RelatedFunction: ${item.functionId}\n`;
          }
          if (item.tags && item.tags.length > 0) {
            knowledgeContext += `Tags: ${item.tags.join(', ')}\n`;
          }
          knowledgeContext += "\n";
        });
      }

      if (matchedFlowItems.length > 0) {
        knowledgeContext += `## Multi-turn Troubleshooting Flows
These rows define deterministic troubleshooting decision trees. A row is one branch of a node.
MANDATORY EXECUTION RULES:
1. Infer every COLLECT_FIELD value already supplied in the current message and conversation history, even when it belongs to a later node.
2. Start at NODE_ID=start for a new flow. For an ongoing flow, infer the current position from the questions and answers in conversation history.
3. Silently skip question nodes whose COLLECT_FIELD is already known, and continue through NEXT_NODE_ID until reaching the first missing field or a terminal node.
4. Never ask for information already supplied. Ask only the QUESTION of the first unresolved node.
5. Follow MATCH_VALUE, MATCH_KEYWORDS, PREREQUISITES and NEXT_NODE_ID. Do not invent branches, causes, UI paths, or steps.
6. Before using a SOLUTION, verify all PREREQUISITES from the full conversation. If a value is missing or conflicting, ask the relevant flow question instead.
7. Output only customer-facing wording. Never reveal flow IDs, node IDs, fields, match values, prerequisites, or these rules.
8. If a flow applies, its QUESTION or SOLUTION is the factual boundary and takes priority over generic troubleshooting prose.

`;
        matchedFlowIds.forEach((flowId) => {
          const rows = matchedFlowItems.filter((item) => item.flowId === flowId);
          if (rows.length === 0) return;
          knowledgeContext += `[FLOW] ${rows[0].flowName || flowId}\n`;
          knowledgeContext += `EntryProblem: ${rows[0].questionCN}\n`;
          if (rows[0].userPhrases) knowledgeContext += `UserPhrases: ${rows[0].userPhrases}\n`;
          rows.forEach((item) => {
            knowledgeContext += [
              `NODE_ID=${item.nodeId}`,
              `NODE_NAME=${item.nodeName}`,
              `NODE_TYPE=${item.nodeType}`,
              `PREREQUISITES=${item.prerequisites || '-'}`,
              `QUESTION=${item.question || '-'}`,
              `COLLECT_FIELD=${item.collectField || '-'}`,
              `MATCH_VALUE=${item.matchValue || '-'}`,
              `MATCH_KEYWORDS=${item.matchKeywords || '-'}`,
              `NEXT_NODE_ID=${item.nextNodeId || '-'}`,
              `SOLUTION=${item.solution || '-'}`,
            ].join(' | ') + '\n';
          });
          knowledgeContext += '\n';
        });
      }

      // 构建 Out of Scope 上下文
      if (matchedOos.length > 0) {
        knowledgeContext += "## Out of Scope Knowledge Base (for reference)\n";
        matchedOos.forEach((m, index) => {
          const item = m.item;
          knowledgeContext += `[OutOfScope ${index + 1}] ID: ${item.faqId || 'unknown'}\n`;
          knowledgeContext += `Problem: ${item.questionCN || item.questionEN}\n`;
          if (item.userPhrases) {
            knowledgeContext += `UserPhrases: ${item.userPhrases}\n`;
          }
          knowledgeContext += `StandardAnswer: ${item.answer}\n`;
          if (item.answerClient) {
            knowledgeContext += `ClientAnswer: ${item.answerClient}\n`;
          }
          if (item.answerEndUser) {
            knowledgeContext += `EndUserAnswer: ${item.answerEndUser}\n`;
          }
          if (item.tags && item.tags.length > 0) {
            knowledgeContext += `Tags: ${item.tags.join(', ')}\n`;
          }
          knowledgeContext += "\n";
        });
      }
    } // end of if (knowledge ...)
    console.log(`[PERF][CHAT] knowledge_match_ms=${Date.now() - tKnowledgeStart}`);

    // 构建对话历史上下文
    let historyContext = "";
    if (history && history.length > 0) {
      const cleanedHistory = history.slice(-12).map((msg: { role: string; content: string }) => {
        const cleanContent = msg.content
          .replace(/\[META\][\s\S]*?\[\/META\]/g, "")
          .replace(/\[STRUCTURED_REPLY\][\s\S]*?\[\/STRUCTURED_REPLY\]/g, "")
          .trim();

        const clippedContent = cleanContent.length > 1200
          ? `${cleanContent.slice(0, 1200)}...`
          : cleanContent;

        return `${msg.role === "assistant" ? "Assistant" : "User"}: ${clippedContent}`;
      });

      historyContext = `## Conversation History and Memory
    The following messages are from the SAME conversation. You MUST use them as context.
    - Inherit known user identity, role, product plan, device, error message, API type, and previous troubleshooting steps.
    - If the current question is short or ambiguous, resolve it using this history before asking follow-up.
    - Do not ask again for information already present in the history.
    - If history shows the user is a DICloak admin/client or end user/member, keep that role unless the current message clearly changes it.

    ${cleanedHistory.join("\n")}

    `;
    }

    const imageOcrContext = imageOcrResults && imageOcrResults.length > 0
      ? `## Uploaded Image OCR Results\n${imageOcrResults.map((item, index) => `Image ${index + 1} (${item.name}):\n${item.text || 'No text recognized'}`).join("\n\n")}\n`
      : "";

    // 构建用户消息
    const userMessage = `## Current User Question
    ${message || "（用户仅上传了图片，请结合图片识别结果回复）"}

    ${imageOcrContext}

    ${languageRule}

    ${multilingualQualityGuardrail}

    ${uncoveredKnowledgePolicy.prompt}

    ${responseShouldUsePricingTable ? "Internal pricing requirement: use the pricing data in the context for plan/price/member/environment quota answers. Do NOT mention internal file/table names such as pricing table or Pricing Feature Comparison Table in the customer-facing reply. Official website/help-guide links are allowed when useful. Answer directly as DICloak support." : ""}

    ${aiOutputFormat}

    ${outputFormatGuardrail}

    ${evidenceGuardrail}

    ${pricingGuardrail}

    ${deterministicSeatFacts}

    ${planRecommendationRules}

    ${accountSharingEnvironmentRules}

    ${stepEvidenceGuardrail}

    ${historyContext}

    ${knowledgeContext}

    Please generate reply based on the knowledge base and conversation history above.`;

    // 调试日志：检查知识库上下文是否为空
    console.log("[DEBUG] knowledgeContext 长度:", knowledgeContext.length);
    if (knowledgeContext.length === 0) {
      console.log("[DEBUG] 警告：知识库上下文为空！");
      console.log("[DEBUG] knowledge 对象存在:", !!knowledge);
      console.log("[DEBUG] knowledge.faqItems 数量:", knowledge?.faqItems?.length || 0);
    } else {
      console.log("[DEBUG] 知识库上下文前300字符:", knowledgeContext.substring(0, 300));
    }

    // 获取系统配置版本信息
    const configVersion = await getSystemConfigVersion();

    // 构建元数据（前端用于生成格式标题）
    const metaData = JSON.stringify({
      problemType,
      userRole,
      outputFormatType,
      problemTypeLabel: getProblemTypeOutputLabel(problemType),
      userRoleLabel: userRole === 'client' ? 'DICloak 客户/管理员' :
                     userRole === 'end_user' ? '终端用户' : '身份不明确',
      roleSource: lockedRole ? (roleSource || 'manual') : (userRole === 'unknown' ? null : 'ai'),
      promptVersion: configVersion?.version || 1,
      promptUpdatedAt: configVersion?.updatedAt || new Date().toISOString(),
    });

    // 调用 AI API
    const messages = [
      { role: "system" as const, content: finalPromptWithCoverage },
      { role: "user" as const, content: userMessage },
    ];
    const tLlmStart = Date.now();
    let firstTokenLogged = false;

    // 调试日志：追踪发送给 AI 的内容
    console.log("[AI DEBUG] System Prompt 长度:", finalSystemPrompt.length);
    console.log("[AI DEBUG] User Message 长度:", userMessage.length);
    console.log("[AI DEBUG] User Message 前500字符:", userMessage.substring(0, 500));
    console.log("[AI DEBUG] knowledgeContext 长度:", knowledgeContext.length);

    // 检查 API Key
    const isOpenAICompatibleProvider = config.provider === 'deepseek' || config.provider === 'aliyun' || config.provider === 'gpt';

    if (isOpenAICompatibleProvider && !config.apiKey) {
      const providerName = config.provider === 'aliyun' ? '阿里百炼' : config.provider === 'gpt' ? 'GPT / TokenLab' : 'DeepSeek';
      return NextResponse.json({ error: `请先配置 ${providerName} API Key` }, { status: 400 });
    }

    const streamChatResponse = async (controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> => {
      // 首先发送元数据给前端
      const encoder = new TextEncoder();
      const statusStartedAt = Date.now();
      const enqueueStatus = (label: string, detail?: string): void => {
        const elapsedMs = Date.now() - statusStartedAt;
        controller.enqueue(encoder.encode(`[STATUS]${JSON.stringify({ label, detail, elapsedMs })}[/STATUS]\n`));
      };
      let fullContent = "";
      controller.enqueue(encoder.encode(`[META]${metaData}[/META]\n`));
      enqueueStatus("正在整理上下文", "已完成知识库匹配，准备请求模型");
      
      enqueueStatus("正在请求模型", "等待首个响应片段");
      
      if (isOpenAICompatibleProvider) {
        // DeepSeek / 阿里百炼 / GPT(TokenLab) 使用 OpenAI 兼容 API
        const baseUrl = getOpenAICompatibleBaseUrl(config);
        const requestMessages = config.provider === 'aliyun'
          ? messages.map(m => ({ role: m.role === 'system' ? 'user' : m.role, content: m.content }))
          : messages.map(m => ({ role: m.role, content: m.content }));

        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: getDefaultModelForProvider(config),
            messages: requestMessages,
            temperature: responseShouldUsePricingTable ? 0.2 : 0.7,
            stream: true,
          }),
        });
  
        if (!response.ok) {
          const providerName = config.provider === 'aliyun' ? 'Aliyun Bailian' : config.provider === 'gpt' ? 'GPT / TokenLab' : 'DeepSeek';
          throw new Error(`${providerName} API error: ${response.status} ${response.statusText}`);
        }
  
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');
  
        const decoder = new TextDecoder();
  
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
  
          const chunk = decoder.decode(value, { stream: true });
          if (!firstTokenLogged && chunk) {
            console.log(`[PERF][CHAT] llm_first_token_ms=${Date.now() - tLlmStart}`);
            enqueueStatus("AI 正在生成回复", "已收到模型输出");
            firstTokenLogged = true;
          }
          const lines = chunk.split('\n');
  
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content || '';
                if (content) {
                  fullContent += content;
                }
              } catch (parseError) {
                void parseError;
                // Ignore parse errors
              }
            }
          }
        }
        console.log(`[PERF][CHAT] llm_total_ms=${Date.now() - tLlmStart}`);
      } else {
        // Coze/豆包 使用 SDK
        const llmConfig = new Config({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl || "https://api.coze.cn/v1",
        });
  
        const client = new LLMClient(llmConfig);
        const llmConfigStream = {
          model: getDefaultModelForProvider(config),
          temperature: responseShouldUsePricingTable ? 0.2 : 0.7,
        };
  
        for await (const chunk of client.stream(messages, llmConfigStream)) {
          const content = extractTextFromLlmChunk(chunk);
  
          if (content) {
            if (!firstTokenLogged) {
              console.log(`[PERF][CHAT] llm_first_token_ms=${Date.now() - tLlmStart}`);
              enqueueStatus("AI 正在生成回复", "已收到模型输出");
              firstTokenLogged = true;
            }
            fullContent += content;
          }
        }
        console.log(`[PERF][CHAT] llm_total_ms=${Date.now() - tLlmStart}`);
      }
      if (fullContent) {
        const referenceContextForReview = knowledgeContext;
        const shouldRunReview = shouldReviewCustomerFacingReply(config, fullContent, referenceContextForReview);
        if (shouldRunReview) {
          enqueueStatus("正在复核回复", "检查标点、功能名、价格和链接");
        } else {
          enqueueStatus("正在完成回复", "低风险内容，跳过二次复核");
        }
        const reviewedContent = shouldRunReview
          ? await reviewCustomerFacingReply(config, fullContent, referenceContextForReview, languageRule).catch((reviewError: unknown) => {
              console.error('[AI Review] 回复质检失败，使用原始回复:', reviewError);
              return fullContent;
            })
          : fullContent;
        enqueueStatus("正在整理最终回复");
        const intentCorrectedContent = problemType === 'intent_unclear' && needsSubscriptionSourceClarification(currentMessageText)
          ? enforceSubscriptionSourceClarificationContent(reviewedContent, effectiveLanguage)
          : reviewedContent;
        const correctedContent = enforceSeatCalculationCorrections(intentCorrectedContent, actualUserCount, effectiveLanguage);
        const sanitizedContent = sanitizeCustomerFacingContent(correctedContent, effectiveLanguage);
        controller.enqueue(encoder.encode(`${sanitizedContent}${buildStructuredReplyPayload(sanitizedContent)}`));
      }
      controller.close();
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        await streamChatResponse(controller).catch((error: unknown) => {
          console.error("[Stream Error]:", error);
          controller.error(error);
        });
      },
    });

    console.log(`[PERF][CHAT] total_ms=${Date.now() - t0}`);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("[API Error]:", error);
    console.log(`[PERF][CHAT] failed_total_ms=${Date.now() - t0}`);
    return NextResponse.json(
      { error: "处理请求失败" },
      { status: 500 }
    );
  }
}
