/*! Open Historia - portions (production unit-type drift guard) (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";

import { UNIT_TYPES } from "./gameState.js";
import { PRODUCTION_UNIT_TYPES } from "../engine/productionQueue.js";

// The engine may not import the runtime, so productionQueue.js re-declares the
// roster's six unit types. This is the test its comment promises: the two lists
// must stay equal, in the same order, or a unit type the roster accepts could
// silently become unbuildable (or the reverse).
test("the engine's production unit types match the runtime roster", () => {
  assert.deepEqual([...PRODUCTION_UNIT_TYPES], [...UNIT_TYPES]);
});
