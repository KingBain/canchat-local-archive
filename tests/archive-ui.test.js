import test from "node:test";
import assert from "node:assert/strict";
import {
  applyRestoredArchiveChat,
  primaryArchiveAction,
} from "../ui/archive.js";

test("restored archive chats switch from restore to open without keeping stale local ids", () => {
  const chats = [
    {
      id: "local-1",
      title: "Archived chat",
      updatedAt: "2026-05-11T00:00:00.000Z",
      restored: false,
      localOnly: true,
      remotePresent: false,
      _plainText: "saved conversation",
    },
  ];

  assert.equal(primaryArchiveAction(chats[0]), "restore-open");

  const updated = applyRestoredArchiveChat(chats, chats[0], {
    localId: "local-1",
    remoteId: "remote-1",
    restoredAt: "2026-05-12T00:00:00.000Z",
  });

  assert.equal(chats.length, 1);
  assert.equal(chats[0], updated);
  assert.equal(chats[0].id, "remote-1");
  assert.equal(chats[0].remotePresent, true);
  assert.equal(chats[0].localOnly, false);
  assert.equal(chats[0].restored, true);
  assert.equal(primaryArchiveAction(chats[0]), "open");
});
