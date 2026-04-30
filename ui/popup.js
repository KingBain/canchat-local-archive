import { discoverEndpoints } from "../src/api.js";
import { getChatsByOrigin } from "../src/db.js";
import { exportAllChatsJson } from "../src/export.js";
import {
  ensureConfiguredOriginPermission,
  getSettings,
  normalizeBaseUrl,
  originFromBaseUrl,
  requestOriginPermission,
  updateSettings,
} from "../src/settings.js";

const app = document.querySelector("#app");

function formatDate(value) {
  if (!value) return "Never";
  const d = new Date(value);
  return Number.isNaN(d.valueOf()) ? "Unknown" : d.toLocaleString();
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
    tx.objectStore("chats").index("by_origin").openCursor(origin).onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.objectStore("search_docs").index("by_origin").openCursor(origin).onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.objectStore("restore_mappings").index("by_origin").openCursor(origin).onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.objectStore("sync_meta").index("by_origin").openCursor(origin).onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function render() {
  const settings = await getSettings();
  const origin = settings.baseUrl ? originFromBaseUrl(settings.baseUrl) : null;
  const chats = origin ? await getChatsByOrigin(origin) : [];
  const localOnlyCount = chats.filter((c) => c.localOnly).length;
  const archivedCount = chats.length;

  app.innerHTML = `
    <section class="card">
      <h2>Setup</h2>
      <label for="base-url">CANChat URL</label>
      <input id="base-url" type="url" placeholder="https://app.canchat.example" value="${settings.baseUrl || ""}" />
      <div class="row">
        <button id="save-btn">Save & Test</button>
      </div>
      <p id="setup-msg" class="message info">Connection status: ${settings.baseUrl ? "Configured" : "Not configured"}</p>
    </section>

    <section class="card">
      <h2>Status</h2>
      <ul>
        <li><strong>Configured origin:</strong> ${origin || "Not set"}</li>
        <li><strong>Last sync:</strong> ${formatDate(settings.lastSyncAt)}</li>
        <li><strong>Archived chats:</strong> ${archivedCount}</li>
        <li><strong>Local-only chats:</strong> ${localOnlyCount}</li>
      </ul>
    </section>

    <section class="card">
      <h2>Actions</h2>
      <div class="actions">
        <button id="backup-btn">Backup now</button>
        <button id="open-archive-btn">Open archive page</button>
        <button id="export-json-btn">Export JSON</button>
        <button class="danger" id="delete-btn">Delete archive</button>
      </div>
      <p id="action-msg" class="message info"></p>
    </section>

    <section class="card governance">
      <h2>Local archive governance</h2>
      <ul>
        <li>Data is stored locally in your browser and remains under your device profile.</li>
        <li>This extension does not bypass CANChat retention, deletion, or legal hold controls.</li>
        <li>Restore creates a new conversation record and does not recreate original server metadata.</li>
      </ul>
    </section>
  `;

  const setupMsg = document.querySelector("#setup-msg");
  const actionMsg = document.querySelector("#action-msg");

  document.querySelector("#save-btn").addEventListener("click", async () => {
    const input = document.querySelector("#base-url").value;
    try {
      const baseUrl = normalizeBaseUrl(input);
      const granted = await requestOriginPermission(baseUrl);
      if (!granted) throw new Error("Host permission not granted.");
      await updateSettings({ baseUrl, discoveredEndpoints: null });
      await discoverEndpoints(true);
      setMessage(setupMsg, "Connected: endpoint discovery succeeded.", "success");
      await render();
    } catch (error) {
      console.error("[CANChat Archive] Save & Test failed", error);
      setMessage(setupMsg, `Connection failed: ${error.message}`, "error");
    }
  });

  document.querySelector("#backup-btn").addEventListener("click", async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: "canchat-page-loaded" });
      if (!res?.ok) throw new Error(res?.error || "Backup failed.");
      await updateSettings({ lastSyncAt: new Date().toISOString() });
      setMessage(actionMsg, "Backup completed.", "success");
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
      setMessage(actionMsg, "Exported JSON archive.", "success");
    } catch (error) {
      setMessage(actionMsg, `Export failed: ${error.message}`, "error");
    }
  });

  document.querySelector("#delete-btn").addEventListener("click", async () => {
    if (!origin) return setMessage(actionMsg, "No configured archive to delete.", "error");
    const confirmed = confirm("Delete all local archived data for this origin?");
    if (!confirmed) return;
    try {
      await clearArchive(origin);
      setMessage(actionMsg, "Deleted local archive.", "success");
      await render();
    } catch (error) {
      setMessage(actionMsg, `Delete failed: ${error.message}`, "error");
    }
  });
}

render().catch((error) => {
  app.textContent = `Failed to load popup: ${error.message}`;
});
