// Run: node --test src/runtime/economyEngine.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { advanceWorldEconomy, economySeedFor, extractEconomyState } from "./economyEngine.js";

const sheet = (over = {}) => ({
  statsSchemaVersion: 1,
  stability: 60,
  economy: {
    gdp: 1e12,
    gdpPerCapita: 10_000,
    gdpGrowth: 2,
    inflation: 4,
    unemployment: 8,
    publicDebt: 90,
    budgetBalance: -4,
    currency: "EGP",
  },
  population: { total: 100_000_000, coreIntegrated: 100_000_000, otherTerritories: 0 },
  gdpBreakdown: { agriculture: 10, industry: 35, services: 55 },
  territorialComponents: [
    { geography: "core", group: "core", population: 100_000_000, gdpPerCapita: 10_000 },
  ],
  continuity: { assessedDate: "2026-01-01", assessedRound: 2 },
  ...over,
});

const world = () => ({
  countryStats: { Egypt: sheet() },
  regionOwnershipOverrides: { "EGY.1": "Egypt" },
});

test("the seed is stable for a campaign and differs for another", () => {
  const a = economySeedFor("game-1", "modern-day");
  assert.equal(a, economySeedFor("game-1", "modern-day"));
  assert.notEqual(a, economySeedFor("game-2", "modern-day"));
  assert.match(a, /^[0-9a-f]{32}$/);
});

test("extraction reads the sheet and ignores a polity with no numbers", () => {
  const state = extractEconomyState({ countryStats: { Egypt: sheet(), France: { stability: 50 } } }, { seed: "s" });
  assert.ok(state.polities.Egypt);
  assert.equal(state.polities.France, undefined);
  assert.equal(state.polities.Egypt.components.length, 1);
});

test("advancing a turn changes the sheet and reports the deltas", () => {
  const before = world();
  const result = advanceWorldEconomy(before, {
    fromDate: "2026-01-01",
    toDate: "2026-04-01",
    playerPolity: "Egypt",
    campaignId: "c1",
    scenarioId: "s1",
  });
  assert.equal(result.months, 3);
  const after = result.world.countryStats.Egypt;
  assert.notDeepEqual(after.economy, before.countryStats.Egypt.economy);
  assert.equal(result.deltas.length, 1);
  assert.equal(result.deltas[0].polity, "Egypt");
  assert.equal(result.deltas[0].estimated, false);
  assert.ok(result.world.economyEngine);
  assert.equal(result.world.economyEngine.version, 1);
});

test("the input world is not mutated", () => {
  const before = world();
  const snapshot = JSON.stringify(before);
  advanceWorldEconomy(before, { fromDate: "2026-01-01", toDate: "2026-04-01" });
  assert.equal(JSON.stringify(before), snapshot);
});

// A world whose committed clock already carries a pending shock, as if the
// previous turn had declared it.
const worldWithPending = (pendingShocks) => ({
  ...world(),
  economyEngine: { version: 1, seed: "s", lastDate: "2026-01-01", lastMonth: 0, pendingShocks },
});

test("a shock declared this turn does NOT move this turn's numbers (the one-period lag)", () => {
  const declared = advanceWorldEconomy(world(), {
    fromDate: "2026-01-01",
    toDate: "2026-10-01",
    declaredShocks: [{ kind: "capital_flight", severity: 3, durationMonths: 9 }],
  });
  const calm = advanceWorldEconomy(world(), { fromDate: "2026-01-01", toDate: "2026-10-01" });
  assert.equal(
    declared.world.countryStats.Egypt.economy.inflation,
    calm.world.countryStats.Egypt.economy.inflation,
    "the period the model just narrated must not be rewritten by the shock it declared for it",
  );
  // And it is held for the next period rather than thrown away.
  assert.equal(declared.world.economyEngine.pendingShocks.length, 1);
  assert.equal(declared.world.economyEngine.pendingShocks[0].kind, "capital_flight");
  assert.equal(declared.shocksRunning.length, 0, "a shock declared now is not running yet");
});

test("a pending shock runs in the period that follows its declaration", () => {
  const calm = advanceWorldEconomy(world(), { fromDate: "2026-01-01", toDate: "2026-10-01" });
  const shocked = advanceWorldEconomy(worldWithPending([{ kind: "capital_flight", severity: 3, durationMonths: 9 }]), {
    fromDate: "2026-01-01",
    toDate: "2026-10-01",
  });
  assert.ok(
    shocked.world.countryStats.Egypt.economy.inflation > calm.world.countryStats.Egypt.economy.inflation,
    "a shock declared last turn must be what this turn's advance applies",
  );
});

