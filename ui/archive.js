/* global chrome */

import { originIdKey, withStore } from "../src/db.js";
import { exportChatMarkdown } from "../src/export.js";
import { fetchChatList } from "../src/api.js";
import { stringIdFromChatLike } from "../src/chatIds.js";
import { getSettings, originFromBaseUrl } from "../src/settings.js";
import { getI18nContext } from "../src/i18n.js";
import { escapeHtml, extractPlainText, generateSnippet } from "../src/chatText.js";
import { restoreChat } from "../src/restore.js";

const app = globalThis.document?.querySelector?.("#app") || null;

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

export function primaryArchiveAction(chat) {
  return chat.remotePresent ? "open" : "restore-open";
}

export function applyRestoredArchiveChat(chats, chat, restored) {
  const updated = {
    ...chat,
    id: String(restored.remoteId),
    updatedAt: restored.restoredAt || chat.updatedAt,
    restored: true,
    localOnly: false,
    remotePresent: true,
  };

  const index = chats.findIndex((candidate) => candidate === chat || String(candidate.id) === String(restored.localId));
  if (index >= 0) chats.splice(index, 1, updated);
  return updated;
}

async function reconcileRemotePresence(chats) {
  if (!chats.length) return;

  try {
    const remoteChats = await fetchChatList();
    const remoteIds = new Set(remoteChats.map(stringIdFromChatLike).filter(Boolean));

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
        const primaryAction = primaryArchiveAction(chat) === "open"
          ? '<button data-action="open">Open</button>'
          : '<button data-action="restore-open">Restore/Open</button>';
        
        return `
          <article class="card" data-id="${escapeHtml(chat.id)}">
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
        const created = chat.remotePresent ? { remoteId: chat.id } : await restoreChat(origin, chat);
        const remoteId = created?.remoteId || chat.id;
        const url = `${settings.baseUrl.replace(/\/$/, "")}/c/${encodeURIComponent(remoteId)}`;
        chrome.tabs.create({ url });
        if (!chat.remotePresent && created?.remoteId) {
          applyRestoredArchiveChat(chats, chat, created);
        }
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

if (app) {
  render().catch((error) => {
    app.textContent = `Failed to load archive UI: ${error.message}`;
  });
}
