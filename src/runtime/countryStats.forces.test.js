import test from "node:test";
import assert from "node:assert/strict";

import { mergeCountryStatPatch, normalizeCountryStatSheet } from "./countryStats.js";

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
