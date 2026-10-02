// Run: node --test src/runtime/supplyAttrition.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readSupplyAttrition } from "./supplyAttrition.js";

const CATALOG = [
  { id: "r1", name: "Ile-de-France", country: "France", countryCode: "FRA", adjacencies: ["r2", "r3"] },
  { id: "r2", name: "Rheinland", country: "Germany", countryCode: "DEU", adjacencies: ["r1"] },
  { id: "r3", name: "Normandie", country: "France", countryCode: "FRA", adjacencies: ["r1"] },
];

const WORLD = {
  wars: [{ id: "w1", status: "active", sideA: ["France"], sideB: ["Germany"] }],
  units: [
    { id: "u1", ownerCode: "France", regionId: "r1", strength: 100 },
    { id: "u2", ownerCode: "France", regionId: "r3", strength: 100 },
    { id: "u3", ownerCode: "France", regionId: "", strength: 100 },
  ],
};

const byId = (result) => Object.fromEntries(result.units.map((row) => [row.unitId, row]));

test("a one-month span strains the front formation and spares the rear one", () => {
  const result = readSupplyAttrition(WORLD, CATALOG, { fromDate: "2000-01-01", toDate: "2000-01-31" });
  assert.equal(byId(result).u1.state, "strained");
  assert.equal(byId(result).u2.state, "supplied");
  assert.deepEqual(result.ops, [{ op: "strength", unitId: "u1", strength: 98 }]);
  assert.deepEqual(result.summary, {
    supplied: 1, strained: 1, isolated: 0, damaged: 1, destroyed: 0, opCount: 1,
  });
});

test("a zero-month span yields no ops", () => {
  const result = readSupplyAttrition(WORLD, CATALOG, { fromDate: "2000-01-01", toDate: "2000-01-01" });
  assert.deepEqual(result.ops, []);
  assert.equal(result.summary.opCount, 0);
});

test("an ownership override changes control and therefore the state", () => {
  const world = { ...WORLD, regionOwnershipOverrides: { r2: "France" } };
  const result = readSupplyAttrition(world, CATALOG, { fromDate: "2000-01-01", toDate: "2000-01-31" });
  assert.equal(byId(result).u1.state, "supplied");
  assert.deepEqual(result.ops, []);
});

test("a collapsed formation becomes a remove op", () => {
  const world = {
    ...WORLD,
    units: [{ id: "u1", ownerCode: "France", regionId: "r1", strength: 4 }],
  };
  const result = readSupplyAttrition(world, CATALOG, { fromDate: "2000-01-01", toDate: "2000-03-31" });
  assert.deepEqual(result.ops, [{ op: "remove", unitId: "u1" }]);
  assert.equal(result.summary.destroyed, 1);
});

test("the adapter leaves the world and the catalog unmodified", () => {
  const world = structuredClone(WORLD);
  const catalog = structuredClone(CATALOG);
  readSupplyAttrition(world, catalog, { fromDate: "2000-01-01", toDate: "2000-03-31" });
  assert.deepEqual(world, WORLD);
  assert.deepEqual(catalog, CATALOG);
});
