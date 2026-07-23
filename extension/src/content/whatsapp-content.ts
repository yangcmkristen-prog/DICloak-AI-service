import { createHash } from "../shared/hash";
import type { ChatSnapshot, ConversationRole, ConversationRoleSource, CopilotReplyResponse, CopilotResult, ExternalChatInfo, ExternalChatMessage } from "../shared/types";
import { detectSensitiveInformation, redactUnapprovedFindings, type SensitiveFinding } from "../../../src/lib/sensitive-data";

type ChromeStorageItems = Record<string, unknown>;

declare const chrome: {
  runtime: {
    id?: string;
    onMessage: {
      addListener(callback: (message: { type?: string }) => void): void;
    };
    sendMessage(
      message: { type: string; endpoint: string; action: "translate-clean" | "reply" | "summarize"; payload: ChatSnapshot },
      callback: (response?: CopilotReplyResponse) => void,
    ): void;
    lastError?: { message?: string };
  };
  storage: {
    local: {
      get(key: string, callback: (items: ChromeStorageItems) => void): void;
      set(items: ChromeStorageItems, callback: () => void): void;
    };
  };
};


type CacheRecord = {
  sourceMessageHash: string;
  updatedAt: number;
  results: CopilotResult[];
};

type RoleRecord = {
  role: ConversationRole | null;
  source: ConversationRoleSource;
  updatedAt: number;
};

type SummaryRecord = { updatedAt: number; webUrl: string };
type AiAction = "translate-clean" | "reply" | "summarize";
type PendingSensitiveRequest = { action: AiAction; snapshot: ChatSnapshot; findings: SensitiveFinding[] };

type ParsedReplySection = {
  type: "question" | "main" | "supplement" | "info" | "common" | "client" | "end_user" | "identity" | "other";
  title: string;
  content: string;
};

type ReplyMetaData = {
  problemType?: string;
  userRole?: string;
  outputFormatType?: string;
  problemTypeLabel?: string;
  userRoleLabel?: string;
  roleSource?: ConversationRoleSource;
};

const SIDEBAR_ID = "dicloak-ai-copilot-sidebar";
const CONTENT_ROOT_ID = "dicloak-ai-copilot-root";
const STORAGE_PREFIX = "dicloak_copilot_cache:";
const ROLE_STORAGE_PREFIX = "dicloak_copilot_role:";
const SUMMARY_STORAGE_PREFIX = "dicloak_customer_summary:";

const state: {
  snapshot: ChatSnapshot | null;
  cache: CacheRecord | null;
  roleRecord: RoleRecord | null;
  summaryRecord: SummaryRecord | null;
  activeResultId: string | null;
  loadingAction: "translate-clean" | "reply" | "summarize" | null;
  error: string | null;
  collapsed: boolean;
  hidden: boolean;
  selectingResultText: boolean;
  pendingSensitiveRequest: PendingSensitiveRequest | null;
} = {
  snapshot: null,
  cache: null,
  roleRecord: null,
  summaryRecord: null,
  activeResultId: null,
  loadingAction: null,
  error: null,
  collapsed: false,
  hidden: false,
  selectingResultText: false,
  pendingSensitiveRequest: null,
};

function getSummaryStorageKey(chatId: string): string { return `${SUMMARY_STORAGE_PREFIX}${chatId}`; }

function readSummaryRecord(chatId: string): Promise<SummaryRecord | null> {
  return new Promise((resolve) => chrome.storage.local.get(getSummaryStorageKey(chatId), (items) => resolve((items[getSummaryStorageKey(chatId)] as SummaryRecord | undefined) ?? null)));
}

function writeSummaryRecord(chatId: string, record: SummaryRecord): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set({ [getSummaryStorageKey(chatId)]: record }, () => resolve()));
}

