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
      { id: "rx", name: "Reactor", kind: "research", ownerCode: "France", domain: "nuclear", scale: "large", status: "active" },
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
      { id: "rx", name: "Programme", kind: "research", ownerCode: "", domain: "medical", scale: "small", status: "active" },
    ],
  };
  const input = buildResearchInput(world, { playerPolity: "France" });
  assert.deepEqual(input.France.programmes.map((p) => p.id), ["rx"]);
});

test("a bare country code as the player token still finds the player's programmes", () => {
  // game.country can still be "FRA" while the stat sheet and ownerCode are keyed
  // "France"; without canonicalisation the player's own programme is dropped.
  const world = {
    countryStats: { France: { population: { total: 0 } } },
    markers: [],
    projects: [
      { id: "rx", name: "Programme", kind: "research", ownerCode: "", domain: "medical", scale: "small", status: "active" },
    ],
  };
  const input = buildResearchInput(world, { playerPolity: "FRA" });
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
        name: "Programme",
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

test("a non-default programme reports progress against its own cost", () => {
  // nuclear/large costs 60 * 3 = 180. 100m people with no facilities give three
  // points in one month, so progress is floor(100 * 3 / 180) = 1. Re-deriving the
  // cost from the stripped programme would fall back to industrial/small (24) and
  // report 12 instead.
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
        id: "nx",
        name: "Atom",
        kind: "research",
        ownerCode: "Egypt",
        domain: "nuclear",
        scale: "large",
        researchPoints: 0,
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
  assert.equal(update.patch.researchPoints, 3);
  assert.equal(update.patch.progress, 1);
});

test("a completion folds its modifier once, applied from the next span", () => {
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
        name: "Programme",
        kind: "research",
        ownerCode: "Egypt",
        domain: "military",
        scale: "small",
        researchPoints: 29,
        status: "active",
      },
    ],
  };
  const first = advanceWorldEconomy(world, {
    fromDate: "2026-01-01",
    toDate: "2026-02-01",
    playerPolity: "Egypt",
  });
  assert.ok(first.researchOps.some((op) => op.op === "close"), "the programme completes");
  // The returned map is sparse: nothing is committed yet this span, so Egypt is
  // absent. Assert "not applied" without dereferencing an absent row.
  assert.equal(first.researchEffects?.Egypt?.pools ?? 0, 0, "the effect is not applied in the span that produced it");
  assert.deepEqual(
    first.world.economyEngine.researchEffects,
    { Egypt: { production: 0, pools: 1, economy: 0 } },
  );

  // The applier stamps the completed programme before the next increment (a
  // caller step this unit test has to make explicit), so the second span reads
  // it as finished rather than re-pricing and closing it again.
  const closed = new Set(first.researchOps.filter((op) => op.op === "close").map((op) => op.projectId));
  const settled = {
    ...first.world,
    projects: first.world.projects.map((project) => (
      closed.has(project.id) ? { ...project, status: "complete" } : project
    )),
  };
  const second = advanceWorldEconomy(settled, {
    fromDate: "2026-03-01",
    toDate: "2026-04-01",
    playerPolity: "Egypt",
  });
  // A full 31-day span: monthsBetweenDates floors days/30, so a 28-day February
  // span is 0 months and would take the early return instead of the real advance.
  assert.equal(second.months, 1, "the second span really advances");
  assert.ok(!second.researchOps.some((op) => op.op === "close"), "the completed programme does not complete twice");
  assert.equal(second.researchEffects.Egypt.pools, 1, "the effect is applied from the next span");
  assert.deepEqual(
    second.world.economyEngine.researchEffects,
    { Egypt: { production: 0, pools: 1, economy: 0 } },
    "and is not folded twice",
  );
});
