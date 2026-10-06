// Run: node --test src/Game/AI/strategicGateway.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_STRATEGIC_INTENTS,
  applyStrategicIntents,
  decodeStrategicIntents,
} from "./strategicGateway.js";

// A small authored world in which the menu offers Ruritania a declaration
// against Syldavia (a relation partner, not yet at war) and a claim on the
// Syldavian region r1.
const world = () => ({
  countryTags: {},
  relations: [{ a: "Ruritania", b: "Syldavia", score: 10 }],
  regionClaimants: {},
  regionOwnershipOverrides: {},
  wars: [],
  agreements: [],
  economyEngine: {
    mobilization: {},
    pools: { Ruritania: { manpower: 100 }, Syldavia: { manpower: 50 } },
  },
});

const REGIONS = [{ regionId: "r1", owner: "Syldavia" }, { regionId: "r2", owner: "Ruritania" }];
const WAR_ID = "war-ruritania-syldavia";
const declarationEvent = () => ({
  id: "e1",
  date: "1900-03-01",
  title: "Ruritania Declares War on Syldavia",
  description: "",
  warId: WAR_ID,
});
const apply = (overrides = {}) =>
  applyStrategicIntents({ world: world(), regions: REGIONS, warUpdates: [], events: [declarationEvent()], intents: "", ...overrides });

test("no intents is the inert path: warUpdates and events are untouched", () => {
  const events = [declarationEvent()];
  const warUpdates = [{ id: "war-x", op: "start", actors: ["A"], opponents: ["B"] }];
  const outcome = applyStrategicIntents({ world: world(), intents: "", warUpdates, events, regions: REGIONS });
  assert.equal(outcome.warUpdates, warUpdates, "the same list, not a rebuilt one");
  assert.deepEqual(outcome.claimOps, []);
  assert.deepEqual(outcome.accepted.declareWar, []);
  assert.deepEqual(outcome.rejected, []);
  assert.equal(events[0].warId, WAR_ID, "the declaration event is not rewritten");
});

test("decodeStrategicIntents reads lines, arrays and decoded objects, and keeps a note", () => {
  assert.deepEqual(decodeStrategicIntents(""), []);
  assert.deepEqual(decodeStrategicIntents("   "), []);
  assert.deepEqual(decodeStrategicIntents(null), []);
  const [line] = decodeStrategicIntents("declare_war~Ruritania~Syldavia~annex~~a note with ~ inside");
  assert.equal(line.op, "declare_war");
  assert.equal(line.polity, "Ruritania");
  assert.equal(line.target, "Syldavia");
  assert.equal(line.goal, "annex");
  assert.deepEqual(line.regionIds, []);
  assert.equal(line.note, "a note with ~ inside", "the note takes the rest of the line");

  const [claim] = decodeStrategicIntents("press_claim~Ruritania~~~r1,r2~");
  assert.equal(claim.op, "press_claim");
  assert.deepEqual(claim.regionIds, ["r1", "r2"]);

  const [obj] = decodeStrategicIntents([{ op: "declare_war", actor: "Ruritania", target: "Syldavia", goal: "annex" }]);
  assert.equal(obj.polity, "Ruritania", "actor is accepted as the polity");
  const many = decodeStrategicIntents(Array.from({ length: MAX_STRATEGIC_INTENTS + 5 }, () => "press_claim~A~~~r1~"));
  assert.equal(many.length, MAX_STRATEGIC_INTENTS);
});

test("an accepted declaration becomes a start and a goals record bound to its event", () => {
  const events = [declarationEvent()];
  const outcome = apply({ intents: "declare_war~Ruritania~Syldavia~annex~~", events });
  assert.deepEqual(outcome.rejected, []);
  assert.equal(outcome.accepted.declareWar.length, 1);
  assert.equal(outcome.accepted.declareWar[0].actor, "Ruritania");
  assert.equal(outcome.accepted.declareWar[0].target, "Syldavia");
  assert.equal(outcome.accepted.declareWar[0].goal, "annex");
  const [start, goals] = outcome.warUpdates;
  assert.equal(start.op, "start");
  assert.equal(start.id, WAR_ID);
  assert.deepEqual(start.actors, ["Ruritania"]);
  assert.deepEqual(start.opponents, ["Syldavia"]);
  assert.deepEqual(start.eventIndexes, [0], "bound to the declaration event");
  assert.equal(goals.op, "goals");
  assert.equal(goals.id, WAR_ID);
  assert.equal(events[0].warId, WAR_ID, "the event keeps the menu's warId");
});

