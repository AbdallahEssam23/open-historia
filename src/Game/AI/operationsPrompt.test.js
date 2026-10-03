// Run: node --test src/Game/AI/operationsPrompt.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { buildForcePoolsInstructions } from "./gameplayPrompts.js";

test("the force-pool block renders the operations digest when it is given", () => {
  const text = buildForcePoolsInstructions({
    digest: "Your reserves: nothing.",
    operations: "[Your Forces in the Field, as simulated]\n1 of 1 formations in supply.",
  });
  assert.match(text, /\[Your Forces in the Field, as simulated\]/);
  assert.match(text, /1 of 1 formations in supply\./);
});

test("the operations heading is omitted when the block is empty", () => {
  const text = buildForcePoolsInstructions({ digest: "Your reserves: nothing." });
  assert.equal(text.includes("[Your Forces in the Field"), false);
});

test("the rule teaches when each policy and each consolidation fits", () => {
  const text = buildForcePoolsInstructions();
  assert.match(text, /husband/i);
  assert.match(text, /pocket/i);
  assert.match(text, /replacements/);
  assert.match(text, /belligerent/);
});
