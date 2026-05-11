import { getSettings, normalizeBaseUrl, updateSettings } from "./settings.js";

const CANDIDATES = {
  list: [
    "/api/v1/chats/",     // Added trailing slash (Matches your findings)
    "/api/v1/chats",
    "/api/chats",
    "/api/conversations",
    "/chats",
  ],
  detail: [
    "/api/v1/chats/{id}", // Matches your findings
    "/api/chats/{id}", 
    "/api/conversations/{id}", 
    "/chats/{id}"
  ],
  create: [
    "/api/v1/chats/new",
    "/api/v1/chats/",
    "/api/v1/chats", 
    "/api/chats", 
    "/api/conversations", 
    "/chats"
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
  if (status === 401) return `Unauthorized (401) while calling ${path}. Please sign in on CANChat.`;
  if (status === 403) return `Forbidden (403) while calling ${path}. Verify host permissions and account access.`;
  if (status === 404) return `Endpoint not found (404): ${path}.`;
  return `Request failed (${status}) for ${path}: ${text || "No response body"}`;
}

export async function authFetch(baseUrl, path, init = {}) {
  const normalized = normalizeBaseUrl(baseUrl);
  const method = init.method || "GET";
  const url = `${normalized}${path}`;
  debugLog("HTTP request", { method, path, url });
  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    debugLog("HTTP response error", { method, path, status: res.status, statusText: res.statusText, body: text || null });
    throw new Error(formatError(res.status, path, text));
  }

  debugLog("HTTP response success", { method, path, status: res.status, statusText: res.statusText });
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
    throw new Error(`${context} returned non-JSON response: ${snippet || "[empty response]"}`);
  }
}

function extractFirstListItem(body) {
  const items = Array.isArray(body)
    ? body
    : body?.items || body?.chats || body?.conversations || body?.data || body?.results || [];
  return Array.isArray(items) ? items.find(Boolean) : null;
}

function idFromChatLike(item) {
  return item?.id || item?.chatId || item?.conversationId || null;
}

function candidateScore(listPath, candidatePath) {
  if (listPath.startsWith("/api/v1/") && candidatePath.startsWith("/api/v1/")) return 0;
  if (listPath.startsWith("/api/") && candidatePath.startsWith("/api/") && !candidatePath.startsWith("/api/v1/")) return 1;
  if (!listPath.startsWith("/api/") && !candidatePath.startsWith("/api/")) return 2;
  return 3;
}

function sortCandidatesForList(listPath, candidates) {
  return [...candidates].sort((a, b) => candidateScore(listPath, a) - candidateScore(listPath, b));
}

function chooseCreateCandidate(listPath) {
  return sortCandidatesForList(listPath, CANDIDATES.create)[0];
}

async function discoverDetailCandidate(baseUrl, listPath, sampleId, diagnostics) {
  const candidates = sortCandidatesForList(listPath, CANDIDATES.detail);
  if (!sampleId) {
    diagnostics.push({ type: "detail", status: "skipped", reason: "No sample chat ID available; using closest route candidate." });
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
      diagnostics.push({ type: "detail", path: template, status: "rejected", reason: "Response did not look like a chat detail." });
    } catch (error) {
      diagnostics.push({ type: "detail", path: template, status: "error", reason: error?.message || String(error) });
    }
  }

  diagnostics.push({ type: "detail", status: "fallback", reason: "No detail candidate validated; using closest route candidate." });
  return candidates[0];
}

export async function discoverEndpoints(force = false) {
  const settings = await getSettings();
  if (!settings.baseUrl) throw new Error("No base URL configured.");
  if (!force && settings.discoveredEndpoints) return settings.discoveredEndpoints;

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

      // If the endpoint responds successfully but with an unknown JSON shape,
      // treat it as discovered to support fork-specific response contracts.
      discovered.list = path;
      listBody = body;
      diagnostics.push({
        type: "list",
        path,
        status: "ok",
        shape: "unknown",
        keys: body && typeof body === "object" ? Object.keys(body) : null,
      });
      debugLog("List endpoint accepted with unknown response shape", {
        path,
        keys: body && typeof body === "object" ? Object.keys(body) : null,
      });
      break;
    } catch (error) {
      diagnostics.push({ type: "list", path, status: "error", reason: error?.message || String(error) });
      debugLog("List candidate failed", { path, error: error?.message || String(error) });
    }
  }

  if (!discovered.list) {
    debugLog("Endpoint discovery failed", { candidates: CANDIDATES.list });
    throw new Error("Could not discover list endpoint from known candidates.");
  }

  const sampleId = idFromChatLike(extractFirstListItem(listBody));
  discovered.detail = await discoverDetailCandidate(settings.baseUrl, discovered.list, sampleId, diagnostics);
  discovered.create = chooseCreateCandidate(discovered.list);
  discovered.diagnostics = diagnostics;

  debugLog("Endpoint discovery complete", discovered);
  await updateSettings({ discoveredEndpoints: discovered });
  return discovered;
}

function normalizeList(body) {
  const items = Array.isArray(body)
    ? body
    : body.items || body.chats || body.conversations || body.data || body.results || [];
  if (!Array.isArray(items)) throw new Error("List response shape mismatch: expected an array of chats.");
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
  const createPath = endpoints.create || chooseCreateCandidate(endpoints.list || "/api/v1/chats/");
  const res = await authFetch(settings.baseUrl, createPath, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(res, `Create endpoint ${createPath}`);
}
