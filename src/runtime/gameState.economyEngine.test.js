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

test("the production engine fields round-trip through a world normalize", () => {
  const world = normalizeWorldState({
    economyEngine: {
      version: 1,
      seed: "abc",
      lastDate: "2026-04-01",
      lastMonth: 3,
      production: {
        France: {
          active: { kind: "unit", type: "infantry", count: 2, monthsTotal: 4, monthsDone: 1 },
          queue: [{ kind: "building", type: "fortification", count: 1, monthsTotal: 4, at: "Metz" }],
        },
      },
      pendingProduction: [{ polity: "Germany", kind: "unit", type: "armor", count: 1 }],
      rejectedProduction: [{ polity: "France", kind: "unit", type: "naval", count: 1, reason: "cannot afford" }],
    },
  });
  assert.deepEqual(world.economyEngine.production.France.active, {
    kind: "unit", type: "infantry", count: 2, monthsTotal: 4, monthsDone: 1,
  });
  assert.equal(world.economyEngine.production.France.queue.length, 1);
  assert.deepEqual(world.economyEngine.pendingProduction, [{ polity: "Germany", kind: "unit", type: "armor", count: 1 }]);
  assert.equal(world.economyEngine.rejectedProduction.length, 1);
});

test("an empty production line is omitted, so an old save keeps its shape", () => {
  const world = normalizeWorldState({
    economyEngine: { version: 1, seed: "abc", production: { France: { queue: [] } } },
  });
  assert.equal(world.economyEngine.production, undefined);
});

test("the research-effects field round-trips, clamps and stays sparse", () => {
  const normalized = normalizeWorldState({
    economyEngine: {
      version: 1,
      seed: "abcdef0123456789",
      lastDate: "2026-04-01",
      lastMonth: 3,
      researchEffects: {
        Egypt: { production: 99, pools: -2, economy: 1 },
        "": { production: 3 },
        Mali: { production: 0, pools: 0, economy: 0 },
      },
    },
  });
  assert.deepEqual(normalized.economyEngine.researchEffects, {
    Egypt: { production: 6, pools: 0, economy: 1 },
  });
  assert.deepEqual(
    normalizeWorldState(normalized).economyEngine.researchEffects,
    normalized.economyEngine.researchEffects,
  );
  const without = normalizeWorldState({
    economyEngine: { version: 1, seed: "abcdef0123456789", lastDate: "2026-04-01", lastMonth: 3 },
  });
  assert.equal("researchEffects" in without.economyEngine, false, "an empty field is omitted");
});