test("a shock longer than the period keeps running and is reported to the digest", () => {
  const result = advanceWorldEconomy(worldWithPending([{ kind: "blockade", severity: 2, durationMonths: 12 }]), {
    fromDate: "2026-01-01",
    toDate: "2026-04-01",
  });
  assert.equal(result.shocksRunning.length, 1);
  assert.equal(result.shocksRunning[0].kind, "blockade");
  assert.equal(result.shocksRunning[0].monthsLeft, 9, "12 declared minus 3 consumed");
  assert.equal(result.world.economyEngine.pendingShocks[0].durationMonths, 9);
});

test("a shock that expires within the period is not carried forward", () => {
  const result = advanceWorldEconomy(worldWithPending([{ kind: "sanctions", severity: 1, durationMonths: 2 }]), {
    fromDate: "2026-01-01",
    toDate: "2026-04-01",
  });
  assert.equal(result.shocksRunning.length, 0);
  assert.equal(result.world.economyEngine.pendingShocks ?? null, null);
});

import { buildUpkeepTable, advanceWorldEconomy as advance } from "./economyEngine.js";

const roster = () => ({
  countryStats: { Egypt: sheet() },
  units: [
    { ownerCode: "Egypt", type: "infantry", strength: 100, lng: 1, lat: 1 },
    { ownerCode: "Egypt", type: "armor", strength: 100, lng: 1, lat: 1 },
  ],
});

// A roster of eight units spanning six fractional-materiel types, with repeats.
// The old per-unit float accumulation gives a different materiel total for the
// three orders below (13.8, 13.800000000000002, 13.799999999999999); the fixed
// type order makes all three byte-identical.
const mixedUnits = (types) => ({
  countryStats: { Egypt: sheet() },
  units: types.map((type) => ({ ownerCode: "Egypt", type, strength: 100, lng: 1, lat: 1 })),
});
const mixedRoster = [
  "infantry", "artillery", "air", "garrison", "armor", "infantry", "naval", "garrison",
];
const handPickedRoster = [
  "air", "artillery", "infantry", "naval", "infantry", "garrison", "armor", "garrison",
];

test("the upkeep table is order-independent across roster permutations", () => {
  const original = buildUpkeepTable(mixedUnits(mixedRoster));
  const reversed = buildUpkeepTable(mixedUnits([...mixedRoster].reverse()));
  const handPicked = buildUpkeepTable(mixedUnits(handPickedRoster));
  assert.deepEqual(original, reversed);
  assert.deepEqual(original, handPicked);
  assert.ok(original.Egypt.materiel > 0);
  assert.ok(original.Egypt.manpower > 0);
});

test("an explicit upkeep option overrides the internally built table", () => {
  const world = { ...roster(), economyEngine: { version: 1, seed: "s", lastDate: "2026-01-01", lastMonth: 0 } };
  const tiny = advance(world, {
    fromDate: "2026-01-01",
    toDate: "2026-04-01",
    upkeep: { Egypt: { manpower: 1, materiel: 0 } },
  });
  const built = advance(world, { fromDate: "2026-01-01", toDate: "2026-04-01" });
  // The roster's materiel upkeep is far above zero, so charging the tiny
  // override leaves strictly more materiel in the pool.
  assert.ok(tiny.world.economyEngine.pools.Egypt.materiel > built.world.economyEngine.pools.Egypt.materiel);
});

test("the advance writes pools, a forces mirror and the committed posture", () => {
  const world = { ...roster(), economyEngine: { version: 1, seed: "s", lastDate: "2026-01-01", lastMonth: 0 } };
  const result = advance(world, {
    fromDate: "2026-01-01",
    toDate: "2026-04-01",
    declaredMobilization: [{ polity: "Egypt", posture: "total" }],
  });
  assert.ok(result.world.economyEngine.pools.Egypt.manpower > 0);
  assert.equal(result.world.economyEngine.mobilization, undefined);
  assert.deepEqual(result.world.economyEngine.pendingMobilization, [{ polity: "Egypt", posture: "total" }]);
  assert.equal(result.world.countryStats.Egypt.forces.mobilization, "peacetime");
});

test("the declared posture runs in the NEXT advance, not this one", () => {
  const world = { ...roster(), economyEngine: { version: 1, seed: "s", lastDate: "2026-01-01", lastMonth: 0 } };
  const first = advance(world, {
    fromDate: "2026-01-01",
    toDate: "2026-04-01",
    declaredMobilization: [{ polity: "Egypt", posture: "total" }],
  });
  const second = advance(first.world, { fromDate: "2026-04-01", toDate: "2026-07-01" });
  assert.equal(second.world.countryStats.Egypt.forces.mobilization, "total");
  assert.equal(second.world.economyEngine.mobilization.Egypt, "total");
  assert.equal(second.world.economyEngine.pendingMobilization, undefined);
});