test("an unrecognised goal falls back to status_quo rather than losing the war", () => {
  const outcome = apply({ intents: "declare_war~Ruritania~Syldavia~nonsense~~" });
  assert.equal(outcome.accepted.declareWar[0].goal, "status_quo");
  assert.equal(outcome.warUpdates[1].actors[0], "Ruritania:status_quo");
});

test("a target outside the menu is refused", () => {
  const outcome = apply({ intents: "declare_war~Ruritania~Nowhere~annex~~" });
  assert.equal(outcome.accepted.declareWar.length, 0);
  assert.equal(outcome.warUpdates.length, 0);
  assert.equal(outcome.rejected[0].reason, "not a legal target this turn");
});

test("a declaration with no event carrying its warId is refused", () => {
  const outcome = apply({ intents: "declare_war~Ruritania~Syldavia~annex~~", events: [{ id: "e1", date: "1900-03-01", title: "A quiet month" }] });
  assert.equal(outcome.accepted.declareWar.length, 0);
  assert.equal(outcome.warUpdates.length, 0);
  assert.equal(outcome.rejected[0].reason, "no event narrates the declaration");
});

test("a start record already in warUpdates stands and the duplicate intent is not written twice", () => {
  const existing = [{ id: WAR_ID, op: "start", actors: ["Ruritania"], opponents: ["Syldavia"], eventIndexes: [0] }];
  const outcome = apply({ intents: "declare_war~Ruritania~Syldavia~annex~~", warUpdates: existing });
  assert.equal(outcome.warUpdates.length, 1, "no second record");
  assert.equal(outcome.accepted.declareWar[0].existing, true);
  assert.deepEqual(outcome.rejected, []);
});

test("the duplicate check reads the model's own line-form warUpdates without losing them", () => {
  const warUpdates = `${WAR_ID}~start~Ruritania~Syldavia~1~opened elsewhere\nwar-other~start~A~B~2~a different war`;
  const outcome = applyStrategicIntents({
    world: world(),
    intents: "declare_war~Ruritania~Syldavia~annex~~",
    warUpdates,
    events: [declarationEvent()],
    regions: REGIONS,
  });
  assert.equal(outcome.warUpdates.length, 2, "both original lines survive, no third record");
  assert.equal(outcome.warUpdates[0], `${WAR_ID}~start~Ruritania~Syldavia~1~opened elsewhere`);
  assert.equal(outcome.accepted.declareWar[0].existing, true);
});

test("an accepted claim becomes a board-only claim op", () => {
  const outcome = apply({ intents: "press_claim~Ruritania~~~r1~a reason" });
  assert.deepEqual(outcome.rejected, []);
  assert.deepEqual(outcome.claimOps, [{ regionId: "r1", claimantCode: "Ruritania", note: "a reason" }]);
  assert.equal(outcome.accepted.pressClaim[0].owner, "Syldavia");
  assert.equal(outcome.warUpdates.length, 0);
});

test("a claim on a region the menu does not offer is refused", () => {
  const outcome = apply({ intents: "press_claim~Ruritania~~~r2,r9~" });
  assert.deepEqual(outcome.claimOps, []);
  assert.equal(outcome.rejected.length, 2);
  assert.equal(outcome.rejected.every((entry) => entry.reason === "not a region it may claim this turn"), true);
});

test("an unknown operation and a nameless actor are reported, not thrown", () => {
  const outcome = apply({ intents: "sanction~Ruritania~Syldavia~~~\npress_claim~~~~~" });
  assert.deepEqual(outcome.warUpdates, []);
  assert.deepEqual(outcome.claimOps, []);
  assert.equal(outcome.rejected[0].reason, "unknown intent");
  assert.equal(outcome.rejected[1].reason, "no actor named");
});

