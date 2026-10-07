/*! Open Historia — local small-model signposting © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The recommended small language models for running on the player's own machine
// through Ollama or LM Studio, and the tasks they suit. Import-free on purpose:
// it is a signpost, so it must not drag the AI runtime into a caller that only
// wants the list. See docs/ai-overview.md ("Local small models").
//
// These run through the existing `openai-compatible` provider. Nothing here adds
// a dependency, a provider kind, or a bundled weight: in-browser inference
// engines (WebLLM, transformers.js) were evaluated and left out for the bundle
// limits recorded in docs/specs/2026-10-07-local-small-models-design.md.
export const LOCAL_SLM_MODELS = [
    {
        id: "llama3.2:1b",
        label: "Llama 3.2 1B",
        params: "1B",
        purpose: "The lightest option: short picks and one-line replies.",
    },
    {
        id: "llama3.2:3b",
        label: "Llama 3.2 3B",
        params: "3B",
        purpose: "Balanced: diplomacy letters and narration on a modest machine.",
    },
    {
        id: "phi3.5",
        label: "Phi-3.5 mini",
        params: "3.8B",
        purpose: "The strongest reasoning here, still local; a slower first token.",
    },
    {
        id: "qwen2.5:1.5b",
        label: "Qwen2.5 1.5B",
        params: "1.5B",
        purpose: "Light and multilingual: non-English letters and narration.",
    },
];

// The tasks a small local model is a good fit for: the ones that write or pick
// short in-character text. A time skip wants the biggest model available, so it
// is deliberately not here. These are existing AI_TASK_ROUTING keys, and a test
// pins that they stay real keys.
export const LOCAL_SLM_TASK_KEYS = ["diplomacy", "idleDiplomacy", "nextSpeaker", "advisor"];

// A local model server: Ollama's default, LM Studio's, or a box on the LAN.
// An empty endpoint counts as local for `openai-compatible`, whose documented
// default is http://localhost:11434/v1 (providerConfig.js).
export function isLocalModelEndpoint(endpoint) {
    const text = String(endpoint ?? "").trim();
    if (!text) return true;
    let host;
    try {
        host = new URL(text).hostname.toLowerCase();
    } catch {
        return false;
    }
    // URL keeps the brackets on an IPv6 literal: [::1].
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1" || host.endsWith(".local");
}

// Datalist hints for the Model field, or nothing. Only a local
// `openai-compatible` endpoint gets them, so a hosted gateway is not offered
// Ollama tags. "custom" is the legacy alias normalizeProvider maps to
// `openai-compatible`.
export function localModelSuggestions(provider, endpoint) {
    const normalized = provider === "custom" ? "openai-compatible" : provider;
    if (normalized !== "openai-compatible") return [];
    if (!isLocalModelEndpoint(endpoint)) return [];
    return LOCAL_SLM_MODELS.map((model) => model.id);
}
