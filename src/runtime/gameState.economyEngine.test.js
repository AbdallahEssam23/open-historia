// Run: node --test src/runtime/gameState.economyEngine.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { WORLD_DEFAULTS, normalizeWorldState } from "./gameState.js";

test("the default world carries a null engine clock", () => {
  assert.ok("economyEngine" in WORLD_DEFAULTS);
  assert.equal(WORLD_DEFAULTS.economyEngine, null);
});

test("the clock survives a normalize round trip", () => {
  const normalized = normalizeWorldState({
    economyEngine: { version: 1, seed: "abcdef0123456789", lastDate: "2026-04-01", lastMonth: 3 },
  });
  assert.deepEqual(normalized.economyEngine, {
    version: 1,
    seed: "abcdef0123456789",
    lastDate: "2026-04-01",
    lastMonth: 3,
  });
  assert.deepEqual(normalizeWorldState(normalized).economyEngine, normalized.economyEngine);
});

test("a missing or malformed clock normalizes to null rather than a half record", () => {
  assert.equal(normalizeWorldState({}).economyEngine, null);
  assert.equal(normalizeWorldState({ economyEngine: { seed: "" } }).economyEngine, null);
  assert.equal(normalizeWorldState({ economyEngine: "nonsense" }).economyEngine, null);
});
