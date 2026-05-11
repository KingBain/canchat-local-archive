import { withStore } from "../src/db.js";
import { createChat, fetchChatList } from "../src/api.js";
import { getSettings, originFromBaseUrl } from "../src/settings.js";

const results = document.querySelector("#results");
const backupBtn = document.querySelector("#sidebar-backup-btn");

async function getAllChats(origin) {
  return withStore("chats", "readonly", (store) =>
    new Promise((resolve, reject) => {
      const idx = store.index("by_origin");
      const r = idx.getAll(origin);
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    })
  );
}

// Check server to see if restored chats were deleted
async function reconcileRemotePresence(chats) {
  if (!chats.length) return false;
  let changed = false;
  try {
    const remoteChats = await fetchChatList();
    const remoteIds = new Set(remoteChats.map((chat) => String(chat.id)).filter(Boolean));

    await Promise.all(
      chats.map(async (chat) => {
        const isRemotePresent = remoteIds.has(String(chat.id));
        let chatChanged = false;

        if (chat.remotePresent !== isRemotePresent) {
          chat.remotePresent = isRemotePresent;
          chatChanged = true;
        }

        // If chat is no longer on server, set back to local archive state
        if (!isRemotePresent && (chat.restored || !chat.localOnly)) {
          chat.restored = false;
          chat.localOnly = true;
          chatChanged = true;
        }

        if (isRemotePresent && chat.localOnly) {
          chat.localOnly = false;
          chatChanged = true;
        }

        if (chatChanged) {
          await withStore("chats", "readwrite", (store) => store.put(chat));
          changed = true;
        }
      })
    );
  } catch {
    // Keep last known status on network or auth failures.
  }
  return changed; // Returns true if DB was modified
}

async function restoreOne(chat) {
  const oldDetail = chat.detail || {};
  const sourceChat = (oldDetail && typeof oldDetail === "object" && oldDetail.chat && typeof oldDetail.chat === "object")
    ? oldDetail.chat : oldDetail;

  const normalizedChat = {
    ...sourceChat,
    messages: Array.isArray(sourceChat.messages) ? sourceChat.messages : [],
    history: (sourceChat.history && typeof sourceChat.history === "object" && !Array.isArray(sourceChat.history)) 
      ? sourceChat.history 
      : { messages: {}, currentId: null },
    models: Array.isArray(sourceChat.models) ? sourceChat.models : [],
  };
  
  const payload = {
    chat: {
      ...normalizedChat,
      id: "",
      title: chat.title || normalizedChat.title || "Untitled",
      timestamp: Date.now() 
    }
  };

  const created = await createChat(payload);
  const remoteId = created?.id || created?.chatId || created?.chat?.id;
  if (!remoteId) throw new Error("Restore succeeded, but server returned no ID.");

  await withStore("restore_mappings", "readwrite", (store) =>
    store.put({ localId: chat.id, remoteId: remoteId, origin: chat.origin, restoredAt: new Date().toISOString() })
  );

  const newChatRecord = {
    ...chat,
    id: remoteId,
    title: payload.chat.title,
    updatedAt: new Date().toISOString(),
    restored: true,
    localOnly: false,
    remotePresent: true,
    detail: { ...oldDetail, chat: { ...normalizedChat, id: remoteId } } 
  };

  await withStore("chats", "readwrite", (store) => {
    store.delete(chat.id); 
    return store.put(newChatRecord); 
  });

  await withStore("search_docs", "readwrite", (store) => {
    store.delete(chat.id); 
    return store.put({
      id: remoteId, 
      origin: chat.origin,
      titleLower: newChatRecord.title.toLowerCase(),
      contentLower: JSON.stringify(newChatRecord.detail).toLowerCase()
    });
  });

  return { id: remoteId };
}

// 1. Instantly paint the UI using whatever is in the local DB right now
async function paint() {
  const settings = await getSettings();
  const origin = settings.baseUrl ? originFromBaseUrl(settings.baseUrl) : null;
  
  if (!origin) {
    results.innerHTML = '<div class="empty">Configure CANChat URL in popup first.</div>';
    return origin;
  }

  const allChats = await getAllChats(origin);
  const archived = allChats.filter((chat) => !chat.restored && (chat.remotePresent === false || chat.localOnly));
  
  if (archived.length === 0) {
    results.innerHTML = '<div class="empty">No local archived chats available.</div>';
    return origin;
  }

  archived.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  results.innerHTML = archived.map(chat => `
    <div class="chat-item" data-id="${chat.id}">
      <div class="chat-header">
        <p class="chat-title" title="${(chat.title || "Untitled").replace(/"/g, '&quot;')}">${chat.title || "Untitled"}</p>
        <button class="restore-btn" data-action="restore">Restore</button>
      </div>
      <p class="chat-meta">${new Date(chat.updatedAt).toLocaleDateString()}</p>
    </div>
  `).join("");
  
  return origin;
}

// 2. Full update cycle: Paint immediately -> Reconcile with server -> Paint again if changed
async function updateAndRender() {
  const origin = await paint();
  if (origin) {
    const chats = await getAllChats(origin);
    const changed = await reconcileRemotePresence(chats);
    if (changed) await paint(); // Only repaint if server told us a chat was deleted
  }
}

// Trigger background backup when clicking the new button
backupBtn.addEventListener("click", async () => {
  backupBtn.textContent = "Running...";
  backupBtn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: "canchat-page-loaded" });
    if (!res?.ok) throw new Error(res?.error || "Backup failed.");
    await updateAndRender();
  } catch (error) {
    alert("Backup failed: " + error.message);
  } finally {
    backupBtn.textContent = "Backup";
    backupBtn.disabled = false;
  }
});

// Handle clicks to restore
results.addEventListener("click", async (event) => {
  const btn = event.target.closest("button[data-action='restore']");
  if (!btn) return;
  
  const item = btn.closest(".chat-item");
  const id = item.dataset.id;
  const settings = await getSettings();
  const origin = originFromBaseUrl(settings.baseUrl);
  
  btn.textContent = "Restoring...";
  btn.disabled = true;

  try {
    const chats = await getAllChats(origin);
    const chat = chats.find(c => String(c.id) === String(id));
    if (!chat) throw new Error("Chat not found in archive");

    const created = await restoreOne(chat);
    const remoteId = created?.id;
    
    const url = `${settings.baseUrl.replace(/\/$/, "")}/c/${encodeURIComponent(remoteId)}`;
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.update(tabs[0].id, {url: url});
    });
    
    // Refresh the list so the restored chat disappears from the sidebar
    await updateAndRender();
  } catch (err) {
    alert("Failed to restore: " + err.message);
    btn.textContent = "Restore";
    btn.disabled = false;
  }
});

// Update the list immediately when the side panel is focused (e.g. after deleting a chat in main window)
window.addEventListener("focus", () => {
  updateAndRender();
});

// Initial load
updateAndRender();