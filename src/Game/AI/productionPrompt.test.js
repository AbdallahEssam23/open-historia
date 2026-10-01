// Run: node --test src/Game/AI/productionPrompt.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { buildProductionInstructions } from "./gameplayPrompts.js";

test("the instructions forbid stating a cost and name the closed kinds", () => {
  const text = buildProductionInstructions();
  assert.match(text, /\[National Production\]/);
  assert.match(text, /unit/);
  assert.match(text, /building/);
  assert.match(text, /NEXT period/i);
  assert.match(text, /never state/i);
});

test("the queue is not to be duplicated through the event impacts", () => {
  const text = buildProductionInstructions();
  assert.match(text, /unitOps/);
  assert.match(text, /markerOps/);
});

test("a digest is appended as given facts", () => {
  const text = buildProductionInstructions({ digest: "Production line: 2x infantry (1 month left)." });
  assert.match(text, /Production line: 2x infantry \(1 month left\)\./);
});
