import test from "node:test";
import assert from "node:assert/strict";

import { clamp, jitterFor, monthsBetweenDates, roundTo, stableOrder } from "./economyMath.js";

test("clamp pins to both ends and passes an in-range value through", () => {
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(42, 0, 10), 10);
  assert.equal(clamp(4.5, 0, 10), 4.5);
});

test("roundTo is exact enough that float noise cannot change a stored value", () => {
  assert.equal(roundTo(1.005, 2), 1.01);
  assert.equal(roundTo(0.1 + 0.2, 2), 0.3);
  assert.equal(roundTo(1234.5, 0), 1235);
});

test("months are whole 30 day steps, and anything unusable is zero", () => {
  assert.equal(monthsBetweenDates("2026-01-01", "2026-04-01"), 3);
  assert.equal(monthsBetweenDates("2026-01-01", "2026-01-11"), 0);
  assert.equal(monthsBetweenDates("2026-01-01", "2025-01-01"), 0);
  assert.equal(monthsBetweenDates("1200 BCE", "2026-01-01"), 0);
  assert.equal(monthsBetweenDates("", "2026-01-01"), 0);
});

test("jitter is deterministic, bounded, and differs per polity", () => {
  const a = jitterFor("seed-1", "Egypt");
  assert.equal(a, jitterFor("seed-1", "Egypt"));
  assert.ok(a >= -1 && a <= 1);
  assert.notEqual(a, jitterFor("seed-1", "France"));
  assert.notEqual(a, jitterFor("seed-2", "Egypt"));
});

test("stableOrder does not depend on the incoming order", () => {
  assert.deepEqual(stableOrder(["France", "Egypt", "France"]), ["Egypt", "France"]);
  assert.deepEqual(stableOrder(["Egypt", "France"]), stableOrder(["France", "Egypt"]));
});
