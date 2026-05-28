import { getSettings, normalizeBaseUrl, updateSettings } from "./settings.js";
import { idFromChatLike } from "./chatIds.js";

const JWT_EXPIRY_SKEW_MS = 60 * 1000;

function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  if (typeof atob === "function") return atob(padded);
  return Buffer.from(padded, "base64").toString("utf8");
}

function parseJwtPayload(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }
}

function jwtExpiryMs(token) {
  const payload = parseJwtPayload(token);
  return typeof payload?.exp === "number" ? payload.exp * 1000 : null;
}

function isJwtUsable(token, now = Date.now()) {
  const expiresAt = jwtExpiryMs(token);
  return Boolean(expiresAt && expiresAt > now + JWT_EXPIRY_SKEW_MS);
}

function tokenFromAuthorizationHeader(value) {
  if (!value || typeof value !== "string") return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function collectJwtTokensFromPage() {
  const jwtPattern = /eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g;

  function decodePayload(token) {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    try {
      const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(
        normalized.length + ((4 - (normalized.length % 4)) % 4),
        "=",
      );
      return JSON.parse(atob(padded));
    } catch {
      return null;
    }
  }

  function pushMatches(candidates, source, key, value) {
    if (typeof value !== "string") return;
    for (const match of value.matchAll(jwtPattern)) {
      const token = match[0];
      const payload = decodePayload(token);
      if (typeof payload?.exp !== "number") continue;
      candidates.push({ token, exp: payload.exp, source, key });
    }
  }

  function scanStorage(storage, source) {
    const candidates = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      pushMatches(candidates, source, key, storage.getItem(key));
    }
    return candidates;
  }

  const candidates = [
    ...scanStorage(window.localStorage, "localStorage"),
    ...scanStorage(window.sessionStorage, "sessionStorage"),
  ];
  pushMatches(candidates, "cookie", "document.cookie", document.cookie);
  return candidates;
}

async function readLatestPageJwt(baseUrl) {
  if (
    typeof chrome === "undefined" ||
    !chrome.tabs?.query ||
    !chrome.scripting?.executeScript
  )
    return null;

  const origin = new URL(normalizeBaseUrl(baseUrl)).origin;
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  if (!tabs.length) return null;

  const rankedTabs = [...tabs].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return (b.lastAccessed || 0) - (a.lastAccessed || 0);
  });

  for (const tab of rankedTabs) {
    if (!tab.id) continue;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: collectJwtTokensFromPage,
        world: "MAIN",
      });
      const candidates = results.flatMap((entry) => entry.result || []);
      if (!candidates.length) continue;

      candidates.sort((a, b) => b.exp - a.exp);
      return candidates[0];
    } catch (error) {
      debugLog("Could not inspect tab for JWT token", {
        tabId: tab.id,
        error: error?.message || String(error),
      });
    }
  }

  return null;
}

async function getStoredToken(baseUrl) {
  const settings = await getSettings();
  const origin = new URL(normalizeBaseUrl(baseUrl)).origin;
  return settings.authTokens?.[origin] || null;
}

async function saveStoredToken(baseUrl, candidate) {
  const settings = await getSettings();
  const origin = new URL(normalizeBaseUrl(baseUrl)).origin;
  await updateSettings({
    authTokens: {
      ...(settings.authTokens || {}),
      [origin]: {
        token: candidate.token,
        exp: candidate.exp,
        source: candidate.source,
        key: candidate.key,
        refreshedAt: new Date().toISOString(),
      },
    },
  });
}

async function removeStoredToken(baseUrl) {
  const settings = await getSettings();
  const origin = new URL(normalizeBaseUrl(baseUrl)).origin;
  const authTokens = { ...(settings.authTokens || {}) };
  delete authTokens[origin];
  await updateSettings({ authTokens });
}

async function getValidJwtToken(baseUrl, forceRefresh = false) {
  const stored = await getStoredToken(baseUrl);
  if (!forceRefresh && isJwtUsable(stored?.token)) return stored.token;

  const latest = await readLatestPageJwt(baseUrl);
  if (latest?.token && isJwtUsable(latest.token)) {
    await saveStoredToken(baseUrl, latest);
    debugLog("Refreshed JWT token from page", {
      source: latest.source,
      key: latest.key,
      expiresAt: new Date(latest.exp * 1000).toISOString(),
    });
    return latest.token;
  }

  if (!forceRefresh && stored?.token && !jwtExpiryMs(stored.token)) {
    return stored.token;
  }

  if (stored?.token && jwtExpiryMs(stored.token)) {
    await removeStoredToken(baseUrl);
    debugLog("Removed expired JWT token from extension storage");
  }

  return null;
}

