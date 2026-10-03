// Run: node --test src/Game/AI/treatyObligationsWiringArchitecture.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");

test("the turn enforces obligations right after the war ledger merges", () => {
  const warMergeAt = gameplay.indexOf("worldWithImpacts = warMerge.world;");
  const readAt = gameplay.indexOf("readTreatyObligations(worldWithImpacts");
  const applyAt = gameplay.indexOf("applyTreatyJoins(worldWithImpacts");
  const reparationAt = gameplay.indexOf("applyWarReparations(worldWithImpacts");
  assert.ok(warMergeAt > 0 && readAt > warMergeAt, "obligations must be read after the war merge");
  assert.ok(applyAt > readAt, "the joins must be applied after they are read");
  assert.ok(reparationAt > applyAt, "the joins must land before the reparations");
});

test("the war directive prints the obligations digest the jump prompt builds", () => {
  const start = gameplay.indexOf("const buildWarLedgerDirective = (variables) => {");
  assert.ok(start > 0, "the war directive builder is missing");
  const end = gameplay.indexOf("\n};", start);
  const body = gameplay.slice(start, end);
  assert.match(body, /treatyObligations/, "the directive does not read the obligations");
  assert.match(body, /A treaty is not narrative/, "the directive does not state the engine obeys the treaty");
  assert.ok(gameplay.indexOf("variables.treatyObligations =") > 0, "the jump prompt never sets variables.treatyObligations");
});

test("the turn resolves declared breaches before the treaty obligations", () => {
  const breachReadAt = gameplay.indexOf("readTreatyBreaches(worldWithImpacts");
  // The cost runs on the world the agreement merge returned, not on
  // worldWithImpacts directly, so the guard only pins the order of the calls.
  const breachApplyAt = gameplay.indexOf("applyTreatyBreaches(");
  const obligationReadAt = gameplay.indexOf("readTreatyObligations(worldWithImpacts");
  assert.ok(breachReadAt > 0, "the pre-pass must read the declared breaches");
  assert.ok(breachApplyAt > breachReadAt, "the turn must charge the breach cost after reading it");
  assert.ok(obligationReadAt > breachApplyAt, "the breach pre-pass must run before the obligation step");
});

test("the war directive prints the breach digest the jump prompt builds", () => {
  const start = gameplay.indexOf("const buildWarLedgerDirective = (variables) => {");
  const end = gameplay.indexOf("\n};", start);
  const body = gameplay.slice(start, end);
  assert.match(body, /treatyBreach/, "the directive does not read the breach digest");
  assert.ok(gameplay.indexOf("variables.treatyBreach =") > 0, "the jump prompt never sets variables.treatyBreach");
});

test("the diplomatic directive tells the model it may breach a treaty", () => {
  const start = gameplay.indexOf("const buildDiplomaticLedgerDirective = (variables) => {");
  assert.ok(start > 0, "the diplomatic directive builder is missing");
  const end = gameplay.indexOf("\n};", start);
  const body = gameplay.slice(start, end);
  assert.match(
    body,
    /op is start, update, suspend, resume, end, expire or breach/,
    "the agreement op list does not offer a breach",
  );
});

test("a resolved breach is removed from the later diplomatic merge", () => {
  assert.ok(
    gameplay.includes("agreementUpdates: otherAgreementUpdates"),
    "the later merge still receives the breach records and would apply them twice",
  );
});
