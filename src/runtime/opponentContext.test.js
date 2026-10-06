// Run: node --test src/runtime/opponentContext.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  NEUTRAL_REPUTATION,
  aggregateWorldContext,
  buildStrategicReport,
  politiesInPlay,
  worldFactsFor,
} from "./opponentContext.js";

const world = () => ({
  countryTags: { Ruritania: ["expansionist"], Syldavia: ["neutral"] },
  internationalReputation: { Ruritania: 20 },
  regionClaimants: { r1: ["Ruritania"], r2: ["Ruritania"], r3: ["Syldavia"] },
  regionOwnershipOverrides: { r1: "Syldavia", r9: "Ruritania" },
  wars: [{ id: "w1", status: "active", sideA: ["Ruritania"], sideB: ["Syldavia"] }],
  agreements: [
    { id: "a1", status: "breached", breachedBy: "Ruritania", parties: ["Ruritania", "Syldavia"] },
    { id: "a2", status: "breached", breachedBy: "Syldavia", parties: ["Ruritania", "Syldavia"] },
    { id: "a3", status: "active", type: "alliance", parties: ["Ruritania", "Borduria"] },
  ],
  relations: [{ a: "Ruritania", b: "Borduria", score: 40 }],
  economyEngine: {
    mobilization: { Ruritania: "total", Syldavia: "peacetime" },
    pools: {
      Ruritania: { manpower: 1000, materiel: 50 },
      Syldavia: { manpower: 500, materiel: 20 },
      Borduria: { manpower: 200, materiel: 5 },
    },
  },
});

test("the facts read claims, wars, breaches and wrongs from the world", () => {
  const facts = worldFactsFor(world(), "Ruritania");
  assert.deepEqual(facts.tags, ["expansionist"]);
  assert.equal(facts.reputation, 20);
  assert.equal(facts.claims, 2, "Ruritania claims two regions");
  assert.equal(facts.activeWars, 1);
  assert.equal(facts.breaches, 1, "Ruritania breached one agreement");
  assert.equal(facts.wrongedCount, 1, "one breach was committed against Ruritania");
  assert.equal(facts.mobilization, "total");
  assert.equal(facts.powerShare, 1, "the strongest power shares 1");
});

test("a weak power shares less and a silent power defaults to neutral", () => {
  assert.equal(worldFactsFor(world(), "Syldavia").powerShare, 0.5);
  const unknown = worldFactsFor(world(), "Nowhere");
  assert.equal(unknown.reputation, NEUTRAL_REPUTATION);
  assert.equal(unknown.claims, 0);
  assert.equal(unknown.activeWars, 0);
  assert.equal(unknown.powerShare, 0);
});

test("a context carries the facts and a derived profile", () => {
  const context = aggregateWorldContext(world(), "Ruritania");
  assert.equal(context.polity, "Ruritania");
  assert.equal(context.facts.claims, 2);
  assert.equal(context.personality.source, "derived");
  assert.ok(context.personality.aggression > 50, "a total-mobilized expansionist reads aggressive");
});

test("the polities in play cover the player, the war and the partners", () => {
  const polities = politiesInPlay(world(), { playerPolity: "Ruritania" });
  assert.equal(polities[0], "Ruritania", "the player comes first");
  assert.ok(polities.includes("Syldavia"), "a belligerent is in play");
  assert.ok(polities.includes("Borduria"), "a partner is in play");
});

test("the report is deterministic and capped, and always keeps the player first", () => {
  const report = buildStrategicReport(world(), { playerPolity: "Ruritania" });
  assert.deepEqual(report, buildStrategicReport(world(), { playerPolity: "Ruritania" }));
  assert.equal(report[0].polity, "Ruritania");
  const capped = buildStrategicReport(world(), { playerPolity: "Ruritania", limit: 2 });
  assert.equal(capped.length, 2);
  assert.equal(capped[0].polity, "Ruritania");
});

test("the adapter imports no Game/AI module", () => {
  const source = readFileSync(new URL("./opponentContext.js", import.meta.url), "utf8");
  const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(specifiers.some((specifier) => specifier.includes("Game/AI")), false);
});
