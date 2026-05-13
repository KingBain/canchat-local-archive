const SETTINGS_KEY = "settings";

const DEFAULT_SETTINGS = {
  enabled: true,
  baseUrl: "",
  discoveredEndpoints: null,
  lastSyncAt: null,
  locale: "en",
  customLocales: {},
};

export function normalizeBaseUrl(input) {
  if (!input || typeof input !== "string") {
    throw new Error("Base URL is required.");
  }

  const trimmed = input.trim();
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Base URL is not a valid URL.");
  }

  const isLocalhost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";

  if (url.protocol !== "https:" && !(isLocalhost && url.protocol === "http:")) {
    throw new Error(
      "Base URL must use HTTPS (HTTP allowed for localhost only).",
    );
  }

  return `${url.protocol}//${url.host}`;
}

export function originFromBaseUrl(baseUrl) {
  return new URL(normalizeBaseUrl(baseUrl)).origin;
}

export async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
}

export async function updateSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function requestOriginPermission(baseUrl) {
  const origin = originFromBaseUrl(baseUrl);
  const permission = { origins: [`${origin}/*`] };
  const hasPermission = await chrome.permissions.contains(permission);
  if (hasPermission) return true;
  return chrome.permissions.request(permission);
}

export async function ensureConfiguredOriginPermission() {
  const settings = await getSettings();
  if (!settings.baseUrl) {
    return { ok: false, reason: "No base URL configured." };
  }
  const granted = await requestOriginPermission(settings.baseUrl);
  return granted
    ? { ok: true, origin: originFromBaseUrl(settings.baseUrl) }
    : { ok: false, reason: "Host permission denied." };
}
