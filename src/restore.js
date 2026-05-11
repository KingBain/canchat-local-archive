import { createChat } from "./api.js";
import { getChatsByOrigin, originIdKey, putRestoreMapping, withStore } from "./db.js";

export function remoteIdFromCreateResponse(created) {
  return created?.id || created?.chatId || created?.chat?.id || null;
}

export function buildRestorePayload(chat) {
  const oldDetail = chat.detail || {};
  const sourceChat = oldDetail?.chat && typeof oldDetail.chat === "object" ? oldDetail.chat : oldDetail;
  const normalizedChat = {
    ...sourceChat,
    messages: Array.isArray(sourceChat?.messages) ? sourceChat.messages : [],
    history: (sourceChat?.history && typeof sourceChat.history === "object" && !Array.isArray(sourceChat.history))
      ? sourceChat.history
      : { messages: {}, currentId: null },
    models: Array.isArray(sourceChat?.models) ? sourceChat.models : [],
  };

  return {
    chat: {
      ...normalizedChat,
      id: "",
      title: chat.title || normalizedChat.title || "Untitled",
      timestamp: Date.now(),
    },
  };
}

export async function restoreChat(origin, chat, deps = {}) {
  const apiCreateChat = deps.createChat || createChat;
  const writeStore = deps.withStore || withStore;
  const writeMapping = deps.putRestoreMapping || putRestoreMapping;
  const oldDetail = chat.detail || {};
  const payload = buildRestorePayload(chat);
  const created = await apiCreateChat(payload);
  const remoteId = remoteIdFromCreateResponse(created);
  if (!remoteId) {
    throw new Error("Restore succeeded, but the server did not return a new chat ID.");
  }

  const restoredAt = new Date().toISOString();
  await writeMapping({
    localId: chat.id,
    remoteId: String(remoteId),
    origin,
    restoredAt,
  });

  const sourceChat = payload.chat;
  const newChatRecord = {
    ...chat,
    id: String(remoteId),
    origin,
    title: sourceChat.title,
    updatedAt: restoredAt,
    restored: true,
    localOnly: false,
    remotePresent: true,
    detail: { ...oldDetail, chat: { ...sourceChat, id: String(remoteId) } },
  };

  await writeStore("chats", "readwrite", (store) => {
    store.delete(originIdKey(origin, chat.id));
    store.put(newChatRecord);
  });

  await writeStore("search_docs", "readwrite", (store) => {
    store.delete(originIdKey(origin, chat.id));
    store.put({
      id: String(remoteId),
      origin,
      titleLower: newChatRecord.title.toLowerCase(),
      contentLower: JSON.stringify(newChatRecord.detail).toLowerCase(),
    });
  });

  return { localId: String(chat.id), remoteId: String(remoteId), restoredAt };
}

export async function restoreAll(origin) {
  const chats = await getChatsByOrigin(origin);
  const results = [];

  for (const chat of chats) {
    if (chat.remotePresent) continue;
    try {
      const restored = await restoreChat(origin, chat);
      results.push({ id: chat.id, restored: true, mode: "full", remoteId: restored.remoteId });
    } catch (error) {
      results.push({ id: chat.id, restored: false, mode: "archive-fallback", error: error.message });
    }
  }

  return results;
}
