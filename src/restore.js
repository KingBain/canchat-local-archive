import { createChat } from "./api.js";
import { getChatsByOrigin, putChat, putRestoreMapping } from "./db.js";

export async function restoreAll(origin) {
  const chats = await getChatsByOrigin(origin);
  const results = [];

  for (const chat of chats) {
    if (chat.remotePresent) continue;
    try {
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

      const created = await createChat({
        chat: {
          ...normalizedChat,
          id: "",
          title: chat.title || normalizedChat.title || "Untitled",
          timestamp: Date.now(),
        },
      });
      await putRestoreMapping({
        localId: chat.id,
        remoteId: created?.id || created?.chatId || null,
        origin,
        restoredAt: new Date().toISOString(),
      });
      chat.restored = true;
      chat.localOnly = false;
      await putChat(chat);
      results.push({ id: chat.id, restored: true, mode: "full" });
    } catch (error) {
      results.push({ id: chat.id, restored: false, mode: "archive-fallback", error: error.message });
    }
  }

  return results;
}
