// Run: node --test src/engine/supplyAttrition.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { deriveSupplyAttrition, SUPPLY_ATTRITION_RATES } from "./supplyAttrition.js";

const war = (id, status, sideA, sideB) => ({ id, status, sideA, sideB });
const unit = (id, ownerCode, regionId, strength = 100) => ({ id, ownerCode, regionId, strength });
const region = (id, controller, home = controller, adjacencies = []) => ({ id, controller, home, adjacencies });

// r1: French home and source. r2: French-held but not French home (conquered),
// reached from r1. r3: German, hostile neighbour of r2 (a front). r4: German,
// behind r3, so a French unit there is cut off.
const GRAPH = [
  region("r1", "France", "France", ["r2"]),
  region("r2", "France", "Germany", ["r1", "r3"]),
  region("r3", "Germany", "Germany", ["r2", "r4"]),
  region("r4", "Germany", "Germany", ["r3"]),
];
const WAR = [war("w1", "active", ["France"], ["Germany"])];

const byId = (result) => Object.fromEntries(result.units.map((row) => [row.unitId, row]));

test("the rate ladder orders supplied below strained below isolated", () => {
  assert.equal(SUPPLY_ATTRITION_RATES.supplied, 0);
  assert.ok(SUPPLY_ATTRITION_RATES.supplied < SUPPLY_ATTRITION_RATES.strained);
  assert.ok(SUPPLY_ATTRITION_RATES.strained < SUPPLY_ATTRITION_RATES.isolated);
});

test("a home formation with no contact is supplied and loses nothing", () => {
  const result = deriveSupplyAttrition({
    wars: WAR, regions: GRAPH, months: 1,
    units: [unit("u1", "France", "r1")],
  });
  const row = byId(result).u1;
  assert.equal(row.state, "supplied");
  assert.equal(row.reachable, true);
  assert.equal(row.contact, false);
  assert.equal(row.loss, 0);
  assert.equal(row.nextStrength, 100);
  assert.equal(row.destroyed, false);
});

test("a formation on a front is strained", () => {
  const result = deriveSupplyAttrition({
    wars: WAR, regions: GRAPH, months: 1,
    units: [unit("u2", "France", "r2")],
  });
  const row = byId(result).u2;
  assert.equal(row.state, "strained");
  assert.equal(row.reachable, true);
  assert.equal(row.contact, true);
  assert.equal(row.loss, SUPPLY_ATTRITION_RATES.strained);
  assert.equal(row.nextStrength, 98);
});

test("a formation outside the network but adjacent to it is strained", () => {
  const result = deriveSupplyAttrition({
    wars: WAR, regions: GRAPH, months: 1,
    units: [unit("u3", "France", "r3")],
  });
  const row = byId(result).u3;
  assert.equal(row.state, "strained");
  assert.equal(row.reachable, false);
  assert.equal(row.contact, true);
  assert.equal(row.loss, SUPPLY_ATTRITION_RATES.strained);
});

test("a formation cut off from every source is isolated", () => {
  const result = deriveSupplyAttrition({
    wars: WAR, regions: GRAPH, months: 1,
    units: [unit("u4", "France", "r4")],
  });
  const row = byId(result).u4;
  assert.equal(row.state, "isolated");
  assert.equal(row.reachable, false);
  assert.equal(row.contact, false);
  assert.equal(row.loss, SUPPLY_ATTRITION_RATES.isolated);
  assert.equal(row.nextStrength, 90);
});

test("a supplied formation standing on a front is strained", () => {
  const regions = [
    region("r1", "France", "France", ["r2"]),
    region("r2", "Germany", "Germany", ["r1"]),
  ];
  const result = deriveSupplyAttrition({
    wars: WAR, regions, months: 1,
    units: [unit("u1", "France", "r1")],
  });
  assert.equal(byId(result).u1.state, "strained");
});

test("an occupied homeland is not a source, so the army is isolated", () => {
  const regions = [
    region("r1", "Germany", "France", ["r2"]),
    region("r2", "France", "Germany", ["r1"]),
  ];
  const result = deriveSupplyAttrition({
    wars: WAR, regions, months: 1,
    units: [unit("u1", "France", "r2")],
  });
  const row = byId(result).u1;
  assert.equal(row.state, "isolated");
  assert.equal(row.reachable, false);
});

test("a non-belligerent cut off loses nothing", () => {
  const result = deriveSupplyAttrition({
    wars: WAR, regions: GRAPH, months: 1,
    units: [unit("u1", "Spain", "r4")],
  });
  const row = byId(result).u1;
  assert.equal(row.state, "isolated");
  assert.equal(row.belligerent, false);
  assert.equal(row.loss, 0);
  assert.equal(row.destroyed, false);
});

