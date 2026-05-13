import test from "node:test";
import assert from "node:assert/strict";
import { includesAllTerms, snippet } from "../src/search.js";

test("includesAllTerms returns true only when every term exists", () => {
  const haystack = "canchat local archive browser extension";
  assert.equal(includesAllTerms(haystack, ["canchat", "archive"]), true);
  assert.equal(includesAllTerms(haystack, ["canchat", "missing"]), false);
});

test("snippet normalizes whitespace and anchors near first match", () => {
  const text = "line one\n\nline two with canchat term and more content";
  const result = snippet(text, ["canchat"]);
  assert.match(result, /line one line two with canchat term/);
  assert.ok(!result.includes("\n"));
});
