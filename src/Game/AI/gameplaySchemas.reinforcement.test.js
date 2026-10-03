// Run: node --test src/Game/AI/gameplaySchemas.reinforcement.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { JUMP_FORWARD_SCHEMA } from "./gameplaySchemas.js";
import {
  MAX_MERGES,
  MAX_REINFORCEMENT,
  MAX_ROTATIONS,
  REINFORCEMENT_POLICIES,
} from "../../engine/reinforcement.js";

test("the jump schema carries the reinforcement policy enum and cap", () => {
  const field = JUMP_FORWARD_SCHEMA.properties.reinforcement;
  assert.equal(field.type, "array");
  assert.equal(field.maxItems, MAX_REINFORCEMENT);
  assert.deepEqual(field.items.properties.policy.enum, [...REINFORCEMENT_POLICIES]);
  assert.deepEqual(field.items.required, ["polity", "policy"]);
});

test("the rotation and merge orders are capped and name two unit ids", () => {
  const rotations = JUMP_FORWARD_SCHEMA.properties.rotations;
  assert.equal(rotations.maxItems, MAX_ROTATIONS);
  assert.deepEqual(rotations.items.required, ["out", "in"]);
  const merges = JUMP_FORWARD_SCHEMA.properties.merges;
  assert.equal(merges.maxItems, MAX_MERGES);
  assert.deepEqual(merges.items.required, ["survivor", "absorbed"]);
});

test("the new declarations are optional, so a turn that omits them validates", () => {
  for (const key of ["reinforcement", "rotations", "merges"]) {
    assert.equal(JUMP_FORWARD_SCHEMA.required.includes(key), false);
  }
});
