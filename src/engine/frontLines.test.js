// Run: node --test src/engine/frontLines.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { deriveFrontLines } from "./frontLines.js";

const region = (id, controller, adjacencies = []) => ({ id, controller, adjacencies });
const war = (id, status, sideA, sideB) => ({ id, status, sideA, sideB });
const unit = (ownerCode, regionId) => ({ ownerCode, regionId });

test("an empty input returns the empty shape, not a throw", () => {
  assert.deepEqual(deriveFrontLines(), { edges: [], contested: [], byWar: [], regions: {} });
  assert.deepEqual(deriveFrontLines({}), { edges: [], contested: [], byWar: [], regions: {} });
});

test("one hostile border between two adjacent regions", () => {
  const result = deriveFrontLines({
    wars: [war("w1", "active", ["France"], ["Germany"])],
    units: [],
    regions: [region("r1", "France", ["r2"]), region("r2", "Germany", ["r1"])],
  });
  assert.deepEqual(result.edges, [
    { regionA: "r1", regionB: "r2", polityA: "France", polityB: "Germany", warIds: ["w1"] },
  ]);
});

test("two polities on the same side are not enemies", () => {
  const result = deriveFrontLines({
    wars: [war("w1", "active", ["France", "Britain"], ["Germany"])],
    units: [],
    regions: [region("r1", "France", ["r2"]), region("r2", "Britain", ["r1"])],
  });
  assert.deepEqual(result.edges, []);
});

test("a ceasefire or an ended war makes no front", () => {
  for (const status of ["ceasefire", "ended"]) {
    const result = deriveFrontLines({
      wars: [war("w1", status, ["France"], ["Germany"])],
      units: [],
      regions: [region("r1", "France", ["r2"]), region("r2", "Germany", ["r1"])],
    });
    assert.deepEqual(result.edges, [], `${status} still made an edge`);
  }
});

test("two active wars hostile across one pair carry both ids, sorted", () => {
  const result = deriveFrontLines({
    wars: [
      war("w2", "active", ["France"], ["Germany"]),
      war("w1", "active", ["France"], ["Germany"]),
    ],
    units: [],
    regions: [region("r1", "France", ["r2"]), region("r2", "Germany", ["r1"])],
  });
  assert.deepEqual(result.edges[0].warIds, ["w1", "w2"]);
});

test("a third polity on a neighbouring region is not a front", () => {
  const result = deriveFrontLines({
    wars: [war("w1", "active", ["France"], ["Germany"])],
    units: [],
    regions: [
      region("r1", "France", ["r2"]),
      region("r2", "Spain", ["r1", "r3"]),
      region("r3", "Germany", ["r2"]),
    ],
  });
  assert.deepEqual(result.edges, []);
});

test("a region with units of two enemies is contested", () => {
  const result = deriveFrontLines({
    wars: [war("w1", "active", ["France"], ["Germany"])],
    units: [unit("France", "r1"), unit("Germany", "r1")],
    regions: [region("r1", "Germany")],
  });
  assert.deepEqual(result.contested, [
    { regionId: "r1", warId: "w1", controller: "Germany", sideA: ["France"], sideB: ["Germany"] },
  ]);
});

test("units of one side only do not contest a region", () => {
  const result = deriveFrontLines({
    wars: [war("w1", "active", ["France"], ["Germany"])],
    units: [unit("France", "r1"), unit("France", "r1")],
    regions: [region("r1", "France")],
  });
  assert.deepEqual(result.contested, []);
});

test("a region that is both a front and contested carries both roles", () => {
  const result = deriveFrontLines({
    wars: [war("w1", "active", ["France"], ["Germany"])],
    units: [unit("France", "r2"), unit("Germany", "r2")],
    regions: [region("r1", "France", ["r2"]), region("r2", "Germany", ["r1"])],
  });
  assert.deepEqual(result.edges.map((edge) => [edge.regionA, edge.regionB]), [["r1", "r2"]]);
  assert.equal(result.regions.r2.controller, "Germany");
  assert.deepEqual(result.regions.r2.roles, ["contested", "front"]);
  assert.deepEqual(result.regions.r2.warIds, ["w1"]);
});

test("adjacency is symmetric and a self-adjacency is ignored", () => {
  const result = deriveFrontLines({
    wars: [war("w1", "active", ["France"], ["Germany"])],
    units: [],
    regions: [region("r1", "France", ["r1"]), region("r2", "Germany", ["r1"])],
  });
  assert.deepEqual(result.edges, [
    { regionA: "r1", regionB: "r2", polityA: "France", polityB: "Germany", warIds: ["w1"] },
  ]);
});

test("duplicate adjacency, unit and war entries are deduped", () => {
  const result = deriveFrontLines({
    wars: [
      war("w1", "active", ["France"], ["Germany"]),
      war("w1", "active", ["France"], ["Germany"]),
    ],
    units: [unit("France", "r1"), unit("France", "r1")],
    regions: [region("r1", "France", ["r2", "r2"]), region("r2", "Germany", ["r1"])],
  });
  assert.deepEqual(result.edges[0].warIds, ["w1"]);
  assert.deepEqual(result.byWar.map((entry) => entry.warId), ["w1"]);
});

test("a unit with no region never contests a region", () => {
  const result = deriveFrontLines({
    wars: [war("w1", "active", ["France"], ["Germany"])],
    units: [unit("France", ""), unit("Germany", "")],
    regions: [region("r1", "France")],
  });
  assert.deepEqual(result.contested, []);
});

test("an ownerless region is neither a front nor a contested holder", () => {
  const result = deriveFrontLines({
    wars: [war("w1", "active", ["France"], ["Germany"])],
    units: [unit("France", "o1"), unit("Germany", "o1")],
    regions: [
      region("o1", "", ["r1"]),
      region("r1", "France", ["o1"]),
    ],
  });
  assert.deepEqual(result.contested, []);
  assert.deepEqual(result.edges, []);
  assert.deepEqual(result.regions, {});
});

test("the derivation is byte-for-byte deterministic and order-independent", () => {
  const input = {
    wars: [war("w1", "active", ["France"], ["Germany"])],
    units: [unit("France", "r2"), unit("Germany", "r2"), unit("France", "r1")],
    regions: [
      region("r1", "France", ["r2"]),
      region("r2", "Germany", ["r1", "r3"]),
      region("r3", "Spain", ["r2"]),
    ],
  };
  const reversed = {
    wars: [...input.wars].reverse(),
    units: [...input.units].reverse(),
    regions: [...input.regions].reverse(),
  };
  assert.equal(JSON.stringify(deriveFrontLines(input)), JSON.stringify(deriveFrontLines(input)));
  assert.equal(JSON.stringify(deriveFrontLines(input)), JSON.stringify(deriveFrontLines(reversed)));
});
