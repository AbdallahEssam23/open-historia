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

test("a shock raises inflation against the same span without one", () => {
  const calm = advanceWorldEconomy(world(), { fromDate: "2026-01-01", toDate: "2026-10-01" });
  const shocked = advanceWorldEconomy(world(), {
    fromDate: "2026-01-01",
    toDate: "2026-10-01",
    shocks: [{ kind: "capital_flight", severity: 3, durationMonths: 9 }],
  });
  assert.ok(
    shocked.world.countryStats.Egypt.economy.inflation > calm.world.countryStats.Egypt.economy.inflation,
  );
});
