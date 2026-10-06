// Run: node --test src/runtime/warTerminationWiringArchitecture.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
const gateway = readFileSync(new URL("../Game/AI/strategicGateway.js", import.meta.url), "utf8");
const adapter = readFileSync(new URL("./warSettlement.js", import.meta.url), "utf8");
const engine = readFileSync(new URL("../engine/warSettlement.js", import.meta.url), "utf8");
const menu = readFileSync(new URL("../engine/strategicIntent.js", import.meta.url), "utf8");

// The turn's seams, as source offsets, so the ordering assertions are about
// positions rather than mere presence anywhere in the file.
const gatewayAt = gameplay.indexOf("const strategicOutcome = applyStrategicIntents({");
const foldAt = gameplay.indexOf("for (const peace of normalizeArray(strategicOutcome.accepted?.seekPeace))");
const settleTickAt = gameplay.indexOf("tickHandlers.settlements = () => {");
const ledgerTickAt = gameplay.indexOf('await runTick(["warLedger"]);');
const factsAt = gameplay.indexOf("settlements: dueSettlements.length > 0,");

test("the gateway forwards the player and reads seek_peace without applying it", () => {
  assert.match(gateway, /playerPolity = ""/);
  assert.match(gateway, /strategicInputsFor\(world, polity, \{ regions, playerPolity \}\)/);
  assert.match(gateway, /intent\.op === "seek_peace"/);
  assert.match(gateway, /accepted\.seekPeace\.push/);
  assert.match(gateway, /accepted: \{ declareWar: \[\], pressClaim: \[\], seekPeace: \[\] \}/);
});

test("the pure law splits the terms from the gate and guards the seek", () => {
  assert.match(engine, /export const settlementTerms = \(input = \{\}\) => withoutDue\(deriveSettlement\(input\)\);/);
  assert.match(engine, /export const settleWar = \(input = \{\}\) => \{/);
  assert.match(engine, /export const canSeekPeace = \(\{ weariness = 0, ahead = false \} = \{\}\)/);
  assert.match(engine, /PEACE_REQUEST_WEARINESS = 0\.5/);
});

test("the menu offers a seek only for a weary, not-ahead, non-player war", () => {
  assert.match(menu, /canSeekPeace\(\{ weariness: war\?\.weariness, ahead: war\?\.ahead \}\)/);
  assert.match(menu, /if \(war\?\.party === true\) continue;/);
  assert.match(menu, /MAX_PEACE_SEEKS = 6/);
});

test("the adapter derives the seekable terms from the same inputs the solver reads", () => {
  assert.match(adapter, /export const seekPeaceFacts = /);
  assert.match(adapter, /peaceTermsByWarId\[warId\] = \{ settlement: settlementTerms\(settlementInputs\), belligerents: sides \}/);
  assert.match(adapter, /const settlement = settleWar\(settlementInputs\);/);
});

test("the turn folds an accepted seek after the gateway and before the ledger", () => {
  assert.ok(gatewayAt > 0, "the gateway call is not found");
  assert.ok(foldAt > 0, "the seek fold is not found");
  assert.ok(settleTickAt > 0, "the settlement phase is not found");
  assert.ok(ledgerTickAt > 0, "the war ledger phase is not found");
  assert.ok(settleTickAt < gatewayAt, "settlements resolve before the gateway reads their terms");
  assert.ok(gatewayAt < foldAt, "the fold follows the gateway's accepted list");
  assert.ok(foldAt < ledgerTickAt, "the fold must land before the ledger applies its end record");
});

test("the fold reuses the automatic path: one event, one end, one reparations list", () => {
  assert.match(gameplay, /buildSettlementEvent\(entry\.settlement, \{ date: nextGame\.gameDate, round: nextGame\.round \}\)/);
  assert.match(gameplay, /warUpdates\.push\(\{ eventIds: \[event\.id\], id: warId, op: "end" \}\)/);
  assert.match(gameplay, /dueSettlements\.push\(\{ \.\.\.entry\.settlement, belligerents: entry\.belligerents \}\)/);
  assert.ok(factsAt > foldAt, "the reparations gate is read after the fold, so a seeked war is paid");
});

test("the timeline is told only the seeks the engine honored", () => {
  assert.match(gameplay, /const honoredSeeks = \[\];/);
  assert.match(gameplay, /honoredSeeks\.push\(peace\);/);
  assert.match(gameplay, /accepted: \{ \.\.\.strategicOutcome\.accepted, seekPeace: honoredSeeks \}/);
});
