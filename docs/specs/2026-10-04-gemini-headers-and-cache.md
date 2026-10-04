<!-- Open Historia - Gemini transport headers and implicit prompt caching (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# Gemini Headers and the Implicit Prefix Cache

This increment is a transport-security fix and a caching guarantee for the one
provider that carries a player's key in the URL. It moves the Gemini API key out
of the query string and into the `x-goog-api-key` header on every call, and it
protects the stable system-prompt prefix that Gemini's implicit cache already
discounts. No request body, no prompt template and no model behaviour changes.

## Why this increment exists

1. **The key travels in the URL today.** `getGeminiUrl(model, apiKey)` builds
   `.../v1beta/models/<model>:generateContent?key=<apiKey>`
   (`src/Game/AI/main.jsx:325-327`), and `getGeminiStreamUrl` derives the SSE
   URL from it (`:331-333`). Both `callGemini` fetches use that URL
   (`:927`, `:988`). A URL is the least private part of an HTTP request: it is
   recorded by every proxy and CDN on the path, printed in server access logs,
   stored in browser and network-capture history, and copied into any bug report
   that includes a captured request. A secret belongs in a header, which is not
   logged by intermediaries. Google documents `x-goog-api-key` for exactly this.

2. **The key is the whole account.** A free Gemini key is the player's entire AI
   allowance. A leaked query-string key is immediately usable by anyone who
   reads a log line; moving it to a header removes it from the places that get
   copied and shared. This is cheap, standard hardening with no user-visible
   cost, and the project currently does the opposite of what its own provider
   table admits in print: `docs/ai-overview.md:60` notes "key in query".

3. **Gemini discounts a stable prefix, and this game already builds one.** The
   prompt-layout work (`src/Game/AI/promptLayout.js`) keeps the game-lifetime
   constants at the front of each task prompt, byte-identical across a
   campaign's calls, with per-turn state after a computed boundary. Anthropic
   pins that boundary with explicit `cache_control` blocks; OpenAI and Gemini
   cache an identical leading prefix on their own. `usageStats.js:67` already
   reads Gemini's `cachedContentTokenCount` as `cachedTokens`, and the debug
   console shows it as "from cache" (`src/Game/GameUI/debugConsole.jsx:314`).
   The economy is therefore already in place; the risk is that a transport
   change, or a future edit, quietly stops it paying.

4. **Explicit caching would spend the scarce resource.** Gemini also offers
   explicit context caching (`cachedContents` resources with a TTL), but
   creating and refreshing a cache costs extra REQUESTS. A free Gemini key
   allows a handful of requests a minute and a few hundred a day
   (`src/Game/AI/requestBudget.js:4-10`, `:26`), so requests, not tokens, are
   what run out. Trading scarce requests for a token discount that implicit
   caching already gives away is the wrong trade for this game. This increment
   deliberately does not use the explicit cache API.

## Architecture flow

Today:

```
callGemini
  -> getGeminiUrl(model, apiKey)         -> ".../models/<m>:generateContent?key=<apiKey>"
  -> getGeminiStreamUrl(model, apiKey)   -> ".../models/<m>:streamGenerateContent?alt=sse&key=<apiKey>"
  -> fetch(url, { headers: { "Content-Type": "application/json" }, body })
```

After this increment:

```
geminiTransport.js  (import-free, unit-tested)
  -> getGeminiUrl(model)        -> ".../models/<m>:generateContent"
  -> getGeminiStreamUrl(model)  -> ".../models/<m>:streamGenerateContent?alt=sse"
  -> geminiHeaders(apiKey)      -> { "Content-Type": "application/json",
                                     "x-goog-api-key": <apiKey> }

callGemini
  -> fetch(getGeminiUrl(model),          { headers: geminiHeaders(apiKey), body })
  -> fetch(getGeminiStreamUrl(model),    { headers: geminiHeaders(apiKey), body })
```

The key never appears in a URL again. The request body is byte-identical to
today, so the leading stable prefix Gemini caches is unchanged.

## Scope

### In scope

1. A new import-free module `src/Game/AI/geminiTransport.js` owning the Gemini
   endpoint shape and the request headers. It exports `getGeminiUrl(model)`,
   `getGeminiStreamUrl(model)` and `geminiHeaders(apiKey)`.
2. `callGemini` (`src/Game/AI/main.jsx`) imports those three and removes its
   local `getGeminiUrl` / `getGeminiStreamUrl`. Both fetches (the advisor SSE
   stream at `:927-936` and the buffered/tool request at `:988-991`) send
   `geminiHeaders(apiKey)`.
3. A new unit test `src/Game/AI/geminiTransport.test.js`:
   - neither URL contains `key=` or a `?key` (the generate URL has no query at
     all; the stream URL's only query is `alt=sse`);
   - `geminiHeaders("SECRET")` returns `x-goog-api-key: SECRET` with
     `Content-Type: application/json`;
   - a source-text guard asserting `src/Game/AI/main.jsx` contains no `?key=`
     and no `key=${`, so the leak cannot be reintroduced.
4. Update `docs/ai-overview.md` (`:60`) so the endpoint column says the key
   rides in `x-goog-api-key`, not the query.

### Explicitly out of scope

1. **Explicit Gemini context caching** (`cachedContents`, `cachedContent`,
   TTL management). It costs requests the game cannot spare (Why, point 4).
   Recorded here so the decision is not silently retried later.
2. **Any change to prompt templates, the `STATIC_PROMPT_KEYS` set, or the
   `staticPrefixEnd` policy.** The cache economy depends on these; this
   increment only guarantees the transport does not disturb them.
3. **The relay, `providerFetch`, and the other providers.** Native Gemini is
   `direct only` (`docs/ai-overview.md:181`); nothing about the relay changes.
4. **Telemetry, the debug console, and `usageStats.js`.** `cachedTokens` is
   already read and shown; no field is added.

## Design

### `src/Game/AI/geminiTransport.js`

Import-free, like `providerErrors.js`, `usageStats.js` and `promptLayout.js`,
so it runs under `node --test` in a bare checkout. It is the single owner of
the endpoint string and the header shape; two copies of a URL were two chances
to leak the key.

```js
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

`apiKey` is a required positional today (`settings.apiKey.trim()` at
`main.jsx:876`), so the `String(...)` guard only prevents `undefined` from
becoming the literal text `undefined` in a header; the missing-key path is
still caught earlier by `missingSetupError` (`main.jsx:878-880`).

### `callGemini` changes

- Delete the two local builders (`main.jsx:325-333`).
- Import the three functions from `./geminiTransport.js`.
- `const streamUrl = getGeminiStreamUrl(model);` (`:927`).
- `const requestUrl = tool ? getGeminiStreamUrl(model) : getGeminiUrl(model);`
  (`:988`).
- Both fetches replace `headers: { "Content-Type": "application/json" }`
  (`:936`, `:991`) with `headers: geminiHeaders(apiKey)`.

The body construction, `...customParams` spread order, tool declarations,
`generationConfig` and history are untouched. That untouched body is what
keeps Gemini's implicit prefix cache valid: the stable system instruction
remains the leading content, exactly as `promptLayout.js` arranged.

## Interfaces

| Export | Input | Output | Notes |
|---|---|---|---|
| `getGeminiUrl` | `model: string` | the `:generateContent` URL, no query | model is `encodeURIComponent`-escaped |
| `getGeminiStreamUrl` | `model: string` | the `:streamGenerateContent?alt=sse` URL | only query is `alt=sse` |
| `geminiHeaders` | `apiKey: string` | `{ "Content-Type", "x-goog-api-key" }` | key trimmed; never logged by the app |

## Failure modes and error handling

- **CORS preflight.** `x-goog-api-key` is a non-simple header, so the browser
  sends an `OPTIONS` preflight. `generativelanguage.googleapis.com` accepts it
  (Google's own browser SDKs send this header), but this cannot be proven
  without a browser. Pre-flight will record the risk; the existing provider
  error path (`classifyProviderFailure`, `providerErrors.js`) already turns a
  refused request into a readable message, so a regression surfaces as a normal
  provider failure rather than a silent hang. If the preflight were refused,
  the fix is still header-based and the alternative is not a fallback to the
  query string.
- **Missing key.** Unchanged: `missingSetupError` fires before any URL is built
  (`main.jsx:878-880`).
- **Key echoed anywhere.** The app never interpolates `apiKey` into a log line
  or the URL after this change; the source guard pins the URL half of that.

## Testing

- `node --test "src/Game/AI/geminiTransport.test.js"` (new): the three URL and
  header assertions plus the `main.jsx` source guard.
- `node --test "src/Game/AI/*.test.js"`: no regression in the AI suite.
- `npm test`: full suite green.
- `rg -n "[\"']key=|\?key=" src/Game/AI/main.jsx src/Game/AI/geminiTransport.js`
  returns nothing.
- The `docs/ai-overview.md` transport table no longer claims "key in query".

## Acceptance

1. `getGeminiUrl` and `getGeminiStreamUrl` contain no key parameter.
2. `callGemini` sets `x-goog-api-key` on both fetches and contains no `?key=`.
3. The request body is unchanged (reviewed against the diff; a transport-only
   change).
4. `npm test` passes; the new geminiTransport tests are green.
5. `docs/ai-overview.md:60` is corrected.
6. No security leak: no `apiKey` in a URL, a log line, or a telemetry field.

## Decision point for approval

The security half (key in header) is unambiguous and recommended. The caching
half is deliberately "implicit only": Gemini already discounts the stable
prefix, the game already builds it, and explicit caching would cost the scarce
free-tier requests. The user may pull explicit caching INTO scope, but that
changes the request budget and the cache lifecycle, so it is left out unless
explicitly requested.
