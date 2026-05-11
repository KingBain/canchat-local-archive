import { getChatsByOrigin } from "./db.js";

export function stringifyContent(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          if (typeof part.text === "string") return part.text;
          if (typeof part.content === "string") return part.content;
          if (typeof part.value === "string") return part.value;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.content === "string") return content.content;
    if (typeof content.value === "string") return content.value;
    return JSON.stringify(content, null, 2);
  }
  return String(content);
}

export function extractMessages(chat) {
  const containers = [chat?.detail, chat, chat?.detail?.chat].filter(Boolean);
  const seen = new Set();
  const messages = [];

  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const role = node.role || node.author || node.sender || node.type;
    const hasMessageContent = Object.prototype.hasOwnProperty.call(node, "content") || Object.prototype.hasOwnProperty.call(node, "text") || Object.prototype.hasOwnProperty.call(node, "parts");
    if (role && hasMessageContent) {
      const content = stringifyContent(node.content ?? node.text ?? node.parts);
      if (content) {
        messages.push({ role, content });
      }
    }

    for (const value of Object.values(node)) {
      visit(value);
    }
  };

  for (const c of containers) visit(c);

  const unique = [];
  const dedupe = new Set();
  for (const m of messages) {
    const key = `${m.role}::${m.content}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    unique.push(m);
  }
  return unique;
}

export function toMarkdown(chat) {
  const lines = [`# ${chat.title || "Untitled"}`, "", `- Chat ID: ${chat.id}`, `- Updated: ${chat.updatedAt || ""}`, ""];
  const messages = extractMessages(chat);
  for (const m of messages) {
    lines.push(`## ${m.role || "message"}`);
    lines.push("");
    lines.push(m.content || "");
    lines.push("");
  }
  return lines.join("\n");
}

export async function exportChatMarkdown(origin, chatId) {
  const chats = await getChatsByOrigin(origin);
  const chat = chats.find((c) => String(c.id) === String(chatId));
  if (!chat) throw new Error(`Chat not found: ${chatId}`);
  return toMarkdown(chat);
}

export async function exportAllChatsJson(origin) {
  const chats = await getChatsByOrigin(origin);
  return JSON.stringify({ origin, exportedAt: new Date().toISOString(), chats }, null, 2);
}