test("a war listing one polity on both sides is degenerate and makes no belligerent", () => {
  const result = deriveSupplyAttrition({
    wars: [war("w1", "active", ["France", "Germany"], ["Germany"])],
    regions: GRAPH,
    months: 1,
    units: [unit("u4", "France", "r4")],
  });
  assert.equal(byId(result).u4.belligerent, false);
  assert.equal(byId(result).u4.loss, 0);
});

test("a blank strength defaults to full and is not destroyed by accident", () => {
  const result = deriveSupplyAttrition({
    wars: WAR, regions: GRAPH, months: 1,
    units: [{ id: "u4", ownerCode: "France", regionId: "r4", strength: "" }],
  });
  const row = byId(result).u4;
  assert.equal(row.nextStrength, 90);
  assert.equal(row.destroyed, false);
});

test("a region id that collides with Object.prototype is safe", () => {
  const regions = [
    region("__proto__", "France", "France", ["r1"]),
    region("r1", "France", "France", ["__proto__"]),
  ];
  const result = deriveSupplyAttrition({
    wars: [], regions, months: 1,
    units: [unit("u1", "France", "__proto__")],
  });
  assert.equal(byId(result).u1.state, "supplied");
});

test("a contested region is contact, and the summary counts the damage", () => {
  const regions = [
    region("r1", "France", "France", ["r2"]),
    region("r2", "Germany", "Germany", ["r1"]),
  ];
  const result = deriveSupplyAttrition({
    wars: WAR, regions, months: 1,
    units: [unit("u1", "France", "r2"), unit("u2", "Germany", "r2")],
  });
  assert.equal(byId(result).u1.contact, true);
  assert.equal(byId(result).u1.state, "strained");
  assert.equal(result.summary.damaged, 2);
});

test("the period multiplies the loss, and zero months costs nothing", () => {
  const at = (months) => byId(deriveSupplyAttrition({
    wars: WAR, regions: GRAPH, months,
    units: [unit("u4", "France", "r4")],
  })).u4;
  assert.equal(at(0).loss, 0);
  assert.equal(at(0).nextStrength, 100);
  assert.equal(at(3).loss, SUPPLY_ATTRITION_RATES.isolated * 3);
  assert.equal(at(3).nextStrength, 70);
});

test("a formation whose strength reaches zero collapses", () => {
  const result = deriveSupplyAttrition({
    wars: WAR, regions: GRAPH, months: 3,
    units: [unit("u4", "France", "r4", 15)],
  });
  const row = byId(result).u4;
  assert.equal(row.loss, 30);
  assert.equal(row.nextStrength, 0);
  assert.equal(row.destroyed, true);
  assert.equal(result.summary.destroyed, 1);
});

test("adjacency listed one way still walks both ways, and a self-adjacency is ignored", () => {
  const regions = [
    region("r1", "France", "France", ["r2", "r1"]),
    // r2 is not a home source (its base owner is Germany); it can only be
    // reached through r1's one-way adjacency, which the walk must mirror.
    region("r2", "France", "Germany", []),
  ];
  const result = deriveSupplyAttrition({
    wars: [], regions, months: 1,
    units: [unit("u1", "France", "r2")],
  });
  assert.equal(byId(result).u1.state, "supplied");
});

test("duplicate unit rows fold by id, first spelling winning", () => {
  const result = deriveSupplyAttrition({
    wars: WAR, regions: GRAPH, months: 1,
    units: [unit("u1", "France", "r4"), unit("u1", "france", "r4")],
  });
  assert.equal(result.units.length, 1);
  assert.equal(result.units[0].ownerCode, "France");
});

test("a unit with no id, owner or known region is skipped", () => {
  const result = deriveSupplyAttrition({
    wars: WAR, regions: GRAPH, months: 1,
    units: [
      unit("", "France", "r1"),
      unit("u1", "", "r1"),
      unit("u2", "France", "unknown"),
      unit("u3", "France", ""),
    ],
  });
  assert.deepEqual(result.units, []);
});

test("empty inputs yield the empty shape, not a throw", () => {
  assert.deepEqual(deriveSupplyAttrition(), {
    units: [],
    summary: { supplied: 0, strained: 0, isolated: 0, damaged: 0, destroyed: 0 },
  });
});

test("the result is order-independent and identical twice", () => {
  const units = [unit("u1", "France", "r1"), unit("u4", "France", "r4"), unit("u3", "France", "r3")];
  const a = deriveSupplyAttrition({ wars: WAR, regions: GRAPH, units, months: 2 });
  const b = deriveSupplyAttrition({ wars: WAR, regions: GRAPH, units, months: 2 });
  assert.deepEqual(a, b);
  const reordered = deriveSupplyAttrition({
    wars: [...WAR].reverse(),
    regions: [...GRAPH].reverse(),
    units: [...units].reverse(),
    months: 2,
  });
  assert.deepEqual(reordered, a);
  assert.deepEqual(a.units.map((row) => row.unitId), ["u1", "u3", "u4"]);
});
