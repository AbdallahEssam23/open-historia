// Run: node --test src/runtime/strategicNarration.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_TURN_MOVES,
  NO_CAUSE_LABEL,
  buildTurnMoves,
  describeStrategicMove,
} from "./strategicNarration.js";

test("a declaration resolves to the event the model stamped with its warId", () => {
  const rows = buildTurnMoves({
    accepted: {
      declareWar: [
        { actor: "France", target: "Prussia", warId: "war-france-prussia", goal: "annex", justified: true, reasons: ["standing claim"] },
      ],
      pressClaim: [],
    },
    events: [
      { id: "evt-1", warId: "" },
      { id: "evt-2", warId: "war-france-prussia" },
    ],
    date: "1815-06-01",
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    kind: "declare_war",
    actor: "France",
    target: "Prussia",
    goal: "annex",
    justified: true,
    reasons: ["standing claim"],
    eventId: "evt-2",
    date: "1815-06-01",
  });
});

test("an existing declaration is not recorded, and a claim has no event", () => {
  const rows = buildTurnMoves({
    accepted: {
      declareWar: [{ actor: "A", target: "B", warId: "w", existing: true }],
      pressClaim: [{ actor: "C", regionId: "r-9", owner: "D" }],
    },
    events: [{ id: "evt-1", warId: "w" }],
    date: "2000-01-01",
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    kind: "press_claim",
    actor: "C",
    regionId: "r-9",
    owner: "D",
    eventId: "",
    date: "2000-01-01",
  });
});

test("malformed rows are dropped, and garbage input never throws", () => {
  assert.deepEqual(buildTurnMoves(), []);
  assert.deepEqual(buildTurnMoves({ accepted: null, events: null, date: null }), []);
  assert.deepEqual(buildTurnMoves({ accepted: { declareWar: [null, {}, { actor: "A" }, { target: "B" }], pressClaim: ["x", { actor: "A" }] } }), []);
  const rows = buildTurnMoves({
    accepted: {
      declareWar: [{ actor: "A", target: "B", warId: "w", goal: "nope", justified: false, reasons: ["unknown token"] }],
      pressClaim: [],
    },
    events: [],
  });
  assert.equal(rows[0].eventId, "", "no event carries the warId");
  assert.equal(rows[0].goal, "nope", "the raw goal is stored; phrasing decides how it reads");
  assert.deepEqual(rows[0].reasons, ["unknown token"]);
});

test("the move list is bounded", () => {
  const many = Array.from({ length: MAX_TURN_MOVES + 5 }, (_, index) => ({
    actor: `A${index}`,
    regionId: `r${index}`,
    owner: "O",
  }));
  const rows = buildTurnMoves({ accepted: { declareWar: [], pressClaim: many } });
  assert.equal(rows.length, MAX_TURN_MOVES);
});

test("describeStrategicMove is deterministic and phrases a war with its cause", () => {
  const move = { kind: "declare_war", actor: "France", target: "Prussia", goal: "annex", justified: true, reasons: ["standing claim", "recorded breach"] };
  const first = describeStrategicMove(move);
  const second = describeStrategicMove(move);
  assert.deepEqual(first, second);
  assert.equal(first.headline, "France declares war on Prussia");
  assert.match(first.detail, /annex/);
  assert.deepEqual(first.reasons, ["standing claim", "recorded breach"]);
});

test("an unjust war reads its goal and says no cause is on record", () => {
  const described = describeStrategicMove({ kind: "declare_war", actor: "A", target: "B", goal: "reparations", justified: false, reasons: [] });
  assert.match(described.detail, /reparations/);
  assert.deepEqual(described.reasons, [NO_CAUSE_LABEL]);
});

test("an unknown goal falls back to the settlement phrase", () => {
  const described = describeStrategicMove({ kind: "declare_war", actor: "A", target: "B", goal: "conquest", justified: true, reasons: ["standing claim"] });
  assert.equal(described.detail, "to force a settlement");
});

test("a claim names the region through regionName, falling back to the id", () => {
  const move = { kind: "press_claim", actor: "C", regionId: "r-9", owner: "D" };
  const named = describeStrategicMove(move, { regionName: "Alsace" });
  assert.equal(named.headline, "C presses a claim on Alsace");
  assert.equal(named.detail, "held by D");
  const fallback = describeStrategicMove(move);
  assert.equal(fallback.headline, "C presses a claim on r-9");
});

test("an unknown or empty move describes to null", () => {
  assert.equal(describeStrategicMove(null), null);
  assert.equal(describeStrategicMove({ kind: "nonsense", actor: "A" }), null);
  assert.equal(describeStrategicMove({ kind: "declare_war", actor: "A" }), null);
  assert.equal(describeStrategicMove({ kind: "press_claim", actor: "A" }), null);
  assert.equal(describeStrategicMove({ kind: "declare_war", target: "B" }), null);
});

test("a seek resolves to the settlement event the engine wrote for its war", () => {
  const rows = buildTurnMoves({
    accepted: { declareWar: [], pressClaim: [], seekPeace: [{ actor: "France", target: "Prussia", warId: "war-france-prussia" }] },
    events: [{ id: "event-peace-war-france-prussia-1815-11-20", warId: "war-france-prussia" }],
    date: "1815-11-20",
  });
  assert.deepEqual(rows, [{
    kind: "seek_peace",
    actor: "France",
    target: "Prussia",
    warId: "war-france-prussia",
    eventId: "event-peace-war-france-prussia-1815-11-20",
    date: "1815-11-20",
  }]);
});

test("a seek with no actor or no war is dropped, never thrown", () => {
  const rows = buildTurnMoves({
    accepted: { declareWar: [], pressClaim: [], seekPeace: [{ target: "Prussia", warId: "war-1" }, { actor: "France" }, null] },
    events: [],
    date: "1815-11-20",
  });
  assert.deepEqual(rows, []);
});

test("a seek reads as a power suing for peace", () => {
  const described = describeStrategicMove({ kind: "seek_peace", actor: "France", target: "Prussia", warId: "war-1" });
  assert.equal(described.headline, "France seeks peace with Prussia");
  assert.deepEqual(described.reasons, []);
  assert.equal(described.detail, "");
});
