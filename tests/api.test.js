import test from "node:test";
import assert from "node:assert/strict";

function installChromeStorage(initialSettings = {}) {
  const storage = {
    settings: {
      enabled: true,
      baseUrl: "https://chat.example.com",
      ...initialSettings,
    },
  };
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
    if (url === "https://chat.example.com/api/v1/chats/")
      return new Response("missing", { status: 404 });
    if (url === "https://chat.example.com/api/v1/chats")
      return Response.json([{ id: "abc", title: "Found" }]);
    if (url === "https://chat.example.com/api/v1/chats/abc")
      return Response.json({ id: "abc", title: "Found" });
    if (url === "https://chat.example.com/api/v1/chats/new")
      return Response.json({ id: "new-id" });
    return new Response("missing", { status: 404 });
  };

  const { createChat, discoverEndpoints } = await importFreshApi();
  const endpoints = await discoverEndpoints(true);
  assert.equal(endpoints.list, "/api/v1/chats");
  assert.equal(endpoints.detail, "/api/v1/chats/{id}");
  assert.equal(endpoints.create, "/api/v1/chats/new");
  assert.equal(
    storage.settings.discoveredEndpoints.create,
    "/api/v1/chats/new",
  );

  const created = await createChat({ chat: { title: "Restored" } });
  assert.deepEqual(created, { id: "new-id" });
  assert.equal(calls.at(-1).url, "https://chat.example.com/api/v1/chats/new");
  assert.equal(calls.at(-1).method, "POST");
});

test("discoverEndpoints records failed non-JSON candidates and continues", async () => {
  installChromeStorage();
  globalThis.fetch = async (url) => {
    if (url === "https://chat.example.com/api/v1/chats/") {
      return new Response("<html>not json</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (url === "https://chat.example.com/api/v1/chats")
      return Response.json({ data: [] });
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
    if (url === "https://chat.example.com/api/v1/chats/")
      return Response.json({ unexpected: true });
    if (url === "https://chat.example.com/api/v1/chats")
      return Response.json({ chats: [{ chatId: "abc" }] });
    if (url === "https://chat.example.com/api/v1/chats/abc")
      return Response.json({ chatId: "abc", title: "Found" });
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
    if (url === "https://chat.example.com/api/v1/chats/")
      return Response.json({ unexpected: true });
    return new Response("missing", { status: 404 });
  };

  const { discoverEndpoints } = await importFreshApi();
  await assert.rejects(
    () => discoverEndpoints(true),
    /Could not discover list endpoint/,
  );
  assert.equal(storage.settings.discoveredEndpoints, undefined);
});

function makeJwt(exp) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64url")
      .replace(/=+$/, "");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ exp })}.sig`;
}

test("authFetch refreshes an expired cached JWT from an open CANChat tab", async () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiredToken = makeJwt(nowSeconds - 60);
  const freshToken = makeJwt(nowSeconds + 3600);
  const storage = installChromeStorage({
    authTokens: {
      "https://chat.example.com": {
        token: expiredToken,
        exp: nowSeconds - 60,
      },
    },
  });
  globalThis.chrome.tabs = {
    async query() {
      return [{ id: 123, active: true, lastAccessed: Date.now() }];
    },
  };
  globalThis.chrome.scripting = {
    async executeScript() {
      return [
        {
          result: [
            {
              token: freshToken,
              exp: nowSeconds + 3600,
              source: "localStorage",
              key: "authToken",
            },
          ],
        },
      ];
    },
  };

  let authorization;
  globalThis.fetch = async (_url, init = {}) => {
    authorization = new Headers(init.headers).get("authorization");
    return Response.json({ ok: true });
  };

  const { authFetch } = await importFreshApi();
  await authFetch("https://chat.example.com", "/api/v1/chats");

  assert.equal(authorization, `Bearer ${freshToken}`);
  assert.equal(
    storage.settings.authTokens["https://chat.example.com"].token,
    freshToken,
  );
});

test("authFetch retries once with a refreshed JWT after a 401", async () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const oldToken = makeJwt(nowSeconds + 3600);
  const freshToken = makeJwt(nowSeconds + 7200);
  installChromeStorage({
    authTokens: {
      "https://chat.example.com": {
        token: oldToken,
        exp: nowSeconds + 3600,
      },
    },
  });
  globalThis.chrome.tabs = {
    async query() {
      return [{ id: 123, active: true, lastAccessed: Date.now() }];
    },
  };
  globalThis.chrome.scripting = {
    async executeScript() {
      return [
        {
          result: [
            {
              token: freshToken,
              exp: nowSeconds + 7200,
              source: "sessionStorage",
              key: "authToken",
            },
          ],
        },
      ];
    },
  };

  const authorizations = [];
  globalThis.fetch = async (_url, init = {}) => {
    authorizations.push(new Headers(init.headers).get("authorization"));
    if (authorizations.length === 1)
      return new Response("expired", { status: 401 });
    return Response.json({ ok: true });
  };

  const { authFetch } = await importFreshApi();
  const response = await authFetch("https://chat.example.com", "/api/v1/chats");

  assert.equal(response.status, 200);
  assert.deepEqual(authorizations, [
    `Bearer ${oldToken}`,
    `Bearer ${freshToken}`,
  ]);
});
