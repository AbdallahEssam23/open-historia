// Run: node --test src/Game/AI/casusBelliWiringArchitecture.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");

test("the turn judges a war's just cause after the breach charge and before the obligations", () => {
  const breachApplyAt = gameplay.indexOf("applyTreatyBreaches(");
  const casusReadAt = gameplay.indexOf("readWarCasus(worldWithImpacts");
  const casusApplyAt = gameplay.indexOf("applyWarCasus(worldWithImpacts");
  const obligationReadAt = gameplay.indexOf("readTreatyObligations(worldWithImpacts");
  assert.ok(breachApplyAt > 0, "the breach cost must be charged");
  assert.ok(casusReadAt > breachApplyAt, "the casus pre-pass reads after the breach charge");
  assert.ok(casusApplyAt > casusReadAt, "the casus cost is charged after it is read");
  assert.ok(obligationReadAt > casusApplyAt, "the casus pre-pass runs before the obligation step");
});

test("the war directive prints the casus digest the jump prompt builds", () => {
  const start = gameplay.indexOf("const buildWarLedgerDirective = (variables) => {");
  assert.ok(start > 0, "the war directive builder is missing");
  const end = gameplay.indexOf("\n};", start);
  const body = gameplay.slice(start, end);
  assert.match(body, /warCasus/, "the directive does not read the casus digest");
  assert.ok(gameplay.indexOf("variables.warCasus =") > 0, "the jump prompt never sets variables.warCasus");
});
