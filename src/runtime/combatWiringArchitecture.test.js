// Run: node --test src/runtime/combatWiringArchitecture.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
const adapter = readFileSync(new URL("./combatEngagements.js", import.meta.url), "utf8");
const core = readFileSync(new URL("../engine/combat.js", import.meta.url), "utf8");

test("the core imports nothing", () => {
  assert.equal(/from\s+"/.test(core), false, "combat.js must be import-free");
});

test("the adapter resolves against the ledger and the roster", () => {
  assert.match(adapter, /world\?\.wars/);
  assert.match(adapter, /world\?\.units/);
  assert.match(adapter, /economyEngine\?\.mobilization/);
});

test("the turn runs the adapter before applying impacts", () => {
  const resolveAt = gameplay.indexOf("resolveEventEngagements(freshEvents");
  const applyAt = gameplay.indexOf("const impactMerge = applyEventImpactsToWorld(");
  assert.ok(resolveAt > 0, "the adapter is not called");
  assert.ok(applyAt > 0, "the impact applier is not found");
  assert.ok(resolveAt < applyAt, "the adapter must run before applyEventImpactsToWorld");
});

test("the turn charges the reserves after the impacts land", () => {
  const chargeAt = gameplay.indexOf("applyCombatReserveCost(impactedWorld");
  const impactAt = gameplay.indexOf("let impactedWorld = impactMerge.world;");
  assert.ok(chargeAt > 0, "the reserve cost is not applied");
  assert.ok(chargeAt > impactAt, "the reserve cost must follow the impact merge");
});

test("the turn merges the adapter's result into the model's events", () => {
  assert.match(gameplay, /mergeEngagementResults\(freshEvents, engagementOutcome\.results\)/);
});

test("the merge drops the model's numbers and its region claim, in the adapter", () => {
  assert.match(adapter, /\["strength", "remove"\]\.includes/);
  assert.match(adapter, /impacts\.regionTransfers = list\(impacts\.regionTransfers\)\.filter/);
  assert.match(adapter, /impacts\.regionControlOps = list\(impacts\.regionControlOps\)\.filter/);
});
