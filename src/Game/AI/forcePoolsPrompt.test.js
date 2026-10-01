// Run: node --test src/Game/AI/forcePoolsPrompt.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { buildForcePoolsInstructions } from "./gameplayPrompts.js";

test("the instructions forbid stating a reserve and name the closed list", () => {
  const text = buildForcePoolsInstructions();
  assert.match(text, /\[National Forces\]/);
  assert.match(text, /demobilized, peacetime, partial, total/);
  assert.match(text, /never state/i);
  assert.match(text, /NEXT period/i);
});

test("a digest is appended as given facts", () => {
  const text = buildForcePoolsInstructions({ digest: "Your reserves: manpower 1,000." });
  assert.match(text, /Your reserves: manpower 1,000\./);
});
