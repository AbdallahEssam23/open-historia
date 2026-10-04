# Gemini Headers and Implicit Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Gemini API key out of the query string and into the
`x-goog-api-key` header on every call, without touching the request body, so
Gemini's implicit prefix cache keeps paying.

**Architecture:** A new import-free module `src/Game/AI/geminiTransport.js`
owns the endpoint strings and the header shape. `callGemini` deletes its two
local URL builders, imports the three functions, and sends
`geminiHeaders(apiKey)` on both fetches. A source-text guard pins the key out of
`main.jsx`'s URLs for good.

**Tech Stack:** Node.js ESM, `node --test`, React/JSX (`main.jsx` is not
unit-testable, so its wiring is pinned by reading the source).

## Global Constraints

- Approved spec: `docs/specs/2026-10-04-gemini-headers-and-cache.md` (commit
  `252ba03`). Explicit caching (`cachedContents`) is OUT of scope, permanently.
- Only ASCII in every added line. No emoji, no em dash, no middle dot. The one
  exception is the `docs/ai-overview.md` table cell, which must keep the
  existing `hard‑coded` spelling intact; edit only the parenthetical.
- The request BODY does not change at all: same `system_instruction`,
  `contents`, `generationConfig`, `...customParams` order, tools and
  `toolConfig`. This is what keeps the implicit prefix cache valid.
- `src/Game/AI/geminiTransport.js` must be import-free (like
  `promptLayout.js`, `usageStats.js`, `providerErrors.js`), so it runs under
  `node --test` in a bare checkout.
- No new dependency. `package.json` and `ENGINE_VERSION` are untouched.
- Every commit is conventional and carries the trailer
  `Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>`. The
  `prepare-commit-msg` hook appends it: never pass it with `-m`.
- Tests run with globs, never a directory: `node --test "src/Game/AI/*.test.js"`.
- Do not weaken an existing test.

## Pre-flight findings

Checked against the working tree at `252ba03` before writing this plan.

1. **Baseline is green.** `npm test` on `252ba03` passes (see the controller's
   confirmation; the count is the slice-17 gate: 2994 tests, 2992 pass, 0 fail,
   2 todo).
2. **The key is in the URL in exactly one file.** `getGeminiUrl` and
   `getGeminiStreamUrl` are defined at `src/Game/AI/main.jsx:325-333` and used
   only inside `callGemini` at `:927` and `:988` (grep confirms no other
   importer). Removing them cannot break another call site.
3. **Both fetches are in `callGemini`.** The advisor SSE fetch at `:934-947`
   and the buffered/tool fetch at `:989-1021`, each with
   `headers: { "Content-Type": "application/json" }` (`:936`, `:991`). Exactly
   two sites to change, which is what the guard asserts.
4. **The docs claim is one line.** `docs/ai-overview.md:60` says
   "(hard‑coded, key in query)". Grep finds no other "key in query" claim.
5. **House guard pattern.** `src/Game/AI/peaceOfferWiringArchitecture.test.js`
   shows the convention for reading a non-importable source and asserting on
   it; the new guard follows it.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/Game/AI/geminiTransport.js` (create) | The Gemini endpoint strings and the request headers. |
| `src/Game/AI/geminiTransport.test.js` (create) | URL/header behavior and the `main.jsx` source guard. |
| `src/Game/AI/main.jsx` (modify) | Delete the local builders, import the module, send the header on both fetches. |
| `docs/ai-overview.md` (modify) | Correct the transport table's "key in query" claim. |

---

### Task 1: The Gemini transport module

**Files:**
- Create: `src/Game/AI/geminiTransport.js`
- Test: `src/Game/AI/geminiTransport.test.js`

**Interfaces:**
- Produces: `getGeminiUrl(model)` returns the `:generateContent` URL with no
  query; `getGeminiStreamUrl(model)` returns the `:streamGenerateContent?alt=sse`
  URL; `geminiHeaders(apiKey)` returns
  `{ "Content-Type": "application/json", "x-goog-api-key": <trimmed key> }`.

- [ ] **Step 1: Write the failing test**

Create `src/Game/AI/geminiTransport.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/Game/AI/geminiTransport.test.js"`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the module**

Create `src/Game/AI/geminiTransport.js`:

```js
/*! Open Historia - Gemini endpoint and request headers (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Import-free on purpose: runs under node --test without a build.
//
// The Gemini key used to ride in the query string
// (`...:generateContent?key=...`), which every proxy, CDN and access log
// records. Google's documented header for the same key is x-goog-api-key, which
// intermediaries do not log. This module is the single owner of the endpoint
// string and the header shape, so the key cannot drift back into a URL through
// a second copy.
//
// The request BODY is deliberately not built here: keeping it in callGemini is
// what keeps Gemini's implicit prefix cache intact, because the stable system
// instruction stays the leading content exactly as promptLayout.js arranged it.

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export const getGeminiUrl = (model) =>
  `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;

export const getGeminiStreamUrl = (model) =>
  `${GEMINI_API_BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

export const geminiHeaders = (apiKey) => ({
  "Content-Type": "application/json",
  "x-goog-api-key": String(apiKey ?? "").trim(),
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/Game/AI/geminiTransport.test.js"`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/Game/AI/geminiTransport.js src/Game/AI/geminiTransport.test.js
git commit -m "feat(ai): own the Gemini endpoint and headers in one module"
```

---

### Task 2: Rewire `callGemini` and pin the key out of URLs

**Files:**
- Modify: `src/Game/AI/main.jsx`
- Test: `src/Game/AI/geminiTransport.test.js` (add the source guard)

**Interfaces:**
- Consumes: `geminiHeaders`, `getGeminiStreamUrl`, `getGeminiUrl` from
  `./geminiTransport.js`.
- Produces: `main.jsx` contains no `?key=` and sends `geminiHeaders(apiKey)` on
  exactly its two Gemini fetches.

- [ ] **Step 1: Add the failing source guard**

Append to `src/Game/AI/geminiTransport.test.js`:

```js
import { readFileSync } from "node:fs";

