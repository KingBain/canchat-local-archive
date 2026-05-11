const DB_NAME = "canchat_local_archive";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;

      const chats = db.createObjectStore("chats", { keyPath: "id" });
      chats.createIndex("by_origin", "origin", { unique: false });
      chats.createIndex("by_updated_at", "updatedAt", { unique: false });
      chats.createIndex("by_origin_updated", ["origin", "updatedAt"], { unique: false });

      const searchDocs = db.createObjectStore("search_docs", { keyPath: "id" });
      searchDocs.createIndex("by_origin", "origin", { unique: false });
      searchDocs.createIndex("by_title", "titleLower", { unique: false });
      searchDocs.createIndex("by_content", "contentLower", { unique: false });

      const restoreMappings = db.createObjectStore("restore_mappings", { keyPath: "localId" });
      restoreMappings.createIndex("by_remote_id", "remoteId", { unique: false });
      restoreMappings.createIndex("by_origin", "origin", { unique: false });

      const syncMeta = db.createObjectStore("sync_meta", { keyPath: "key" });
      syncMeta.createIndex("by_origin", "origin", { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function withStore(name, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const store = tx.objectStore(name);
    Promise.resolve(fn(store, tx)).then(resolve).catch(reject);
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => db.close();
  });
}

export async function putChat(chat) {
  return withStore("chats", "readwrite", (store) => promisify(store.put(chat)));
}

export async function getChatsByOrigin(origin) {
  return withStore("chats", "readonly", (store) => {
    const idx = store.index("by_origin");
    return promisify(idx.getAll(origin));
  });
}

export async function putSearchDoc(doc) {
  return withStore("search_docs", "readwrite", (store) => promisify(store.put(doc)));
}

export async function getAllSearchDocs(origin) {
  return withStore("search_docs", "readonly", (store) => {
    const idx = store.index("by_origin");
    return promisify(idx.getAll(origin));
  });
}

export async function putRestoreMapping(mapping) {
  return withStore("restore_mappings", "readwrite", (store) => promisify(store.put(mapping)));
}

export async function putSyncMeta(entry) {
  return withStore("sync_meta", "readwrite", (store) => promisify(store.put(entry)));
}

export async function exportFullDatabase() {
  const db = await openDb();
  const stores = ["chats", "search_docs", "restore_mappings", "sync_meta"];
  const data = {};

  for (const storeName of stores) {
    data[storeName] = await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  db.close();
  
  return JSON.stringify({ 
    version: DB_VERSION, 
    exportedAt: new Date().toISOString(), 
    data 
  }, null, 2);
}

export async function importFullDatabase(jsonData) {
  const parsed = JSON.parse(jsonData);
  if (!parsed || !parsed.data) {
    throw new Error("Invalid backup file format. Missing 'data' object.");
  }

  const db = await openDb();
  const stores = ["chats", "search_docs", "restore_mappings", "sync_meta"];

  return new Promise((resolve, reject) => {
    // Open a single transaction for all stores
    const tx = db.transaction(stores, "readwrite");
    
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);

    // Loop through the stores and "upsert" (update or insert) every record
    for (const storeName of stores) {
      if (Array.isArray(parsed.data[storeName])) {
        const store = tx.objectStore(storeName);
        for (const item of parsed.data[storeName]) {
          store.put(item); 
        }
      }
    }
  });
}