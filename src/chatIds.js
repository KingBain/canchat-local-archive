export function idFromChatLike(item) {
  return item?.id || item?.chatId || item?.conversationId || null;
}

export function stringIdFromChatLike(item) {
  const id = idFromChatLike(item);
  return id == null ? null : String(id);
}
