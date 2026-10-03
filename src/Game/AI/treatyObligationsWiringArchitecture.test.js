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
