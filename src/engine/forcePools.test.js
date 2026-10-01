// src/engine/forcePools.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_POSTURE,
  MOBILIZATION_EFFECTS,
  UNIT_UPKEEP,
  normalizeMobilization,
  normalizeMobilizationMap,
  normalizePendingMobilization,
  normalizePools,
  normalizeUpkeepShortfall,
  postureFor,
} from "./forcePools.js";

test("the posture table is closed and peacetime is the identity", () => {
  assert.deepEqual(Object.keys(MOBILIZATION_EFFECTS), ["demobilized", "peacetime", "partial", "total"]);
  assert.deepEqual(
    MOBILIZATION_EFFECTS.peacetime,
    { extraction: 1, allocation: 1, growthDrag: 0, stabilityDrag: 0 },
  );
  assert.equal(DEFAULT_POSTURE, "peacetime");
});

test("mobilizing raises production and raises the drag", () => {
  assert.ok(MOBILIZATION_EFFECTS.partial.extraction > MOBILIZATION_EFFECTS.peacetime.extraction);
  assert.ok(MOBILIZATION_EFFECTS.total.growthDrag > MOBILIZATION_EFFECTS.partial.growthDrag);
  assert.ok(MOBILIZATION_EFFECTS.total.stabilityDrag > MOBILIZATION_EFFECTS.partial.stabilityDrag);
});

test("every unit type the roster can hold has an upkeep row", () => {
  for (const type of ["infantry", "armor", "air", "naval", "artillery", "garrison"]) {
    assert.ok(UNIT_UPKEEP[type], `${type} has upkeep`);
    assert.ok(UNIT_UPKEEP[type].manpower >= 0);
    assert.ok(UNIT_UPKEEP[type].materiel >= 0);
  }
});

test("a declared mobilization drops an unknown polity and an unknown posture", () => {
  const { valid, rejected } = normalizeMobilization(
    [
      { polity: "France", posture: "total" },
      { polity: "Atlantis", posture: "partial" },
      { polity: "France", posture: "waving" },
    ],
    { knownPolities: ["France", "Germany"] },
  );
  assert.deepEqual(valid, [{ polity: "France", posture: "total" }]);
  assert.equal(rejected.length, 2);
  assert.match(rejected[0].reason, /unknown polity/);
  assert.match(rejected[1].reason, /unknown posture/);
});

test("a duplicate polity folds, last one winning", () => {
  const { valid } = normalizeMobilization(
    [
      { polity: "France", posture: "partial" },
      { polity: "France", posture: "total" },
    ],
    { knownPolities: ["France"] },
  );
  assert.deepEqual(valid, [{ polity: "France", posture: "total" }]);
});

test("the pending mobilization round-trips through storage and rejects a bad posture", () => {
  assert.deepEqual(
    normalizePendingMobilization([{ polity: "France", posture: "total" }, { polity: "X", posture: "nope" }]),
    [{ polity: "France", posture: "total" }],
  );
});

test("normalizePools floors at zero and drops a non-numeric row", () => {
  assert.deepEqual(
    normalizePools({ France: { manpower: 1200.7, materiel: -3 }, Ghost: "nope" }),
    { France: { manpower: 1201, materiel: 0 } },
  );
});

test("the mobilization map omits the default posture", () => {
  assert.deepEqual(
    normalizeMobilizationMap({ France: "peacetime", Germany: "total", Italy: "junk" }),
    { Germany: "total" },
  );
});

test("the shortfall map keeps only a real shortfall", () => {
  assert.deepEqual(
    normalizeUpkeepShortfall({ France: { manpower: 400, materiel: 0 }, Germany: { manpower: 0, materiel: 0 } }),
    { France: { manpower: 400, materiel: 0 } },
  );
});

test("postureFor returns the default for an absent polity", () => {
  assert.equal(postureFor({ Germany: "total" }, "France"), "peacetime");
  assert.equal(postureFor({ Germany: "total" }, "Germany"), "total");
});
