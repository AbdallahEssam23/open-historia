// Run: node --test src/runtime/regionAdjacency.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getContiguousNeighbors, readRegionAdjacency } from "./regionAdjacency.js";

const catalog = () => [
  { id: "PARIS", name: "Ile-de-France", country: "France", adjacencies: ["RHINE"] },
  { id: "RHINE", name: "Rheinland", country: "Germany" },
  { id: "NORM", name: "Normandie", country: "France" },
  { id: "TIBER", name: "Lazio", country: "Italy" },
];

test("getContiguousNeighbors returns the home regions, their neighbours and the bordering polities", () => {
  // PARIS is French and declares RHINE; NORM is French and declares nothing.
  const world = { regionOwnershipOverrides: { NORM: "France" } };
  const out = getContiguousNeighbors(world, catalog(), "France");
  assert.equal(out.polity, "France");
  assert.deepEqual(out.regions, ["PARIS", "NORM"]);
  assert.deepEqual(out.neighbours.map((row) => row.regionId), ["RHINE"]);
  assert.deepEqual(out.neighbours, [{ regionId: "RHINE", owner: "Germany" }]);
  assert.deepEqual(out.polities, ["Germany"]);
});

test("a renamed polity resolves through the alias map", () => {
  const world = {
    regionOwnershipOverrides: { PARIS: "Frankreich" },
    polityOverrides: { Frankreich: { name: "France", aliases: ["Frankreich"] } },
  };
  const out = getContiguousNeighbors(world, catalog(), "Frankreich");
  assert.deepEqual(out.regions, ["PARIS"]);
  assert.deepEqual(out.polities, ["Germany"]);
});

test("an unknown polity returns empty lists rather than throwing", () => {
  const out = getContiguousNeighbors({}, catalog(), "Atlantis");
  assert.deepEqual(out.regions, []);
  assert.deepEqual(out.neighbours, []);
  assert.deepEqual(out.polities, []);
});

test("bordering regions are de-duplicated and never include the polity's own land", () => {
  // Both PARIS and NORM border RHINE; it is reported once.
  const world = { regionOwnershipOverrides: { NORM: "France", PARIS: "France" } };
  const out = getContiguousNeighbors(world, catalog(), "France");
  assert.deepEqual(out.neighbours.map((row) => row.regionId), ["RHINE"]);
});

test("a bbox-only catalog still answers contiguity", () => {
  const rows = [
    { id: "A", country: "France", bbox: [0, 0, 1, 1] },
    { id: "B", country: "Germany", bbox: [1, 0, 2, 1] },
    { id: "C", country: "Italy", bbox: [10, 10, 11, 11] },
  ];
  const out = getContiguousNeighbors({}, rows, "France");
  assert.deepEqual(out.regions, ["A"]);
  assert.deepEqual(out.neighbours, [{ regionId: "B", owner: "Germany" }]);
});

test("readRegionAdjacency exposes the graph and the resolved owner", () => {
  const world = { regionOwnershipOverrides: { RHINE: "Germany" } };
  const { graph, ownerOf } = readRegionAdjacency(world, catalog());
  assert.equal(graph.size, 4);
  assert.deepEqual(graph.neighborsOf("PARIS"), ["RHINE"]);
  assert.equal(ownerOf("PARIS"), "France");
  assert.equal(ownerOf("RHINE"), "Germany");
});

test("the adapter imports no Game/AI module", () => {
  const source = readFileSync(new URL("./regionAdjacency.js", import.meta.url), "utf8");
  const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(specifiers.some((specifier) => specifier.includes("Game/AI")), false);
});
