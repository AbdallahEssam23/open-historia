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
  assert.match(body, /warCasus \?/, "the directive does not print the casus digest");
  assert.match(gameplay, /warCasus: buildWarCasusDigest\(/, "the war facts builder does not set the casus digest");
  assert.ok(gameplay.indexOf("await buildWarFactsVariables({") > 0, "the jump never builds the war facts");
});

test("the turn judges only the starts the war ledger applied", () => {
  const appliedAt = gameplay.indexOf("warMerge.appliedIds");
  const casusReadAt = gameplay.indexOf("readWarCasus(worldWithImpacts");
  assert.ok(appliedAt > 0, "the pre-pass must read the ids the ledger applied");
  assert.ok(appliedAt < casusReadAt, "the applied-id gate must precede the casus read");
});
