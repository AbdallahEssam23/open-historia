// Run: node --test src/Game/AI/localModels.test.js
//
// The local small-model signposting (localModels.js). The module itself is
// import-free; this test imports providerConfig only to pin that the
// recommended task keys are still real task keys, and installs the same
// localStorage stand-in providerConfig.test.js uses.
import test from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)); },
  removeItem: (key) => { store.delete(key); },
  clear: () => { store.clear(); },
  key: (index) => [...store.keys()][index] ?? null,
  get length() { return store.size; },
};

const {
  LOCAL_SLM_MODELS,
  LOCAL_SLM_TASK_KEYS,
  isLocalModelEndpoint,
  localModelSuggestions,
} = await import("./localModels.js");
const { AI_TASK_ROUTING } = await import("./providerConfig.js");

test("every recommended model is identified, labelled and justified", () => {
  assert.ok(Array.isArray(LOCAL_SLM_MODELS) && LOCAL_SLM_MODELS.length > 0);
  const seen = new Set();
  for (const model of LOCAL_SLM_MODELS) {
    assert.equal(typeof model.id, "string");
    assert.ok(model.id.length > 0);
    assert.equal(seen.has(model.id), false, `duplicate model id: ${model.id}`);
    seen.add(model.id);
    assert.ok(model.label.length > 0, `no label: ${model.id}`);
    assert.ok(model.params.length > 0, `no param count: ${model.id}`);
    assert.ok(model.purpose.length > 0, `no purpose: ${model.id}`);
  }
});

test("the recommended task keys are real task keys", () => {
  const known = new Set(AI_TASK_ROUTING.map((task) => task.key));
  assert.ok(LOCAL_SLM_TASK_KEYS.length > 0);
  for (const key of LOCAL_SLM_TASK_KEYS) {
    assert.ok(known.has(key), `task key is not in AI_TASK_ROUTING: ${key}`);
  }
});

test("a local endpoint is recognised and a hosted one is not", () => {
  assert.equal(isLocalModelEndpoint("http://localhost:11434/v1"), true);
  assert.equal(isLocalModelEndpoint("http://127.0.0.1:1234/v1"), true);
  assert.equal(isLocalModelEndpoint("http://[::1]:8080/v1"), true);
  assert.equal(isLocalModelEndpoint("http://box.local:11434/v1"), true);
  // An empty endpoint means the provider's documented localhost default.
  assert.equal(isLocalModelEndpoint(""), true);
  assert.equal(isLocalModelEndpoint(undefined), true);
  // A hosted gateway, and anything unparsable, is not local.
  assert.equal(isLocalModelEndpoint("https://api.groq.com/openai/v1"), false);
  assert.equal(isLocalModelEndpoint("https://openrouter.ai/api/v1"), false);
  assert.equal(isLocalModelEndpoint("not a url"), false);
});

test("suggestions are offered only for a local openai-compatible endpoint", () => {
  const ids = LOCAL_SLM_MODELS.map((model) => model.id);

  assert.deepEqual(localModelSuggestions("openai-compatible", "http://localhost:11434/v1"), ids);
  assert.deepEqual(localModelSuggestions("custom", "http://localhost:11434/v1"), ids);
  assert.deepEqual(localModelSuggestions("openai-compatible", ""), ids);

  assert.deepEqual(localModelSuggestions("openai-compatible", "https://api.groq.com/openai/v1"), []);
  assert.deepEqual(localModelSuggestions("gemini", "http://localhost:11434/v1"), []);
  assert.deepEqual(localModelSuggestions("openai", "http://localhost:11434/v1"), []);
  assert.deepEqual(localModelSuggestions(undefined, "http://localhost:11434/v1"), []);
});
