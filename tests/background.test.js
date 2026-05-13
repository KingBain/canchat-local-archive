import test from "node:test";
import assert from "node:assert/strict";

function installChromeMock() {
  globalThis.chrome = {
    tabs: {
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} },
      onActivated: { addListener() {} },
      async query() {
        return [];
      },
    },
    windows: { onRemoved: { addListener() {} } },
    alarms: {
      onAlarm: { addListener() {} },
      create() {},
    },
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: { addListener() {} },
      sendMessage() {
        return Promise.resolve();
      },
    },
    storage: {
      local: {
        async get() {
          return {};
        },
        async set() {},
      },
    },
    permissions: {
      async contains() {
        return true;
      },
      async request() {
        return true;
      },
    },
  };
}

async function importFreshBackground() {
  installChromeMock();
  return import(`../src/background.js?test=${Date.now()}-${Math.random()}`);
}

test("runBackupOnce records per-chat failures and still updates successful records", async () => {
  const { runBackupOnce } = await importFreshBackground();
  const putChats = [];
  const putSearchDocs = [];

  const result = await runBackupOnce("https://chat.example.com", {
    fetchChatList: async () => [{ id: "ok" }, { id: "bad" }],
    fetchChatDetail: async (id) => {
      if (id === "bad") throw new Error("detail failed");
      return {
        id,
        title: "Good",
        updatedAt: "2026-05-11T00:00:00.000Z",
        messages: [],
      };
    },
    putChat: async (chat) => putChats.push({ ...chat }),
    putSearchDoc: async (doc) => putSearchDocs.push({ ...doc }),
    getChatsByOrigin: async () => [
      { id: "stale", origin: "https://chat.example.com", remotePresent: true },
    ],
    putSyncMeta: async () => {},
    updateSettings: async () => {},
  });

  assert.equal(result.ok, true);
  assert.equal(result.syncedCount, 1);
  assert.equal(result.failedCount, 1);
  assert.deepEqual(result.failures, [{ id: "bad", error: "detail failed" }]);
  assert.equal(putSearchDocs.length, 1);
  assert.equal(putChats.find((chat) => chat.id === "stale").localOnly, true);
});

test("runBackupOnce does not mark local chats deleted when list fetch fails", async () => {
  const { runBackupOnce } = await importFreshBackground();
  let readLocal = false;

  await assert.rejects(
    () =>
      runBackupOnce("https://chat.example.com", {
        fetchChatList: async () => {
          throw new Error("list failed");
        },
        getChatsByOrigin: async () => {
          readLocal = true;
          return [];
        },
      }),
    /list failed/,
  );
  assert.equal(readLocal, false);
});

test("runQueuedBackup queues one rerun when a backup is already active", async () => {
  const { runQueuedBackup } = await importFreshBackground();
  const running = new Set();
  const queued = new Set();
  const calls = [];
  let release;
  const firstRun = new Promise((resolve) => {
    release = resolve;
  });

  const runner = async () => {
    calls.push("run");
    if (calls.length === 1) await firstRun;
    return {
      ok: true,
      syncedCount: 0,
      failedCount: 0,
      failures: [],
      completedAt: new Date().toISOString(),
    };
  };

  const active = runQueuedBackup(
    "https://chat.example.com",
    runner,
    running,
    queued,
  );
  const queuedResult = await runQueuedBackup(
    "https://chat.example.com",
    runner,
    running,
    queued,
  );
  assert.equal(queuedResult.queued, true);
  assert.equal(calls.length, 1);

  release();
  await active;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 2);
});
