import type { ConversationRole, ConversationRoleSource, CustomerSummary } from "./shared/types";
type RuntimeMessage = {
  type?: string;
  action?: "translate-clean" | "reply" | "summarize";
  endpoint?: string;
  payload?: unknown;
};

declare const chrome: {
  action: {
    onClicked: {
      addListener(callback: (tab: { id?: number }) => void): void;
    };
  };
  tabs: {
    sendMessage(tabId: number, message: RuntimeMessage, callback?: () => void): void;
  };
  runtime: {
    getURL(path: string): string;
    lastError?: { message?: string };
    onMessage: {
      addListener(
        callback: (
          message: RuntimeMessage,
          sender: unknown,
          sendResponse: (response: { content?: string; error?: string; detectedRole?: ConversationRole | null; roleSource?: ConversationRoleSource; summary?: CustomerSummary; webUrl?: string }) => void,
        ) => true | void,
      ): void;
    };
  };
};

let apiBasePromise: Promise<string> | null = null;

function getApiBase(): Promise<string> {
  if (!apiBasePromise) {
    apiBasePromise = fetch(chrome.runtime.getURL("config.json"))
      .then(async (response) => await response.json() as { apiBaseUrl?: unknown })
      .then((config) => {
        if (typeof config.apiBaseUrl !== "string" || !config.apiBaseUrl.startsWith("https://")) {
          throw new Error("请先在扩展 config.json 中配置 Vercel API 地址");
        }
        return config.apiBaseUrl.replace(/\/+$/, "");
      });
  }
  return apiBasePromise;
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "dicloak:toggle-sidebar" }, () => {
    void chrome.runtime.lastError;
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "dicloak:copilot-request" || !message.endpoint) return;

  void getApiBase()
    .then(async (apiBase) => await fetch(`${apiBase}${message.endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload),
    }))
    .then(async (response) => {
      if (message.action === "reply" && response.ok && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let content = "";
        let detectedRole: ConversationRole | null = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as { type?: string; content?: string; message?: string; data?: { userRole?: unknown } };
            if (event.type === "delta" && event.content) content += event.content;
            if (event.type === "final" && event.content) content = event.content;
            if (event.type === "meta") detectedRole = event.data?.userRole === "client" || event.data?.userRole === "end_user" ? event.data.userRole : null;
            if (event.type === "error") throw new Error(event.message || "AI 请求失败");
          }
        }
        sendResponse({ content, detectedRole, roleSource: detectedRole ? "ai" : null });
        return;
      }
      const payload = await response.json() as { content?: string; error?: string; detectedRole?: ConversationRole | null; roleSource?: ConversationRoleSource; summary?: CustomerSummary; webUrl?: string };
      if (!response.ok || (!payload.content && !payload.summary)) {
        sendResponse({ error: payload.error || "AI 请求失败" });
        return;
      }
      sendResponse({ content: payload.content, detectedRole: payload.detectedRole ?? null, roleSource: payload.roleSource ?? null, summary: payload.summary, webUrl: payload.webUrl });
    })
    .catch((error: unknown) => {
      sendResponse({ error: error instanceof Error ? error.message : "AI 请求失败" });
    });

  return true;
});
