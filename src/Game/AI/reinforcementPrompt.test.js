// Run: node --test src/Game/AI/reinforcementPrompt.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { buildForcePoolsInstructions } from "./gameplayPrompts.js";

test("the force-pool rules teach reinforcement, rotation and merging", () => {
  const text = buildForcePoolsInstructions();
  assert.match(text, /\[National Forces\]/);
  assert.match(text, /reinforcement/i);
  assert.match(text, /rotation/i);
  assert.match(text, /merge/i);
  assert.match(text, /NEXT period/i);
  assert.match(text, /state no .*number/i);
});
