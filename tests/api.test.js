import test from "node:test";
import assert from "node:assert/strict";

function installChromeStorage(initialSettings = {}) {
  const storage = { settings: { enabled: true, baseUrl: "https://chat.example.com", ...initialSettings } };
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: storage[key] };
        },
        async set(value) {
          Object.assign(storage, value);
        },
      },
    },
  };
  return storage;
}

async function importFreshApi() {
  return import(`../src/api.js?test=${Date.now()}-${Math.random()}`);
}

test("discoverEndpoints validates list/detail and chooses matching create endpoint", async () => {
  const storage = installChromeStorage();
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET" });
    if (url === "https://chat.example.com/api/v1/chats/") return new Response("missing", { status: 404 });
    if (url === "https://chat.example.com/api/v1/chats") return Response.json([{ id: "abc", title: "Found" }]);
    if (url === "https://chat.example.com/api/v1/chats/abc") return Response.json({ id: "abc", title: "Found" });
    if (url === "https://chat.example.com/api/v1/chats/new") return Response.json({ id: "new-id" });
    return new Response("missing", { status: 404 });
  };

  const { createChat, discoverEndpoints } = await importFreshApi();
  const endpoints = await discoverEndpoints(true);
  assert.equal(endpoints.list, "/api/v1/chats");
  assert.equal(endpoints.detail, "/api/v1/chats/{id}");
  assert.equal(endpoints.create, "/api/v1/chats/new");
  assert.equal(storage.settings.discoveredEndpoints.create, "/api/v1/chats/new");

  const created = await createChat({ chat: { title: "Restored" } });
  assert.deepEqual(created, { id: "new-id" });
  assert.equal(calls.at(-1).url, "https://chat.example.com/api/v1/chats/new");
  assert.equal(calls.at(-1).method, "POST");
});

test("discoverEndpoints records failed non-JSON candidates and continues", async () => {
  installChromeStorage();
  globalThis.fetch = async (url) => {
    if (url === "https://chat.example.com/api/v1/chats/") {
      return new Response("<html>not json</html>", { status: 200, headers: { "content-type": "text/html" } });
    }
    if (url === "https://chat.example.com/api/v1/chats") return Response.json({ data: [] });
    return new Response("missing", { status: 404 });
  };

  const { discoverEndpoints } = await importFreshApi();
  const endpoints = await discoverEndpoints(true);
  assert.equal(endpoints.list, "/api/v1/chats");
  assert.equal(endpoints.detail, "/api/v1/chats/{id}");
  assert.match(endpoints.diagnostics[0].reason, /non-JSON/);
});

test("discoverEndpoints rejects unknown JSON list shapes and continues", async () => {
  installChromeStorage();
  globalThis.fetch = async (url) => {
    if (url === "https://chat.example.com/api/v1/chats/") return Response.json({ unexpected: true });
    if (url === "https://chat.example.com/api/v1/chats") return Response.json({ chats: [{ chatId: "abc" }] });
    if (url === "https://chat.example.com/api/v1/chats/abc") return Response.json({ chatId: "abc", title: "Found" });
    return new Response("missing", { status: 404 });
  };

  const { discoverEndpoints } = await importFreshApi();
  const endpoints = await discoverEndpoints(true);
  assert.equal(endpoints.list, "/api/v1/chats");
  assert.equal(endpoints.detail, "/api/v1/chats/{id}");
  assert.equal(endpoints.diagnostics[0].status, "rejected");
  assert.equal(endpoints.diagnostics[0].shape, "unknown");
});

test("discoverEndpoints fails when every list candidate has an unknown shape", async () => {
  const storage = installChromeStorage();
  globalThis.fetch = async (url) => {
    if (url === "https://chat.example.com/api/v1/chats/") return Response.json({ unexpected: true });
    return new Response("missing", { status: 404 });
  };

  const { discoverEndpoints } = await importFreshApi();
  await assert.rejects(() => discoverEndpoints(true), /Could not discover list endpoint/);
  assert.equal(storage.settings.discoveredEndpoints, undefined);
});
