import { originIdKey, withStore } from "../src/db.js";
import { exportChatMarkdown } from "../src/export.js";
import { createChat, fetchChatList } from "../src/api.js";
import { getSettings, originFromBaseUrl } from "../src/settings.js";
import { getI18nContext } from "../src/i18n.js";

const app = document.querySelector("#app");

function escapeHtml(s) {
  return String(s || "").replace(/[&<>\"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

// 1. New Helper: Extract ONLY the human/assistant message text from the payload
function extractPlainText(chat) {
  const messages = [];
  const seen = new Set();

  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    // Grab text only if this object looks like a message (has a role/author)
    const role = node.role || node.author || node.sender || node.type;
    if (role && (typeof node.content === "string" || typeof node.text === "string")) {
      const text = (node.content || node.text).trim();
      if (text) messages.push(text);
    }

    for (const value of Object.values(node)) {
      visit(value);
    }
  }

  visit(chat.detail || chat);
  // Remove duplicates and join with spacing
  return Array.from(new Set(messages)).join(" ... ");
}

// 2. New Helper: Create a clean UI snippet (and center it around the search query if active)
function generateSnippet(text, query) {
  if (!text) return "No message content found.";
  if (!query) return text.slice(0, 180) + (text.length > 180 ? "..." : "");

  const lowerText = text.toLowerCase();
  const idx = lowerText.indexOf(query);
  if (idx === -1) return text.slice(0, 180) + (text.length > 180 ? "..." : "");

  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + 140);
  let snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  
  return snippet;
}

async function getChats(origin) {
  return withStore("chats", "readonly", (store) =>
    new Promise((resolve, reject) => {
      const idx = store.index("by_origin");
      const r = idx.getAll(origin);
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    })
  );
}

function statusOf(chat) {
  if (chat.restored) return "restored";
  if (chat.remotePresent === false || chat.localOnly) return "archived locally";
  if (chat.remotePresent === true) return "still on CANChat";
  return "archived locally";
}

async function reconcileRemotePresence(chats) {
  if (!chats.length) return;

  try {
    const remoteChats = await fetchChatList();
    const remoteIds = new Set(remoteChats.map((chat) => String(chat.id)).filter(Boolean));

    await Promise.all(
      chats.map(async (chat) => {
        const isRemotePresent = remoteIds.has(String(chat.id));
        let changed = false;

        if (chat.remotePresent !== isRemotePresent) {
          chat.remotePresent = isRemotePresent;
          changed = true;
        }

        if (!isRemotePresent && (chat.restored || !chat.localOnly)) {
          chat.restored = false;
          chat.localOnly = true;
          changed = true;
        }

        if (isRemotePresent && chat.localOnly) {
          chat.localOnly = false;
          changed = true;
        }

        if (changed) {
          await withStore("chats", "readwrite", (store) => store.put({ ...chat, id: String(chat.id) }));
        }
      })
    );
  } catch {
    // Keep last known status on network or auth failures.
  }
}

async function deleteChatLocal(origin, id) {
  const key = originIdKey(origin, id);
  await withStore("chats", "readwrite", (store) => store.delete(key));
  await withStore("search_docs", "readwrite", (store) => store.delete(key));
}

function download(name, content) {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
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
  if (!remoteId) {
    throw new Error("Restore succeeded, but the server didn't return a new Chat ID.");
  }

  await withStore("restore_mappings", "readwrite", (store) =>
    store.put({ localId: chat.id, remoteId: remoteId, origin: chat.origin, restoredAt: new Date().toISOString() })
  );

  const newChatRecord = {
    ...chat,
    id: String(remoteId),
    title: payload.chat.title,
    updatedAt: new Date().toISOString(),
    restored: true,
    localOnly: false,
    remotePresent: true,
    detail: { ...oldDetail, chat: { ...normalizedChat, id: remoteId } } 
  };

  await withStore("chats", "readwrite", (store) => {
    store.delete(originIdKey(chat.origin, chat.id)); 
    return store.put(newChatRecord); 
  });

  await withStore("search_docs", "readwrite", (store) => {
    store.delete(originIdKey(chat.origin, chat.id)); 
    return store.put({
      id: String(remoteId), 
      origin: chat.origin,
      titleLower: newChatRecord.title.toLowerCase(),
      contentLower: JSON.stringify(newChatRecord.detail).toLowerCase()
    });
  });

  return { id: remoteId };
}

async function render() {
  const settings = await getSettings();
  const { t } = await getI18nContext();
  const origin = settings.baseUrl ? originFromBaseUrl(settings.baseUrl) : null;
  if (!origin) {
    app.innerHTML = `<p>${t("archive.configureFirst")}</p>`;
    return;
  }

  const chats = await getChats(origin);
  
  // Pre-calculate plain text once so search is lightning fast
  for (const chat of chats) {
    chat._plainText = extractPlainText(chat);
  }

  app.innerHTML = `
    <header>
      <h1>${t("archive.title")}</h1>
      <p class="governance">Stored locally in this browser profile. No retention bypass. Restore creates a new conversation.</p>
    </header>
    <section class="toolbar">
      <input id="search" placeholder="${t("archive.searchPlaceholder")}" />
      <select id="filter">
        <option value="all">${t("archive.all")}</option>
        <option value="still on CANChat">${t("archive.still")}</option>
        <option value="archived locally">${t("archive.archived")}</option>
        <option value="restored">${t("archive.restored")}</option>
      </select>
    </section>
    <section id="results"></section>
  `;

  const results = document.querySelector("#results");
  const searchEl = document.querySelector("#search");
  const filterEl = document.querySelector("#filter");

  const paint = () => {
    const q = searchEl.value.toLowerCase().trim();
    const f = filterEl.value;
    const filtered = chats.filter((chat) => {
      const status = statusOf(chat);
      if (f !== "all" && status !== f) return false;
      
      // Search through Title and actual message Plain Text instead of raw JSON!
      const hay = `${chat.title || ""} ${chat._plainText}`.toLowerCase();
      return !q || hay.includes(q);
    });

    results.innerHTML = filtered
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .map((chat) => {
        const status = statusOf(chat);
        const snippetText = generateSnippet(chat._plainText, q);
        const formattedDate = new Date(chat.updatedAt).toLocaleString(); // Format ugly date string
        const primaryAction = chat.remotePresent ? '<button data-action="open">Open</button>' : '<button data-action="restore-open">Restore/Open</button>';
        
        return `
          <article class="card" data-id="${chat.id}">
            <h3>${escapeHtml(chat.title || "Untitled")}</h3>
            <p class="snippet" style="font-style: italic; font-size: 13px; line-height: 1.4;">${escapeHtml(snippetText)}</p>
            <p class="meta">Updated: ${escapeHtml(formattedDate)} · Status: <span class="status">${status}</span></p>
            <div class="actions">
              ${primaryAction}
              <button data-action="export">Export Markdown</button>
              <button data-action="delete" class="danger">Delete local copy</button>
            </div>
          </article>
        `;
      })
      .join("");
  };

  results.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const card = button.closest("article[data-id]");
    const id = card?.dataset.id;
    const chat = chats.find((c) => String(c.id) === String(id));
    if (!chat) return;

    const action = button.dataset.action;
    if (action === "open") {
      const url = `${settings.baseUrl.replace(/\/$/, "")}/c/${encodeURIComponent(chat.id)}`;
      chrome.tabs.create({ url });
    }
    if (action === "restore-open") {
      try {
        button.textContent = "Restoring...";
        button.disabled = true;
        const created = chat.remotePresent ? { id: chat.id } : await restoreOne(chat);
        const remoteId = created?.id || created?.chatId || chat.id;
        const url = `${settings.baseUrl.replace(/\/$/, "")}/c/${encodeURIComponent(remoteId)}`;
        chrome.tabs.create({ url });
        paint();
      } catch (error) {
        alert(`Restore failed: ${error.message}`);
        button.textContent = "Restore/Open";
        button.disabled = false;
      }
    }
    if (action === "export") {
      const md = await exportChatMarkdown(origin, chat.id);
      download(`chat-${chat.id}.md`, md);
    }
    if (action === "delete") {
      if (!confirm("Delete this local archived copy?")) return;
      await deleteChatLocal(origin, chat.id);
      const idx = chats.findIndex((c) => c.id === chat.id);
      if (idx >= 0) chats.splice(idx, 1);
      paint();
    }
  });

  searchEl.addEventListener("input", paint);
  filterEl.addEventListener("change", paint);

  paint();
  await reconcileRemotePresence(chats);
  paint(); // Repaint in case statuses changed
}

render().catch((error) => {
  app.textContent = `Failed to load archive UI: ${error.message}`;
});
