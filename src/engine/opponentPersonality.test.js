// Run: node --test src/engine/opponentPersonality.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_CHARACTER_LEN,
  NEUTRAL_AXIS,
  PERSONALITY_AXES,
  derivePersonality,
  normalizePersonality,
} from "./opponentPersonality.js";

const neutral = () => derivePersonality({});
const axesOf = (profile) => Object.fromEntries(PERSONALITY_AXES.map((axis) => [axis, profile[axis]]));

test("a profile is deterministic: equal facts give equal axes", () => {
  const facts = {
    tags: ["expansionist", "revanchist"],
    reputation: 30,
    claims: 2,
    activeWars: 1,
    breaches: 1,
    wrongedCount: 1,
    mobilization: "total",
    powerShare: 0.8,
  };
  assert.deepEqual(derivePersonality(facts), derivePersonality(facts));
});

test("every axis is an integer in 0..100", () => {
  const samples = [
    {},
    { tags: ["pacifist", "isolationist"] },
    { tags: ["fascist", "expansionist"], reputation: 0, claims: 9, activeWars: 4, breaches: 5, mobilization: "total", powerShare: 1 },
    { tags: ["neutral"], reputation: 100, powerShare: 0 },
  ];
  for (const facts of samples) {
    const profile = derivePersonality(facts);
    for (const axis of PERSONALITY_AXES) {
      assert.equal(Number.isInteger(profile[axis]), true, `${axis} must be an integer`);
      assert.ok(profile[axis] >= 0 && profile[axis] <= 100, `${axis} must be within 0..100`);
    }
    assert.equal(profile.source, "derived");
  }
});

test("an unknown tag never moves a number", () => {
  assert.deepEqual(axesOf(derivePersonality({ tags: ["no-such-trait"] })), axesOf(neutral()));
});

test("an expansionist reads more aggressive than an isolationist", () => {
  const expansionist = derivePersonality({ tags: ["expansionist"] });
  const isolationist = derivePersonality({ tags: ["isolationist"] });
  assert.ok(expansionist.aggression > NEUTRAL_AXIS, "expansionist aggression rises");
  assert.ok(isolationist.aggression < NEUTRAL_AXIS, "isolationist aggression falls");
  assert.ok(isolationist.patience > NEUTRAL_AXIS, "isolationist patience rises");
});

test("reputation and its own breaches move honor in opposite directions", () => {
  assert.ok(derivePersonality({ reputation: 100 }).honor > NEUTRAL_AXIS);
  assert.ok(derivePersonality({ reputation: 0 }).honor < NEUTRAL_AXIS);
  const faithful = derivePersonality({ breaches: 0 });
  const breaker = derivePersonality({ breaches: 3 });
  assert.ok(breaker.honor < faithful.honor, "a breaker loses honor");
  assert.ok(breaker.opportunism > faithful.opportunism, "a breaker reads more opportunistic");
});

test("standing claims and wrongs feed grievance", () => {
  assert.ok(derivePersonality({ claims: 5 }).grievance > NEUTRAL_AXIS);
  assert.ok(derivePersonality({ wrongedCount: 3 }).grievance > NEUTRAL_AXIS);
});

test("force share and mobilization raise aggression", () => {
  assert.ok(derivePersonality({ powerShare: 1 }).aggression > derivePersonality({ powerShare: 0 }).aggression);
  assert.ok(derivePersonality({ mobilization: "total" }).aggression > derivePersonality({ mobilization: "demobilized" }).aggression);
});

test("the character line is single, non-empty and capped", () => {
  for (const facts of [{}, { tags: ["expansionist", "revanchist", "pariah", "nuclear"] }, { reputation: 100, breaches: 4 }]) {
    const { character } = derivePersonality(facts);
    assert.equal(typeof character, "string");
    assert.ok(character.length > 0, "the character line is present");
    assert.equal(character.includes("\n"), false, "the character line is single-line");
    assert.ok(character.length <= MAX_CHARACTER_LEN, "the character line is capped");
  }
});

test("normalizePersonality rejects a value with no axis and never throws", () => {
  assert.equal(normalizePersonality(null), null);
  assert.equal(normalizePersonality(undefined), null);
  assert.equal(normalizePersonality("x"), null);
  assert.equal(normalizePersonality([]), null);
  assert.equal(normalizePersonality({ character: "no axes here" }), null);
});

test("normalizePersonality clamps and rounds a real profile", () => {
  const normalized = normalizePersonality({ aggression: 140, patience: -20, honor: 50.6, opportunism: 10, grievance: 0, source: "authored" });
  assert.equal(normalized.aggression, 100);
  assert.equal(normalized.patience, 0);
  assert.equal(normalized.honor, 51);
  assert.equal(normalized.source, "authored");
});
