import test from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  extractPlainText,
  generateSnippet,
} from "../src/chatText.js";

test("escapeHtml protects HTML inserted into templates", () => {
  assert.equal(
    escapeHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
  );
});

test("extractPlainText collects nested message content and deduplicates", () => {
  const text = extractPlainText({
    detail: {
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: [{ text: "Hi there" }] },
        { role: "user", content: "Hello" },
      ],
    },
  });

  assert.equal(text, "Hello ... Hi there");
});

test("generateSnippet centers around query and normalizes whitespace", () => {
  const snippet = generateSnippet("one\n\n two three four five", "three");
  assert.match(snippet, /one two three four five/);
});
