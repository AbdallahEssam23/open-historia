/*! Open Historia — world ledger normalisation tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/gameState.ledgers.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEventEntry, normalizeWorldState } from "./gameState.js";

// world.wars / relations / agreements are written by the ledgers (AI/) and read
// back through normalizeWorldState like every other world field - a field the
// normalizer does not know is a field the next round trip loses.

test("wars, relations and agreements survive a normalizeWorldState round trip", () => {
  const world = normalizeWorldState({
    polityOverrides: { France: { code: "France" }, Germany: { code: "Germany" } },
    wars: [
      { id: "w1", status: "active", sideA: ["Germany"], sideB: ["France"], startedDate: "1914-08-03", sourceEventIds: ["e1"] },
      // One-sided: not a war.
      { id: "w2", status: "active", sideA: ["Germany"], sideB: [] },
      // Same id twice: the later record wins.
      { id: "w1", status: "ceasefire", sideA: ["Germany"], sideB: ["France"], startedDate: "1914-08-03" },
    ],
    relations: [
      { a: "Germany", b: "France", score: -85 },
      { a: "France", b: "Germany", score: 12, summary: "later" },
    ],
    agreements: [
      { id: "pact", type: "Mutual Defense", parties: ["France", "Germany"], startedDate: "1900-01-01" },
      { id: "solo", type: "alliance", parties: ["France"] },
    ],
    diplomaticLedgerVersion: "1",
  });

  assert.equal(world.wars.length, 1);
  assert.equal(world.wars[0].status, "ceasefire");
  assert.equal(world.wars[0].title, "Germany–France War");

  assert.equal(world.relations.length, 1, "a pair is one relation whichever way round it is written");
  assert.equal(world.relations[0].score, 12);
  assert.equal(world.relations[0].status, "neutral", "status derives from the score when not given");
  assert.deepEqual([world.relations[0].a, world.relations[0].b], ["France", "Germany"]);

  assert.equal(world.agreements.length, 1);
  assert.equal(world.agreements[0].type, "mutual_defense");
  assert.equal(world.agreements[0].status, "active");
  assert.equal(world.diplomaticLedgerVersion, 1);

  const again = normalizeWorldState(world);
  assert.deepEqual(again.wars, world.wars);
  assert.deepEqual(again.relations, world.relations);
  assert.deepEqual(again.agreements, world.agreements);
});

test("an empty world has empty ledgers", () => {
  const world = normalizeWorldState({});
  assert.deepEqual(world.wars, []);
  assert.deepEqual(world.relations, []);
  assert.deepEqual(world.agreements, []);
  assert.equal(world.diplomaticLedgerVersion, 0);
});

test("an event keeps its war metadata", () => {
  const event = normalizeEventEntry({
    title: "Battle of the Marne",
    date: "1914-09-06",
    warId: "w1",
    combatants: ["France", "Germany", "France", ""],
  });
  assert.equal(event.warId, "w1");
  assert.deepEqual(event.combatants, ["France", "Germany"]);

  const plain = normalizeEventEntry({ title: "A quiet day" });
  assert.equal(plain.warId, "");
  assert.deepEqual(plain.combatants, []);
});

test("an event keeps its combatRegion and defaults it to empty", () => {
  const withRegion = normalizeEventEntry({
    title: "Battle of Alsace",
    date: "1870-07-19",
    warId: "war-x",
    combatants: ["Prussia", "France"],
    combatRegion: "  ALSACE  ",
  }, 0);
  assert.equal(withRegion.combatRegion, "ALSACE");

  const without = normalizeEventEntry({ title: "A quiet year", date: "1870-01-01" }, 0);
  assert.equal(without.combatRegion, "");
});

// Both diplomatic ledgers resolve their parties through ONE identity index built
// for the call (see diplomaticIdentityIndex in normalizeWorldState), because the
// per-name default rebuilt that index over the whole world for every party. This
// pins that the shared index is only a saving: an alias still folds to its
// polity, and one world's index never answers for the next world normalized.
test("diplomatic parties fold aliases through one index per call, never a stale one", () => {
  const withAlias = () => ({
    polityOverrides: {
      Germany: { code: "Germany", aliases: ["Third Reich"] },
      France: { code: "France" },
    },
    relations: [{ a: "Third Reich", b: "France", score: 40 }],
    agreements: [{ id: "pact", type: "alliance", parties: ["Third Reich", "France"] }],
  });

  const first = normalizeWorldState(withAlias());
  assert.deepEqual([first.relations[0].a, first.relations[0].b], ["France", "Germany"], "a relation party written as an alias must fold onto its polity");
  assert.deepEqual(first.agreements[0].parties, ["Germany", "France"], "an agreement party written as an alias must fold onto its polity");

  // A DIFFERENT world, where "Third Reich" answers to nobody. Were the previous
  // call's index still in hand, this would resolve to Germany again.
  const other = normalizeWorldState({
    polityOverrides: { Italy: { code: "Italy" }, France: { code: "France" } },
    relations: [{ a: "Third Reich", b: "France", score: 40 }],
  });
  assert.deepEqual([other.relations[0].a, other.relations[0].b], ["France", "Third Reich"], "the previous world's index answered for this one");

  // Back to the first world: the result must not depend on what came between.
  assert.deepEqual(normalizeWorldState(withAlias()).relations, first.relations);
});

test("a war carries an aggressor that defaults to side A and survives a round trip", () => {
  const world = normalizeWorldState({
    wars: [
      { id: "w1", status: "active", sideA: ["Germany"], sideB: ["France"], startedDate: "1914-08-03" },
      { id: "w2", status: "active", aggressor: "b", sideA: ["Italy"], sideB: ["Austria"], startedDate: "1915-05-23" },
    ],
  });
  assert.equal(world.wars.find((war) => war.id === "w1").aggressor, "a", "a war with no field defaults to the declarer");
  assert.equal(world.wars.find((war) => war.id === "w2").aggressor, "b", "an explicit aggressor is kept");

  const again = normalizeWorldState(world);
  assert.deepEqual(again.wars, world.wars);
});
