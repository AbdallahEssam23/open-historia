// Run: node --test src/runtime/reinforcementLag.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { advanceWorldEconomy } from "./economyEngine.js";
import { normalizeWorldState } from "./gameState.js";

const sheet = () => ({
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
  territorialComponents: [{ geography: "core", group: "core", population: 100_000_000, gdpPerCapita: 10_000 }],
});

const world = () => ({
  countryStats: { Egypt: sheet() },
  economyEngine: { version: 1, seed: "s", lastDate: "2026-01-01", lastMonth: 0 },
});

test("a declared policy is pending this period, not in force", () => {
  const result = advanceWorldEconomy(world(), {
    fromDate: "2026-01-01",
    toDate: "2026-04-01",
    declaredReinforcement: [{ polity: "Egypt", policy: "none" }],
  });
  assert.equal(result.world.economyEngine.reinforcement, undefined);
  assert.deepEqual(result.world.economyEngine.pendingReinforcement, [{ polity: "Egypt", policy: "none" }]);
});

test("the declared policy is in force in the next advance", () => {
  const first = advanceWorldEconomy(world(), {
    fromDate: "2026-01-01",
    toDate: "2026-04-01",
    declaredReinforcement: [{ polity: "Egypt", policy: "none" }],
  });
  const second = advanceWorldEconomy(first.world, { fromDate: "2026-04-01", toDate: "2026-07-01" });
  assert.deepEqual(second.world.economyEngine.reinforcement, { Egypt: "none" });
  assert.equal(second.world.economyEngine.pendingReinforcement, undefined);
});

test("an unknown polity declared for reinforcement is rejected, not thrown", () => {
  const result = advanceWorldEconomy(world(), {
    fromDate: "2026-01-01",
    toDate: "2026-04-01",
    declaredReinforcement: [{ polity: "Atlantis", policy: "none" }],
  });
  assert.equal(result.world.economyEngine.pendingReinforcement, undefined);
});

test("the policy fields round-trip through a world normalize", () => {
  const normalized = normalizeWorldState({
    economyEngine: {
      version: 1,
      seed: "abc",
      lastDate: "2026-04-01",
      lastMonth: 3,
      reinforcement: { France: "belligerent" },
      pendingReinforcement: [{ polity: "Germany", policy: "none" }],
    },
  });
  assert.deepEqual(normalized.economyEngine.reinforcement, { France: "belligerent" });
  assert.deepEqual(normalized.economyEngine.pendingReinforcement, [{ polity: "Germany", policy: "none" }]);
});

test("an engine block with no reinforcement keeps its old shape", () => {
  const normalized = normalizeWorldState({
    economyEngine: { version: 1, seed: "abc", lastDate: "2026-04-01", lastMonth: 3 },
  });
  assert.deepEqual(Object.keys(normalized.economyEngine).sort(), ["lastDate", "lastMonth", "seed", "version"]);
});
