import { createHash } from "../shared/hash";
import type { ChatSnapshot, CopilotResult, ExternalChatInfo, ExternalChatMessage } from "../shared/types";

type ChromeStorageItems = Record<string, unknown>;

declare const chrome: {
  runtime: {
    onMessage: {
      addListener(callback: (message: { type?: string }) => void): void;
    };
    sendMessage(
      message: { type: string; endpoint: string; action: "translate-clean" | "reply"; payload: ChatSnapshot },
      callback: (response?: { content?: string; error?: string }) => void,
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

const SIDEBAR_ID = "dicloak-ai-copilot-sidebar";
const CONTENT_ROOT_ID = "dicloak-ai-copilot-root";
const STORAGE_PREFIX = "dicloak_copilot_cache:";

const state: {
  snapshot: ChatSnapshot | null;
  cache: CacheRecord | null;
  activeResultId: string | null;
  loadingAction: "translate-clean" | "reply" | null;
  error: string | null;
  collapsed: boolean;
  hidden: boolean;
  selectingResultText: boolean;
} = {
  snapshot: null,
  cache: null,
  activeResultId: null,
  loadingAction: null,
  error: null,
  collapsed: false,
  hidden: false,
  selectingResultText: false,
};

function textOf(element: Element | null): string {
  return element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function getStorageKey(chatId: string): string {
  return `${STORAGE_PREFIX}${chatId}`;
}

function readCache(chatId: string): Promise<CacheRecord | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(getStorageKey(chatId), (items) => {
      const value = items[getStorageKey(chatId)] as CacheRecord | undefined;
      resolve(value ?? null);
    });
  });
}

function writeCache(chatId: string, cache: CacheRecord): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [getStorageKey(chatId)]: cache }, () => resolve());
  });
}

