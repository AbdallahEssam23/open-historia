import test from "node:test";
import assert from "node:assert/strict";

import { mergeCountryStatPatch, normalizeCountryStatSheet, stripEngineOnlyStatFields } from "./countryStats.js";
import { validateGameplayPayload } from "../Game/AI/gameplaySchemas.js";

const forces = { manpower: 1200, materiel: 40.5, mobilization: "total" };

test("the sheet reads a well-formed forces block", () => {
  const sheet = normalizeCountryStatSheet({ statsSchemaVersion: 1, forces });
  assert.deepEqual(sheet.forces, forces);
});

test("a bad posture is dropped and a negative pool is floored", () => {
  const sheet = normalizeCountryStatSheet({
    statsSchemaVersion: 1,
    forces: { manpower: -5, materiel: 3, mobilization: "waving" },
  });
  assert.deepEqual(sheet.forces, { manpower: 0, materiel: 3 });
});

test("an engine-sourced patch writes forces", () => {
  const merged = mergeCountryStatPatch({ statsSchemaVersion: 1 }, { forces }, { engineSourced: true });
  assert.deepEqual(merged.forces, forces);
});

test("an ordinary patch cannot write forces", () => {
  const merged = mergeCountryStatPatch({ statsSchemaVersion: 1 }, { forces }, { engineSourced: false });
  assert.equal(merged.forces, undefined);
});

test("an ordinary patch cannot overwrite engine-written forces", () => {
  const base = normalizeCountryStatSheet({ statsSchemaVersion: 1, forces });
  const merged = mergeCountryStatPatch(base, { forces: { manpower: 1, materiel: 1, mobilization: "peacetime" } }, {});
  assert.deepEqual(merged.forces, forces);
});

test("a sheet reads the shortfall the reserves could not pay", () => {
  const sheet = normalizeCountryStatSheet({
    statsSchemaVersion: 1,
    forces: { ...forces, shortfall: { manpower: 30, materiel: 0 } },
  });
  assert.deepEqual(sheet.forces, { ...forces, shortfall: { manpower: 30 } });
});

test("a sub-unit shortfall rounds away instead of being stored as zero", () => {
  const sheet = normalizeCountryStatSheet({
    statsSchemaVersion: 1,
    forces: { ...forces, shortfall: { manpower: 0.4, materiel: 0.004 } },
  });
  assert.equal(sheet.forces.shortfall, undefined);
});

test("an engine write that pays the army in full clears the stored shortfall", () => {
  const base = normalizeCountryStatSheet({
    statsSchemaVersion: 1,
    forces: { ...forces, shortfall: { manpower: 30, materiel: 2 } },
  });
  const merged = mergeCountryStatPatch(base, { forces }, { engineSourced: true });
  assert.deepEqual(merged.forces, forces);
  assert.equal(merged.forces.shortfall, undefined);
});

// The Stats pane validates a native sheet with the model-facing schema, which
// deliberately excludes the engine-only block. Without stripping it, every
// sheet the engine has advanced is rejected and the panel cannot show it.
const completeSheet = () => ({
  statsSchemaVersion: 1,
  capital: "Cairo",
  continent: "Africa",
  government: "Republic",
  leader: "A Leader",
  stability: 60,
  indices: { sovereignty: 60 },
  territorialComponents: [{ geography: "Egypt", group: "core", population: 1_000_000, gdpPerCapita: 1_000 }],
  population: { total: 1_000_000, coreIntegrated: 1_000_000, otherTerritories: 0 },
  economy: {
    gdp: 1e9,
    gdpPerCapita: 1_000,
    gdpGrowth: 2,
    inflation: 5,
    unemployment: 8,
    publicDebt: 80,
    budgetBalance: -2,
    currency: "EGP",
  },
  gdpBreakdown: { agriculture: 10, industry: 30, services: 60 },
  continuity: { assessedDate: "2026-01-01", engineSourced: true },
});

test("the model-facing schema rejects the engine-only block", () => {
  const sheet = normalizeCountryStatSheet({ ...completeSheet(), forces });
  const verdict = validateGameplayPayload("countryStatSheet", sheet);
  assert.equal(verdict.valid, false);
  assert.match(verdict.error, /\$\.forces is not allowed/);
});

test("stripping the engine-only fields lets an engine-advanced sheet validate", () => {
  const sheet = normalizeCountryStatSheet({ ...completeSheet(), forces });
  assert.equal(sheet.continuity.engineSourced, true);
  const stripped = stripEngineOnlyStatFields(sheet);
  const verdict = validateGameplayPayload("countryStatSheet", stripped);
  assert.equal(verdict.valid, true, verdict.error);
  // The block and the last-writer mark are gone; everything else is intact.
  assert.equal(stripped.forces, undefined);
  assert.equal(stripped.continuity.engineSourced, undefined);
  assert.equal(stripped.continuity.assessedDate, "2026-01-01");
  const expected = { ...sheet };
  delete expected.forces;
  expected.continuity = { ...sheet.continuity };
  delete expected.continuity.engineSourced;
  assert.deepEqual(stripped, expected);
});

test("a continuity with only the last-writer mark is dropped entirely", () => {
  const stripped = stripEngineOnlyStatFields({ capital: "Cairo", continuity: { engineSourced: true } });
  assert.deepEqual(stripped, { capital: "Cairo" });
});
