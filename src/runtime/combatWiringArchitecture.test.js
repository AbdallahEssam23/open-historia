// Run: node --test src/runtime/combatWiringArchitecture.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
const adapter = readFileSync(new URL("./combatEngagements.js", import.meta.url), "utf8");
const core = readFileSync(new URL("../engine/combat.js", import.meta.url), "utf8");

// The turn's seams, as source offsets, so the ordering assertions below are
// about positions in the file rather than mere presence anywhere in it.
const normalizeAt = gameplay.indexOf("const baseWorldNormalized = normalizeWorldState(baseWorld);");
const resolveAt = gameplay.indexOf("resolveEventEngagements(freshEvents");
const mergeAt = gameplay.indexOf("mergeEngagementResults(freshEvents, engagementOutcome.results)");
const applyAt = gameplay.indexOf("const impactMerge = applyEventImpactsToWorld(");
const impactAt = gameplay.indexOf("let impactedWorld = impactMerge.world;");
const chargeAt = gameplay.indexOf("impactedWorld = applyCombatReserveCost(impactedWorld");

test("the core imports nothing", () => {
  assert.equal(/from\s*["']/.test(core), false, "combat.js must not import from a module");
  assert.equal(/\brequire\s*\(/.test(core), false, "combat.js must not require a module");
  assert.equal(/\bimport\s*\(/.test(core), false, "combat.js must not dynamically import");
  assert.equal(/^\s*import\s+["']/m.test(core), false, "combat.js must not side-effect import");
});

test("the adapter resolves against the ledger and the roster", () => {
  assert.match(adapter, /world\?\.wars/);
  assert.match(adapter, /world\?\.units/);
  assert.match(adapter, /economyEngine\?\.mobilization/);
});

test("the adapter reads the region terrain and the turn passes the catalog", () => {
  assert.match(adapter, /regionCoastal\(regionId, regionCatalog\)/);
  assert.match(gameplay, /regionCatalog: getPrimedScenarioRegionCatalog\(\) \?\? \[\]/);
});

test("the turn runs the adapter before applying impacts", () => {
  assert.ok(normalizeAt > 0, "the pre-turn world normalization is not found");
  assert.ok(resolveAt > 0, "the adapter is not called");
  assert.ok(applyAt > 0, "the impact applier is not found");
  assert.ok(normalizeAt < resolveAt, "the adapter must run after the pre-turn world is normalized");
  assert.ok(resolveAt < applyAt, "the adapter must run before applyEventImpactsToWorld");
});

test("the turn merges the adapter's result into the model's events", () => {
  assert.ok(mergeAt > 0, "the adapter result is not merged");
  assert.ok(resolveAt < mergeAt, "the result must be merged after it is resolved");
  assert.ok(mergeAt < applyAt, "the result must be merged before applyEventImpactsToWorld");
});

test("the turn charges the reserves after the impacts land", () => {
  assert.ok(impactAt > 0, "the impact merge is not found");
  assert.ok(chargeAt > 0, "the reserve cost is not assigned to impactedWorld");
  assert.ok(chargeAt > impactAt, "the reserve cost must follow the impact merge");
});

test("the merge drops the model's numbers and its region claim, in the adapter", () => {
  assert.match(adapter, /\["strength", "remove"\]\.includes/);
  assert.match(adapter, /impacts\.regionTransfers = list\(impacts\.regionTransfers\)\.filter/);
  assert.match(adapter, /impacts\.regionControlOps = list\(impacts\.regionControlOps\)\.filter/);
});
