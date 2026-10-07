// Run: node --test src/engine/warMood.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { deriveMusicState } from "./warMood.js";

const war = (overrides = {}) => ({ status: "active", sideA: ["A"], sideB: ["B"], ...overrides });

test("no active war is idle", () => {
  assert.equal(deriveMusicState({ wars: [], playerName: "A" }), "idle");
  assert.equal(deriveMusicState({ wars: [war({ status: "ended" })], playerName: "A" }), "idle");
  assert.equal(deriveMusicState({}), "idle");
});

test("an active war the player is not in is tension", () => {
  assert.equal(deriveMusicState({ wars: [war()], playerName: "C" }), "tension");
});

test("an active war the player is in is war, on either side and regardless of case", () => {
  assert.equal(deriveMusicState({ wars: [war()], playerName: "A" }), "war");
  assert.equal(deriveMusicState({ wars: [war()], playerName: "b" }), "war");
  assert.equal(deriveMusicState({ wars: [war({ sideA: [], sideB: ["  A  "] })], playerName: "a" }), "war");
});

test("a party may arrive as an object with a name", () => {
  assert.equal(
    deriveMusicState({ wars: [war({ sideA: [{ name: "Ruritania" }], sideB: [{ polity: "Syldavia" }] })], playerName: "syldavia" }),
    "war",
  );
});
