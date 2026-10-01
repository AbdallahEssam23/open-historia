// Run: node --test src/runtime/countryStats.engineWrite.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { mergeCountryStatPatch } from "./countryStats.js";

const base = () => ({
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
  },
  population: { total: 100_000_000, coreIntegrated: 100_000_000, otherTerritories: 0 },
  gdpBreakdown: { agriculture: 10, industry: 35, services: 55 },
  continuity: { assessedDate: "2026-01-01", assessedRound: 2 },
});

test("an engine write is marked in continuity", () => {
  const merged = mergeCountryStatPatch(base(), { economy: { gdpGrowth: 3.5 } }, { engineSourced: true });
  assert.equal(merged.continuity.engineSourced, true);
  assert.equal(merged.economy.gdpGrowth, 3.5);
});

test("an ordinary write does not carry the mark", () => {
  const merged = mergeCountryStatPatch(base(), { economy: { gdpGrowth: 3.5 } });
  assert.notEqual(merged.continuity.engineSourced, true);
});

test("the mark does not survive a later ordinary write on the same sheet", () => {
  const engineWritten = mergeCountryStatPatch(base(), { economy: { gdpGrowth: 3.5 } }, { engineSourced: true });
  const later = mergeCountryStatPatch(engineWritten, { indices: { sovereignty: 50 } });
  assert.notEqual(later.continuity.engineSourced, true);
});

test("a marked write changes no other field", () => {
  const plain = mergeCountryStatPatch(base(), { economy: { gdpGrowth: 3.5 } });
  const marked = mergeCountryStatPatch(base(), { economy: { gdpGrowth: 3.5 } }, { engineSourced: true });
  delete marked.continuity.engineSourced;
  assert.deepEqual(marked, plain);
});

test("the guard stands down for an engine write and still bands an ordinary one", async () => {
  const { guardCountryStatContinuity } = await import("./countryStats.js");
  const engineSheet = mergeCountryStatPatch(base(), { economy: { gdpGrowth: 40 } }, { engineSourced: true });
  const passed = guardCountryStatContinuity(base(), engineSheet, { elapsedYears: 0 });
  assert.equal(passed.restored.length, 0);
  assert.equal(passed.sheet.economy.gdpGrowth, 40);

  const modelSheet = mergeCountryStatPatch(base(), { economy: { gdpGrowth: 40 } });
  const banded = guardCountryStatContinuity(base(), modelSheet, { elapsedYears: 0 });
  assert.ok(banded.restored.some((row) => row.field === "gdpGrowth"));
  assert.equal(banded.sheet.economy.gdpGrowth, 2);
});
