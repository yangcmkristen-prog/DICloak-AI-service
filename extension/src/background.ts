import type { ConversationRole, ConversationRoleSource } from "./shared/types";
type RuntimeMessage = {
  type?: string;
  action?: "translate-clean" | "reply";
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
    lastError?: { message?: string };
    onMessage: {
      addListener(
        callback: (
          message: RuntimeMessage,
          sender: unknown,
          sendResponse: (response: { content?: string; error?: string; detectedRole?: ConversationRole | null; roleSource?: ConversationRoleSource }) => void,
        ) => true | void,
      ): void;
    };
  };
};

const API_BASE = "https://5wygm4zx4m.coze.site";

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "dicloak:toggle-sidebar" }, () => {
    void chrome.runtime.lastError;
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "dicloak:copilot-request" || !message.endpoint) return;

  // Do not set Content-Type here. A JSON Content-Type triggers a CORS preflight
  // from the chrome-extension:// origin, and the deployed Coze site may not
  // answer OPTIONS with CORS headers. NextRequest.json() can still parse the
  // raw JSON body without this header.
  void fetch(`${API_BASE}${message.endpoint}`, {
    method: "POST",
    body: JSON.stringify(message.payload),
  })
    .then(async (response) => {
      const payload = await response.json() as { content?: string; error?: string; detectedRole?: ConversationRole | null; roleSource?: ConversationRoleSource };
      if (!response.ok || !payload.content) {
        sendResponse({ error: payload.error || "AI 请求失败" });
        return;
      }
      sendResponse({ content: payload.content, detectedRole: payload.detectedRole ?? null, roleSource: payload.roleSource ?? null });
    })
    .catch((error: unknown) => {
      sendResponse({ error: error instanceof Error ? error.message : "AI 请求失败" });
    });

  return true;
});