/*! Open Historia — canonical war ledger tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/warLedger.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  activeWarIdsForPolity,
  applyWarUpdates,
  buildCanonicalWarContext,
  decodeWarUpdates,
  eventNarratesHardCombat,
  reconcileCombatWarState,
  repairWarLedgerPayload,
  validateWarLedgerPayload,
} from "./nativeWarLedger.js";
import { normalizeWorldState } from "../../runtime/gameState.js";

// A war exists only because a warUpdates record started it, and a battle can
// only be narrated inside one that is active: the invariant the whole ledger
// enforces, exercised end to end on the compact line transport the model emits.

const world = { polityOverrides: {}, wars: [] };

const declaration = () => [{
  id: "e1",
  date: "1914-08-03",
  title: "Germany declares war on France",
  description: "Berlin declares war on Paris after the ultimatum expires.",
  kind: "diplomacy",
  warId: "war-france-germany-1914",
}];

test("a declaration starts a canonical war bound to its event", () => {
  const events = declaration();
  const candidate = { events, warUpdates: "war-france-germany-1914~start~Germany~France~1~Declaration of war" };
  assert.equal(validateWarLedgerPayload(candidate, { world }), "");

  const merge = applyWarUpdates({
    world,
    updates: decodeWarUpdates(candidate.warUpdates),
    events,
    stopDate: "1914-08-31",
    round: 2,
  });
  assert.deepEqual(merge.appliedIds, ["war-france-germany-1914"]);
  assert.equal(merge.wars.length, 1);
  assert.equal(merge.wars[0].status, "active");
  assert.deepEqual(merge.wars[0].sideA, ["Germany"]);
  assert.deepEqual(merge.wars[0].sideB, ["France"]);
  assert.equal(merge.wars[0].startedDate, "1914-08-03");
  assert.deepEqual(merge.wars[0].sourceEventIds, ["e1"]);
  assert.deepEqual(activeWarIdsForPolity(merge.world, "France"), ["war-france-germany-1914"]);
  assert.match(buildCanonicalWarContext(merge.world), /war-france-germany-1914 \| ACTIVE \| SIDE A: Germany \| SIDE B: France/);
});

test("a declaration with no matching warUpdates record is rejected", () => {
  const error = validateWarLedgerPayload({ events: declaration(), warUpdates: "" }, { world });
  assert.match(error, /narrates a canonical war transition but has no matching warUpdates record/);
});

test("hard combat without a canonical war is rejected", () => {
  const candidate = {
    events: [{
      id: "e1",
      date: "1914-08-20",
      title: "Battle of the Frontiers",
      description: "French and German armies clash along the whole border.",
      kind: "military",
      combatants: ["France", "Germany"],
    }],
    warUpdates: "",
  };
  assert.match(validateWarLedgerPayload(candidate, { world }), /has no event\.warId/);
});

test("reconciliation binds unlabelled combat to the one matching active war", () => {
  const warWorld = {
    ...world,
    wars: [{ id: "war-france-germany-1914", status: "active", sideA: ["Germany"], sideB: ["France"], startedDate: "1914-08-03" }],
  };
  const candidate = {
    events: [{
      id: "e1",
      date: "1914-08-20",
      title: "Battle of the Frontiers",
      description: "French and German armies clash along the whole border.",
      kind: "military",
      combatants: ["France", "Germany"],
    }],
    warUpdates: "",
  };
  const repair = reconcileCombatWarState(candidate, { world: warWorld });
  assert.equal(repair.bound, 1);
  assert.deepEqual(repair.unresolved, []);
  assert.equal(candidate.events[0].warId, "war-france-germany-1914");
  assert.equal(validateWarLedgerPayload(candidate, { world: warWorld }), "");
});

test("a started war records side A as the aggressor and keeps an explicit one", () => {
  const events = [{
    id: "e1",
    date: "1914-08-03",
    title: "Germany declares war on France",
    warId: "war-france-germany-1914",
  }];
  const started = applyWarUpdates({
    world: { polityOverrides: {}, wars: [] },
    updates: decodeWarUpdates("war-france-germany-1914~start~Germany~France~1~Declaration of war"),
    events,
    stopDate: "1914-08-31",
    round: 2,
  });
  assert.equal(started.wars[0].aggressor, "a");

  const kept = applyWarUpdates({
    world: {
      polityOverrides: {},
      wars: [{ id: "w", status: "active", aggressor: "b", sideA: ["A"], sideB: ["B"], startedDate: "1900-01-01" }],
    },
    updates: [],
    events: [],
    stopDate: "1901-01-01",
    round: 2,
  });
  assert.equal(kept.wars[0].aggressor, "b");
});

test("a readiness event naming two allies is not combat and creates no war", () => {
  const candidate = {
    events: [{
      id: "e1",
      date: "1914-07-30",
      title: "Joint staff talks conclude",
      description: "British and French staffs agree combat-readiness measures and a deployment plan.",
      kind: "military",
      combatants: ["France", "United Kingdom"],
    }],
    warUpdates: "",
  };
  const repair = reconcileCombatWarState(candidate, { world });
  assert.equal(repair.started, 0);
  assert.equal(repair.sanitized, 1);
  assert.deepEqual(candidate.events[0].combatants, []);
  assert.equal(validateWarLedgerPayload(candidate, { world }), "");
});

// Transcribed from a player's debug report (Iran, round 55): the event the model
// wrote for the player's own queued action. It was read as a launched military
// offensive with no combatants, so the retry was spent on a phantom battle and
// the final attempt dropped the event from the turn.
test("a diplomatic offensive is not a battle; a military offensive still is", () => {
  const diplomatic = {
    id: "segment-1-event-2",
    date: "2026-07-18",
    kind: "diplomacy",
    title: "Ministry of Foreign Affairs Launches European Diplomatic Offensive for Sanctions Relief",
    description: "The Ministry of Foreign Affairs, in close coordination with Omani backchannel delegates, launches an active diplomatic offensive across European capitals, formally demanding the immediate lifting of unilateral Western sanctions against the sovereign Bahraini Republic and the unified government of Yemen.",
  };
  assert.equal(eventNarratesHardCombat(diplomatic), false);
  const candidate = { events: [diplomatic], warUpdates: "" };
  assert.deepEqual(reconcileCombatWarState(candidate, { world }).unresolved, []);
  assert.equal(validateWarLedgerPayload(candidate, { world }), "");

  for (const phrase of ["charm offensive", "media counter-offensive", "peace offensive"]) {
    assert.equal(
      eventNarratesHardCombat({ kind: "diplomacy", title: `Tokyo launches a ${phrase} in Seoul`, description: "" }),
      false,
      phrase,
    );
  }

  assert.equal(eventNarratesHardCombat({
    kind: "military",
    title: "Germany launches an offensive on the Marne",
    description: "German armies open a counter-offensive against French positions.",
  }), true, "a military offensive is still combat");
  assert.equal(eventNarratesHardCombat({
    kind: "diplomacy",
    title: "Paris opens a diplomatic offensive as armies clash on the border",
    description: "",
  }), true, "real fighting in the same event is still combat");
  assert.equal(eventNarratesHardCombat({
    kind: "military",
    title: "Moscow launches a cyber offensive against Kyiv's grid",
    description: "",
  }), true, "a cyber offensive is a hostile act, not a figure of speech");
});

test("ceasefire, resume and end move the status; a second start on a live war is refused", () => {
  const warWorld = { ...world, wars: [{ id: "w", status: "active", sideA: ["A"], sideB: ["B"], startedDate: "1900-01-01" }] };
  const events = [{ id: "e1", date: "1901-01-01", title: "Armistice signed between A and B", description: "The guns fall silent.", warId: "w" }];

  const paused = applyWarUpdates({ world: warWorld, updates: "w~ceasefire~~~1~armistice", events, stopDate: "1901-01-31", round: 3 });
  assert.equal(paused.wars[0].status, "ceasefire");

  const again = applyWarUpdates({ world: paused.world, updates: "w~start~A~B~1~again", events, stopDate: "1901-02-01", round: 4 });
  assert.deepEqual(again.appliedIds, []);
  assert.equal(again.wars[0].status, "ceasefire");

  const resumed = applyWarUpdates({ world: paused.world, updates: "w~resume~~~1~fighting resumes", events, stopDate: "1901-02-01", round: 4 });
  assert.equal(resumed.wars[0].status, "active");

  const ended = applyWarUpdates({ world: resumed.world, updates: "w~end~~~1~peace", events, stopDate: "1901-03-01", round: 5 });
  assert.equal(ended.wars[0].status, "ended");
  assert.equal(ended.wars[0].endedDate, "1901-01-01");
  assert.match(buildCanonicalWarContext(ended.world), /No active or ceasefire canonical wars/);
});

// A live run (2026-09-17) lost two real events to this: "Tragic Clashes and Fire
// in Odessa" and "Explosion Rocks Regional Administration Building in Luhansk"
// read as hard combat to the detector, named no two belligerents, and were
// DELETED by the salvage path — and under salvage-first there is no second
// attempt to correct them, so the player simply never saw them. What must fail
// closed is the belligerency, not the event.
test("an unbindable combat event is reported for unbinding, never for deletion", () => {
  const riot = {
    id: "e1",
    date: "2014-05-02",
    title: "Tragic Clashes and Fire in Odessa",
    description: "Street clashes between rival demonstrators end with a building alight; dozens are killed.",
    kind: "world",
    combatants: [],
  };
  const candidate = { events: [riot], warUpdates: "" };
  const outcome = reconcileCombatWarState(candidate, { world });

  assert.equal(outcome.unresolved.length, 1, "the engine cannot tie it to a war, and says so");
  assert.equal(outcome.unresolved[0].index, 0);
  // reconcileCombatWarState itself never removes an event: it reports, and the
  // caller (gameplay.js validateGeneratedWorldChanges) unbinds rather than drops.
  assert.equal(candidate.events.length, 1, "the event is still there after reconciliation");
  assert.equal(candidate.events[0].title, "Tragic Clashes and Fire in Odessa");

  // What the caller then does (gameplay.js validateGeneratedWorldChanges): strip
  // the war metadata and keep the event. The ledger still complains that prose
  // reading as combat carries no warId — a riot IS written like a battle — and
  // that complaint is only ever logged: repairWarLedgerPayload, the last stage,
  // strips bindings and drops records but NEVER removes an event. So the event
  // reaches the player either way, with no belligerency invented for it.
  candidate.events = candidate.events.map((event) => ({ ...event, warId: "", combatants: [] }));
  const repair = repairWarLedgerPayload(candidate, { world });
  assert.equal(candidate.events.length, 1, "the repair keeps the event");
  assert.equal(candidate.events[0].warId, "", "and invents no war for it");
  assert.deepEqual(candidate.events[0].combatants, []);
  assert.deepEqual(decodeWarUpdates(candidate.warUpdates), [], "no war record was conjured either");
  assert.match(repair.residual, /no event.warId/, "the residual complaint is about the ledger, and is only logged");
});

// A goals record is a link-free state declaration: it rides the same compact
// transport as the transitions but is not bound to the event that causes it.

test("a goals record decodes as a link-free declaration", () => {
  const records = decodeWarUpdates("war-x~goals~France:annex:Alsace|Lorraine;Germany:reparations~~~");
  assert.equal(records.length, 1);
  assert.equal(records[0].op, "goals");
});

test("a start then a link-free goals record stores the parsed declaration", () => {
  const merge = applyWarUpdates({
    world,
    updates: [
      "war-x~start~France~Germany~1~declaration of war",
      "war-x~goals~France:annex:Alsace|Lorraine;Germany:reparations~~~",
    ],
    events: [],
    stopDate: "1914-08-31",
    round: 2,
    resolveRegion: (value) => ({ Alsace: "alsace", Lorraine: "lorraine" })[value] || "",
  });
  assert.equal(merge.wars.length, 1);
  assert.equal(merge.wars[0].goals.a.kind, "annex");
  assert.deepEqual(merge.wars[0].goals.a.targetRegionIds, ["alsace", "lorraine"]);
  assert.equal(merge.wars[0].goals.b.kind, "reparations");
});

// The goals record carries no note, and its empty note must not clobber the
// note the war was started or last updated with. Four trailing tildes would
// parse the last separator as a literal "~" note; three is the empty form.
test("a goals declaration keeps the war's existing note", () => {
  const started = applyWarUpdates({
    world,
    updates: "war-note~start~France~Germany~1~the war of the two flags",
    events: [],
    stopDate: "1914-08-03",
    round: 2,
  });
  assert.equal(started.wars[0].note, "the war of the two flags");

  const declared = applyWarUpdates({
    world: started.world,
    updates: "war-note~goals~France:annex:Alsace~~~",
    events: [],
    stopDate: "1914-08-31",
    round: 3,
    resolveRegion: () => "alsace",
  });
  assert.equal(declared.wars[0].note, "the war of the two flags");
});

test("a goals record naming an unknown war is dropped, not thrown", () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => { warnings.push(String(message)); };
  let merge;
  try {
    merge = applyWarUpdates({ world, updates: "war-ghost~goals~France:annex:Alsace~~~", events: [] });
  } finally {
    console.warn = original;
  }
  assert.deepEqual(merge.appliedIds, []);
  assert.equal(merge.wars.length, 0);
  assert.match(warnings.join("\n"), /war-ghost/);
});

test("legacy wars normalize without goals or weariness, and weariness survives a later save", () => {
  const legacy = normalizeWorldState({
    wars: [{ id: "w", status: "active", sideA: ["A"], sideB: ["B"], startedDate: "1900-01-01" }],
  });
  assert.equal(legacy.wars[0].goals, null);
  assert.equal(legacy.wars[0].weariness, null);

  const declared = applyWarUpdates({
    world: legacy,
    updates: "w~goals~A:annex:Alsace~~~",
    events: [],
    stopDate: "1901-01-01",
    round: 2,
    weariness: { w: { a: 0.4, b: 0.2, throughDate: "1901-01-01" } },
    resolveRegion: () => "alsace",
  });
  assert.equal(declared.wars[0].goals.a.kind, "annex");
  assert.equal(declared.wars[0].weariness.a, 0.4);

  const ended = applyWarUpdates({
    world: declared.world,
    updates: "w~end~~~",
    events: [],
    stopDate: "1901-02-01",
    round: 3,
  });
  assert.equal(ended.wars[0].status, "ended");
  assert.equal(ended.wars[0].weariness.a, 0.4);
  assert.equal(ended.wars[0].weariness.throughDate, "1901-01-01");
});

test("normalizeWorldState round-trips goals and weariness", () => {
  const goals = {
    a: { kind: "annex", targetRegionIds: ["alsace"], note: "" },
    b: { kind: "status_quo", targetRegionIds: [], note: "" },
  };
  const weariness = { a: 0.7, b: 0.1, throughDate: "1914-08-31" };
  const normalized = normalizeWorldState({
    wars: [{ id: "w", status: "active", sideA: ["A"], sideB: ["B"], startedDate: "1900-01-01", goals, weariness }],
  });
  assert.deepEqual(normalized.wars[0].goals, goals);
  assert.deepEqual(normalized.wars[0].weariness, weariness);
});

test("a link-free goals record is a valid war ledger payload", () => {
  const warWorld = {
    ...world,
    wars: [{ id: "war-x", status: "active", sideA: ["France"], sideB: ["Germany"], startedDate: "1914-08-03" }],
  };
  const candidate = {
    events: [],
    warUpdates: "war-x~goals~France:annex:Alsace|Lorraine;Germany:reparations~~~",
  };
  assert.equal(validateWarLedgerPayload(candidate, { world: warWorld }), "");
});

test("an unrelated war update preserves a war's unjust aggressors", () => {
  const events = [{
    id: "e1",
    date: "1935-10-03",
    title: "Italy invades Ethiopia",
    description: "Italian forces cross the border.",
    kind: "diplomacy",
    warId: "war-ethiopia-1935",
  }];
  const started = applyWarUpdates({
    world: { polityOverrides: {}, wars: [] },
    updates: "war-ethiopia-1935~start~Italy~Ethiopia~1~invasion",
    events,
    stopDate: "1935-10-03",
    round: 1,
  });
  const marked = {
    ...started.world,
    wars: started.world.wars.map((war) => ({ ...war, unjustAggressors: ["Italy"] })),
  };
  const merged = applyWarUpdates({
    world: marked,
    updates: "war-ethiopia-1935~goals~Italy:annex:eritrea~~~",
    events,
    stopDate: "1935-10-04",
    round: 2,
  });
  const war = merged.wars.find((entry) => entry.id === "war-ethiopia-1935");
  assert.deepEqual(war.unjustAggressors, ["Italy"]);
});

test("a record that would close the held war is refused, and the rest are not", () => {
  const heldWorld = {
    polityOverrides: {},
    wars: [
      { id: "war-1", status: "active", sideA: ["Prussia"], sideB: ["France"], startedDate: "1800-01-01" },
      { id: "war-2", status: "active", sideA: ["Spain"], sideB: ["Portugal"], startedDate: "1800-01-01" },
    ],
    peaceOffer: { warId: "war-1", round: 3, pressure: 0.7 },
  };
  const endOne = [{
    id: "e1", date: "1800-02-01", title: "Peace of Basel",
    description: "Prussia and France sign a peace.", kind: "military",
    warId: "war-1", combatants: ["Prussia", "France"],
  }];
  const endTwo = [{
    id: "e2", date: "1800-02-02", title: "Peace of Madrid",
    description: "Spain and Portugal sign a peace.", kind: "military",
    warId: "war-2", combatants: ["Spain", "Portugal"],
  }];

  const refused = validateWarLedgerPayload(
    { events: endOne, warUpdates: "war-1~end~Prussia~~1~Peace signed" },
    { world: heldWorld },
  );
  assert.match(refused, /held open by a pending peace offer/);

  // A goal declaration does not close the war.
  assert.equal(
    validateWarLedgerPayload({ events: [], warUpdates: "war-1~goals~Prussia:annex~~~" }, { world: heldWorld }),
    "",
  );
  // A different war is untouched.
  assert.equal(
    validateWarLedgerPayload({ events: endTwo, warUpdates: "war-2~end~Spain~~1~Peace signed" }, { world: heldWorld }),
    "",
  );
  // Without an offer the very same record is valid.
  assert.equal(
    validateWarLedgerPayload(
      { events: endOne, warUpdates: "war-1~end~Prussia~~1~Peace signed" },
      { world: { polityOverrides: {}, wars: heldWorld.wars } },
    ),
    "",
  );
});
