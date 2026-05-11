import { discoverEndpoints } from "../src/api.js";
import { getChatsByOrigin, exportFullDatabase, importFullDatabase } from "../src/db.js";
import { exportAllChatsJson } from "../src/export.js";
import {
  ensureConfiguredOriginPermission,
  getSettings,
  normalizeBaseUrl,
  originFromBaseUrl,
  requestOriginPermission,
  updateSettings,
} from "../src/settings.js";
import { getI18nContext, saveCustomLocale, setLocale } from "../src/i18n.js";

const app = document.querySelector("#app");

function formatDate(value) {
  if (!value) return window.__t("common.never");
  const d = new Date(value);
  return Number.isNaN(d.valueOf()) ? window.__t("common.unknown") : d.toLocaleString();
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
  el.textContent = text;
  el.className = `message ${kind}`;
}

async function clearArchive(origin) {
  const dbReq = indexedDB.open("canchat_local_archive");
  const db = await new Promise((resolve, reject) => {
    dbReq.onsuccess = () => resolve(dbReq.result);
    dbReq.onerror = () => reject(dbReq.error);
  });

  await new Promise((resolve, reject) => {
    const tx = db.transaction(["chats", "search_docs", "restore_mappings", "sync_meta"], "readwrite");
    
    // Helper to clear records matching the origin
    const clearOrigin = (storeName) => {
      tx.objectStore(storeName).index("by_origin").openCursor(origin).onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    };

    clearOrigin("chats");
    clearOrigin("search_docs");
    clearOrigin("restore_mappings");
    clearOrigin("sync_meta");

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function render() {
  const settings = await getSettings();
  const { t, locale, locales } = await getI18nContext();
  window.__t = t;
  const origin = settings.baseUrl ? originFromBaseUrl(settings.baseUrl) : null;
  const chats = origin ? await getChatsByOrigin(origin) : [];
  const localOnlyCount = chats.filter((c) => c.localOnly).length;
  const archivedCount = chats.length;

  app.innerHTML = `
    <section class="card">
      <h2>${t("popup.setup")}</h2>
      <label for="base-url">${t("popup.urlLabel")}</label>
      <input id="base-url" type="url" placeholder="https://app.canchat.example" value="${settings.baseUrl || ""}" />
      <div class="row">
        <button id="save-btn">${t("popup.saveTest")}</button>
      </div>
      <p id="setup-msg" class="message info">${t("popup.connectionStatus", { status: settings.baseUrl ? t("popup.configured") : t("popup.notConfigured") })}</p>
    </section>

    <section class="card">
      <h2>${t("popup.status")}</h2>
      <ul>
        <li><strong>${t("popup.configuredOrigin")}</strong> ${origin || t("popup.notSet")}</li>
        <li><strong>${t("popup.lastSync")}</strong> ${formatDate(settings.lastSyncAt)}</li>
        <li><strong>${t("popup.archivedChats")}</strong> ${archivedCount}</li>
        <li><strong>${t("popup.localOnlyChats")}</strong> ${localOnlyCount}</li>
      </ul>
    </section>

    <section class="card">
      <h2>${t("popup.actions")}</h2>
      <div class="actions">
        <button id="backup-btn">${t("popup.syncNow")}</button>
        <button id="open-archive-btn">${t("popup.openArchive")}</button>
        <button id="export-json-btn">${t("popup.exportJson")}</button>
        <button class="danger" id="delete-btn">${t("popup.deleteArchive")}</button>
      </div>
      <p id="action-msg" class="message info"></p>
    </section>

    <section class="card">
      <h2>${t("popup.dbMgmt")}</h2>
      <div class="actions">
        <button id="export-db-btn">${t("popup.exportDb")}</button>
        <button id="import-db-btn">${t("popup.importDb")}</button>
        <input type="file" id="import-file" accept=".json" style="display: none;" />
      </div>
      <p id="db-msg" class="message info">${t("popup.dbHelp")}</p>
    </section>



    <section class="card">
      <h2>${t("popup.language")}</h2>
      <label for="locale-select">${t("popup.languageLabel")}</label>
      <select id="locale-select">
        ${Object.keys(locales).sort().map((code) => `<option value="${code}" ${code===locale?"selected":""}>${code}</option>`).join("")}
      </select>
      <div class="actions">
        <button id="import-lang-btn">${t("popup.importLanguage")}</button>
        <input type="file" id="import-lang-file" accept=".json" style="display:none;"/>
      </div>
    </section>

    <section class="card governance">
      <h2>${t("popup.governance")}</h2>
      <ul>
        <li>Data is stored locally in your browser and remains under your device profile.</li>
        <li>This extension does not bypass CANChat retention, deletion, or legal hold controls.</li>
        <li>Restore creates a new conversation record and does not recreate original server metadata.</li>
      </ul>
    </section>
  `;

  const setupMsg = document.querySelector("#setup-msg");
  const actionMsg = document.querySelector("#action-msg");
  const dbMsg = document.querySelector("#db-msg");

  // --- SETUP ---
  document.querySelector("#save-btn").addEventListener("click", async () => {
    const input = document.querySelector("#base-url").value;
    try {
      const baseUrl = normalizeBaseUrl(input);
      const granted = await requestOriginPermission(baseUrl);
      if (!granted) throw new Error("Host permission not granted.");
      await updateSettings({ baseUrl, discoveredEndpoints: null });
      await discoverEndpoints(true);
      setMessage(setupMsg, t("popup.msg.connected"), "success");
      await render();
    } catch (error) {
      console.error("[CANChat Archive] Save & Test failed", error);
      setMessage(setupMsg, `Connection failed: ${error.message}`, "error");
    }
  });

  // --- ACTIONS ---
  document.querySelector("#backup-btn").addEventListener("click", async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: "canchat-page-loaded" });
      if (!res?.ok) throw new Error(res?.error || "Backup failed.");
      await updateSettings({ lastSyncAt: new Date().toISOString() });
      setMessage(actionMsg, t("popup.msg.backupCompleted"), "success");
      await render();
    } catch (error) {
      setMessage(actionMsg, `Backup failed: ${error.message}`, "error");
    }
  });

  document.querySelector("#open-archive-btn").addEventListener("click", async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL("ui/archive.html") });
  });

  document.querySelector("#export-json-btn").addEventListener("click", async () => {
    try {
      const permission = await ensureConfiguredOriginPermission();
      if (!permission.ok) throw new Error(permission.reason);
      const data = await exportAllChatsJson(permission.origin);
      downloadText(`canchat-archive-${Date.now()}.json`, data);
      setMessage(actionMsg, t("popup.msg.exported"), "success");
    } catch (error) {
      setMessage(actionMsg, `Export failed: ${error.message}`, "error");
    }
  });

  document.querySelector("#delete-btn").addEventListener("click", async () => {
    if (!origin) return setMessage(actionMsg, t("popup.msg.noArchive"), "error");
    const confirmed = confirm(t("popup.msg.confirmDelete"));
    if (!confirmed) return;
    try {
      await clearArchive(origin);
      setMessage(actionMsg, t("popup.msg.deleted"), "success");
      await render();
    } catch (error) {
      setMessage(actionMsg, `Delete failed: ${error.message}`, "error");
    }
  });

  // --- DATABASE MANAGEMENT ---
  document.querySelector("#export-db-btn").addEventListener("click", async () => {
    try {
      setMessage(dbMsg, t("popup.msg.genBackup"), "info");
      const dbJson = await exportFullDatabase();
      downloadText(`canchat-full-backup-${Date.now()}.json`, dbJson);
      setMessage(dbMsg, t("popup.msg.dbDownloadOk"), "success");
    } catch (error) {
      setMessage(dbMsg, `Export failed: ${error.message}`, "error");
    }
  });

  document.querySelector("#import-db-btn").addEventListener("click", () => {
    // Triggers the hidden file input
    document.querySelector("#import-file").click(); 
  });

  document.querySelector("#locale-select").addEventListener("change", async (event) => {
    await setLocale(event.target.value);
    await render();
  });

  document.querySelector("#import-lang-btn").addEventListener("click", () => {
    document.querySelector("#import-lang-file").click();
  });

  document.querySelector("#import-lang-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const content = JSON.parse(await file.text());
      const code = String(content.locale || file.name.replace(/\.json$/i, "")).trim();
      const messages = content.messages || content;
      await saveCustomLocale(code, messages);
      await setLocale(code);
      await render();
    } catch (error) {
      setMessage(dbMsg, `Language import failed: ${error.message}`, "error");
    } finally {
      event.target.value = "";
    }
  });

  document.querySelector("#import-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      setMessage(dbMsg, t("popup.msg.dbImporting"), "info");
      
      const text = await file.text();
      await importFullDatabase(text);
      
      setMessage(dbMsg, t("popup.msg.dbImportOk"), "success");
      
      // Clear the file input so it can be used again
      event.target.value = ''; 
      
      // Re-render the UI to show the updated chat counts
      await render();
    } catch (error) {
      setMessage(dbMsg, `Import failed: ${error.message}`, "error");
    }
  });
}

render().catch((error) => {
  app.textContent = `Failed to load popup: ${error.message}`;
});