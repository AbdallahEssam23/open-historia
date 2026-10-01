import test from "node:test";
import assert from "node:assert/strict";

import { ENGINE_VERSION, MAX_STEPS, MONTH_DAYS, eraBandFor } from "./economyConstants.js";

test("the clock constants are the approved ones", () => {
  assert.equal(MONTH_DAYS, 30);
  assert.equal(MAX_STEPS, 240);
  assert.equal(ENGINE_VERSION, 1);
});

test("era bands are ordered and every band is positive", () => {
  const years = [-1200, 1000, 1600, 1800, 1930, 1970, 2026];
  for (const year of years) {
    const band = eraBandFor(year);
    assert.ok(band.populationMonthly > 0, `${year} population`);
    assert.ok(band.productivityMonthly > 0, `${year} productivity`);
  }
  // Modern productivity must exceed medieval productivity, or the bands are
  // wired backwards.
  assert.ok(eraBandFor(2026).productivityMonthly > eraBandFor(-1200).productivityMonthly);
});

test("a missing or unparseable year falls back to the modern band, never throws", () => {
  assert.deepEqual(eraBandFor(null), eraBandFor(2026));
  assert.deepEqual(eraBandFor(Number.NaN), eraBandFor(2026));
});
