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

test("a pending shock survives the round trip, a malformed one is dropped", () => {
  const clock = {
    version: 1,
    seed: "abcdef0123456789",
    lastDate: "2026-04-01",
    lastMonth: 3,
    pendingShocks: [
      { kind: "blockade", severity: 2, durationMonths: 9, scope: "world" },
      { kind: "blockade", severity: 9, durationMonths: 9 },
      { kind: "sunspots", severity: 1, durationMonths: 3 },
    ],
  };
  const normalized = normalizeWorldState({ economyEngine: clock });
  assert.deepEqual(normalized.economyEngine.pendingShocks, [
    { kind: "blockade", severity: 2, durationMonths: 9, scope: "world" },
  ]);
  assert.deepEqual(normalizeWorldState(normalized).economyEngine.pendingShocks, normalized.economyEngine.pendingShocks);
});

test("the force-pool engine fields round-trip through a world normalize", () => {
  const world = normalizeWorldState({
    economyEngine: {
      version: 1,
      seed: "abc",
      lastDate: "2026-04-01",
      lastMonth: 3,
      pools: { France: { manpower: 1200, materiel: 40.5 } },
      mobilization: { France: "total" },
      pendingMobilization: [{ polity: "Germany", posture: "partial" }],
      upkeepShortfall: { France: { manpower: 30, materiel: 0 } },
    },
  });
  assert.deepEqual(world.economyEngine.pools, { France: { manpower: 1200, materiel: 40.5 } });
  assert.deepEqual(world.economyEngine.mobilization, { France: "total" });
  assert.deepEqual(world.economyEngine.pendingMobilization, [{ polity: "Germany", posture: "partial" }]);
  assert.deepEqual(world.economyEngine.upkeepShortfall, { France: { manpower: 30, materiel: 0 } });
});

test("an engine block with none of the new fields keeps its old shape", () => {
  const world = normalizeWorldState({
    economyEngine: { version: 1, seed: "abc", lastDate: "2026-04-01", lastMonth: 3 },
  });
  assert.deepEqual(Object.keys(world.economyEngine).sort(), ["lastDate", "lastMonth", "seed", "version"]);
});

test("a half-written pool row is dropped, not defaulted", () => {
  const world = normalizeWorldState({
    economyEngine: {
      version: 1,
      seed: "abc",
      pools: { France: { manpower: 1200 }, Ghost: null },
    },
  });
  assert.equal(world.economyEngine.pools, undefined);
});
