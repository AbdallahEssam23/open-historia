import test from "node:test";
import assert from "node:assert/strict";

import { JUMP_FORWARD_SCHEMA } from "./gameplaySchemas.js";
import { MOBILIZATION_POSTURES } from "../../engine/forcePools.js";

test("the jump schema carries a closed mobilization enum and a cap", () => {
  const field = JUMP_FORWARD_SCHEMA.properties.mobilization;
  assert.equal(field.type, "array");
  assert.equal(field.maxItems, 20);
  assert.deepEqual(field.items.properties.posture.enum, [...MOBILIZATION_POSTURES]);
  assert.deepEqual(field.items.required, ["polity", "posture"]);
});

test("mobilization is optional, so a turn that says nothing still validates", () => {
  assert.ok(!JUMP_FORWARD_SCHEMA.required.includes("mobilization"));
});
