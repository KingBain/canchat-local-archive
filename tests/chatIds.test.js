import test from "node:test";
import assert from "node:assert/strict";

import { idFromChatLike, stringIdFromChatLike } from "../src/chatIds.js";

test("idFromChatLike supports known chat id shapes", () => {
  assert.equal(idFromChatLike({ id: "a" }), "a");
  assert.equal(idFromChatLike({ chatId: "b" }), "b");
  assert.equal(idFromChatLike({ conversationId: "c" }), "c");
  assert.equal(idFromChatLike({}), null);
  assert.equal(idFromChatLike(null), null);
});

test("stringIdFromChatLike normalizes numeric ids without treating missing ids as strings", () => {
  assert.equal(stringIdFromChatLike({ id: 123 }), "123");
  assert.equal(stringIdFromChatLike({ chatId: 456 }), "456");
  assert.equal(stringIdFromChatLike({ conversationId: 789 }), "789");
  assert.equal(stringIdFromChatLike({}), null);
});
