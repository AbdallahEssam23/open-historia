// Run: node --test src/runtime/warFacts.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { buildWarFactsDirective } from "./warFacts.js";

test("no facts is no block", () => {
  assert.equal(buildWarFactsDirective(), "");
  assert.equal(buildWarFactsDirective({}), "");
  assert.equal(
    buildWarFactsDirective({ treatyObligations: "  ", treatyBreach: "", warCasus: null, peaceOffer: undefined }),
    "",
  );
});

test("one fact renders under the header with the framing", () => {
  const block = buildWarFactsDirective({ peaceOffer: "[Peace Offer Pending, as simulated]" });
  assert.match(block, /^\[Standing War Facts\]\n/);
  assert.match(block, /\[Peace Offer Pending, as simulated\]/);
  assert.match(block, /do not conclude, close, leave or cease fire/);
});

test("all four render in the fixed order with no blank lines", () => {
  const block = buildWarFactsDirective({
    treatyObligations: "OBLIGATION",
    treatyBreach: "BREACH",
    warCasus: "CASUS",
    peaceOffer: "OFFER",
  });
  const positions = ["OBLIGATION", "BREACH", "CASUS", "OFFER"].map((line) => block.indexOf(line));
  assert.ok(positions.every((at) => at > 0), "every fact is present");
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), "the facts keep their fixed order");
  assert.equal(block.split("\n\n").length, 1, "the block has no blank separator");
});
