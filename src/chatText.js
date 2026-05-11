export function escapeHtml(value) {
  return String(value || "").replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch])
  );
}

export function extractPlainText(chat) {
  const messages = [];
  const seen = new Set();

  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const role = node.role || node.author || node.sender || node.type;
    const content = node.content ?? node.text ?? node.parts;
    if (role && content != null) {
      const text = stringifyText(content).trim();
      if (text) messages.push(text);
    }

    for (const value of Object.values(node)) {
      visit(value);
    }
  }

  visit(chat?.detail || chat);
  return Array.from(new Set(messages)).join(" ... ");
}

export function generateSnippet(text, query = "") {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "No message content found.";

  const q = String(query || "").toLowerCase().trim();
  if (!q) return truncate(normalized, 180);

  const idx = normalized.toLowerCase().indexOf(q);
  if (idx === -1) return truncate(normalized, 180);

  const start = Math.max(0, idx - 40);
  const end = Math.min(normalized.length, idx + 140);
  return `${start > 0 ? "..." : ""}${normalized.slice(start, end).trim()}${end < normalized.length ? "..." : ""}`;
}

function stringifyText(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    return content.map(stringifyText).filter(Boolean).join("\n");
  }
  if (typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.content === "string") return content.content;
    if (typeof content.value === "string") return content.value;
    return "";
  }
  return String(content);
}

function truncate(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
