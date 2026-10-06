/*! Open Historia - opponent war termination facts (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: npm ci && node --test src/runtime/warTermination.test.js
//
// Needs a full install: warSettlement.js -> gameState.js -> assets.js -> maplibre-gl.
//
// The two halves of the seek_peace increment that live in the settlement
// adapter: the facts the strategic menu reads to decide whether a power may sue
// for peace, and the terms the application reads when one did. Everything else
// is the engine's pure law (engine/warSettlement.js) or the gateway.

import test from "node:test";
import assert from "node:assert/strict";
import { resolveWarSettlements, seekPeaceFacts } from "./warSettlement.js";

const war = (over = {}) => ({
  id: "war-1",
  status: "active",
  startedDate: "1914-01-01",
  sideA: ["Ruritania"],
  sideB: ["Syldavia"],
  goals: { a: { kind: "annex", targetRegionIds: ["r1"] }, b: { kind: "annex", targetRegionIds: ["r2"] } },
  // Through today, so no months accrue and the stored weariness is the stepped one.
  weariness: { a: 0.2, b: 0.2, throughDate: "1915-01-01" },
  unjustAggressors: [],
  ...over,
});

const world = (over = {}) => ({
  wars: [war()],
  regionOwnershipOverrides: {},
  economyEngine: { mobilization: {}, pools: { Ruritania: { manpower: 100, materiel: 10 }, Syldavia: { manpower: 80, materiel: 5 } } },
  ...over,
});

test("seekPeaceFacts reads weariness, the progress guard and the player's party", () => {
  const weary = seekPeaceFacts({ war: war({ weariness: { a: 0.62, b: 0.2, throughDate: "1915-01-01" } }), polity: "Ruritania" });
  assert.equal(weary.warId, "war-1");
  assert.equal(weary.opponent, "Syldavia");
  assert.equal(weary.weariness, 0.62);
  assert.equal(weary.ahead, false);
  assert.equal(weary.party, false);

  // Ruritania holds its declared target: it is ahead and may not freeze the win.
  const ahead = seekPeaceFacts({
    war: war({ regionOwnershipOverrides: { r1: "Ruritania" } }),
    polity: "Ruritania",
    regionOwnershipOverrides: { r1: "Ruritania" },
  });
  assert.equal(ahead.ahead, true);

  const party = seekPeaceFacts({ war: war(), polity: "Ruritania", playerPolity: "Syldavia" });
  assert.equal(party.party, true);

  assert.equal(seekPeaceFacts({ war: war(), polity: "Borduria" }), null, "not a side of the war");
  assert.equal(seekPeaceFacts({ war: war({ status: "ended" }), polity: "Ruritania" }), null, "not active");
});

test("a status_quo side is never ahead and may seek peace whenever it is weary", () => {
  const facts = seekPeaceFacts({
    war: war({ goals: { a: { kind: "status_quo", targetRegionIds: [] }, b: { kind: "annex", targetRegionIds: ["r1"] } } }),
    polity: "Ruritania",
  });
  assert.equal(facts.ahead, false);
});

test("peaceTermsByWarId holds terms for an AI-vs-AI war nothing forces", () => {
  const outcome = resolveWarSettlements({ world: world(), events: [], engagements: [], date: "1915-01-01" });
  assert.deepEqual(outcome.settlements, [], "nothing is forced");
  const entry = outcome.peaceTermsByWarId["war-1"];
  assert.ok(entry, "a seekable war has terms ready");
  assert.equal(entry.settlement.warId, "war-1");
  assert.equal("due" in entry.settlement, false);
  assert.deepEqual(entry.belligerents, ["Ruritania", "Syldavia"]);
});

test("peaceTermsByWarId leaves out a due war but prices a player's war to offer", () => {
  const due = resolveWarSettlements({
    world: world({ wars: [war({ weariness: { a: 0.7, b: 0.2, throughDate: "1915-01-01" } })] }),
    events: [],
    engagements: [],
    date: "1915-01-01",
  });
  assert.equal(due.settlements.length, 1, "the war is forced");
  assert.deepEqual(due.peaceTermsByWarId, {}, "a forced war is no power's to seek");

  const player = resolveWarSettlements({ world: world(), events: [], engagements: [], date: "1915-01-01", playerPolity: "Ruritania" });
  const entry = player.peaceTermsByWarId["war-1"];
  assert.ok(entry, "a seek against the player has terms ready");
  assert.equal(entry.side, "a", "the player sits on side A");
  assert.equal(entry.pressure, 0.2, "the war's exhaustion travels with the offer");
  assert.deepEqual(player.offers, [], "not due, so no offer is forced yet");
});

test("an intent-less turn's settlements are exactly what the automatic path gives", () => {
  const noWars = resolveWarSettlements({ world: world({ wars: [] }), events: [], engagements: [], date: "1915-01-01" });
  assert.deepEqual(noWars.settlements, []);
  assert.deepEqual(noWars.peaceTermsByWarId, {});
  assert.deepEqual(noWars.unresolved, []);
});
