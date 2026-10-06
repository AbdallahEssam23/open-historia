// Run: node --test src/runtime/gameState.partialNormalize.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeWorldState } from "./gameState.js";

// A small world that carries every scope the reuse predicate guards. Timestamps
// are explicit so two normalizations of the same input are byte-for-byte equal
// (a unit born without them is stamped with the wall clock).
const WORLD = {
  polityOverrides: { A: { name: "Alpha", code: "A" } },
  regionOwnershipOverrides: { r1: "A" },
  regionClaimants: { r2: ["A"], r3: ["A", "B"] },
  settledRegionClaims: ["r4"],
  regionSovereigntyOverrides: { r5: "A" },
  internationalReputation: { A: 60 },
  intelligence: { A: 30 },
  spies: [{ id: "s1", target: "B", status: "active" }],
  countryTags: { A: ["expansionist"] },
  units: [{
    id: "u1",
    ownerCode: "A",
    type: "infantry",
    lng: 10,
    lat: 20,
    strength: 100,
    createdAt: "2000-01-01T00:00:00.000Z",
    updatedAt: "2000-01-01T00:00:00.000Z",
  }],
  wars: [],
  markers: [],
  reports: [],
  projects: [],
  simulationHistory: [],
  economyEngine: { version: 1, seed: "s", lastDate: "2000-01-01", lastMonth: 0 },
};

const deepEqualJson = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));

test("a partial normalize equals a full normalize for every reference-preserving update", () => {
  const before = normalizeWorldState(WORLD);
  const previous = { raw: WORLD, normalized: before };
  const updates = [
    { intelligence: { A: 44 } },
    { internationalReputation: { A: 10 } },
    { countryTags: { A: ["revanchist"] } },
    { regionClaimants: { r2: ["A"] } },
    { wars: [] },
    { economyEngine: { version: 1, seed: "s", lastDate: "2000-02-01", lastMonth: 1 } },
    { units: WORLD.units.map((unit) => ({ ...unit, strength: 80 })) },
    { intelligence: { A: 44 }, regionClaimants: { r2: ["A"] } },
  ];
  for (const update of updates) {
    const next = { ...WORLD, ...update };
    deepEqualJson(normalizeWorldState(next, { previous }), normalizeWorldState(next));
  }
});

test("a spread of the already-normalized result also equals a full normalize", () => {
  const before = normalizeWorldState(WORLD);
  const previous = { raw: WORLD, normalized: before };
  const next = { ...before, intelligence: { A: 44 } };
  deepEqualJson(normalizeWorldState(next, { previous }), normalizeWorldState(next));
});

test("scopes whose inputs did not move are reused by reference", () => {
  const before = normalizeWorldState(WORLD);
  const next = { ...WORLD, units: WORLD.units.map((unit) => ({ ...unit, strength: 80 })) };
  const after = normalizeWorldState(next, { previous: { raw: WORLD, normalized: before } });
  assert.equal(after.countryStats, before.countryStats);
  assert.equal(after.regionClaimants, before.regionClaimants);
  assert.equal(after.wars, before.wars);
  assert.equal(after.countryTags, before.countryTags);
  assert.notEqual(after.units, before.units, "the moved scope is rebuilt");
});

test("a change to polityOverrides invalidates the scopes that resolve owners", () => {
  const before = normalizeWorldState(WORLD);
  const next = { ...WORLD, polityOverrides: { A: { name: "Alpha Prime", code: "A" } } };
  const after = normalizeWorldState(next, { previous: { raw: WORLD, normalized: before } });
  assert.notEqual(after.regionClaimants, before.regionClaimants);
  assert.notEqual(after.regionOwnershipOverrides, before.regionOwnershipOverrides);
  assert.notEqual(after.regionSovereigntyOverrides, before.regionSovereigntyOverrides);
  assert.notEqual(after.projects, before.projects);
  deepEqualJson(after, normalizeWorldState(next));
});

test("without a previous pair every scope is rebuilt", () => {
  const before = normalizeWorldState(WORLD);
  const after = normalizeWorldState(WORLD);
  assert.notEqual(after.regionClaimants, before.regionClaimants);
  assert.notEqual(after.units, before.units);
  deepEqualJson(after, before);
});
