import test from "node:test";
import assert from "node:assert/strict";

import { MAX_SHOCKS, SHOCK_KINDS, activeMultipliers, normalizeShocks } from "./economyShocks.js";

test("the enum is closed and every kind has a table entry", async () => {
  const mod = await import("./economyShocks.js");
  assert.ok(SHOCK_KINDS.length >= 10);
  assert.ok(SHOCK_KINDS.includes("harvest_failure"));
  assert.ok(SHOCK_KINDS.includes("trade_boom"));
  for (const kind of SHOCK_KINDS) {
    assert.ok(Array.isArray(mod.SHOCK_EFFECTS[kind]), kind);
    assert.equal(mod.SHOCK_EFFECTS[kind].length, 3, kind);
  }
});

test("a well formed shock normalizes with a month window", () => {
  const { valid, rejected } = normalizeShocks([{ kind: "sanctions", severity: 2, durationMonths: 6, scope: ["Egypt"] }], {
    knownPolities: ["Egypt", "France"],
  });
  assert.equal(rejected.length, 0);
  assert.equal(valid.length, 1);
  assert.equal(valid[0].startMonth, 0);
  assert.equal(valid[0].endMonth, 6);
  assert.deepEqual(valid[0].scope, ["Egypt"]);
});

test("an unknown kind, a bad severity and a bad duration are rejected, never thrown", () => {
  const { valid, rejected } = normalizeShocks(
    [
      { kind: "sunspots", severity: 1, durationMonths: 3 },
      { kind: "sanctions", severity: 9, durationMonths: 3 },
      { kind: "sanctions", severity: 1, durationMonths: 0 },
      { kind: "sanctions", severity: 1, durationMonths: 999 },
      { kind: "blockade", severity: 1, durationMonths: 3, scope: ["Atlantis"] },
    ],
    { knownPolities: ["Egypt"] },
  );
  assert.equal(valid.length, 1);
  assert.equal(valid[0].kind, "blockade");
  assert.deepEqual(valid[0].scope, []);
  assert.equal(rejected.length, 4);
  for (const row of rejected) assert.ok(typeof row.reason === "string" && row.reason.length > 0);
});

test("the array is capped", () => {
  const many = Array.from({ length: MAX_SHOCKS + 5 }, () => ({ kind: "sanctions", severity: 1, durationMonths: 3 }));
  const { valid, rejected } = normalizeShocks(many);
  assert.equal(valid.length, MAX_SHOCKS);
  assert.equal(rejected.length, 5);
});

test("multipliers apply only inside the window and compose across kinds", () => {
  const { valid } = normalizeShocks([
    { kind: "sanctions", severity: 3, durationMonths: 4 },
    { kind: "reconstruction", severity: 2, durationMonths: 4 },
  ]);
  const inside = activeMultipliers(valid, 1);
  const outside = activeMultipliers(valid, 9);
  assert.ok(inside.gdp < 1, "sanctions pull growth down");
  assert.ok(inside.inflation > 0);
  assert.equal(outside.gdp, 1);
  assert.equal(outside.inflation, 0);
  assert.equal(outside.stability, 0);
});

test("a world-scope shock reaches a polity that is not named", () => {
  const { valid } = normalizeShocks([{ kind: "mobilization", severity: 2, durationMonths: 12 }]);
  assert.equal(valid[0].scope, null);
  assert.ok(activeMultipliers(valid, 1).gdp !== 1);
});
