/*! Open Historia - the trade clause in a save (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: npm ci && node --test src/runtime/gameState.tradeClimate.test.js
//
// Needs a full install: gameState.js -> assets.js -> maplibre-gl.
//
// What a save carries of the engine's trade clause (runtime/economyEngine.js's
// describeTradeClimate, written by Game/AI/gameplay.js onto the turn record), and
// the equivalence that matters: a turn the network found nothing to say about
// keeps no `tradeClimate` key, so a save written before this increment reads back
// exactly as it was.

import test from "node:test";
import assert from "node:assert/strict";
import { WORLD_DEFAULTS, normalizeWorldState } from "./gameState.js";

const turn = (over = {}) => ({ mode: "jump", round: 4, eventIds: ["e1"], ...over });
const record = (over) => normalizeWorldState({ simulationHistory: [turn(over)] }).simulationHistory[0];

test("a turn with no clause keeps no key at all", () => {
  assert.equal("tradeClimate" in record({}), false);
  assert.equal("tradeClimate" in record({ tradeClimate: "" }), false);
  assert.equal("tradeClimate" in record({ tradeClimate: "   " }), false);
  assert.equal("tradeClimate" in record({ tradeClimate: 42 }), false, "a non-string is dropped, never kept raw");
  assert.equal("tradeClimate" in record({ tradeClimate: { text: "x" } }), false);
});

test("a clause is kept, trimmed", () => {
  assert.equal(record({ tradeClimate: "  open commerce favoured Egypt  " }).tradeClimate, "open commerce favoured Egypt");
});

test("a world's clause survives a normalize round trip", () => {
  const first = normalizeWorldState({ simulationHistory: [turn({ tradeClimate: "hostility cut Egypt and Sudan off" })] });
  assert.equal(first.simulationHistory[0].tradeClimate, "hostility cut Egypt and Sudan off");
  assert.equal(normalizeWorldState(first).simulationHistory[0].tradeClimate, first.simulationHistory[0].tradeClimate);
});

test("a fresh world has no trade clause anywhere", () => {
  assert.equal("tradeClimate" in WORLD_DEFAULTS, false);
});
