// Run: node --test src/runtime/opponentContext.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  NEUTRAL_REPUTATION,
  aggregateWorldContext,
  buildStrategicReport,
  politiesInPlay,
  strategicInputsFor,
  worldFactsFor,
} from "./opponentContext.js";
import { deriveIntentMenu } from "../engine/strategicIntent.js";

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

// Three powers with hands on the map: Ruritania holds a bordered region and a
// coastal one, Syldavia holds the region across that border, Borduria and Oversea
// hold isolated regions, and only Oversea's is on the coast.
const reachWorld = () => ({
  economyEngine: { pools: {}, mobilization: {} },
  wars: [],
  agreements: [],
  // A relation with the actor is what puts each power in play (politiesInPlay).
  relations: [
    { a: "Ruritania", b: "Syldavia", score: 0 },
    { a: "Ruritania", b: "Borduria", score: 0 },
    { a: "Ruritania", b: "Oversea", score: 0 },
  ],
});

const REACH_REGIONS = [
  { regionId: "R1", owner: "Ruritania", adjacencies: ["S1"], type: "land" },
  { regionId: "RC", owner: "Ruritania", adjacencies: [], type: "coastal" },
  { regionId: "S1", owner: "Syldavia", adjacencies: ["R1"], type: "land" },
  { regionId: "B1", owner: "Borduria", adjacencies: [], type: "land" },
  { regionId: "O1", owner: "Oversea", adjacencies: [], type: "coastal" },
];

const reachByTarget = (input) => Object.fromEntries(input.targets.map((target) => [target.polity, target.reach]));

test("reach classifies a neighbour, a sea route and a landlocked stranger", () => {
  const input = strategicInputsFor(reachWorld(), "Ruritania", { regions: REACH_REGIONS });
  const reach = reachByTarget(input);
  assert.equal(reach.Syldavia, "contiguous", "across the land border");
  assert.equal(reach.Oversea, "overseas", "both hold coast, so a sea route exists");
  assert.equal(reach.Borduria, "unreachable", "no border, no coast, no ally's front");
});

test("the reach facts gate the menu: the unreachable target is not offered", () => {
  const menu = deriveIntentMenu(strategicInputsFor(reachWorld(), "Ruritania", { regions: REACH_REGIONS }));
  const offered = menu.declareWar.map((entry) => entry.target);
  assert.ok(offered.includes("Syldavia"));
  assert.ok(offered.includes("Oversea"));
  assert.equal(offered.includes("Borduria"), false);
});

test("a target bordering a co-belligerent is reached through the coalition", () => {
  const world = reachWorld();
  // Ruritania and Borduria are on the same side of an active war; Tulia holds the
  // region across Borduria's border, so the war can be carried to Tulia by land.
  world.wars = [{ id: "war-x", status: "active", sideA: ["Ruritania", "Borduria"], sideB: ["Germania"] }];
  world.relations.push({ a: "Ruritania", b: "Tulia", score: 0 });
  const regions = [
    ...REACH_REGIONS,
    { regionId: "B2", owner: "Borduria", adjacencies: ["T1"], type: "land" },
    { regionId: "T1", owner: "Tulia", adjacencies: ["B2"], type: "land" },
  ];
  const reach = reachByTarget(strategicInputsFor(world, "Ruritania", { regions }));
  assert.equal(reach.Tulia, "coalition", "Borduria's front reaches Tulia");
});

test("no adjacency and no coast leaves every target unclassified, so the menu is unchanged", () => {
  const flat = REACH_REGIONS.map((region) => ({ ...region, adjacencies: [], type: "land" }));
  const input = strategicInputsFor(reachWorld(), "Ruritania", { regions: flat });
  for (const target of input.targets) assert.equal(target.reach, undefined, target.polity);
  const menu = deriveIntentMenu(input);
  assert.equal(menu.declareWar.length, 3, "all three remain legal, exactly as before");
});
