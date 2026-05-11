import { fetchChatDetail, fetchChatList } from "./api.js";
import { putChat, putSearchDoc, getChatsByOrigin, putSyncMeta } from "./db.js";
import { ensureConfiguredOriginPermission, getSettings, originFromBaseUrl, updateSettings } from "./settings.js";

const runningByOrigin = new Set();
let shutdownBackupTimer = null;

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
      // Get timestamp, handling both camelCase and snake_case.
      let ts = detail.updatedAt || detail.updated_at || item.updatedAt || item.updated_at;
      // If the timestamp is in seconds (10 digits), convert to milliseconds for JS Dates.
      if (typeof ts === "number" && ts < 2000000000) ts = ts * 1000;

      const chat = {
        id: String(id),
        origin,
        title: detail.title || item.title || "Untitled",
        updatedAt: ts ? new Date(ts).toISOString() : new Date().toISOString(),
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

    const now = new Date().toISOString();
    await putSyncMeta({ key: `last_sync:${origin}`, origin, at: now });
    await updateSettings({ lastSyncAt: now });
    chrome.runtime.sendMessage({ type: "sync-completed", timestamp: now });
  } finally {
    runningByOrigin.delete(origin);
  }
}

async function maybeBackupBeforeLastSessionEnds() {
  const settings = await getSettings();
  if (!settings.enabled || !settings.baseUrl) return;

  const permission = await ensureConfiguredOriginPermission();
  if (!permission.ok) return;

  const origin = originFromBaseUrl(settings.baseUrl);
  const canchatTabs = await chrome.tabs.query({ url: `${origin}/*` });

  // If no CanChat tabs are left, this was the user's final session.
  if (canchatTabs.length === 0) {
    await backupOrigin(origin);
  }
}

function scheduleShutdownBackupCheck() {
  if (shutdownBackupTimer) clearTimeout(shutdownBackupTimer);
  // Let Chrome finish tab/window teardown before checking tab count.
  shutdownBackupTimer = setTimeout(() => {
    shutdownBackupTimer = null;
    maybeBackupBeforeLastSessionEnds().catch(() => {
      // Intentionally ignore to avoid noisy extension errors during shutdown.
    });
  }, 750);
}

chrome.tabs.onRemoved.addListener(() => {
  scheduleShutdownBackupCheck();
});

chrome.windows.onRemoved.addListener(() => {
  scheduleShutdownBackupCheck();
});

// ==========================================
// NEW AUTO-SYNC TRIGGERS
// ==========================================

// 1. Polling: Sync active conversations every 2 minutes
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("canchat-sync-poll", { periodInMinutes: 2 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "canchat-sync-poll") {
    const settings = await getSettings();
    if (!settings.enabled || !settings.baseUrl) return;
    
    const origin = originFromBaseUrl(settings.baseUrl);
    const canchatTabs = await chrome.tabs.query({ url: `${origin}/*` });
    
    // Only run the backup if they actually have a CanChat tab open right now
    if (canchatTabs.length > 0) {
      backupOrigin(origin).catch(() => {});
    }
  }
});

// 2. SPA Navigation: Sync when navigating between chats or leaving the site
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Fire when the URL changes (changing chats) or page finishes loading
  if (changeInfo.url || changeInfo.status === "complete") {
    const settings = await getSettings();
    if (!settings.enabled || !settings.baseUrl) return;
    
    const origin = originFromBaseUrl(settings.baseUrl);
    
    if (tab.url && tab.url.startsWith(origin)) {
      // User navigated around inside CanChat
      backupOrigin(origin).catch(() => {});
    } else if (changeInfo.url && !changeInfo.url.startsWith(origin)) {
      // User typed a different website into the address bar, leaving CanChat
      scheduleShutdownBackupCheck();
    }
  }
});

// 3. Tab Switching: Sync immediately when they click away to another tab
chrome.tabs.onActivated.addListener(async () => {
  const settings = await getSettings();
  if (!settings.enabled || !settings.baseUrl) return;
  
  const origin = originFromBaseUrl(settings.baseUrl);
  const canchatTabs = await chrome.tabs.query({ url: `${origin}/*` });
  
  // If they click away, save the state of their current CanChat tabs
  if (canchatTabs.length > 0) {
    backupOrigin(origin).catch(() => {});
  }
});


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
