# Local Small Models for Narration and Diplomacy

> Status: designed. Follows Wave 3, item 8 of
> `docs/specs/2026-10-07-grand-strategy-roadmap-design.md` ("Desktop-only local
> narration model"). The owner's decision here is the **local-runtime path**:
> run the recommended small models through Ollama or LM Studio, which the game
> already supports, rather than bundling an in-browser inference engine.

## Problem

The roadmap proposed on-device small language models (Llama 3.2, Phi-3.5-mini,
Qwen2.5) for diplomacy letters, war declarations and ruler-to-ruler messages,
and asked whether to add the in-browser inference engines (WebLLM,
transformers.js). The repository already answers half of this: a
`openai-compatible` Connection reaches Ollama, LM Studio, vLLM and gateways, and
the code carries local-model accommodations (the llama.cpp tool form, the Qwen3
`enable_thinking` template key, the longer relay timeout, and lenient JSON for
small models). What is missing is not a capability but a **signpost**: the game
never names the recommended small models, and a player has no hint that a local
model suits diplomacy and narration but not a time skip.

## Goal

Make the existing local path discoverable, with no new dependency and no growth
in any shipped bundle:

1. a tested catalog of the recommended small models and the exact task keys they
   suit;
2. model-id hints in the AI settings and the start-of-game prompt, offered only
   for a local `openai-compatible` endpoint;
3. documentation of the setup (pull commands, CORS, task routing).

## Non-goals

- **No in-browser inference.** WebLLM and transformers.js are not added. They
  pull multi-hundred-megabyte to gigabyte weights, which cannot ride in the
  bundle (Cloudflare's 25 MiB/file limit, the "map binaries are never bundled"
  rule, and the Android app's single web bundle). If that is ever wanted it is a
  separate, desktop-only, lazily-loaded project behind an explicit opt-in, and
  it must fall back to the Fallback list. Recorded, not built.
- **No new provider kind.** The models run through the existing
  `openai-compatible` provider; nothing about the Fallback list, task picks or
  structured output changes.
- **No default model is forced.** The hints are datalist suggestions; a player
  still types whatever their server serves.

## Architecture

### Pure catalog: `src/Game/AI/localModels.js`

Import-free, so it is cheap to test and cannot pull the AI runtime into a
caller that only wants the list.

```
LOCAL_SLM_MODELS = [
  { id, label, params, purpose },
  ...
]
LOCAL_SLM_TASK_KEYS = ["diplomacy", "idleDiplomacy", "nextSpeaker", "advisor"]
isLocalModelEndpoint(endpoint) -> boolean
localModelSuggestions(provider, endpoint) -> [model id]
```

The ids are Ollama tags (`llama3.2:1b`, `llama3.2:3b`, `phi3.5`,
`qwen2.5:1.5b`); an LM Studio user types the GGUF id they loaded instead, which
the free-text field already allows. `LOCAL_SLM_TASK_KEYS` are existing keys in
`AI_TASK_ROUTING`; a test pins that they stay a subset, so a rename cannot leave
the recommendation pointing at a task that no longer exists.

`isLocalModelEndpoint` treats an empty endpoint as local for
`openai-compatible`, because that provider's documented default is
`http://localhost:11434/v1`, and otherwise accepts `localhost`, `127.0.0.1`,
`::1` and `*.local` hosts. A hosted gateway therefore never gets Ollama tags in
its suggestions.

### Wiring

- `src/Game/GameUI/settings.jsx`, `EntryEditor`: the Model field's datalist gains
  `localModelSuggestions(provider, connection?.endpoint)` alongside the existing
  suggested and recent models.
- `src/Game/GameUI/apiSetupPrompt.jsx`: the same suggestions join the start
  prompt's datalist for parity.

Both are hints only. Neither writes state.

### Documentation

- `docs/ai-overview.md`: a "Local small models" section with the catalog, the
  pull commands, `OLLAMA_ORIGINS` for a hosted page, and which tasks to route.
- `README.md`: one line under the existing local-AI note pointing at it.

## Data flow

```
LOCAL_SLM_MODELS --\
provider ----------+--> localModelSuggestions --> datalist (settings, start prompt)
connection.endpoint/                                            (hint only, no write)
```

## Edge cases

- Non-`openai-compatible` provider: no suggestions.
- `openai-compatible` pointed at a hosted gateway: no suggestions.
- Empty endpoint: suggestions offered (the provider's default is local).
- A malformed endpoint URL: treated as not local rather than throwing.
- The player's server lacks the suggested model: the field still accepts a typed
  id and the call reports the server's own error.

## Testing

- `src/Game/AI/localModels.test.js` (new): catalog ids are unique and non-empty,
  every entry has a label and purpose, `LOCAL_SLM_TASK_KEYS` is a subset of
  `AI_TASK_ROUTING`'s keys, `isLocalModelEndpoint` accepts the local forms and
  rejects a hosted one and a malformed string, and `localModelSuggestions` is
  empty off `openai-compatible` or off a hosted endpoint and returns the ids on a
  local one.
- `npm test` stays green; `npm run build` is unaffected.

## Files

- New: `docs/specs/2026-10-07-local-small-models-design.md`,
  `src/Game/AI/localModels.js`, `src/Game/AI/localModels.test.js`.
- Edit: `src/Game/GameUI/settings.jsx`, `src/Game/GameUI/apiSetupPrompt.jsx`,
  `docs/ai-overview.md`, `README.md`.

## Open questions

1. Should a one-click preset create the Ollama Connection and route the four
   tasks to it? Deferred: it writes Connections and task picks for the player,
   which deserves its own design. The hints plus the docs are the low-risk half.
2. Should the in-browser engine ever ship? Deferred and recorded as rejected for
   the bundle; see Non-goals.

## TODO

- [ ] Write `src/Game/AI/localModels.js` + `src/Game/AI/localModels.test.js` (TDD).
- [ ] Wire the suggestions into the settings and the start prompt.
- [ ] Document the setup in `docs/ai-overview.md` and `README.md`.
- [ ] Run `npm test` and `npm run build`.