async function buildAuthHeaders(baseUrl, initHeaders, forceRefresh = false) {
  const headers = new Headers(initHeaders || {});
  if (!headers.has("content-type"))
    headers.set("content-type", "application/json");

  const suppliedToken = tokenFromAuthorizationHeader(
    headers.get("authorization"),
  );
  if (suppliedToken && isJwtUsable(suppliedToken) && !forceRefresh) {
    return { headers, token: suppliedToken };
  }

  const token = await getValidJwtToken(baseUrl, forceRefresh);
  if (token) headers.set("authorization", `Bearer ${token}`);
  else if (suppliedToken && jwtExpiryMs(suppliedToken))
    headers.delete("authorization");

  return { headers, token };
}

const CANDIDATES = {
  list: [
    "/api/v1/chats/", // Added trailing slash (Matches your findings)
    "/api/v1/chats",
    "/api/chats",
    "/api/conversations",
    "/chats",
  ],
  detail: [
    "/api/v1/chats/{id}", // Matches your findings
    "/api/chats/{id}",
    "/api/conversations/{id}",
    "/chats/{id}",
  ],
  create: [
    "/api/v1/chats/new",
    "/api/v1/chats/",
    "/api/v1/chats",
    "/api/chats",
    "/api/conversations",
    "/chats",
  ],
};

function debugLog(message, meta) {
  if (meta === undefined) {
    console.info(`[CANChat Archive] ${message}`);
    return;
  }
  console.info(`[CANChat Archive] ${message}`, meta);
}

function formatError(status, path, text) {
  if (status === 401)
    return `Unauthorized (401) while calling ${path}. Please sign in on CANChat.`;
  if (status === 403)
    return `Forbidden (403) while calling ${path}. Verify host permissions and account access.`;
  if (status === 404) return `Endpoint not found (404): ${path}.`;
  return `Request failed (${status}) for ${path}: ${text || "No response body"}`;
}

export async function authFetch(baseUrl, path, init = {}) {
  const normalized = normalizeBaseUrl(baseUrl);
  const method = init.method || "GET";
  const url = `${normalized}${path}`;

  async function makeRequest(forceRefresh = false) {
    const { headers, token } = await buildAuthHeaders(
      baseUrl,
      init.headers,
      forceRefresh,
    );
    debugLog("HTTP request", {
      method,
      path,
      url,
      tokenRefreshed: forceRefresh,
      hasBearerToken: Boolean(token),
    });
    const res = await fetch(url, {
      ...init,
      credentials: "include",
      headers,
    });
    return { res, token };
  }

  let { res, token } = await makeRequest(false);
  if (res.status === 401) {
    const retry = await makeRequest(true);
    if (retry.token && retry.token !== token) {
      res = retry.res;
      token = retry.token;
    } else {
      retry.res.body?.cancel?.();
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    debugLog("HTTP response error", {
      method,
      path,
      status: res.status,
      statusText: res.statusText,
      body: text || null,
      hasBearerToken: Boolean(token),
    });
    throw new Error(formatError(res.status, path, text));
  }

  debugLog("HTTP response success", {
    method,
    path,
    status: res.status,
    statusText: res.statusText,
    hasBearerToken: Boolean(token),
  });
  return res;
}

function looksLikeList(body) {
  if (Array.isArray(body)) return true;
  return (
    Array.isArray(body?.items) ||
    Array.isArray(body?.chats) ||
    Array.isArray(body?.conversations) ||
    Array.isArray(body?.data) ||
    Array.isArray(body?.results)
  );
}

function looksLikeDetail(body) {
  return Boolean(body && (body.id || body.chatId || body.conversationId));
}

async function parseJsonResponse(res, context) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.slice(0, 120).replace(/\s+/g, " ");
    throw new Error(
      `${context} returned non-JSON response: ${snippet || "[empty response]"}`,
    );
  }
}

function extractFirstListItem(body) {
  const items = Array.isArray(body)
    ? body
    : body?.items ||
      body?.chats ||
      body?.conversations ||
      body?.data ||
      body?.results ||
      [];
  return Array.isArray(items) ? items.find(Boolean) : null;
}

function candidateScore(listPath, candidatePath) {
  if (listPath.startsWith("/api/v1/") && candidatePath.startsWith("/api/v1/"))
    return 0;
  if (
    listPath.startsWith("/api/") &&
    candidatePath.startsWith("/api/") &&
    !candidatePath.startsWith("/api/v1/")
  )
    return 1;
  if (!listPath.startsWith("/api/") && !candidatePath.startsWith("/api/"))
    return 2;
  return 3;
}

function sortCandidatesForList(listPath, candidates) {
  return [...candidates].sort(
    (a, b) => candidateScore(listPath, a) - candidateScore(listPath, b),
  );
}

function chooseCreateCandidate(listPath) {
  return sortCandidatesForList(listPath, CANDIDATES.create)[0];
}

