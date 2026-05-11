import { withStore } from "../src/db.js";
import { exportChatMarkdown } from "../src/export.js";
import { createChat, fetchChatList } from "../src/api.js";
import { getSettings, originFromBaseUrl } from "../src/settings.js";

const app = document.querySelector("#app");

function escapeHtml(s) {
  return String(s || "").replace(/[&<>\"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
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
  const reconcilableChats = chats.filter((chat) => !chat.restored && !chat.localOnly);
  if (!reconcilableChats.length) return;

  try {
    const remoteChats = await fetchChatList();
    const remoteIds = new Set(remoteChats.map((chat) => String(chat.id)).filter(Boolean));

    await Promise.all(
      reconcilableChats.map(async (chat) => {
        const remotePresent = remoteIds.has(String(chat.id));
        if (chat.remotePresent === remotePresent) return;
        chat.remotePresent = remotePresent;
        await withStore("chats", "readwrite", (store) => store.put(chat));
      })
    );
  } catch {
    // Keep last known status on network or auth failures.
  }
}

async function deleteChatLocal(id) {
  await withStore("chats", "readwrite", (store) => store.delete(id));
  await withStore("search_docs", "readwrite", (store) => store.delete(id));
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
  
  // 1. Prepare the payload based on the exact format you found.
  // We leave `id: ""` because the /new endpoint expects it blank and will generate a new one.
  const payload = {
    chat: {
      ...normalizedChat, // Inject all the old messages, models, and history
      id: "",
      title: `[Restored] ${chat.title || normalizedChat.title || "Untitled"}`,
      timestamp: Date.now() // The payload expects milliseconds here
    }
  };

  // 2. Send it to the server (/api/v1/chats/new)
  const created = await createChat(payload);
  
  // 3. The server response should contain the newly generated ID
  const remoteId = created?.id || created?.chatId || created?.chat?.id;
  if (!remoteId) {
    throw new Error("Restore succeeded, but the server didn't return a new Chat ID.");
  }

  // 4. Save the mapping so we know which local ID turned into which remote ID
  await withStore("restore_mappings", "readwrite", (store) =>
    store.put({ localId: chat.id, remoteId: remoteId, origin: chat.origin, restoredAt: new Date().toISOString() })
  );

  // 5. Update our local database. 
  // Because IndexedDB uses "id" as the primary key, we delete the old local record and save it under the new active ID.
  const newChatRecord = {
    ...chat,
    id: remoteId,
    title: payload.chat.title,
    updatedAt: new Date().toISOString(),
    restored: true,
    localOnly: false,
    remotePresent: true,
    detail: { ...oldDetail, chat: { ...normalizedChat, id: remoteId } } // Update nested payload shape for future backups
  };

  await withStore("chats", "readwrite", (store) => {
    store.delete(chat.id); // Delete old local-only ID
    return store.put(newChatRecord); // Save new restored ID
  });

  return { id: remoteId };
}

async function render() {
  const settings = await getSettings();
  const origin = settings.baseUrl ? originFromBaseUrl(settings.baseUrl) : null;
  if (!origin) {
    app.innerHTML = "<p>Configure CANChat URL in popup before using archive.</p>";
    return;
  }

  const chats = await getChats(origin);

  app.innerHTML = `
    <header>
      <h1>CANChat Archive</h1>
      <p class="governance">Stored locally in this browser profile. No retention bypass. Restore creates a new conversation.</p>
    </header>
    <section class="toolbar">
      <input id="search" placeholder="Search title and content" />
      <select id="filter">
        <option value="all">All</option>
        <option value="still on CANChat">Still on CANChat</option>
        <option value="archived locally">Archived locally</option>
        <option value="restored">Restored</option>
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
      const hay = `${chat.title || ""} ${JSON.stringify(chat.detail || {})}`.toLowerCase();
      return !q || hay.includes(q);
    });

    results.innerHTML = filtered
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .map((chat) => {
        const status = statusOf(chat);
        const snippet = JSON.stringify(chat.detail || {}).slice(0, 180).replace(/\s+/g, " ");
        const primaryAction = chat.remotePresent ? '<button data-action="open">Open</button>' : '<button data-action="restore-open">Restore/Open</button>';
        return `
          <article class="card" data-id="${chat.id}">
            <h3>${escapeHtml(chat.title || "Untitled")}</h3>
            <p class="snippet">${escapeHtml(snippet)}</p>
            <p class="meta">Updated: ${escapeHtml(chat.updatedAt || "Unknown")} · Status: <span class="status">${status}</span></p>
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
        const created = chat.remotePresent ? { id: chat.id } : await restoreOne(chat);
        const remoteId = created?.id || created?.chatId || chat.id;
        const url = `${settings.baseUrl.replace(/\/$/, "")}/c/${encodeURIComponent(remoteId)}`;
        chrome.tabs.create({ url });
        paint();
      } catch (error) {
        alert(`Restore failed: ${error.message}`);
      }
    }
    if (action === "export") {
      const md = await exportChatMarkdown(origin, chat.id);
      download(`chat-${chat.id}.md`, md);
    }
    if (action === "delete") {
      if (!confirm("Delete this local archived copy?")) return;
      await deleteChatLocal(chat.id);
      const idx = chats.findIndex((c) => c.id === chat.id);
      if (idx >= 0) chats.splice(idx, 1);
      paint();
    }
  });

  searchEl.addEventListener("input", paint);
  filterEl.addEventListener("change", paint);

  paint();
  await reconcileRemotePresence(chats);
  paint();
}

render().catch((error) => {
  app.textContent = `Failed to load archive UI: ${error.message}`;
});
