// Run: node --test src/Game/AI/economicShocksSchema.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { JUMP_FORWARD_SCHEMA } from "./gameplaySchemas.js";
import { MAX_SHOCKS, SHOCK_KINDS } from "../../engine/economyShocks.js";

test("the jump schema offers an optional shock array and does not require it", () => {
  const field = JUMP_FORWARD_SCHEMA.properties.economicShocks;
  assert.ok(field, "economicShocks is missing from JUMP_FORWARD_SCHEMA");
  assert.equal(field.type, "array");
  assert.equal(field.maxItems, MAX_SHOCKS);
  assert.equal(JUMP_FORWARD_SCHEMA.required.includes("economicShocks"), false);
  assert.equal(JUMP_FORWARD_SCHEMA.additionalProperties, false);
});

test("the enum is the engine's list, not a copy", () => {
  const item = JUMP_FORWARD_SCHEMA.properties.economicShocks.items;
  assert.deepEqual(item.properties.kind.enum, [...SHOCK_KINDS]);
  assert.deepEqual(item.properties.severity.enum, [1, 2, 3]);
  assert.equal(item.properties.durationMonths.minimum, 1);
  assert.equal(item.required.includes("kind"), true);
  assert.equal(item.required.includes("severity"), true);
  assert.equal(item.required.includes("durationMonths"), true);
});