function textOf(element: Element | null): string {
  return element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function getStorageKey(chatId: string): string {
  return `${STORAGE_PREFIX}${chatId}`;
}

function getRoleStorageKey(chatId: string): string {
  return `${ROLE_STORAGE_PREFIX}${chatId}`;
}

function isExtensionContextValid(): boolean {
  try {
    return Boolean(chrome.runtime.id);
  } catch {
    return false;
  }
}

function readCache(chatId: string): Promise<CacheRecord | null> {
  return new Promise((resolve) => {
    if (!isExtensionContextValid()) {
      resolve(null);
      return;
    }

    try {
      chrome.storage.local.get(getStorageKey(chatId), (items) => {
        const value = items[getStorageKey(chatId)] as CacheRecord | undefined;
        resolve(value ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

function writeCache(chatId: string, cache: CacheRecord): Promise<void> {
  return new Promise((resolve) => {
    if (!isExtensionContextValid()) {
      resolve();
      return;
    }

    try {
      chrome.storage.local.set({ [getStorageKey(chatId)]: cache }, () => resolve());
    } catch {
      resolve();
    }
  });
}

function normalizeRoleRecord(value: unknown): RoleRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<RoleRecord>;
  const role = record.role === "client" || record.role === "end_user" ? record.role : null;
  const source = record.source === "manual" || record.source === "ai" ? record.source : null;
  const updatedAt = typeof record.updatedAt === "number" ? record.updatedAt : Date.now();

  if (!role || !source) return null;
  return { role, source, updatedAt };
}

function readRoleRecord(chatId: string): Promise<RoleRecord | null> {
  return new Promise((resolve) => {
    if (!isExtensionContextValid()) {
      resolve(null);
      return;
    }

    try {
      chrome.storage.local.get(getRoleStorageKey(chatId), (items) => {
        resolve(normalizeRoleRecord(items[getRoleStorageKey(chatId)]));
      });
    } catch {
      resolve(null);
    }
  });
}

function writeRoleRecord(chatId: string, roleRecord: RoleRecord | null): Promise<void> {
  return new Promise((resolve) => {
    if (!isExtensionContextValid()) {
      resolve();
      return;
    }

    try {
      chrome.storage.local.set({ [getRoleStorageKey(chatId)]: roleRecord }, () => resolve());
    } catch {
      resolve();
    }
  });
}

function getRoleLabel(role: ConversationRole | null | undefined): string {
  if (role === "client") return "客户";
  if (role === "end_user") return "终端用户";
  return "";
}

function getRoleEmoji(role: ConversationRole | null | undefined): string {
  if (role === "client") return "👤";
  if (role === "end_user") return "🙋";
  return "👥";
}

function getCurrentChatInfo(): ExternalChatInfo | null {
  const main = document.querySelector("#main");
  if (!main) return null;
  const header = main.querySelector("header");
  if (!header) return null;

  const image = header.querySelector("img") as HTMLImageElement | null;
  const titleCandidates = [
    header.querySelector("span[dir='auto'][title]"),
    header.querySelector("[data-testid='conversation-info-header-chat-title']"),
    header.querySelector("h1"),
  ];
  const displayName = titleCandidates.map((candidate) => candidate?.getAttribute("title") || textOf(candidate)).find(Boolean);
  if (!displayName) return null;

  const headerText = textOf(header);
  const onlineStatus = headerText.replace(displayName, "").trim() || undefined;
  const avatarUrl = image?.src;
  const phoneFromName = displayName.match(/\+?[\d][\d\s()-]{6,}\d/)?.[0];
  const remoteJid = Array.from(main.querySelectorAll<HTMLElement>("[data-id]"))
    .map((element) => element.dataset.id?.match(/(?:^|_)(\d{7,15})@(?:c|s)\.us(?:_|$)/)?.[1])
    .find((phone): phone is string => Boolean(phone));
  const contactDetail = phoneFromName?.replace(/[^\d+]/g, "") || (remoteJid ? `+${remoteJid}` : undefined);
  const teamId = displayName.match(/^DIC-([A-Za-z0-9]+)(?:\s|$)/i)?.[1];
  const externalChatId = createHash(["whatsapp", displayName, avatarUrl ?? ""].join("|"));

  return {
    platform: "whatsapp",
    externalChatId,
    displayName,
    contactDetail,
    teamId,
    avatarUrl,
    onlineStatus,
  };
}


function getCopyableElement(container: Element): Element | null {
  if (container.matches("div.copyable-text, [data-pre-plain-text]")) return container;
  return container.querySelector("div.copyable-text, [data-pre-plain-text]");
}

function uniqueElements(elements: Element[]): Element[] {
  return elements.filter((element, index) => elements.indexOf(element) === index);
}

function getMessageRole(container: Element, main: Element): ExternalChatMessage["role"] {
  const bubble = container.closest("div.message-in, div.message-out");
  if (bubble?.classList.contains("message-out")) return "agent";
  if (bubble?.classList.contains("message-in")) return "customer";

  const dataId = container.closest("[data-id]")?.getAttribute("data-id") || "";
  if (dataId.startsWith("true_") || dataId.includes("_true_")) return "agent";
  if (dataId.startsWith("false_") || dataId.includes("_false_")) return "customer";

  const rect = container.getBoundingClientRect();
  const mainRect = main.getBoundingClientRect();
  if (rect.width > 0 && mainRect.width > 0) {
    const messageCenter = rect.left + rect.width / 2;
    const mainCenter = mainRect.left + mainRect.width / 2;
    return messageCenter > mainCenter ? "agent" : "customer";
  }

  return "unknown";
}

function getMessageText(container: Element): string {
  const copyable = Array.from(container.querySelectorAll("span.selectable-text, div.copyable-text span.selectable-text"))
    .map((node) => textOf(node))
    .filter(Boolean)
    .join("\n");
  if (copyable) return copyable;

  const aria = container.getAttribute("aria-label");
  if (aria) return aria.trim();

  return textOf(container);
}

function getMessageTime(container: Element): string | undefined {
  const copyable = getCopyableElement(container);
  const prePlainText = copyable?.getAttribute("data-pre-plain-text");
  if (prePlainText) {
    const timeMatch = prePlainText.match(/\[(.*?)]/);
    return timeMatch?.[1];
  }

  const timeNode = container.querySelector("span[aria-label*=':'], span[dir='auto']");
  return textOf(timeNode) || undefined;
}

function extractMessages(): ExternalChatMessage[] {
  const main = document.querySelector("#main");
  if (!main) return [];

  const messageBubbleNodes = Array.from(main.querySelectorAll("div.message-in, div.message-out"));
  const prePlainTextNodes = Array.from(main.querySelectorAll("[data-pre-plain-text]"));
  const copyableTextNodes = Array.from(main.querySelectorAll("div.copyable-text"));
  const messageNodes = messageBubbleNodes.length > 0
    ? messageBubbleNodes
    : uniqueElements([
        ...prePlainTextNodes,
        ...copyableTextNodes,
      ]);

  console.debug("[DICloak Copilot] WhatsApp message candidates", {
    messageBubbleCount: messageBubbleNodes.length,
    prePlainTextCount: prePlainTextNodes.length,
    copyableTextCount: copyableTextNodes.length,
    candidateCount: messageNodes.length,
  });

  return messageNodes
    .map((node, index): ExternalChatMessage | null => {
      const text = getMessageText(node);
      if (!text) return null;

      const role = getMessageRole(node, main);
      const rawTimeText = getMessageTime(node);
      const id = createHash(`${role}|${rawTimeText ?? ""}|${text}|${index}`);
      return { id, role, text, rawTimeText };
    })
    .filter((message): message is ExternalChatMessage => message !== null)
    .slice(-40);
}

function createSnapshot(): ChatSnapshot | null {
  const chat = getCurrentChatInfo();
  if (!chat) return null;

  const messages = extractMessages();
  const sourceMessageHash = createHash(JSON.stringify(messages.map((message) => ({ role: message.role, text: message.text, time: message.rawTimeText }))));
  return { chat, messages, sourceMessageHash };
}

function getSnapshotForRequest(): ChatSnapshot | null {
  if (!state.snapshot) return null;
  const confirmedRole = state.roleRecord?.role || undefined;
  return {
    ...state.snapshot,
    chat: {
      ...state.snapshot.chat,
      confirmedRole,
    },
  };
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseMetaData(content: string): { metaData: ReplyMetaData | null; cleanContent: string } {
  const metaMatch = content.match(/\[META\]([\s\S]*?)\[\/META\]/);
  if (!metaMatch) return { metaData: null, cleanContent: content };

  try {
    const metaData = JSON.parse(metaMatch[1].trim()) as ReplyMetaData;
    return {
      metaData,
      cleanContent: content.replace(/\[META\][\s\S]*?\[\/META\]/, "").trim(),
    };
  } catch (error) {
    console.warn("[DICloak Copilot] Failed to parse reply metadata", error);
    return { metaData: null, cleanContent: content.replace(/\[META\][\s\S]*?\[\/META\]/, "").trim() };
  }
}

function normalizeHeaderText(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[【】〖〗\[\]{}()（）:：|｜\-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getSectionType(header: string): ParsedReplySection["type"] | null {
  const normalizedHeader = normalizeHeaderText(header);
  if (/问题类型|回复类型|tipo de problema|problem type|loai van de|jenis masalah|ประเภทปัญหา|نوع المشكلة|問題タイプ|문제 유형/i.test(normalizedHeader)) return "question";
  if (/身份状态|身份识别|estado de identidad|identity status|trang thai danh tinh|status identitas|สถานะตัวตน|حالة الهوية|本人確認|신원 상태/i.test(normalizedHeader)) return "identity";
  if (/主回复|主要回复|优先发送|回复\s*1|respuesta general|main reply|primary reply|cau tra loi chinh|balasan utama|คำตอบหลัก|الرد الرئيسي|主な返信|주요 답변/i.test(normalizedHeader)) return "main";
  if (/通用回复|respuesta general|general reply|cau tra loi chung|balasan umum|คำตอบทั่วไป|رد عام|一般的な返信|일반 답변/i.test(normalizedHeader)) return "common";
  if (/客户回复|respuesta para cliente|client reply|customer reply|cau tra loi cho khach hang|balasan klien|คำตอบสำหรับลูกค้า|رد العميل|顧客向け返信|고객 답변/i.test(normalizedHeader)) return "client";
  if (/终端用户回复|最终用户回复|respuesta para usuario final|end user reply|final user reply|cau tra loi cho nguoi dung cuoi|balasan pengguna akhir|คำตอบสำหรับผู้ใช้ปลายทาง|رد المستخدم النهائي|エンドユーザー向け返信|최종 사용자 답변/i.test(normalizedHeader)) return "end_user";
  if (/补充建议|补充说明|回复\s*2|sugerencia complementaria|suggestion|supplement|additional advice|goi y bo sung|saran tambahan|ข้อเสนอแนะเพิ่มเติม|اقتراحات اضافية|補足提案|추가 제안/i.test(normalizedHeader)) return "supplement";
  if (/需要补充的信息|需补充信息|回复\s*3|informacion que necesitamos|informacion necesaria|need.*information|additional information|thong tin can bo sung|informasi yang diperlukan|ข้อมูลที่ต้องการเพิ่มเติม|معلومات مطلوبة|必要な追加情報|필요한追加情報|필요한 추가 정보/i.test(normalizedHeader)) return "info";
  return null;
}

function getSectionTypeFromIcon(icon: string): ParsedReplySection["type"] | null {
  const iconMap: Record<string, ParsedReplySection["type"]> = {
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

function sanitizeAssistantText(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,，。]|$)/g, "$1$2")
    .replace(/\{\{\s*([^{}]+?)\s*\}\}/g, "$1")
    .replace(/\{\{\s*([^{}\n]+?)(?=(?:[。！？；;,.，、]|\s|$))/g, "$1")
    .replace(/[{}]/g, "")
    .trim();
}

function getReplySectionTitle(type: ParsedReplySection["type"], fallback: string, index: number): string {
  const titles: Record<ParsedReplySection["type"], string> = {
    question: "📌 问题类型",
    identity: "⚠️ 身份状态",
    main: "✅ 主回复 | 优先发送",
    common: "🟡 通用回复",
    client: "🔵 客户回复",
    end_user: "🟣 终端用户回复",
    supplement: "💡 补充建议",
    info: "📝 需要补充的信息",
    other: `💬 回复 ${index + 1}`,
  };

  return titles[type] || fallback || `💬 回复 ${index + 1}`;
}

function parseReplySections(content: string): ParsedReplySection[] {
  const { metaData, cleanContent } = parseMetaData(content);
  if (!cleanContent) return [];

  const sectionHeaderRegex =
    /(?:^|\n)\s*(📌|⚠️|✅|🟡|🔵|🟣|💡|📝|🛠️|👤|☑️|📎)?\s*(?:【|〖|\[)?\s*([^\n【】〖〗\[\]]{1,120}?)\s*(?:】|〗|\])\s*(?=\n|$)/gu;

  const matches = [...cleanContent.matchAll(sectionHeaderRegex)]
    .map((match) => ({
      fullText: match[0],
      index: match.index ?? 0,
      icon: match[1] || "",
      header: match[2] || "",
    }))
    .filter((match) => getSectionType(match.header) || getSectionTypeFromIcon(match.icon));

  if (matches.length === 0) {
    const contentOnly = sanitizeAssistantText(cleanContent);
    return contentOnly ? [{ type: "other", title: "💬 推荐回复", content: contentOnly }] : [];
  }

  const sections = matches.flatMap((match, index): ParsedReplySection[] => {
    const type = getSectionType(match.header) || getSectionTypeFromIcon(match.icon) || "other";
    const nextMatch = matches[index + 1];
    const contentStart = match.index + match.fullText.length;
    const contentEnd = nextMatch?.index ?? cleanContent.length;
    const sectionText = sanitizeAssistantText(cleanContent.slice(contentStart, contentEnd));
    if (!sectionText) return [];

    return [{
      type,
      title: getReplySectionTitle(type, match.header, index),
      content: sectionText,
    }];
  });

  if (metaData?.problemType === "troubleshooting" && (metaData.userRole === "client" || metaData.userRole === "end_user")) {
    return sections.filter((section) => !["common", "client", "end_user"].includes(section.type));
  }

  return sections;
}

function renderResultDetail(result: CopilotResult): string {
  const { cleanContent } = parseMetaData(result.content);

  if (result.type !== "reply") {
    return `
      <section class="dc-card dc-result-detail" data-active-result-id="${escapeHtml(result.id)}">
        <div class="dc-result-head">
          <div class="dc-section-title">${escapeHtml(result.title)}</div>
          <button class="dc-copy" data-action="copy">复制</button>
        </div>
        <pre>${escapeHtml(cleanContent)}</pre>
      </section>
    `;
  }

  const sections = parseReplySections(result.content);
  return `
    <section class="dc-card dc-result-detail" data-active-result-id="${escapeHtml(result.id)}">
      <div class="dc-result-head">
        <div class="dc-section-title">${escapeHtml(result.title)}</div>
        <button class="dc-copy" data-action="copy">复制全部</button>
      </div>
      <div class="dc-reply-sections">
        ${sections.map((section, index) => `
          <article class="dc-reply-section">
            <div class="dc-reply-section-head">
              <div class="dc-reply-section-title">${escapeHtml(section.title)}</div>
              <button class="dc-copy dc-copy-small" data-action="copy-section" data-section-index="${index}">复制</button>
            </div>
            <pre>${escapeHtml(section.content)}</pre>
          </article>
        `).join("") || `<pre>${escapeHtml(cleanContent)}</pre>`}
      </div>
    </section>
  `;
}

function getCacheStatus(): { label: string; className: string; detail: string } {
  if (!state.snapshot) return { label: "🔴 未识别", className: "empty", detail: "请先打开一个 WhatsApp 聊天" };
  if (!state.cache) return { label: "🔴 未生成", className: "empty", detail: "点击下方能力开始生成" };
  if (state.cache.sourceMessageHash !== state.snapshot.sourceMessageHash) {
    return { label: "🟡 有新消息，需要更新", className: "stale", detail: `上次更新：${formatTime(state.cache.updatedAt)}` };
  }
  return { label: "🟢 已缓存", className: "cached", detail: `上次更新：${formatTime(state.cache.updatedAt)}` };
}

function getActiveResult(): CopilotResult | null {
  const results = state.cache?.results ?? [];
  if (!state.activeResultId) return null;
  return results.find((result) => result.id === state.activeResultId) ?? null;
}

async function deleteResult(resultId: string): Promise<void> {
  const snapshot = state.snapshot;
  const cache = state.cache;
  if (!snapshot || !cache) return;

  const nextResults = cache.results.filter((result) => result.id !== resultId);
  const nextCache: CacheRecord = {
    ...cache,
    updatedAt: Date.now(),
    results: nextResults,
  };

  state.cache = nextCache;
  if (state.activeResultId === resultId) {
    state.activeResultId = nextResults[0]?.id ?? null;
  }

  await writeCache(snapshot.chat.externalChatId, nextCache);
  render();
}

function clearWindowSelection(): void {
  window.getSelection()?.removeAllRanges();
}

function render(): void {
  const root = document.getElementById(CONTENT_ROOT_ID);
  if (!root) return;

  if (state.selectingResultText) return;

  const snapshot = state.snapshot;
  const status = getCacheStatus();
  const results = state.cache?.results ?? [];
  const activeResult = getActiveResult();
  const activeResultDetail = activeResult ? renderResultDetail(activeResult) : "";
  const messageCount = snapshot?.messages.length ?? 0;
  const currentRole = state.roleRecord?.role ?? null;
  const currentRoleLabel = getRoleLabel(currentRole);
  const currentRoleSourceLabel = state.roleRecord?.source === "manual" ? "人工选择" : state.roleRecord?.source === "ai" ? "AI 推测" : "";
  const summaryRecord = state.summaryRecord;
  const previousBodyScrollTop = root.querySelector<HTMLElement>(".dc-body")?.scrollTop ?? 0;
  const previousResultScrollTop = root.querySelector<HTMLElement>(".dc-result-detail pre")?.scrollTop ?? 0;
  const previousActiveResultId = root.querySelector<HTMLElement>("[data-active-result-id]")?.dataset.activeResultId ?? null;
  document.getElementById(SIDEBAR_ID)?.classList.toggle("dc-hidden", state.hidden);
  document.documentElement.classList.toggle("dc-copilot-open", !state.hidden);

  root.innerHTML = `
    <div class="dc-shell ${state.collapsed ? "dc-collapsed" : ""}">
      <div class="dc-header">
        <div class="dc-title"><span class="dc-logo">✦</span><span>AI 助手</span></div>
        <button class="dc-icon-button" data-action="toggle">${state.collapsed ? "展开" : "收起"}</button>
      </div>
      <div class="dc-body">
        <section class="dc-card">
          <div class="dc-section-title">当前对话</div>
          ${snapshot ? `
            <div class="dc-chat-row">
              ${snapshot.chat.avatarUrl ? `<img class="dc-avatar" src="${escapeHtml(snapshot.chat.avatarUrl)}" alt="" />` : `<div class="dc-avatar dc-avatar-fallback">${escapeHtml(snapshot.chat.displayName.slice(0, 1))}</div>`}
              <div class="dc-chat-meta">
                <div class="dc-chat-name">${escapeHtml(snapshot.chat.displayName)}</div>
                <div class="dc-chat-status">${escapeHtml(snapshot.chat.onlineStatus || "WhatsApp 当前聊天")}</div>
                ${currentRole ? `<div class="dc-chat-role">${escapeHtml(getRoleEmoji(currentRole))} ${escapeHtml(currentRoleLabel)} · ${escapeHtml(currentRoleSourceLabel)}</div>` : ""}
              </div>
            </div>
            <div class="dc-role-picker" role="group" aria-label="选择当前对话角色">
              <button class="dc-role-button ${currentRole === "client" ? "active" : ""}" data-action="role-client" title="设置为客户">👤 客户</button>
              <button class="dc-role-button ${currentRole === "end_user" ? "active" : ""}" data-action="role-end-user" title="设置为终端用户">🙋 终端用户</button>
              <button class="dc-role-button" data-action="role-clear" title="清除角色">不确认</button>
            </div>
          ` : `<div class="dc-muted">请打开一个 WhatsApp 聊天。</div>`}
        </section>

        <section class="dc-summary-card">
          <div class="dc-summary-head"><span>✨ AI 总结</span>${summaryRecord ? `<span class="dc-summary-updated">已更新 ${formatTime(summaryRecord.updatedAt)}</span>` : ""}</div>
          <div class="dc-summary-body">
            <div><strong>${summaryRecord ? "已生成客户画像" : "未生成"}</strong><small>${summaryRecord ? "已同步客户信息、历史问题和功能需求" : "读取全部聊天记录生成客户信息"}</small></div>
            <button class="dc-summary-button" data-action="summary" ${!snapshot || state.loadingAction ? "disabled" : ""}>${state.loadingAction === "summarize" ? "总结中..." : summaryRecord ? "重新总结" : "生成总结"}</button>
          </div>
          ${summaryRecord ? `<button class="dc-summary-link" data-action="view-summary">查看总结 →</button>` : ""}
        </section>

        <section class="dc-cache dc-cache-${status.className}">
          <div class="dc-cache-main">${escapeHtml(status.label)}</div>
          <div class="dc-cache-detail">${escapeHtml(status.detail)}</div>
          <div class="dc-cache-detail">已读取 ${messageCount} 条当前已加载消息</div>
        </section>

        <section class="dc-actions">
          <button class="dc-action-card" data-action="translate" ${!snapshot || state.loadingAction ? "disabled" : ""}>
            <span class="dc-action-icon">A文</span>
            <span>翻译并清洗</span>
            <small>${state.loadingAction === "translate-clean" ? "处理中..." : "整理当前聊天语义"}</small>
          </button>
          <button class="dc-action-card" data-action="reply" ${!snapshot || state.loadingAction ? "disabled" : ""}>
            <span class="dc-action-icon">✨</span>
            <span>生成推荐回复</span>
            <small>${state.loadingAction === "reply" ? "生成中..." : "沿用网页端规则"}</small>
          </button>
        </section>

        ${state.error ? `<div class="dc-error">${escapeHtml(state.error)}</div>` : ""}

        <section class="dc-card dc-results">
          <div class="dc-section-title">最近结果</div>
          ${results.length === 0 ? `<div class="dc-muted">暂无结果。点击上方按钮后会缓存到当前聊天。</div>` : results.map((result) => `
            <button class="dc-result-item ${activeResult?.id === result.id ? "active" : ""}" data-result-id="${escapeHtml(result.id)}">
              <span>${result.type === "reply" ? "生成推荐回复" : "翻译结果"}</span>
              <span class="dc-result-meta">
                <small>${formatTime(result.createdAt)}</small>
                <span class="dc-delete-result" data-action="delete-result" data-result-id="${escapeHtml(result.id)}" role="button" tabindex="0" title="删除该结果" aria-label="删除该结果">删除</span>
              </span>
            </button>
          `).join("")}
        </section>

        ${activeResultDetail}
        ${state.pendingSensitiveRequest ? `
          <section class="dc-sensitive-panel" role="dialog" aria-modal="true" aria-label="敏感信息确认">
            <div class="dc-sensitive-title">⚠️ 检测到敏感信息</div>
            <p>勾选表示允许将该项发送给 AI；未勾选的内容将在发送前替换为隐藏标记。</p>
            <div class="dc-sensitive-list">
              ${state.pendingSensitiveRequest.findings.map((finding) => `
                <label class="dc-sensitive-item">
                  <input type="checkbox" data-sensitive-id="${escapeHtml(finding.id)}" />
                  <span><strong>${escapeHtml(finding.category)}</strong><small>${escapeHtml(finding.value)}</small></span>
                </label>
              `).join("")}
            </div>
            <div class="dc-sensitive-actions">
              <button data-action="sensitive-cancel">取消</button>
              <button class="primary" data-action="sensitive-confirm">确认并继续</button>
            </div>
          </section>
        ` : ""}
      </div>
      <div class="dc-footer">
        <span>知识库/Prompt/模型配置沿用网页端</span>
        <span>coze.site</span>
      </div>
    </div>
  `;

  const nextBody = root.querySelector<HTMLElement>(".dc-body");
  if (nextBody) nextBody.scrollTop = previousBodyScrollTop;

  const nextResult = root.querySelector<HTMLElement>(".dc-result-detail pre");
  if (nextResult && previousActiveResultId === activeResult?.id) {
    nextResult.scrollTop = previousResultScrollTop;
  }
}

async function refreshSnapshot(): Promise<void> {
  const snapshot = createSnapshot();
  const previousSnapshot = state.snapshot;
  const previousChatId = previousSnapshot?.chat.externalChatId;
  const previousHash = previousSnapshot?.sourceMessageHash;

  if (!snapshot) {
    const shouldRender = state.snapshot !== null || state.cache !== null || state.activeResultId !== null;
    state.snapshot = null;
    state.cache = null;
    state.roleRecord = null;
    state.summaryRecord = null;
    state.activeResultId = null;
    if (shouldRender) render();
    return;
  }

  const isSameChat = previousChatId === snapshot.chat.externalChatId;
  const isSameSnapshot = isSameChat && previousHash === snapshot.sourceMessageHash;
  state.snapshot = snapshot;

  if (!isSameChat || !state.cache) {
    const [cache, roleRecord, summaryRecord] = await Promise.all([
      readCache(snapshot.chat.externalChatId),
      readRoleRecord(snapshot.chat.externalChatId),
      readSummaryRecord(snapshot.chat.externalChatId),
    ]);
    state.cache = cache;
    state.roleRecord = roleRecord;
    state.summaryRecord = summaryRecord;
    state.activeResultId = null;
    render();
    return;
  }

  if (!isSameSnapshot) {
    render();
  }
}

function sendCopilotRequest(endpoint: string, action: "translate-clean" | "reply" | "summarize", payload: ChatSnapshot): Promise<CopilotReplyResponse> {
  return new Promise((resolve) => {
    if (!isExtensionContextValid()) {
      resolve({ error: "扩展已重新加载，请刷新 WhatsApp 页面后重试" });
      return;
    }

    try {
      chrome.runtime.sendMessage({ type: "dicloak:copilot-request", endpoint, action, payload }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message || "AI 请求失败" });
          return;
        }
        resolve(response ?? { error: "AI 请求失败" });
      });
    } catch {
      resolve({ error: "扩展已重新加载，请刷新 WhatsApp 页面后重试" });
    }
  });
}

async function setConversationRole(role: ConversationRole | null): Promise<void> {
  if (!state.snapshot) return;

  const nextRoleRecord: RoleRecord | null = role
    ? { role, source: "manual", updatedAt: Date.now() }
    : null;

  state.roleRecord = nextRoleRecord;
  await writeRoleRecord(state.snapshot.chat.externalChatId, nextRoleRecord);
  render();
}

async function executeCopilot(action: "translate-clean" | "reply", requestSnapshot: ChatSnapshot): Promise<void> {

  state.loadingAction = action;
  state.error = null;
  render();

  try {
    const endpoint = action === "reply" ? "/api/copilot/reply" : "/api/copilot/translate-clean";
    const payload = await sendCopilotRequest(endpoint, action, requestSnapshot);
    if (!payload.content) {
      throw new Error(payload.error || "AI 请求失败");
    }

    const requestChatId = requestSnapshot.chat.externalChatId;
    const isCurrentRequestChat = state.snapshot?.chat.externalChatId === requestChatId;

    if (
      action === "reply"
      && !requestSnapshot.chat.confirmedRole
      && (payload.detectedRole === "client" || payload.detectedRole === "end_user")
    ) {
      const nextRoleRecord: RoleRecord = {
        role: payload.detectedRole,
        source: payload.roleSource === "manual" ? "manual" : "ai",
        updatedAt: Date.now(),
      };
      if (isCurrentRequestChat) {
        state.roleRecord = nextRoleRecord;
      }
      await writeRoleRecord(requestChatId, nextRoleRecord);
    }

    const result: CopilotResult = {
      id: `${Date.now()}-${action}`,
      type: action,
      title: action === "reply" ? "生成推荐回复" : "翻译结果",
      content: payload.content,
      createdAt: Date.now(),
      sourceMessageHash: requestSnapshot.sourceMessageHash,
    };

    const requestCache = isCurrentRequestChat ? state.cache : await readCache(requestChatId);
    const nextCache: CacheRecord = {
      sourceMessageHash: requestSnapshot.sourceMessageHash,
      updatedAt: Date.now(),
      results: [result, ...(requestCache?.results ?? [])].slice(0, 10),
    };

    await writeCache(requestChatId, nextCache);

    if (isCurrentRequestChat) {
      state.cache = nextCache;
      state.activeResultId = result.id;
    }
  } catch (error) {
    if (state.snapshot?.chat.externalChatId === requestSnapshot.chat.externalChatId) {
      state.error = error instanceof Error ? error.message : "AI 请求失败";
    }
  } finally {
    state.loadingAction = null;
    render();
  }
}

async function executeCustomerSummary(requestSnapshot: ChatSnapshot): Promise<void> {
  state.loadingAction = "summarize";
  state.error = null;
  render();
  try {
    // Unlike reply generation, the summary endpoint receives every message currently
    // present in the snapshot; it deliberately applies no slice or message-count cap.
    const response = await sendCopilotRequest("/api/copilot/customer-summary", "summarize", requestSnapshot);
    if (!response.summary || !response.webUrl) throw new Error(response.error || "客户总结失败");
    const record = { updatedAt: Date.parse(response.summary.updatedAt) || Date.now(), webUrl: response.webUrl };
    await writeSummaryRecord(requestSnapshot.chat.externalChatId, record);
    if (state.snapshot?.chat.externalChatId === requestSnapshot.chat.externalChatId) state.summaryRecord = record;
  } catch (error) {
    state.error = error instanceof Error ? error.message : "客户总结失败";
  } finally {
    state.loadingAction = null;
    render();
  }
}

async function executeAiAction(action: AiAction, snapshot: ChatSnapshot): Promise<void> {
  if (action === "summarize") {
    await executeCustomerSummary(snapshot);
  } else {
    await executeCopilot(action, snapshot);
  }
}

function requestAiAction(action: AiAction): void {
  const snapshot = getSnapshotForRequest();
  if (!snapshot) return;
  const findings = detectSensitiveInformation(snapshot.messages);
  if (findings.length === 0) {
    void executeAiAction(action, snapshot);
    return;
  }
  state.pendingSensitiveRequest = { action, snapshot, findings };
  state.error = null;
  render();
}

function confirmSensitiveRequest(root: HTMLElement): void {
  const pending = state.pendingSensitiveRequest;
  if (!pending) return;
  const approvedIds = new Set(
    Array.from(root.querySelectorAll<HTMLInputElement>("[data-sensitive-id]:checked"))
      .map((input) => input.dataset.sensitiveId)
      .filter((id): id is string => Boolean(id)),
  );
  const snapshot: ChatSnapshot = {
    ...pending.snapshot,
    messages: redactUnapprovedFindings(pending.snapshot.messages, pending.findings, approvedIds),
  };
  state.pendingSensitiveRequest = null;
  render();
  void executeAiAction(pending.action, snapshot);
}

function injectStyles(): void {
  const style = document.createElement("style");
  style.textContent = `
    :root { --dc-copilot-sidebar-width: 380px; }
    html.dc-copilot-open body #app { width: calc(100vw - var(--dc-copilot-sidebar-width)) !important; max-width: calc(100vw - var(--dc-copilot-sidebar-width)) !important; transition: width .2s ease, max-width .2s ease; }
    #${SIDEBAR_ID}.dc-hidden { display: none; }
    #${SIDEBAR_ID} { position: fixed; z-index: 2147483647; top: 0; right: 0; width: var(--dc-copilot-sidebar-width); height: 100vh; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #e5eefb; box-shadow: -16px 0 40px rgba(0,0,0,.3); }
    #${CONTENT_ROOT_ID} { height: 100%; }
    .dc-shell { height: 100%; display: flex; flex-direction: column; background: radial-gradient(circle at top left, #17243a, #07111d 42%, #020817); border-left: 1px solid rgba(148,163,184,.22); }
    .dc-collapsed { width: 72px; overflow: hidden; }
    .dc-collapsed .dc-body, .dc-collapsed .dc-footer { display: none; }
    .dc-header { height: 64px; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; border-bottom: 1px solid rgba(148,163,184,.18); }
    .dc-title { display: flex; align-items: center; gap: 10px; font-size: 19px; font-weight: 700; white-space: nowrap; }
    .dc-logo { width: 34px; height: 34px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; background: linear-gradient(135deg,#6d5dfc,#0ea5e9); box-shadow: 0 10px 24px rgba(99,102,241,.35); }
    .dc-icon-button, .dc-copy { border: 1px solid rgba(148,163,184,.25); color: #dbeafe; background: rgba(15,23,42,.72); border-radius: 10px; padding: 7px 10px; cursor: pointer; }
    .dc-body { flex: 1; overflow: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
    .dc-card, .dc-cache { border: 1px solid rgba(148,163,184,.14); border-radius: 14px; background: rgba(15,23,42,.68); padding: 14px; backdrop-filter: blur(14px); }
    .dc-section-title { font-size: 14px; color: #f8fafc; font-weight: 700; margin-bottom: 10px; }
    .dc-chat-row { display: flex; align-items: center; gap: 12px; }
    .dc-avatar { width: 42px; height: 42px; border-radius: 999px; object-fit: cover; background: #1e293b; }
    .dc-avatar-fallback { display: flex; align-items: center; justify-content: center; font-weight: 700; }
    .dc-chat-name { font-size: 16px; font-weight: 700; color: #f8fafc; }
    .dc-chat-role { display: inline-flex; align-items: center; width: fit-content; margin-top: 5px; border: 1px solid rgba(96,165,250,.35); border-radius: 999px; background: rgba(37,99,235,.16); color: #bfdbfe; padding: 2px 8px; font-size: 12px; font-weight: 700; }
    .dc-chat-status, .dc-muted, .dc-cache-detail { font-size: 12px; color: #94a3b8; line-height: 1.6; }
    .dc-role-picker { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; margin-top: 12px; }
    .dc-role-button { border: 1px solid rgba(148,163,184,.2); color: #dbeafe; background: rgba(15,23,42,.72); border-radius: 999px; padding: 7px 9px; cursor: pointer; font-size: 12px; font-weight: 700; }
    .dc-role-button.active { border-color: rgba(96,165,250,.72); background: rgba(37,99,235,.36); color: #eff6ff; }
    .dc-cache-main { font-weight: 700; margin-bottom: 4px; }
    .dc-summary-card { border: 1px solid rgba(139,92,246,.75); box-shadow: inset 0 0 0 1px rgba(99,102,241,.28); border-radius: 14px; background: rgba(30,41,59,.72); padding: 14px; }
    .dc-summary-head { display: flex; align-items: center; gap: 8px; color: #f8fafc; font-size: 14px; font-weight: 700; }
    .dc-summary-updated { border-radius: 5px; background: rgba(34,197,94,.2); color: #86efac; padding: 2px 5px; font-size: 10px; font-weight: 600; }
    .dc-summary-body { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 12px; }
    .dc-summary-body strong, .dc-summary-body small { display: block; }
    .dc-summary-body strong { font-size: 13px; color: #e2e8f0; }
    .dc-summary-body small { margin-top: 4px; color: #94a3b8; font-size: 11px; }
    .dc-summary-button { flex-shrink: 0; border: 0; border-radius: 9px; background: linear-gradient(135deg,#2563eb,#7c3aed); color: white; padding: 9px 13px; cursor: pointer; font-weight: 700; }
    .dc-summary-button:disabled { opacity: .55; cursor: not-allowed; }
    .dc-summary-link { margin-top: 10px; border: 0; background: transparent; color: #a5b4fc; padding: 0; cursor: pointer; font-size: 12px; }
    .dc-cache-cached { border-color: rgba(34,197,94,.35); background: rgba(21,128,61,.13); }
    .dc-cache-stale { border-color: rgba(234,179,8,.38); background: rgba(113,63,18,.18); }
    .dc-cache-empty { border-color: rgba(248,113,113,.25); }
    .dc-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .dc-action-card { min-height: 120px; border: 1px solid rgba(148,163,184,.14); border-radius: 14px; background: linear-gradient(180deg, rgba(30,41,59,.9), rgba(15,23,42,.82)); color: #f8fafc; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; font-size: 16px; font-weight: 700; }
    .dc-action-card:disabled { opacity: .55; cursor: not-allowed; }
    .dc-action-card small { color: #94a3b8; font-size: 11px; font-weight: 500; }
    .dc-action-icon { font-size: 24px; }
    .dc-sensitive-panel { position: sticky; bottom: 0; z-index: 20; border: 1px solid rgba(251,191,36,.55); border-radius: 14px; background: #111827; box-shadow: 0 -12px 35px rgba(0,0,0,.45); padding: 14px; }
    .dc-sensitive-title { color: #fde68a; font-weight: 800; }
    .dc-sensitive-panel > p { color: #cbd5e1; font-size: 12px; line-height: 1.55; }
    .dc-sensitive-list { max-height: 230px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
    .dc-sensitive-item { display: flex; align-items: flex-start; gap: 9px; border: 1px solid rgba(148,163,184,.18); border-radius: 9px; padding: 9px; cursor: pointer; }
    .dc-sensitive-item input { margin-top: 3px; }
    .dc-sensitive-item span, .dc-sensitive-item small { display: block; min-width: 0; }
    .dc-sensitive-item strong { color: #f8fafc; font-size: 12px; }
    .dc-sensitive-item small { margin-top: 3px; color: #94a3b8; word-break: break-all; }
    .dc-sensitive-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
    .dc-sensitive-actions button { border: 1px solid rgba(148,163,184,.3); border-radius: 8px; padding: 7px 11px; background: #1e293b; color: #e2e8f0; cursor: pointer; }
    .dc-sensitive-actions button.primary { border: 0; background: #2563eb; color: white; }
    .dc-error { border: 1px solid rgba(248,113,113,.35); background: rgba(127,29,29,.3); color: #fecaca; border-radius: 12px; padding: 10px; font-size: 12px; }
    .dc-results { display: flex; flex-direction: column; gap: 8px; }
    .dc-result-item { border: 1px solid rgba(148,163,184,.12); background: rgba(30,41,59,.7); border-radius: 12px; color: #e2e8f0; padding: 12px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .dc-result-item.active { border-color: rgba(99,102,241,.6); background: rgba(67,56,202,.22); }
    .dc-result-item small { color: #94a3b8; }
    .dc-result-meta { display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .dc-delete-result { border: 1px solid rgba(248,113,113,.28); border-radius: 999px; color: #fecaca; background: rgba(127,29,29,.26); padding: 2px 7px; font-size: 11px; font-weight: 700; }
    .dc-delete-result:hover { border-color: rgba(248,113,113,.55); background: rgba(127,29,29,.42); color: #fee2e2; }
    .dc-result-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .dc-result-detail, .dc-result-detail pre { user-select: text; -webkit-user-select: text; }
    .dc-result-detail pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-family: inherit; color: #dbeafe; font-size: 13px; line-height: 1.55; max-height: 260px; overflow: auto; cursor: text; }
    .dc-reply-sections { display: flex; flex-direction: column; gap: 10px; }
    .dc-reply-section { border: 1px solid rgba(148,163,184,.14); border-radius: 12px; background: rgba(2,8,23,.26); padding: 10px; }
    .dc-reply-section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .dc-reply-section-title { color: #f8fafc; font-size: 13px; font-weight: 700; }
    .dc-copy-small { padding: 4px 8px; font-size: 12px; }
    .dc-footer { height: 54px; padding: 0 14px; border-top: 1px solid rgba(148,163,184,.18); display: flex; align-items: center; justify-content: space-between; color: #94a3b8; font-size: 11px; }
  `;
  document.documentElement.appendChild(style);
}

function injectSidebar(): void {
  if (document.getElementById(SIDEBAR_ID)) return;
  injectStyles();
  const sidebar = document.createElement("aside");
  sidebar.id = SIDEBAR_ID;
  sidebar.innerHTML = `<div id="${CONTENT_ROOT_ID}"></div>`;
  document.documentElement.appendChild(sidebar);

  sidebar.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const actionElement = target?.closest<HTMLElement>("[data-action]");
    const resultElement = target?.closest<HTMLElement>("[data-result-id]");

    const action = actionElement?.dataset.action;
    if (action === "delete-result") {
      event.preventDefault();
      event.stopPropagation();
      const resultId = actionElement?.dataset.resultId;
      if (resultId) void deleteResult(resultId);
      return;
    }

    if (resultElement) {
      const nextResultId = resultElement.dataset.resultId ?? null;
      state.activeResultId = state.activeResultId === nextResultId ? null : nextResultId;
      render();
      return;
    }

    if (action === "toggle") {
      state.hidden = true;
      render();
    } else if (action === "translate") {
      requestAiAction("translate-clean");
    } else if (action === "reply") {
      requestAiAction("reply");
    } else if (action === "summary") {
      requestAiAction("summarize");
    } else if (action === "sensitive-cancel") {
      state.pendingSensitiveRequest = null;
      render();
    } else if (action === "sensitive-confirm") {
      confirmSensitiveRequest(sidebar);
    } else if (action === "view-summary") {
      if (state.summaryRecord?.webUrl) window.open(state.summaryRecord.webUrl, "_blank", "noopener,noreferrer");
    } else if (action === "role-client") {
      void setConversationRole("client");
    } else if (action === "role-end-user") {
      void setConversationRole("end_user");
    } else if (action === "role-clear") {
      void setConversationRole(null);
    } else if (action === "copy") {
      const activeResult = getActiveResult();
      if (activeResult) {
        void navigator.clipboard.writeText(parseMetaData(activeResult.content).cleanContent);
        clearWindowSelection();
      }
    } else if (action === "copy-section") {
      const activeResult = getActiveResult();
      const sectionIndex = Number(actionElement?.dataset.sectionIndex);
      const section = activeResult?.type === "reply" ? parseReplySections(activeResult.content)[sectionIndex] : undefined;
      if (section) {
        void navigator.clipboard.writeText(section.content);
        clearWindowSelection();
      }
    }
  });

  sidebar.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest(".dc-result-detail pre")) return;
    state.selectingResultText = true;
  });

  document.addEventListener("pointerup", () => {
    window.setTimeout(() => {
      state.selectingResultText = false;
    }, 150);
  });

  document.addEventListener("pointercancel", () => {
    state.selectingResultText = false;
  });

  sidebar.addEventListener("copy", () => {
    window.setTimeout(clearWindowSelection, 0);
  });

  render();
}

function runRefreshSnapshot(): void {
  void refreshSnapshot().catch(() => {
    // The extension context can be invalidated when the extension is reloaded
    // while WhatsApp remains open. Ignore stale content-script refreshes.
  });
}

function scheduleRefresh(): void {
  window.setTimeout(runRefreshSnapshot, 350);
}


if (isExtensionContextValid()) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== "dicloak:toggle-sidebar") return;
    state.hidden = !state.hidden;
    if (!state.hidden) {
      state.collapsed = false;
      runRefreshSnapshot();
    }
    render();
  });
}

injectSidebar();
runRefreshSnapshot();
window.setInterval(runRefreshSnapshot, 3000);
new MutationObserver(scheduleRefresh).observe(document.body, { childList: true, subtree: true });