// A war Ruritania may sue to leave: weary, not ahead, between two computer
// powers. `ahead` is false because neither side holds its declared target.
const wearyWorld = (over = {}) => ({
  ...world(),
  wars: [{
    id: "war-ruritania-syldavia",
    status: "active",
    startedDate: "1900-01-01",
    sideA: ["Ruritania"],
    sideB: ["Syldavia"],
    goals: { a: { kind: "annex", targetRegionIds: ["r1"] }, b: { kind: "annex", targetRegionIds: ["r2"] } },
    weariness: { a: 0.62, b: 0.2, throughDate: "1900-03-01" },
    unjustAggressors: [],
  }],
  ...over,
});

test("a weary power may sue for peace: accepted, and no war record is written", () => {
  const warUpdates = [{ id: "war-other", op: "start", actors: ["A"], opponents: ["B"] }];
  const outcome = applyStrategicIntents({
    world: wearyWorld(),
    regions: REGIONS,
    events: [],
    warUpdates,
    intents: "seek_peace~Ruritania~war-ruritania-syldavia~~~",
  });
  assert.deepEqual(outcome.rejected, []);
  assert.deepEqual(outcome.accepted.seekPeace, [
    { actor: "Ruritania", target: "Syldavia", warId: "war-ruritania-syldavia" },
  ]);
  assert.deepEqual(outcome.warUpdates, warUpdates, "the ledger records are untouched");
  assert.deepEqual(outcome.claimOps, []);
});

test("a seek on a war the menu does not offer, or with no war named, is refused", () => {
  const unknown = applyStrategicIntents({
    world: wearyWorld(),
    regions: REGIONS,
    events: [],
    intents: "seek_peace~Ruritania~war-does-not-exist~~~",
  });
  assert.deepEqual(unknown.accepted.seekPeace, []);
  assert.equal(unknown.rejected[0].reason, "not a war it may seek peace in this turn");

  const nameless = applyStrategicIntents({ world: wearyWorld(), regions: REGIONS, events: [], intents: "seek_peace~Ruritania~~~~" });
  assert.equal(nameless.rejected[0].reason, "no war named");
});

test("a fresh war, an ahead power and the player's war are not offers", () => {
  const fresh = applyStrategicIntents({
    world: wearyWorld({
      wars: [{
        id: "war-ruritania-syldavia",
        status: "active",
        startedDate: "1900-01-01",
        sideA: ["Ruritania"],
        sideB: ["Syldavia"],
        goals: { a: { kind: "annex", targetRegionIds: ["r1"] }, b: { kind: "annex", targetRegionIds: ["r2"] } },
        weariness: { a: 0.1, b: 0.1, throughDate: "1900-03-01" },
      }],
    }),
    regions: REGIONS,
    events: [],
    intents: "seek_peace~Ruritania~war-ruritania-syldavia~~~",
  });
  assert.deepEqual(fresh.accepted.seekPeace, [], "too fresh to seek");

  const ahead = applyStrategicIntents({
    world: wearyWorld({ regionOwnershipOverrides: { r1: "Ruritania" } }),
    regions: REGIONS,
    events: [],
    intents: "seek_peace~Ruritania~war-ruritania-syldavia~~~",
  });
  assert.deepEqual(ahead.accepted.seekPeace, [], "a power ahead may not freeze the win");

  const player = applyStrategicIntents({
    world: wearyWorld(),
    regions: REGIONS,
    events: [],
    playerPolity: "Syldavia",
    intents: "seek_peace~Ruritania~war-ruritania-syldavia~~~",
  });
  assert.deepEqual(player.accepted.seekPeace, [], "the player's war is the player's decision");
});

test("the inert path reports an empty seekPeace list", () => {
  const outcome = applyStrategicIntents({ world: wearyWorld(), intents: "", regions: REGIONS, events: [] });
  assert.deepEqual(outcome.accepted.seekPeace, []);
});
