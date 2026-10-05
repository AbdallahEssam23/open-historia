// Run: node --test src/engine/tickSchedule.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { TICK_PHASES, tickPhasePlan } from "./tickSchedule.js";

const IDS = [
  "engagements",
  "engagementMerge",
  "settlements",
  "engagementReserve",
  "supply",
  "reinforcement",
  "reinforcementReserve",
  "warLedger",
  "treatyBreaches",
  "casusBelli",
  "treatyObligations",
  "reparations",
  "espionage",
  "economy",
  "production",
  "statsHistory",
];

const FACTS = [
  "battles",
  "atWar",
  "supply",
  "reinforcement",
  "treaties",
  "casus",
  "settlements",
  "espionage",
  "production",
];

const ALWAYS_ON = ["warLedger", "economy", "statsHistory"];

test("the schedule is the sixteen phases in declared order", () => {
  assert.deepEqual(TICK_PHASES.map((phase) => phase.id), IDS);
});

test("the schedule and its parts are frozen", () => {
  assert.equal(Object.isFrozen(TICK_PHASES), true);
  for (const phase of TICK_PHASES) {
    assert.equal(Object.isFrozen(phase), true, phase.id);
    assert.equal(Object.isFrozen(phase.anchors), true, phase.id);
    assert.equal(Object.isFrozen(phase.requires), true, phase.id);
  }
});

test("every phase carries at least one anchor and only known facts", () => {
  for (const phase of TICK_PHASES) {
    assert.equal(Array.isArray(phase.anchors), true, phase.id);
    assert.ok(phase.anchors.length >= 1, phase.id);
    for (const anchor of phase.anchors) {
      assert.equal(typeof anchor, "string", phase.id);
      assert.ok(anchor.length > 0, phase.id);
    }
    assert.equal(Array.isArray(phase.requires), true, phase.id);
    for (const fact of phase.requires) {
      assert.ok(FACTS.includes(fact), `${phase.id} requires unknown fact ${fact}`);
    }
  }
});

test("the anchors are unique across the schedule", () => {
  const seen = new Set();
  for (const phase of TICK_PHASES) {
    for (const anchor of phase.anchors) {
      assert.equal(seen.has(anchor), false, `duplicate anchor: ${anchor}`);
      seen.add(anchor);
    }
  }
});

test("the always-on phases are the ones with no requirement", () => {
  assert.deepEqual(
    TICK_PHASES.filter((phase) => phase.requires.length === 0).map((phase) => phase.id),
    ALWAYS_ON,
  );
});

test("no facts plan is the always-on phases in order", () => {
  assert.deepEqual(tickPhasePlan(), ALWAYS_ON);
  assert.deepEqual(tickPhasePlan({}), ALWAYS_ON);
});

test("all facts plan is every phase in order", () => {
  const all = Object.fromEntries(FACTS.map((fact) => [fact, true]));
  assert.deepEqual(tickPhasePlan(all), IDS);
});

test("a partial fact set filters without reordering", () => {
  assert.deepEqual(
    tickPhasePlan({ battles: true, production: true }),
    ["engagements", "engagementMerge", "engagementReserve", "warLedger", "economy", "production", "statsHistory"],
  );
});

test("unknown facts are ignored and falsy facts exclude", () => {
  assert.deepEqual(tickPhasePlan({ nonsense: true }), ALWAYS_ON);
  assert.deepEqual(tickPhasePlan({ battles: false, production: 0 }), ALWAYS_ON);
});
