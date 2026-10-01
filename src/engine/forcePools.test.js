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

test("a padded persisted key is trimmed, not dropped", () => {
  assert.deepEqual(normalizePools({ " France ": { manpower: 10, materiel: 2 } }), { France: { manpower: 10, materiel: 2 } });
  assert.deepEqual(normalizeMobilizationMap({ " France ": "total" }), { France: "total" });
  assert.deepEqual(normalizeUpkeepShortfall({ " France ": { manpower: 10, materiel: 2 } }), { France: { manpower: 10, materiel: 2 } });
});

test("the pending cap folds an already-seen polity instead of rejecting it", () => {
  const twenty = Array.from({ length: 20 }, (_, i) => ({ polity: `P${i}`, posture: "partial" }));
  const folded = normalizePendingMobilization([...twenty, { country: "P0", posture: "total" }]);
  assert.equal(folded.length, 20);
  assert.equal(folded.find((entry) => entry.polity === "P0").posture, "total");
});

test("postureFor returns the default for an absent polity", () => {
  assert.equal(postureFor({ Germany: "total" }, "France"), "peacetime");
  assert.equal(postureFor({ Germany: "total" }, "Germany"), "total");
});

import {
  FORCE_POOLS,
  applyMobilization,
  initialPoolsFor,
  shortfallPressureFor,
  stepPolityPools,
} from "./forcePools.js";
import { makePolityEconomy } from "./economyTick.js";

const polityFixture = (over = {}) =>
  makePolityEconomy({
    population: 100_000_000,
    gdp: 1_000_000_000_000,
    gdpPerCapita: 10_000,
    gdpBreakdown: { agriculture: 10, industry: 35, services: 55 },
    stability: 60,
    ...over,
  });

test("a polity with no committed pools starts from its population and output", () => {
  const pools = initialPoolsFor(polityFixture());
  assert.equal(pools.manpower, Math.round(100_000_000 * FORCE_POOLS.INITIAL_MANPOWER_SHARE));
  assert.ok(pools.materiel > 0);
});

test("the pools are deterministic for the same inputs", () => {
  const p = polityFixture();
  const a = stepPolityPools(p, { pools: { manpower: 1_000_000, materiel: 100 }, posture: "peacetime" });
  const b = stepPolityPools(p, { pools: { manpower: 1_000_000, materiel: 100 }, posture: "peacetime" });
  assert.deepEqual(a, b);
});

test("total mobilization drains faster than peacetime over a year", () => {
  let war = { manpower: 500_000, materiel: 50 };
  let peace = { manpower: 500_000, materiel: 50 };
  const p = polityFixture();
  const upkeep = { manpower: 2_000_000, materiel: 400 };
  for (let i = 0; i < 12; i += 1) {
    war = stepPolityPools(p, { pools: war, posture: "total", upkeep }).pools;
    peace = stepPolityPools(p, { pools: peace, posture: "peacetime", upkeep }).pools;
  }
  assert.ok(war.materiel > peace.materiel, "total allocates more materiel");
});

test("the zero floor holds when upkeep exceeds the pool, and the shortfall is exact", () => {
  const p = polityFixture({ population: 1_000, gdp: 1000 });
  const result = stepPolityPools(p, {
    pools: { manpower: 100, materiel: 0 },
    posture: "peacetime",
    upkeep: { manpower: 50_000, materiel: 900 },
  });
  assert.equal(result.pools.manpower, 0, "never negative");
  assert.equal(result.pools.materiel, 0, "never negative");
  assert.ok(result.shortfall.manpower > 0);
  assert.ok(result.shortfall.materiel > 0);
});

test("a hundred peaceful years stay under the cap", () => {
  const p = polityFixture();
  let pools = initialPoolsFor(p);
  for (let i = 0; i < 1200; i += 1) pools = stepPolityPools(p, { pools, posture: "peacetime" }).pools;
  assert.ok(pools.manpower <= Math.round(100_000_000 * FORCE_POOLS.MANPOWER_CAP_SHARE));
  assert.ok(pools.materiel <= 1_000_000_000_000 * FORCE_POOLS.MATERIEL_CAP_SHARE);
});

test("a shortfall becomes stability pressure, bounded", () => {
  const pressure = shortfallPressureFor({ manpower: 1_000_000, materiel: 500 }, { manpower: 1_000_000, materiel: 500 });
  assert.ok(pressure > 0 && pressure <= FORCE_POOLS.STABILITY_UPKEEP_SHORTFALL);
  assert.equal(shortfallPressureFor(null, { manpower: 1, materiel: 1 }), 0);
});

test("mobilization folds into the multiplier vector without touching inflation", () => {
  const base = { population: 1, gdp: 1, inflation: 3, unemployment: 5, stability: 10 };
  const war = applyMobilization(base, "total", { shortfallPressure: 2 });
  assert.ok(war.gdp < 1, "the call-up drags output");
  assert.equal(war.inflation, 3);
  assert.ok(war.stability < 10, "it costs stability");
  assert.deepEqual(applyMobilization(base, "peacetime"), base);
});

test("a regeneration multiplier raises the monthly gain", () => {
  const polity = { population: 10_000_000, gdp: 1e11, gdpBreakdown: { industry: 30 } };
  const base = stepPolityPools(polity, { pools: { manpower: 0, materiel: 0 }, posture: "peacetime" });
  const boosted = stepPolityPools(polity, {
    pools: { manpower: 0, materiel: 0 },
    posture: "peacetime",
    regenMultiplier: 1.3,
  });
  assert.ok(boosted.pools.manpower > base.pools.manpower);
  assert.ok(boosted.pools.materiel > base.pools.materiel);
});

test("a missing or non-positive regeneration multiplier is a no-op", () => {
  const polity = { population: 10_000_000, gdp: 1e11, gdpBreakdown: { industry: 30 } };
  const base = stepPolityPools(polity, { pools: { manpower: 0, materiel: 0 }, posture: "peacetime" });
  for (const bad of [undefined, 0, -1, Number.NaN]) {
    const same = stepPolityPools(polity, {
      pools: { manpower: 0, materiel: 0 },
      posture: "peacetime",
      regenMultiplier: bad,
    });
    assert.deepEqual(same.pools, base.pools);
  }
});