function getCurrentChatInfo(): ExternalChatInfo | null {
  const main = document.querySelector("#main");
  const header = main?.querySelector("header");
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
  const externalChatId = createHash(["whatsapp", displayName, avatarUrl ?? ""].join("|"));

  return {
    platform: "whatsapp",
    externalChatId,
    displayName,
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
  const messageCount = snapshot?.messages.length ?? 0;
  const previousBodyScrollTop = root.querySelector<HTMLElement>(".dc-body")?.scrollTop ?? 0;
  const previousResultScrollTop = root.querySelector<HTMLElement>(".dc-result-detail pre")?.scrollTop ?? 0;
  const previousActiveResultId = root.querySelector<HTMLElement>("[data-active-result-id]")?.dataset.activeResultId ?? null;
  document.getElementById(SIDEBAR_ID)?.classList.toggle("dc-hidden", state.hidden);

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
              </div>
            </div>
          ` : `<div class="dc-muted">请打开一个 WhatsApp 聊天。</div>`}
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
              <small>${formatTime(result.createdAt)}</small>
            </button>
          `).join("")}
        </section>

        ${activeResult ? `
          <section class="dc-card dc-result-detail" data-active-result-id="${escapeHtml(activeResult.id)}">
            <div class="dc-result-head">
              <div class="dc-section-title">${escapeHtml(activeResult.title)}</div>
              <button class="dc-copy" data-action="copy">复制</button>
            </div>
            <pre>${escapeHtml(activeResult.content)}</pre>
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
    state.activeResultId = null;
    if (shouldRender) render();
    return;
  }

  const isSameChat = previousChatId === snapshot.chat.externalChatId;
  const isSameSnapshot = isSameChat && previousHash === snapshot.sourceMessageHash;
  state.snapshot = snapshot;

  if (!isSameChat || !state.cache) {
    state.cache = await readCache(snapshot.chat.externalChatId);
    state.activeResultId = null;
    render();
    return;
  }

  if (!isSameSnapshot) {
    render();
  }
}


function sendCopilotRequest(endpoint: string, action: "translate-clean" | "reply", payload: ChatSnapshot): Promise<{ content?: string; error?: string }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "dicloak:copilot-request", endpoint, action, payload }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message || "AI 请求失败" });
        return;
      }
      resolve(response ?? { error: "AI 请求失败" });
    });
  });
}

async function callCopilot(action: "translate-clean" | "reply"): Promise<void> {
  if (!state.snapshot) return;

  state.loadingAction = action;
  state.error = null;
  render();

  try {
    const endpoint = action === "reply" ? "/api/copilot/reply" : "/api/copilot/translate-clean";
    const payload = await sendCopilotRequest(endpoint, action, state.snapshot);
    if (!payload.content) {
      throw new Error(payload.error || "AI 请求失败");
    }

    const result: CopilotResult = {
      id: `${Date.now()}-${action}`,
      type: action,
      title: action === "reply" ? "生成推荐回复" : "翻译结果",
      content: payload.content,
      createdAt: Date.now(),
      sourceMessageHash: state.snapshot.sourceMessageHash,
    };

    const nextCache: CacheRecord = {
      sourceMessageHash: state.snapshot.sourceMessageHash,
      updatedAt: Date.now(),
      results: [result, ...(state.cache?.results ?? [])].slice(0, 10),
    };

    state.cache = nextCache;
    state.activeResultId = result.id;
    await writeCache(state.snapshot.chat.externalChatId, nextCache);
  } catch (error) {
    state.error = error instanceof Error ? error.message : "AI 请求失败";
  } finally {
    state.loadingAction = null;
    render();
  }
}

function injectStyles(): void {
  const style = document.createElement("style");
  style.textContent = `
    #${SIDEBAR_ID}.dc-hidden { display: none; }
    #${SIDEBAR_ID} { position: fixed; z-index: 2147483647; top: 0; right: 0; width: 380px; height: 100vh; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #e5eefb; box-shadow: -16px 0 40px rgba(0,0,0,.3); }
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
    .dc-chat-status, .dc-muted, .dc-cache-detail { font-size: 12px; color: #94a3b8; line-height: 1.6; }
    .dc-cache-main { font-weight: 700; margin-bottom: 4px; }
    .dc-cache-cached { border-color: rgba(34,197,94,.35); background: rgba(21,128,61,.13); }
    .dc-cache-stale { border-color: rgba(234,179,8,.38); background: rgba(113,63,18,.18); }
    .dc-cache-empty { border-color: rgba(248,113,113,.25); }
    .dc-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .dc-action-card { min-height: 120px; border: 1px solid rgba(148,163,184,.14); border-radius: 14px; background: linear-gradient(180deg, rgba(30,41,59,.9), rgba(15,23,42,.82)); color: #f8fafc; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; font-size: 16px; font-weight: 700; }
    .dc-action-card:disabled { opacity: .55; cursor: not-allowed; }
    .dc-action-card small { color: #94a3b8; font-size: 11px; font-weight: 500; }
    .dc-action-icon { font-size: 24px; }
    .dc-error { border: 1px solid rgba(248,113,113,.35); background: rgba(127,29,29,.3); color: #fecaca; border-radius: 12px; padding: 10px; font-size: 12px; }
    .dc-results { display: flex; flex-direction: column; gap: 8px; }
    .dc-result-item { border: 1px solid rgba(148,163,184,.12); background: rgba(30,41,59,.7); border-radius: 12px; color: #e2e8f0; padding: 12px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
    .dc-result-item.active { border-color: rgba(99,102,241,.6); background: rgba(67,56,202,.22); }
    .dc-result-item small { color: #94a3b8; }
    .dc-result-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .dc-result-detail, .dc-result-detail pre { user-select: text; -webkit-user-select: text; }
    .dc-result-detail pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-family: inherit; color: #dbeafe; font-size: 13px; line-height: 1.55; max-height: 260px; overflow: auto; cursor: text; }
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

    if (resultElement) {
      const nextResultId = resultElement.dataset.resultId ?? null;
      state.activeResultId = state.activeResultId === nextResultId ? null : nextResultId;
      render();
      return;
    }

    const action = actionElement?.dataset.action;
    if (action === "toggle") {
      state.hidden = true;
      render();
    } else if (action === "translate") {
      void callCopilot("translate-clean");
    } else if (action === "reply") {
      void callCopilot("reply");
    } else if (action === "copy") {
      const activeResult = getActiveResult();
      if (activeResult) {
        void navigator.clipboard.writeText(activeResult.content);
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

function scheduleRefresh(): void {
  window.setTimeout(() => void refreshSnapshot(), 350);
}


chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "dicloak:toggle-sidebar") return;
  state.hidden = !state.hidden;
  if (!state.hidden) {
    state.collapsed = false;
    void refreshSnapshot();
  }
  render();
});

injectSidebar();
void refreshSnapshot();
window.setInterval(() => void refreshSnapshot(), 3000);
new MutationObserver(scheduleRefresh).observe(document.body, { childList: true, subtree: true });