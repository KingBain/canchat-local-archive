import { getChatsByOrigin } from "./db.js";

function toMarkdown(chat) {
  const lines = [`# ${chat.title || "Untitled"}`, "", `- Chat ID: ${chat.id}`, `- Updated: ${chat.updatedAt || ""}`, ""];
  const messages = chat?.detail?.messages || chat?.messages || [];
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
