// Run: node --test src/runtime/reinforcement.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { readReinforcement, readReinforcementPolicies } from "./reinforcement.js";
import { REINFORCEMENT_POOL_FACTOR } from "../engine/reinforcement.js";
import { COMBAT_POOL_FACTOR } from "./combatEngagements.js";

const CATALOG = [
  { id: "r1", name: "Ile-de-France", country: "France", countryCode: "FRA", adjacencies: ["r2", "r3"] },
  { id: "r2", name: "Rheinland", country: "Germany", countryCode: "DEU", adjacencies: ["r1"] },
  { id: "r3", name: "Normandie", country: "France", countryCode: "FRA", adjacencies: ["r1"] },
];

const WORLD = {
  wars: [{ id: "w1", status: "active", sideA: ["France"], sideB: ["Germany"] }],
  economyEngine: {
    reinforcement: { France: "replacements" },
    pools: { France: { manpower: 100000, materiel: 1000 } },
  },
  units: [
    { id: "a", ownerCode: "France", type: "infantry", regionId: "r1", strength: 40, lng: 1, lat: 1 },
    { id: "b", ownerCode: "France", type: "infantry", regionId: "r3", strength: 90, lng: 3, lat: 3 },
    { id: "c", ownerCode: "France", type: "armor", regionId: "r3", strength: 50, lng: 3.1, lat: 3.1 },
    { id: "d", ownerCode: "France", type: "armor", regionId: "r3", strength: 30, lng: 3.2, lat: 3.2 },
    { id: "f", ownerCode: "France", type: "infantry", regionId: "r3", strength: 40, lng: 3.3, lat: 3.3 },
    { id: "e", ownerCode: "France", type: "infantry", regionId: "r9", strength: 40, lng: 9, lat: 9 },
  ],
};

test("the pool factor is pinned to the combat factor", () => {
  assert.equal(REINFORCEMENT_POOL_FACTOR, COMBAT_POOL_FACTOR);
});

test("a composite world yields the expected ops, reserve draw and summary", () => {
  const result = readReinforcement(WORLD, CATALOG, {
    fromDate: "2000-01-01",
    toDate: "2000-01-31",
    rotations: [{ out: "a", in: "b" }],
    merges: [{ survivor: "c", absorbed: "d" }],
  });
  assert.deepEqual(result.ops, [
    { op: "strength", unitId: "f", strength: 45 },
    { op: "move", unitId: "a", toLng: 3, toLat: 3, regionId: "r3" },
    { op: "move", unitId: "b", toLng: 1, toLat: 1, regionId: "r1" },
    { op: "strength", unitId: "c", strength: 80 },
    { op: "remove", unitId: "d" },
  ]);
  assert.deepEqual(result.reserveCost, { France: { manpower: 600, materiel: 0.25 } });
  assert.equal(result.summary.reinforced, 1);
  assert.equal(result.summary.rotations, 1);
  assert.equal(result.summary.merges, 1);
  assert.equal(result.summary.opCount, 5);
});

test("an empty catalog leaves every formation unreachable", () => {
  const result = readReinforcement(WORLD, [], { fromDate: "2000-01-01", toDate: "2000-01-31" });
  assert.deepEqual(result.ops, []);
  assert.deepEqual(result.reserveCost, {});
});

test("the adapter leaves the world and the catalog unmodified", () => {
  const world = structuredClone(WORLD);
  const catalog = structuredClone(CATALOG);
  readReinforcement(world, catalog, { fromDate: "2000-01-01", toDate: "2000-03-31" });
  assert.deepEqual(world, WORLD);
  assert.deepEqual(catalog, CATALOG);
});

test("the policy fold is exposed: committed overridden by the pending declaration", () => {
  const world = {
    economyEngine: {
      reinforcement: { France: "replacements", Germany: "none" },
      pendingReinforcement: [{ polity: "France", policy: "belligerent" }],
    },
  };
  const { inForce, pending } = readReinforcementPolicies(world);
  assert.deepEqual(inForce, { France: "replacements", Germany: "none" });
  assert.deepEqual(pending, { France: "belligerent" });
});
