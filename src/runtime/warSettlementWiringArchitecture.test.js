// Run: node --test src/runtime/warSettlementWiringArchitecture.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
const adapter = readFileSync(new URL("./warSettlement.js", import.meta.url), "utf8");
const core = readFileSync(new URL("../engine/warSettlement.js", import.meta.url), "utf8");

test("the settlement core imports only the shared math", () => {
  const specifiers = [...core.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(specifiers, ["./economyMath.js"]);
});

test("the turn settles after the battles and before the impacts", () => {
  const battlesAt = gameplay.indexOf("resolveEventEngagements(freshEvents");
  const settleAt = gameplay.indexOf("resolveWarSettlements({");
  const applyAt = gameplay.indexOf("const impactMerge = applyEventImpactsToWorld(");
  const reparationAt = gameplay.indexOf("applyWarReparations(worldWithImpacts");
  const warMergeAt = gameplay.indexOf("worldWithImpacts = warMerge.world;");
  assert.ok(battlesAt > 0 && settleAt > 0 && applyAt > 0, "a settlement seam is missing");
  assert.ok(battlesAt < settleAt, "settlement must run after the battles resolve");
  assert.ok(settleAt < applyAt, "settlement must run before the impacts are applied");
  assert.ok(warMergeAt > 0 && reparationAt > warMergeAt, "reparations must be paid after the war closes");
});

test("the adapter never writes the war ledger or a combat region", () => {
  assert.equal(/applyWarUpdates\s*\(/.test(adapter), false);
  assert.match(adapter, /impacts\.regionTransfers/);
  assert.equal(/combatRegion\s*:/.test(adapter), false);
});

test("the turn passes the weariness and the resolver to the war ledger", () => {
  const mergeAt = gameplay.indexOf("weariness: settlementOutcome.weariness");
  assert.ok(mergeAt > 0, "the ledger is not handed the weariness");
  assert.ok(gameplay.indexOf("resolveRegion: regionResolver.resolve") > 0, "the ledger is not handed the resolver");
});

test("the turn withholds a war it closes itself from settlement", () => {
  const closedAt = gameplay.indexOf("const modelClosedWarIds = new Set(");
  const dueAt = gameplay.indexOf("const dueSettlements = settlementOutcome.settlements");
  const filterAt = gameplay.indexOf(
    ".filter((settlement) => !modelClosedWarIds.has(normalizeString(settlement.warId)))",
  );
  const reparationAt = gameplay.indexOf("applyWarReparations(worldWithImpacts, dueSettlements)");
  assert.ok(closedAt > 0 && dueAt > closedAt, "the model-closed wars are not withheld");
  assert.ok(filterAt > dueAt, "the settlements are not filtered by the model-closed ids");
  assert.ok(reparationAt > 0, "reparations are paid from the unfiltered settlement set");
});

test("the adapter reads a war's recorded unjust aggressors", () => {
  assert.match(adapter, /war\.unjustAggressors/);
});

test("the adapter passes the unjust flags to the core", () => {
  const inputsAt = adapter.indexOf("const settlementInputs = {");
  const inputs = adapter.slice(inputsAt, adapter.indexOf("};", inputsAt));
  assert.ok(inputsAt > 0, "the shared settlement inputs are not found");
  assert.match(inputs, /unjustA/);
  assert.match(inputs, /unjustB/);
  assert.match(adapter, /const settlement = settleWar\(settlementInputs\);/);
  assert.match(adapter, /settlementTerms\(settlementInputs\)/);
});

test("the turn's peace receipt names a punitive settlement", () => {
  const at = gameplay.indexOf("The war ${settlement.warId} closed:");
  const receipt = gameplay.slice(at, gameplay.indexOf("region(s) moved", at));
  assert.match(receipt, /settlement\.punitive && settlement\.white === false/);
});