async function discoverDetailCandidate(
  baseUrl,
  listPath,
  sampleId,
  diagnostics,
) {
  const candidates = sortCandidatesForList(listPath, CANDIDATES.detail);
  if (!sampleId) {
    diagnostics.push({
      type: "detail",
      status: "skipped",
      reason: "No sample chat ID available; using closest route candidate.",
    });
    return candidates[0];
  }

  for (const template of candidates) {
    const path = template.replace("{id}", encodeURIComponent(sampleId));
    try {
      const res = await authFetch(baseUrl, path);
      const body = await parseJsonResponse(res, `Detail endpoint ${path}`);
      if (looksLikeDetail(body)) {
        diagnostics.push({ type: "detail", path: template, status: "ok" });
        return template;
      }
      diagnostics.push({
        type: "detail",
        path: template,
        status: "rejected",
        reason: "Response did not look like a chat detail.",
      });
    } catch (error) {
      diagnostics.push({
        type: "detail",
        path: template,
        status: "error",
        reason: error?.message || String(error),
      });
    }
  }

  diagnostics.push({
    type: "detail",
    status: "fallback",
    reason: "No detail candidate validated; using closest route candidate.",
  });
  return candidates[0];
}

export async function discoverEndpoints(force = false) {
  const settings = await getSettings();
  if (!settings.baseUrl) throw new Error("No base URL configured.");
  if (!force && settings.discoveredEndpoints)
    return settings.discoveredEndpoints;

  const discovered = {};
  const diagnostics = [];
  let listBody = null;

  debugLog("Starting endpoint discovery", { candidates: CANDIDATES.list });

  for (const path of CANDIDATES.list) {
    try {
      debugLog("Trying list endpoint candidate", { path });
      const res = await authFetch(settings.baseUrl, path);
      const body = await parseJsonResponse(res, `List endpoint ${path}`);
      if (looksLikeList(body)) {
        discovered.list = path;
        listBody = body;
        diagnostics.push({ type: "list", path, status: "ok", shape: "known" });
        debugLog("List endpoint discovered", { path, parsedAsJson: true });
        break;
      }

      diagnostics.push({
        type: "list",
        path,
        status: "rejected",
        shape: "unknown",
        reason: "Response did not look like a chat list.",
        keys: body && typeof body === "object" ? Object.keys(body) : null,
      });
      debugLog("List endpoint rejected with unknown response shape", {
        path,
        keys: body && typeof body === "object" ? Object.keys(body) : null,
      });
    } catch (error) {
      diagnostics.push({
        type: "list",
        path,
        status: "error",
        reason: error?.message || String(error),
      });
      debugLog("List candidate failed", {
        path,
        error: error?.message || String(error),
      });
    }
  }

  if (!discovered.list) {
    debugLog("Endpoint discovery failed", { candidates: CANDIDATES.list });
    throw new Error("Could not discover list endpoint from known candidates.");
  }

  const sampleId = idFromChatLike(extractFirstListItem(listBody));
  discovered.detail = await discoverDetailCandidate(
    settings.baseUrl,
    discovered.list,
    sampleId,
    diagnostics,
  );
  discovered.create = chooseCreateCandidate(discovered.list);
  discovered.diagnostics = diagnostics;

  debugLog("Endpoint discovery complete", discovered);
  await updateSettings({ discoveredEndpoints: discovered });
  return discovered;
}

function normalizeList(body) {
  const items = Array.isArray(body)
    ? body
    : body.items ||
      body.chats ||
      body.conversations ||
      body.data ||
      body.results ||
      [];
  if (!Array.isArray(items))
    throw new Error(
      "List response shape mismatch: expected an array of chats.",
    );
  return items;
}

export async function fetchChatList() {
  const settings = await getSettings();
  const endpoints = await discoverEndpoints();
  const res = await authFetch(settings.baseUrl, endpoints.list);
  const body = await parseJsonResponse(res, `List endpoint ${endpoints.list}`);
  return normalizeList(body);
}

export async function fetchChatDetail(id) {
  const settings = await getSettings();
  const endpoints = await discoverEndpoints();
  const path = endpoints.detail.replace("{id}", encodeURIComponent(id));
  const res = await authFetch(settings.baseUrl, path);
  const body = await parseJsonResponse(res, `Detail endpoint ${path}`);
  if (!looksLikeDetail(body)) {
    throw new Error(`Detail response shape mismatch for chat ${id}.`);
  }
  return body;
}

export async function createChat(payload) {
  const settings = await getSettings();
  const endpoints = await discoverEndpoints();
  const createPath =
    endpoints.create ||
    chooseCreateCandidate(endpoints.list || "/api/v1/chats/");
  const res = await authFetch(settings.baseUrl, createPath, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(res, `Create endpoint ${createPath}`);
}