// main.jsx reaches settings, fetch and the DOM, so it cannot be imported by
// node --test; its wiring is pinned by reading the source (the house pattern,
// see peaceOfferWiringArchitecture.test.js).
test("main.jsx sends the key through the headers helper, never a URL", () => {
  const source = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
  assert.ok(!source.includes("?key="), "main.jsx must not build a ?key= URL");
  assert.ok(!source.includes("key=${"), "main.jsx must not interpolate a key into a URL");
  assert.ok(!source.includes("getGeminiUrl(model, apiKey)"), "the keyed URL builder is gone");
  assert.equal(
    (source.match(/geminiHeaders\(apiKey\)/g) ?? []).length,
    2,
    "both Gemini fetches send geminiHeaders(apiKey)",
  );
});
```

- [ ] **Step 2: Run the guard to verify it fails**

Run: `node --test "src/Game/AI/geminiTransport.test.js"`
Expected: the new guard FAILS (`?key=` is still in main.jsx); the 5 behavior
tests pass. Do not weaken the guard.

- [ ] **Step 3: Import the module**

In `src/Game/AI/main.jsx`, beside the other `./` AI imports (for example after
the `promptLayout.js` import at line 26), add:

```js
import { geminiHeaders, getGeminiStreamUrl, getGeminiUrl } from "./geminiTransport.js";
```

- [ ] **Step 4: Delete the local builders**

Remove both functions (`main.jsx:325-333`):

```js
function getGeminiUrl(model, apiKey) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
}

// The same call as an event stream. Used for the advisor (tokens to the UI) and
// for tool calls (keep-alive) — see the streaming comment in callGemini.
function getGeminiStreamUrl(model, apiKey) {
    return getGeminiUrl(model, apiKey).replace(":generateContent?", ":streamGenerateContent?alt=sse&");
}
```

Leave the streaming comment block that follows (`main.jsx:335` onward)
untouched.

- [ ] **Step 5: Update the two fetch sites**

The advisor stream (`:927`, `:936`):

```js
        const streamUrl = getGeminiStreamUrl(model);
```

```js
                headers: geminiHeaders(apiKey),
```

The buffered/tool request (`:988`, `:991`):

```js
        const requestUrl = tool ? getGeminiStreamUrl(model) : getGeminiUrl(model);
```

```js
            headers: geminiHeaders(apiKey),
```

Change NOTHING else: `method`, `body`, `signal`, the `JSON.stringify({...})`
contents and the `...customParams` order all stay byte-identical. That untouched
body is what preserves Gemini's implicit prefix cache.

- [ ] **Step 6: Verify the guard passes and no key remains in a URL**

Run: `node --test "src/Game/AI/geminiTransport.test.js"`
Expected: ALL tests PASS, including the guard.

Run: `rg -n "\?key=|key=\$\{|key in query" src/Game/AI/main.jsx src/Game/AI/geminiTransport.js`
Expected: no output.

Run: `node --check src/Game/AI/geminiTransport.js`
Expected: no output. (main.jsx is JSX; do not `node --check` it.)

- [ ] **Step 7: Run the AI suite**

Run: `node --test "src/Game/AI/*.test.js"`
Expected: PASS, no regression.

- [ ] **Step 8: Commit**

```bash
git add src/Game/AI/main.jsx src/Game/AI/geminiTransport.test.js
git commit -m "fix(ai): send the Gemini key as a header, not a query parameter"
```

---

### Task 3: Correct the transport table

**Files:**
- Modify: `docs/ai-overview.md`

**Interfaces:**
- Produces: no doc claims the Gemini key rides in the query.

- [ ] **Step 1: Update the Gemini row**

In `docs/ai-overview.md` at line 60, change only the parenthetical in the
Endpoint cell, keeping the existing `hard‑coded` spelling:

```markdown
| `gemini` | Gemini | Native APIs | `callGemini` (`main.jsx`) | `generativelanguage.googleapis.com/v1beta` (hard‑coded, key in `x-goog-api-key` header) | **direct only** (`fetch`) | no |
```

- [ ] **Step 2: Verify no stale claim remains**

Run: `rg -n "key in query" docs/`
Expected: no output.

- [ ] **Step 3: Run the wiki check and the docs-adjacent guard**

Run: `npm run wiki:check`
Expected: `Wiki is current.`

Run: `node --test "src/Game/AI/geminiTransport.test.js"`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/ai-overview.md
git commit -m "docs(ai): the Gemini key travels in a header"
```

---

## Acceptance

After all tasks, on the final HEAD:

- `npm test` passes with 0 failures (the known `server/appUpdate.test.js` network
  flake must not be the cause of a failure). The new `geminiTransport.test.js`
  adds 6 tests (5 behavior + 1 guard), so the total rises from the slice-17
  baseline of 2994 to 3000; the exact figure is confirmed against the run.
- `node --test "src/Game/AI/*.test.js"` passes.
- `rg -n "\?key=" src/` returns nothing.
- `npx eslint .` shows no new errors beyond the pre-existing 18 in
  `src/Game/Map/*`; the two new/changed source files lint clean.
- `npm run wiki:check` prints `Wiki is current.`
- `npm run build` exits 0.
- `docs/ai-overview.md` no longer says "key in query".
- Every commit in the increment carries the `Co-authored-by` trailer.
- `package.json` and `ENGINE_VERSION` are unchanged; no new dependency.
- No `apiKey` appears in a URL, a log line, or a telemetry field.
