import test from "node:test";
import assert from "node:assert/strict";
import {
  stringifyContent,
  extractMessages,
  toMarkdown,
} from "../src/export.js";

test("stringifyContent handles arrays and object fallbacks", () => {
  assert.equal(
    stringifyContent(["hello", { text: "world" }, { value: "!" }]),
    "hello\nworld\n!",
  );
  assert.equal(
    stringifyContent({ text: "assistant reply" }),
    "assistant reply",
  );
  assert.match(stringifyContent({ nested: true }), /"nested": true/);
});

test("extractMessages deduplicates by role/content across nested structures", () => {
  const chat = {
    detail: {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ text: "hello" }] },
      ],
    },
    extra: {
      duplicate: { role: "user", content: "hi" },
    },
  };

  const messages = extractMessages(chat);
  assert.deepEqual(messages, [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ]);
});

test("toMarkdown renders chat metadata and role sections", () => {
  const md = toMarkdown({
    id: "chat-1",
    title: "Sample Chat",
    updatedAt: "2026-05-11T00:00:00.000Z",
    detail: {
      tree: [
        { role: "user", text: "Question?" },
        { role: "assistant", content: "Answer." },
      ],
    },
  });

  assert.match(md, /^# Sample Chat/m);
  assert.match(md, /- Chat ID: chat-1/);
  assert.match(md, /## user\n\nQuestion\?/);
  assert.match(md, /## assistant\n\nAnswer\./);
});
