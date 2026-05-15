import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBaseUrl,
  originFromBaseUrl,
  getSettings,
  updateSettings,
  requestOriginPermission,
  ensureConfiguredOriginPermission,
} from "../src/settings.js";

function installChrome({ settings = {}, hasPermission = false, grant = true } = {}) {
  const store = { settings };
  const calls = { contains: [], request: [] };
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: store[key] };
        },
        async set(value) {
          Object.assign(store, value);
        },
      },
    },
    permissions: {
      async contains(permission) {
        calls.contains.push(permission);
        return hasPermission;
      },
      async request(permission) {
        calls.request.push(permission);
        return grant;
      },
    },
  };
  return { store, calls };
}

test("normalizeBaseUrl validates scheme and host", () => {
  assert.equal(normalizeBaseUrl(" https://chat.example.com/path?q=1 "), "https://chat.example.com");
  assert.equal(normalizeBaseUrl("http://localhost:3000/demo"), "http://localhost:3000");
  assert.throws(() => normalizeBaseUrl(""), /required/);
  assert.throws(() => normalizeBaseUrl("not-a-url"), /valid URL/);
  assert.throws(() => normalizeBaseUrl("http://chat.example.com"), /must use HTTPS/);
});

test("originFromBaseUrl normalizes to origin", () => {
  assert.equal(originFromBaseUrl("https://chat.example.com/foo"), "https://chat.example.com");
});

test("getSettings merges defaults and stored values", async () => {
  installChrome({ settings: { baseUrl: "https://chat.example.com", locale: "fr" } });
  const settings = await getSettings();
  assert.equal(settings.enabled, true);
  assert.equal(settings.baseUrl, "https://chat.example.com");
  assert.equal(settings.locale, "fr");
  assert.deepEqual(settings.customLocales, {});
});

test("updateSettings persists merged settings", async () => {
  const { store } = installChrome({ settings: { baseUrl: "https://chat.example.com" } });
  const updated = await updateSettings({ locale: "fr", enabled: false });
  assert.equal(updated.locale, "fr");
  assert.equal(updated.enabled, false);
  assert.equal(store.settings.baseUrl, "https://chat.example.com");
});

test("requestOriginPermission returns true when already granted", async () => {
  const { calls } = installChrome({ hasPermission: true });
  const ok = await requestOriginPermission("https://chat.example.com");
  assert.equal(ok, true);
  assert.equal(calls.request.length, 0);
  assert.deepEqual(calls.contains[0], { origins: ["https://chat.example.com/*"] });
});

test("requestOriginPermission requests permission when missing", async () => {
  const { calls } = installChrome({ hasPermission: false, grant: false });
  const ok = await requestOriginPermission("https://chat.example.com");
  assert.equal(ok, false);
  assert.equal(calls.request.length, 1);
});

test("ensureConfiguredOriginPermission handles missing and denied permissions", async () => {
  installChrome({ settings: { baseUrl: "" } });
  assert.deepEqual(await ensureConfiguredOriginPermission(), {
    ok: false,
    reason: "No base URL configured.",
  });

  installChrome({ settings: { baseUrl: "https://chat.example.com" }, hasPermission: false, grant: false });
  assert.deepEqual(await ensureConfiguredOriginPermission(), {
    ok: false,
    reason: "Host permission denied.",
  });
});

test("ensureConfiguredOriginPermission returns origin on success", async () => {
  installChrome({ settings: { baseUrl: "https://chat.example.com" }, hasPermission: true });
  assert.deepEqual(await ensureConfiguredOriginPermission(), {
    ok: true,
    origin: "https://chat.example.com",
  });
});
