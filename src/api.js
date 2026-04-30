import { getSettings, normalizeBaseUrl, updateSettings } from "./settings.js";

const CANDIDATES = {
  list: ["/api/v1/chats", "/api/chats", "/api/conversations", "/chats"],
  detail: ["/api/v1/chats/{id}", "/api/chats/{id}", "/api/conversations/{id}", "/chats/{id}"],
  create: ["/api/v1/chats", "/api/chats", "/api/conversations", "/chats"],
};

function formatError(status, path, text) {
  if (status === 401) return `Unauthorized (401) while calling ${path}. Please sign in on CANChat.`;
  if (status === 403) return `Forbidden (403) while calling ${path}. Verify host permissions and account access.`;
  if (status === 404) return `Endpoint not found (404): ${path}.`;
  return `Request failed (${status}) for ${path}: ${text || "No response body"}`;
}

export async function authFetch(baseUrl, path, init = {}) {
  const normalized = normalizeBaseUrl(baseUrl);
  const res = await fetch(`${normalized}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(formatError(res.status, path, text));
  }

  return res;
}

function looksLikeList(body) {
  if (Array.isArray(body)) return true;
  return Array.isArray(body?.items) || Array.isArray(body?.chats) || Array.isArray(body?.conversations);
}

function looksLikeDetail(body) {
  return Boolean(body && (body.id || body.chatId || body.conversationId));
}

export async function discoverEndpoints(force = false) {
  const settings = await getSettings();
  if (!settings.baseUrl) throw new Error("No base URL configured.");
  if (!force && settings.discoveredEndpoints) return settings.discoveredEndpoints;

  const discovered = {};

  for (const path of CANDIDATES.list) {
    try {
      const res = await authFetch(settings.baseUrl, path);
      const body = await res.json();
      if (looksLikeList(body)) {
        discovered.list = path;
        break;
      }
    } catch {}
  }

  if (!discovered.list) {
    throw new Error("Could not discover list endpoint from known candidates.");
  }

  const detailTemplate = CANDIDATES.detail.find((p) => p.includes("{id}"));
  discovered.detail = detailTemplate;
  discovered.create = CANDIDATES.create[0];

  await updateSettings({ discoveredEndpoints: discovered });
  return discovered;
}

function normalizeList(body) {
  const items = Array.isArray(body)
    ? body
    : body.items || body.chats || body.conversations || [];
  if (!Array.isArray(items)) throw new Error("List response shape mismatch: expected an array of chats.");
  return items;
}

export async function fetchChatList() {
  const settings = await getSettings();
  const endpoints = await discoverEndpoints();
  const res = await authFetch(settings.baseUrl, endpoints.list);
  const body = await res.json();
  return normalizeList(body);
}

export async function fetchChatDetail(id) {
  const settings = await getSettings();
  const endpoints = await discoverEndpoints();
  const path = endpoints.detail.replace("{id}", encodeURIComponent(id));
  const res = await authFetch(settings.baseUrl, path);
  const body = await res.json();
  if (!looksLikeDetail(body)) {
    throw new Error(`Detail response shape mismatch for chat ${id}.`);
  }
  return body;
}

export async function createChat(payload) {
  const settings = await getSettings();
  const endpoints = await discoverEndpoints();
  const res = await authFetch(settings.baseUrl, endpoints.create, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.json();
}
