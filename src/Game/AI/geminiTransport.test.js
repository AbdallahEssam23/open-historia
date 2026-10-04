// Run: node --test src/Game/AI/geminiTransport.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { getGeminiStreamUrl, getGeminiUrl, geminiHeaders } from "./geminiTransport.js";

test("the generate URL carries no key and no query at all", () => {
  const url = getGeminiUrl("gemini-3.5-flash");
  assert.equal(
    url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
  );
  assert.ok(!url.includes("?"), "the generate URL has no query string");
  assert.ok(!url.includes("key"), "the generate URL never contains the word key");
});

test("the stream URL's only query is alt=sse, never the key", () => {
  const url = getGeminiStreamUrl("gemini-3.5-flash");
  assert.equal(
    url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse",
  );
  assert.ok(url.endsWith("?alt=sse"), "the stream query is exactly alt=sse");
  assert.ok(!/key/i.test(url), "the stream URL never contains the key");
});

test("the model is URL-escaped like the old builder did", () => {
  assert.ok(getGeminiUrl("a/b").includes("a%2Fb"));
});

test("the headers carry the key in x-goog-api-key and JSON content type", () => {
  assert.deepEqual(geminiHeaders("  SECRET  "), {
    "Content-Type": "application/json",
    "x-goog-api-key": "SECRET",
  });
});

test("a missing key becomes an empty header, never the text undefined", () => {
  assert.equal(geminiHeaders(undefined)["x-goog-api-key"], "");
});
