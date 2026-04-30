import { fetchChatDetail, fetchChatList } from "./api.js";
import { putChat, putSearchDoc, getChatsByOrigin, putSyncMeta } from "./db.js";
import { ensureConfiguredOriginPermission, getSettings, originFromBaseUrl } from "./settings.js";

const runningByOrigin = new Set();

async function backupOrigin(origin) {
  if (runningByOrigin.has(origin)) return;
  runningByOrigin.add(origin);
  try {
    const list = await fetchChatList();
    const remoteIds = new Set();

    for (const item of list) {
      const id = item.id || item.chatId || item.conversationId;
      if (!id) continue;
      remoteIds.add(String(id));
      const detail = await fetchChatDetail(id);
      const chat = {
        id: String(id),
        origin,
        title: detail.title || item.title || "Untitled",
        updatedAt: detail.updatedAt || item.updatedAt || new Date().toISOString(),
        remotePresent: true,
        detail,
      };
      await putChat(chat);
      await putSearchDoc({
        id: chat.id,
        origin,
        titleLower: chat.title.toLowerCase(),
        contentLower: JSON.stringify(detail).toLowerCase(),
      });
    }

    const local = await getChatsByOrigin(origin);
    for (const chat of local) {
      if (!remoteIds.has(String(chat.id))) {
        chat.remotePresent = false;
        chat.localOnly = true;
        await putChat(chat);
      }
    }

    await putSyncMeta({ key: `last_sync:${origin}`, origin, at: new Date().toISOString() });
  } finally {
    runningByOrigin.delete(origin);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "canchat-page-loaded") {
    (async () => {
      try {
        const settings = await getSettings();
        if (!settings.enabled || !settings.baseUrl) return sendResponse({ ok: true, skipped: true });
        const permission = await ensureConfiguredOriginPermission();
        if (!permission.ok) return sendResponse({ ok: false, error: permission.reason });
        await backupOrigin(originFromBaseUrl(settings.baseUrl));
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }
  return false;
});
