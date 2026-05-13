/* global chrome */

import { discoverEndpoints } from "../src/api.js";
import {
  getChatsByOrigin,
  exportFullDatabase,
  importFullDatabase,
  originIdKey,
  withStore,
} from "../src/db.js";
import { exportAllChatsJson } from "../src/export.js";
import {
  ensureConfiguredOriginPermission,
  getSettings,
  normalizeBaseUrl,
  originFromBaseUrl,
  requestOriginPermission,
  updateSettings,
} from "../src/settings.js";
import { getI18nContext, setLocale } from "../src/i18n.js";

const app = document.querySelector("#app");

function formatDate(value) {
  if (!value) return window.__t("common.never");
  const d = new Date(value);
  return Number.isNaN(d.valueOf())
    ? window.__t("common.unknown")
    : d.toLocaleString();
}

function downloadText(name, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function setMessage(el, text, kind = "info") {
  if (!el) return;
  el.textContent = text;
  el.className = `message ${kind}`;
}

async function clearArchive(origin) {
  const chats = await getChatsByOrigin(origin);
  await withStore("chats", "readwrite", (store) => {
    for (const chat of chats) store.delete(originIdKey(origin, chat.id));
  });
  await withStore("search_docs", "readwrite", (store) => {
    for (const chat of chats) store.delete(originIdKey(origin, chat.id));
  });
  await withStore("restore_mappings", "readwrite", (store) => {
    const idx = store.index("by_origin");
    const req = idx.getAll(origin);
    req.onsuccess = () => {
      for (const mapping of req.result || []) store.delete(mapping.localId);
    };
  });
  await withStore("sync_meta", "readwrite", (store) => {
    const idx = store.index("by_origin");
    const req = idx.getAll(origin);
    req.onsuccess = () => {
      for (const entry of req.result || []) store.delete(entry.key);
    };
  });
  await updateSettings({ lastSyncAt: null });
}

async function render() {
  const settings = await getSettings();
  const { t, locale, locales } = await getI18nContext();
  window.__t = t;
  const origin = settings.baseUrl ? originFromBaseUrl(settings.baseUrl) : null;
  const chats = origin ? await getChatsByOrigin(origin) : [];
  const archivedCount = chats.length;

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "sync-completed") {
      // Force a re-render of the popup when a sync finishes
      render();
    }
  });

  app.innerHTML = `
    <section class="card">
      <h2>${t("popup.setup")}</h2>
      <input id="base-url" placeholder="https://chat.example.com" value="${settings.baseUrl || ""}" />
      <div class="row"><button id="save-btn" class="primary" style="flex:1">${t("popup.saveTest")}</button></div>
      <div id="setup-msg" class="message" style="margin-top:8px; font-size:11px"></div>
    </section>

    <section class="card">
      <h2>${t("popup.dbMgmt")}</h2>
      <ul class="stats-list">
        <li><span>${t("popup.lastSync")}</span> <b>${formatDate(settings.lastSyncAt)}</b></li>
        <li><span>${t("popup.archivedChats")}:</span> <b>${archivedCount}</b></li>
      </ul>
      <div class="grid-actions" style="margin-top:12px">
        <button id="backup-btn">${t("popup.syncNow")}</button>
        <button id="open-archive-btn">${t("popup.openArchive")}</button>
        <button id="export-json-btn">${t("popup.exportJson")}</button>
        <button id="export-db-btn">${t("popup.exportDb")}</button>
        <button id="import-db-btn">${t("popup.importDb")}</button>
        <button id="delete-btn" class="danger">${t("popup.deleteArchive")}</button>
      </div>
      <div id="action-msg" class="message" style="margin-top:8px; font-size:11px"></div>
      <div id="db-msg" class="message" style="margin-top:8px; font-size:11px"></div>
      <input type="file" id="import-file" accept=".json" style="display: none;" />
    </section>

    <section class="card">
      <h2>${t("popup.language")}</h2>
      <select id="locale-select">
        ${locales.map((code) => `<option value="${code}" ${code === locale ? "selected" : ""}>${code.toUpperCase()}</option>`).join("")}
      </select>
    </section>
  `;

  // --- SINGLE EVENT DELEGATION ---
  app.onclick = async (e) => {
    const target = e.target;
    const setupMsg = document.querySelector("#setup-msg");
    const actionMsg = document.querySelector("#action-msg");
    const dbMsg = document.querySelector("#db-msg");

    if (target.id === "save-btn") {
      const originalText = target.textContent;
      target.disabled = true;
      target.classList.add("loading");
      target.textContent = "Connecting...";

      try {
        const input = document.querySelector("#base-url").value;
        const baseUrl = normalizeBaseUrl(input);
        const granted = await requestOriginPermission(baseUrl);
        if (!granted) throw new Error("Host permission not granted.");
        await updateSettings({ baseUrl, discoveredEndpoints: null });
        await discoverEndpoints(true);
        setMessage(setupMsg, t("popup.msg.connected"), "success");
        await render();
      } catch (err) {
        setMessage(setupMsg, err.message, "error");
      } finally {
        target.disabled = false;
        target.classList.remove("loading");
        target.textContent = originalText;
      }
    }

    if (target.id === "backup-btn") {
      try {
        target.disabled = true;
        const res = await chrome.runtime.sendMessage({
          type: "canchat-page-loaded",
        });
        if (!res?.ok) throw new Error(res?.error || "Backup failed.");
        await updateSettings({ lastSyncAt: new Date().toISOString() });
        setMessage(actionMsg, t("popup.msg.backupCompleted"), "success");
        await render();
      } catch (err) {
        setMessage(actionMsg, err.message, "error");
      } finally {
        target.disabled = false;
      }
    }

    if (target.id === "open-archive-btn")
      chrome.tabs.create({ url: chrome.runtime.getURL("ui/archive.html") });

    if (target.id === "export-json-btn") {
      try {
        const p = await ensureConfiguredOriginPermission();
        if (!p.ok) throw new Error(p.reason);
        downloadText(
          `canchat-archive-${Date.now()}.json`,
          await exportAllChatsJson(p.origin),
        );
        setMessage(actionMsg, t("popup.msg.exported"), "success");
      } catch (err) {
        setMessage(actionMsg, err.message, "error");
      }
    }

    if (target.id === "delete-btn") {
      if (!origin || !confirm(t("popup.msg.confirmDelete"))) return;
      await clearArchive(origin);
      await render();
    }

    if (target.id === "export-db-btn") {
      try {
        setMessage(dbMsg, t("popup.msg.genBackup"), "info");
        downloadText(`backup-${Date.now()}.json`, await exportFullDatabase());
        setMessage(dbMsg, t("popup.msg.dbDownloadOk"), "success");
      } catch (err) {
        setMessage(dbMsg, err.message, "error");
      }
    }

    if (target.id === "import-db-btn")
      document.querySelector("#import-file").click();
  };

  // --- LANGUAGE HANDLER ---
  document.querySelector("#locale-select").onchange = async (e) => {
    await setLocale(e.target.value);
    await render();
  };

  // --- FILE HANDLER ---
  document.querySelector("#import-file").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      setMessage(document.querySelector("#db-msg"), "Importing...", "info");
      await importFullDatabase(await file.text());
      await render();
    } catch { setMessage(document.querySelector("#db-msg"), "Import failed", "error"); }
  };
}

render().catch(console.error);
