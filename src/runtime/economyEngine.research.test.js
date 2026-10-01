// Run: node --test src/runtime/economyEngine.research.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { advanceWorldEconomy, buildResearchInput } from "./economyEngine.js";

test("capacity counts the polity's research facilities and population", () => {
  const world = {
    countryStats: {
      France: { population: { total: 100000000 }, capital: "Paris" },
    },
    markers: [
      { ownerCode: "France", kind: "research facility" },
      { ownerCode: "France", kind: "research facility" },
      { ownerCode: "France", kind: "naval base" },
      { ownerCode: "Germany", kind: "research facility" },
    ],
    projects: [
      { id: "rx", kind: "research", ownerCode: "France", domain: "nuclear", scale: "large", status: "active" },
    ],
  };
  const input = buildResearchInput(world);
  // 1 base + 2*2 facilities + floor(100m/50m)=2 -> 7
  assert.equal(input.France.points, 7);
  assert.deepEqual(input.France.programmes.map((p) => p.id), ["rx"]);
});

test("a polity with no programmes is present so the advance can skip it cleanly", () => {
  const world = { countryStats: { France: { population: { total: 0 } } }, markers: [], projects: [] };
  const input = buildResearchInput(world);
  assert.equal(input.France.points, 1);
  assert.deepEqual(input.France.programmes, []);
});

test("a blank owner means the player and is attributed to the player polity", () => {
  const world = {
    countryStats: { France: { population: { total: 0 } } },
    markers: [],
    projects: [
      { id: "rx", kind: "research", ownerCode: "", domain: "medical", scale: "small", status: "active" },
    ],
  };
  const input = buildResearchInput(world, { playerPolity: "France" });
  assert.deepEqual(input.France.programmes.map((p) => p.id), ["rx"]);
});

test("a completion emits both the 100 percent update and the close op", () => {
  // A small but valid sheet: sheetToPolity needs population > 0 and a positive
  // gdpPerCapita. 100m people give 2 capacity points plus the base of 1, so a
  // military/small programme (cost 30) started at 29 points finishes in one month.
  const world = {
    countryStats: {
      Egypt: {
        stability: 60,
        economy: { gdp: 1e12, gdpPerCapita: 10_000 },
        population: { total: 100_000_000 },
        territorialComponents: [
          { geography: "core", group: "core", population: 100_000_000, gdpPerCapita: 10_000 },
        ],
      },
    },
    projects: [
      {
        id: "rx",
        kind: "research",
        ownerCode: "Egypt",
        domain: "military",
        scale: "small",
        researchPoints: 29,
        status: "active",
      },
    ],
  };
  const result = advanceWorldEconomy(world, {
    fromDate: "2026-01-01",
    toDate: "2026-02-01",
    playerPolity: "Egypt",
  });
  const update = result.researchOps.find((op) => op.op === "update");
  assert.ok(update, "the progress update must be emitted");
  assert.equal(update.projectId, "rx");
  assert.equal(update.patch.progress, 100);
  assert.equal(update.patch.researchPoints, 30);
  const close = result.researchOps.find((op) => op.op === "close");
  assert.ok(close, "the completion must be closed");
  assert.equal(close.projectId, "rx");
  assert.equal(close.status, "complete");
  assert.equal(result.research.Egypt.programmes[0].status, "complete");
});
