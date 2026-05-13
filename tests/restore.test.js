import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRestorePayload,
  remoteIdFromCreateResponse,
  restoreChat,
} from "../src/restore.js";

test("remoteIdFromCreateResponse supports known response shapes", () => {
  assert.equal(remoteIdFromCreateResponse({ id: "a" }), "a");
  assert.equal(remoteIdFromCreateResponse({ chatId: "b" }), "b");
  assert.equal(remoteIdFromCreateResponse({ chat: { id: "c" } }), "c");
  assert.equal(remoteIdFromCreateResponse({}), null);
});

test("buildRestorePayload preserves chat content with safe defaults", () => {
  const payload = buildRestorePayload({
    title: "Local title",
    detail: {
      chat: {
        messages: [{ role: "user", content: "Hi" }],
        history: null,
        models: null,
      },
    },
  });

  assert.equal(payload.chat.id, "");
  assert.equal(payload.chat.title, "Local title");
  assert.deepEqual(payload.chat.history, { messages: {}, currentId: null });
  assert.deepEqual(payload.chat.models, []);
});

test("restoreChat remaps chat, search doc, and restore mapping to the new remote ID", async () => {
  const writes = { chats: [], search_docs: [], restore_mappings: [] };
  const deletes = { chats: [], search_docs: [] };
  const deps = {
    createChat: async () => ({ chat: { id: "remote-1" } }),
    putRestoreMapping: async (mapping) => writes.restore_mappings.push(mapping),
    withStore: async (name, _mode, fn) => {
      const store = {
        delete: (key) => deletes[name].push(key),
        put: (value) => writes[name].push(value),
      };
      fn(store);
    },
  };

  const result = await restoreChat(
    "https://chat.example.com",
    {
      id: "local-1",
      origin: "https://chat.example.com",
      title: "Archived",
      detail: { chat: { messages: [{ role: "assistant", content: "Saved" }] } },
    },
    deps,
  );

  assert.equal(result.localId, "local-1");
  assert.equal(result.remoteId, "remote-1");
  assert.deepEqual(deletes.chats, [["https://chat.example.com", "local-1"]]);
  assert.deepEqual(deletes.search_docs, [
    ["https://chat.example.com", "local-1"],
  ]);
  assert.equal(writes.restore_mappings[0].remoteId, "remote-1");
  assert.equal(writes.chats[0].id, "remote-1");
  assert.equal(writes.chats[0].remotePresent, true);
  assert.equal(writes.search_docs[0].id, "remote-1");
});