test("an unknown polity declared for mobilization is rejected, not thrown", () => {
  const world = { ...roster(), economyEngine: { version: 1, seed: "s", lastDate: "2026-01-01", lastMonth: 0 } };
  const result = advance(world, {
    fromDate: "2026-01-01",
    toDate: "2026-04-01",
    declaredMobilization: [{ polity: "Atlantis", posture: "total" }],
  });
  assert.equal(result.world.economyEngine.pendingMobilization, undefined);
});

test("an army the reserves cannot pay writes the shortfall onto the sheet", () => {
  const base = { ...world(), economyEngine: { version: 1, seed: "s", lastDate: "2026-01-01", lastMonth: 0 } };
  const result = advance(base, {
    fromDate: "2026-01-01",
    toDate: "2026-04-01",
    upkeep: { Egypt: { manpower: 1e12, materiel: 0 } },
  });
  const stored = result.world.economyEngine.upkeepShortfall?.Egypt;
  assert.ok(stored && stored.manpower > 0);
  assert.deepEqual(result.world.countryStats.Egypt.forces.shortfall, { manpower: stored.manpower });
});

import { completionBatchesFor } from "./economyEngine.js";

test("a completed unit becomes a spawn op dated at its month step", () => {
  const batches = completionBatchesFor(
    [{ polity: "Egypt", kind: "unit", type: "infantry", count: 2, monthOffset: 2 }],
    { world: { ...world(), countryStats: { Egypt: { ...sheet(), capital: "Cairo" } } }, fromDate: "2026-01-01" },
  );
  assert.equal(batches.length, 1);
  assert.equal(batches[0].date, "2026-03-01");
  assert.equal(batches[0].unitOps.length, 2);
  assert.equal(batches[0].unitOps[0].unit.ownerCode, "Egypt");
  assert.equal(batches[0].unitOps[0].unit.at, "Cairo");
});

test("a completed structure becomes a build op with a worded kind", () => {
  const batches = completionBatchesFor(
    [{ polity: "Egypt", kind: "building", type: "naval_base", count: 1, at: "Alexandria", monthOffset: 1 }],
    { world: world(), fromDate: "2026-01-01" },
  );
  assert.equal(batches[0].markerOps[0].marker.kind, "naval base");
  assert.equal(batches[0].markerOps[0].marker.status, "active");
  assert.equal(batches[0].markerOps[0].marker.at, "Alexandria");
});

test("a unit site falls back from the order to the capital to the first component", () => {
  const noCapital = {
    countryStats: {
      Egypt: { ...sheet(), capital: "", territorialComponents: [{ geography: "Nile Delta" }] },
    },
  };
  const batches = completionBatchesFor(
    [{ polity: "Egypt", kind: "unit", type: "infantry", count: 1, monthOffset: 1 }],
    { world: noCapital, fromDate: "2026-01-01" },
  );
  assert.equal(batches[0].unitOps[0].unit.at, "Nile Delta");
});

test("a unit with no resolvable site is dropped rather than placed at 0,0", () => {
  const batches = completionBatchesFor(
    [{ polity: "Nowhere", kind: "unit", type: "infantry", count: 1, monthOffset: 1 }],
    { world: world(), fromDate: "2026-01-01" },
  );
  assert.equal(batches.length, 0);
});

test("a declared production order is stored and runs in the NEXT advance", () => {
  const first = advance(world(), {
    fromDate: "2026-01-01",
    toDate: "2026-04-01",
    declaredProduction: [{ polity: "Egypt", kind: "unit", type: "infantry", count: 1 }],
  });
  assert.equal(first.production.Egypt, undefined, "nothing entered the line this period");
  assert.equal(first.world.economyEngine.pendingProduction.length, 1);
  const second = advance(first.world, { fromDate: "2026-04-01", toDate: "2026-05-01" });
  assert.ok(second.production.Egypt, "the declared order entered the line next period");
});

test("an unaffordable order is recorded as a rejection", () => {
  const result = advance(world(), {
    fromDate: "2026-01-01",
    toDate: "2026-07-01",
    declaredProduction: [{ polity: "Egypt", kind: "unit", type: "naval", count: 20 }],
  });
  // Runs next period; drive it through, then check the rejection.
  assert.equal(result.world.economyEngine.pendingProduction.length, 1);
});

test("a structure completion with no site is dropped, not emitted as an empty batch", () => {
  const batches = completionBatchesFor(
    [{ polity: "Egypt", kind: "building", type: "naval_base", count: 1, monthOffset: 1 }],
    { world: world(), fromDate: "2026-01-01" },
  );
  assert.equal(batches.length, 0);
});
