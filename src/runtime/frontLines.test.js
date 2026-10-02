// Run: node --test src/runtime/frontLines.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFrontLines } from "./frontLines.js";

const CATALOG = [
  { id: "r1", name: "Ile-de-France", country: "France", countryCode: "FRA", adjacencies: ["r2"] },
  { id: "r2", name: "Rheinland", country: "Germany", countryCode: "DEU", adjacencies: ["r1", "r3"] },
  { id: "r3", name: "Malopolska", country: "Poland", countryCode: "POL", adjacencies: ["r2"] },
  { id: "r4", name: "Tirol", country: "Austria", countryCode: "AUT", adjacencies: [] },
];

const WORLD = {
  wars: [
    { id: "w1", status: "active", sideA: ["France"], sideB: ["Germany"] },
    { id: "w2", status: "active", sideA: ["France"], sideB: ["Poland"] },
    { id: "w3", status: "ended", sideA: ["France"], sideB: ["Austria"] },
  ],
  units: [
    { id: "u1", ownerCode: "France", regionId: "r1" },
    { id: "u2", ownerCode: "Germany", regionId: "r2" },
    { id: "u3", ownerCode: "France", regionId: "r2" },
    { id: "u4", ownerCode: "Poland", regionId: "r3" },
    { id: "u5", ownerCode: "France", regionId: "" },
  ],
  regionOwnershipOverrides: {},
};

test("the adapter derives the fronts of a composite world", () => {
  const result = readFrontLines(WORLD, CATALOG);
  assert.deepEqual(result.edges, [
    { regionA: "r1", regionB: "r2", polityA: "France", polityB: "Germany", warIds: ["w1"] },
  ]);
  assert.deepEqual(result.contested, [
    { regionId: "r2", warId: "w1", controller: "Germany", sideA: ["France"], sideB: ["Germany"] },
  ]);
  assert.deepEqual(result.byWar, [
    {
      warId: "w1",
      sideA: ["France"],
      sideB: ["Germany"],
      edges: [["r1", "r2"]],
      contested: ["r2"],
    },
  ]);
  assert.deepEqual(result.regions.r2, { controller: "Germany", roles: ["contested", "front"], warIds: ["w1"] });
});

test("an ownership override changes the effective controller", () => {
  const world = { ...WORLD, regionOwnershipOverrides: { r3: "Germany" } };
  const result = readFrontLines(world, CATALOG);
  // r2 Germany now borders r3 Germany (same owner, no edge), and r1 France still
  // borders r2 Germany. The override moved Poland's region to Germany and left
  // the one front unchanged.
  assert.deepEqual(result.edges.map((edge) => [edge.regionA, edge.regionB]), [["r1", "r2"]]);
  assert.equal(result.regions.r3, undefined);
});

test("the adapter does not mutate the world or the catalog", () => {
  const worldCopy = JSON.parse(JSON.stringify(WORLD));
  const catalogCopy = JSON.parse(JSON.stringify(CATALOG));
  readFrontLines(WORLD, CATALOG);
  assert.deepEqual(WORLD, worldCopy);
  assert.deepEqual(CATALOG, catalogCopy);
});

test("an empty world is an empty derivation, not a throw", () => {
  assert.deepEqual(readFrontLines(undefined, undefined), { edges: [], contested: [], byWar: [], regions: {} });
  assert.deepEqual(readFrontLines({}, []), { edges: [], contested: [], byWar: [], regions: {} });
});
