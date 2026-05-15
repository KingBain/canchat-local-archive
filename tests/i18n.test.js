import test from "node:test";
import assert from "node:assert/strict";

function installEnv({ settings = {}, fetchMap = {} } = {}) {
  const storage = { settings };
  globalThis.chrome = {
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
    },
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

  globalThis.fetch = async (url) => {
    const key = url.replace("chrome-extension://test/", "");
    const value = fetchMap[key];
    if (value instanceof Error) throw value;
    if (value === undefined) return new Response("missing", { status: 404 });
    return Response.json(value);
  };
  return storage;
}

async function importFreshI18n() {
  return import(`../src/i18n.js?test=${Date.now()}-${Math.random()}`);
}

test("getI18nContext loads locale from custom locales and interpolates vars", async () => {
  installEnv({
    settings: {
      locale: "pirate",
      customLocales: {
        pirate: { greeting: "Ahoy {name}" },
      },
    },
  });
  const { getI18nContext } = await importFreshI18n();
  const ctx = await getI18nContext();
  assert.equal(ctx.locale, "pirate");
  assert.equal(ctx.t("greeting", { name: "Sam" }), "Ahoy Sam");
  assert.ok(ctx.locales.includes("en"));
  assert.ok(ctx.locales.includes("fr"));
  assert.ok(ctx.locales.includes("pirate"));
});

test("getI18nContext falls back to English file when selected locale fails", async () => {
  installEnv({
    settings: { locale: "de", customLocales: {} },
    fetchMap: {
      "locales/en.json": { app: { title: "CANChat" }, greeting: "Hello {name}" },
    },
  });
  const { getI18nContext } = await importFreshI18n();
  const ctx = await getI18nContext();
  assert.equal(ctx.t("greeting", { name: "Taylor" }), "Hello Taylor");
  assert.equal(ctx.t("missing.key"), "missing.key");
  assert.equal(ctx.t("app.title"), "CANChat");
});

test("setLocale and saveCustomLocale update settings storage", async () => {
  const storage = installEnv({ settings: { locale: "en", customLocales: {} } });
  const { setLocale, saveCustomLocale } = await importFreshI18n();

  await setLocale("fr");
  assert.equal(storage.settings.locale, "fr");

  await saveCustomLocale("es", { hello: "Hola" });
  assert.deepEqual(storage.settings.customLocales.es, { hello: "Hola" });
});
