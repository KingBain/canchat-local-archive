import { withStore } from "../src/db.js";
import { createChat } from "../src/api.js";
import { getSettings, originFromBaseUrl } from "../src/settings.js";

const results = document.querySelector("#results");



async function getArchivedChats(origin) {
  return withStore("chats", "readonly", (store) =>
    new Promise((resolve, reject) => {
      const idx = store.index("by_origin");
      const r = idx.getAll(origin);
      r.onsuccess = () => {
        const chats = r.result || [];
        // Filter out chats that are already restored or currently active on the server
        const archived = chats.filter((chat) => {
          if (chat.restored) return false;
          if (chat.remotePresent === false || chat.localOnly) return true;
          return false;
        });
        resolve(archived);
      };
      r.onerror = () => reject(r.error);
    })
  );
}

async function restoreOne(chat) {
  const oldDetail = chat.detail || {};
  const sourceChat = (oldDetail && typeof oldDetail === "object" && oldDetail.chat && typeof oldDetail.chat === "object")
    ? oldDetail.chat
    : oldDetail;

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

async function render() {
  const settings = await getSettings();
  const origin = settings.baseUrl ? originFromBaseUrl(settings.baseUrl) : null;
  
  if (!origin) {
    results.innerHTML = '<div class="empty">Configure CANChat URL in the extension popup first.</div>';
    return;
  }

  const chats = await getArchivedChats(origin);
  
  if (chats.length === 0) {
    results.innerHTML = '<div class="empty">No local archived chats available.</div>';
    return;
  }

  // Sort by newest first
  chats.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  results.innerHTML = chats.map(chat => `
    <div class="chat-item" data-id="${chat.id}">
      <p class="chat-title" title="${(chat.title || "Untitled").replace(/"/g, '&quot;')}">${chat.title || "Untitled"}</p>
      <p class="chat-meta">${new Date(chat.updatedAt).toLocaleDateString()}</p>
      <button class="restore-btn" data-action="restore">Restore</button>
    </div>
  `).join("");
}

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
    const chats = await getArchivedChats(origin);
    const chat = chats.find(c => String(c.id) === String(id));
    if (!chat) throw new Error("Chat not found in archive");

    const created = await restoreOne(chat);
    const remoteId = created?.id;
    
    // Redirect the parent window to the newly restored chat
    const url = `${settings.baseUrl.replace(/\/$/, "")}/c/${encodeURIComponent(remoteId)}`;
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.update(tabs[0].id, {url: url});
    });
    

    render();
  } catch (err) {
    alert("Failed to restore: " + err.message);
    btn.textContent = "Restore";
    btn.disabled = false;
  }
});

render();