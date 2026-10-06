/*! Open Historia - the opponent's moves in a save (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: npm ci && node --test src/runtime/gameState.turnMoves.test.js
//
// Needs a full install: gameState.js -> assets.js -> maplibre-gl.
//
// What a save carries of the opponent's accepted decisions (the rows
// runtime/strategicNarration.js builds and Game/AI/gameplay.js writes), and the
// equivalence that matters: a turn with none keeps no `strategicMoves` key, so a
// save written before this increment reads back exactly as it was.

import test from "node:test";
import assert from "node:assert/strict";
import { WORLD_DEFAULTS, normalizeWorldState } from "./gameState.js";

const turn = (over = {}) => ({ mode: "jump", round: 4, eventIds: ["e1"], ...over });
const record = (over) => normalizeWorldState({ simulationHistory: [turn(over)] }).simulationHistory[0];

test("a turn with no moves keeps no key at all", () => {
  assert.equal("strategicMoves" in record({}), false);
  assert.equal("strategicMoves" in record({ strategicMoves: [] }), false);
  assert.equal("strategicMoves" in record({ strategicMoves: "nonsense" }), false);
  assert.equal("strategicMoves" in record({ strategicMoves: [{ kind: "declare_war" }] }), false);
});

test("a declaration is kept with its cause and its event", () => {
  const [move] = record({
    strategicMoves: [
      {
        kind: "declare_war",
        actor: " France ",
        target: "Germany",
        goal: "annex",
        justified: true,
        reasons: ["standing claim", "", "recorded breach", "extra", "more"],
        eventId: "e1",
        date: "1914-08-03",
      },
    ],
  }).strategicMoves;
  assert.equal(move.kind, "declare_war");
  assert.equal(move.actor, "France");
  assert.equal(move.target, "Germany");
  assert.equal(move.goal, "annex");
  assert.equal(move.justified, true);
  assert.deepEqual(move.reasons, ["standing claim", "recorded breach", "extra"], "at most three, blanks dropped");
  assert.equal(move.eventId, "e1");
  assert.equal(move.date, "1914-08-03");
});

test("a claim keeps its region and owner, and drops without either", () => {
  const [move] = record({
    strategicMoves: [{ kind: "press_claim", actor: "Italy", regionId: "reg-7", owner: "Ottoman Empire" }],
  }).strategicMoves;
  assert.equal(move.kind, "press_claim");
  assert.equal(move.regionId, "reg-7");
  assert.equal(move.owner, "Ottoman Empire");
  assert.equal("eventId" in move, false, "a claim has no event to sit beside");
  assert.equal("strategicMoves" in record({ strategicMoves: [{ kind: "press_claim", actor: "Italy" }] }), false);
});

test("unknown kinds and unreadable rows are dropped, never kept raw", () => {
  const moves = record({
    strategicMoves: [
      null,
      "nonsense",
      { kind: "assassinate", actor: "Serbia", target: "Austria" },
      { kind: "declare_war", actor: "Serbia" },
      { kind: "press_claim", regionId: "reg-1" },
      { kind: "declare_war", actor: "Russia", target: "Austria", stray: true },
    ],
  }).strategicMoves;
  assert.equal(moves.length, 1);
  assert.equal(moves[0].actor, "Russia");
  assert.equal("stray" in moves[0], false);
});

test("the list is bounded to twelve", () => {
  const many = Array.from({ length: 20 }, (_, index) => ({
    kind: "press_claim",
    actor: `Power ${index}`,
    regionId: `reg-${index}`,
  }));
  assert.equal(record({ strategicMoves: many }).strategicMoves.length, 12);
});

test("a world's moves survive a normalize round trip", () => {
  const first = normalizeWorldState({
    simulationHistory: [turn({ strategicMoves: [{ kind: "declare_war", actor: "France", target: "Germany", goal: "annex", reasons: ["recorded breach"], eventId: "e1" }] })],
  });
  assert.deepEqual(normalizeWorldState(first).simulationHistory[0].strategicMoves, first.simulationHistory[0].strategicMoves);
});

test("a fresh world has no turn moves anywhere", () => {
  assert.equal("strategicMoves" in WORLD_DEFAULTS, false);
});

test("a sought peace keeps its war and its settlement event", () => {
  const [move] = record({
    strategicMoves: [{ kind: "seek_peace", actor: "France", target: "Prussia", warId: "war-france-prussia", eventId: "event-peace-1", date: "1815-11-20" }],
  }).strategicMoves;
  assert.equal(move.kind, "seek_peace");
  assert.equal(move.actor, "France");
  assert.equal(move.target, "Prussia");
  assert.equal(move.warId, "war-france-prussia");
  assert.equal(move.eventId, "event-peace-1");
  assert.equal("strategicMoves" in record({ strategicMoves: [{ kind: "seek_peace", actor: "France", target: "Prussia" }] }), false, "no war id is dropped");
});
