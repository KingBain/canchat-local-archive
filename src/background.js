import { fetchChatDetail, fetchChatList } from "./api.js";
import { stringIdFromChatLike } from "./chatIds.js";
import { putChat, putSearchDoc, getChatsByOrigin, putSyncMeta } from "./db.js";
import {
  ensureConfiguredOriginPermission,
  getSettings,
  originFromBaseUrl,
  updateSettings,
} from "./settings.js";

const runningByOrigin = new Set();
const queuedByOrigin = new Set();
let shutdownBackupTimer = null;

export async function runBackupOnce(origin, deps = {}) {
  const apiFetchChatList = deps.fetchChatList || fetchChatList;
  const apiFetchChatDetail = deps.fetchChatDetail || fetchChatDetail;
  const writeChat = deps.putChat || putChat;
  const writeSearchDoc = deps.putSearchDoc || putSearchDoc;
  const readChatsByOrigin = deps.getChatsByOrigin || getChatsByOrigin;
  const writeSyncMeta = deps.putSyncMeta || putSyncMeta;
  const saveSettings = deps.updateSettings || updateSettings;

  const list = await apiFetchChatList();
  const remoteIds = new Set();
  const failures = [];
  let syncedCount = 0;

  for (const item of list) {
    const id = stringIdFromChatLike(item);
    if (!id) continue;
    remoteIds.add(id);

    try {
      const detail = await apiFetchChatDetail(id);
      // Get timestamp, handling both camelCase and snake_case.
      let ts =
        detail.updatedAt ||
        detail.updated_at ||
        item.updatedAt ||
        item.updated_at;
      // If the timestamp is in seconds (10 digits), convert to milliseconds for JS Dates.
      if (typeof ts === "number" && ts < 2000000000) ts = ts * 1000;

      const chat = {
        id,
        origin,
        title: detail.title || item.title || "Untitled",
        updatedAt: ts ? new Date(ts).toISOString() : new Date().toISOString(),
        remotePresent: true,
        detail,
      };

      await writeChat(chat);
      await writeSearchDoc({
        id: chat.id,
        origin,
        titleLower: chat.title.toLowerCase(),
        contentLower: JSON.stringify(detail).toLowerCase(),
      });
      syncedCount += 1;
    } catch (error) {
      failures.push({ id: String(id), error: error?.message || String(error) });
    }
  }

  const local = await readChatsByOrigin(origin);
  for (const chat of local) {
    if (!remoteIds.has(String(chat.id))) {
      chat.remotePresent = false;
      chat.localOnly = true;
      await writeChat(chat);
    }
  }

  const completedAt = new Date().toISOString();
  await writeSyncMeta({ key: `last_sync:${origin}`, origin, at: completedAt });
  await saveSettings({ lastSyncAt: completedAt });

  return {
    ok: true,
    syncedCount,
    failedCount: failures.length,
    failures,
    completedAt,
  };
}

export async function backupOrigin(origin) {
  return runQueuedBackup(
    origin,
    runBackupOnce,
    runningByOrigin,
    queuedByOrigin,
  );
}

export async function runQueuedBackup(
  origin,
  runner,
  running = new Set(),
  queued = new Set(),
) {
  if (running.has(origin)) {
    queued.add(origin);
    return {
      ok: true,
      queued: true,
      syncedCount: 0,
      failedCount: 0,
      failures: [],
      completedAt: null,
    };
  }

  running.add(origin);
  try {
    const result = await runner(origin);
    chrome.runtime
      .sendMessage({
        type: "sync-completed",
        timestamp: result.completedAt,
        result,
      })
      .catch?.(() => {});
    return result;
  } finally {
    running.delete(origin);
    if (queued.has(origin)) {
      queued.delete(origin);
      runQueuedBackup(origin, runner, running, queued).catch(() => {});
    }
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
        if (!settings.enabled || !settings.baseUrl)
          return sendResponse({ ok: true, skipped: true });
        const permission = await ensureConfiguredOriginPermission();
        if (!permission.ok)
          return sendResponse({ ok: false, error: permission.reason });
        const result = await backupOrigin(originFromBaseUrl(settings.baseUrl));
        sendResponse(result);
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }
  return false;
});
