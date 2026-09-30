/*! Open Historia — world direction: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/worldDirection.test.js
//
// Runs without node_modules: worldDirection.js imports nothing.
//
// These are an author's settings, so the promise is to the author: the number
// they set is the number the engine uses. And to the player: none of it may
// cost a request — a skip that falls short is kept and the model is told, never
// asked again.

import test from "node:test";
import assert from "node:assert/strict";

import {
    PRIORITY_RULES_HEADING,
    applyTerritoryTempo,
    beatIsWritten,
    buildScriptedEventsInstruction,
    dateKey,
    ensureScriptedEvents,
    parseScriptedEvents,
    parseImpactLine,
    parseImpactBlock,
    IMPACT_VERBS,
    serializeScriptedEvents,
    beatEventIndex,
    scriptedBeatsInSpan,
    territoryTempoAllowance,
    WORLD_SHARE_MIN_EVENTS,
    buildWorldDirectionDirective,
    eventConcernsPlayer,
    scaleEventRange,
    worldShareShortfall,
} from "./worldDirection.js";

test("pace scales what a period is asked for, and 100 changes nothing", () => {
    assert.deepEqual(scaleEventRange([5, 7], 100), [5, 7]);
    assert.deepEqual(scaleEventRange([5, 7], 50), [3, 4]);
    assert.deepEqual(scaleEventRange([5, 7], 200), [10, 14]);
    assert.deepEqual(scaleEventRange([10, 13], 40), [4, 5]);
    assert.deepEqual(scaleEventRange([29, 37], 250), [73, 93]);
});

test("a period never asks for nothing, and its upper end never falls below its lower", () => {
    assert.deepEqual(scaleEventRange([1, 2], 40), [1, 1]);
    assert.deepEqual(scaleEventRange([2, 2], 40), [2, 2], "a fixed count is not a pace");
    // An afternoon is one event however crowded the author likes their months.
    assert.deepEqual(scaleEventRange([1, 1], 250), [1, 1]);
});

test("a pace that is not a number is the built-in pace", () => {
    for (const pace of [undefined, null, "fast", Number.NaN]) assert.deepEqual(scaleEventRange([5, 7], pace), [5, 7]);
    assert.deepEqual(scaleEventRange(null, 150), [1, 1]);
});

const PLAYER = ["Russian Federation", "Russia"];
const event = (title, description = "", extra = {}) => ({ title, description, ...extra });

test("an event is the player's when the simulator says so, or when its own words name the player", () => {
    assert.equal(eventConcernsPlayer(event("Moscow raises tariffs", "", { playerRelated: true }), PLAYER), true);
    assert.equal(eventConcernsPlayer(event("Poland protests to the Russian Federation"), PLAYER), true);
    assert.equal(eventConcernsPlayer(event("Warsaw recalls its envoy", "The note is addressed to RUSSIA."), PLAYER), true);
    assert.equal(eventConcernsPlayer(event("Brazil devalues the real", "Coffee exporters cheer."), PLAYER), false);
});

test("the player's name is matched as whole words, never inside another", () => {
    assert.equal(eventConcernsPlayer(event("Prussian reforms begin", "Belorussian exiles take note."), ["Russia"]), false);
    assert.equal(eventConcernsPlayer(event("Romania mobilises"), ["Oman"]), false);
    assert.equal(eventConcernsPlayer(event("Talks open in Oman"), ["Oman"]), true);
    // A name too short to mean anything is not searched for at all.
    assert.equal(eventConcernsPlayer(event("Ob river floods"), ["Ob"]), false);
});

test("the floor is met when enough of the period belongs to the rest of the world", () => {
    const events = [
        event("Russian forces enter Kharkiv", "", { playerRelated: true }),
        event("Brazil devalues the real"),
        event("Japan launches a carrier"),
    ];
    assert.equal(worldShareShortfall(events, 35, { playerNames: PLAYER }), null);
    assert.equal(worldShareShortfall(events, 66, { playerNames: PLAYER }), null, "2 of 3 is 66%");
});

test("a shortfall says the count, the floor, and what to do about it", () => {
    const events = [
        event("Russian forces enter Kharkiv", "", { playerRelated: true }),
        event("NATO condemns Russia"),
        event("The Russian Federation recalls its envoy"),
        event("Brazil devalues the real"),
        event("Sanctions on Russia widen"),
    ];
    const shortfall = worldShareShortfall(events, 40, { playerNames: PLAYER });
    assert.deepEqual([shortfall.world, shortfall.total, shortfall.needed], [1, 5, 2]);
    assert.match(shortfall.text, /^1 of your 5 events was about the world beyond Russian Federation; this scenario asks for at least 2 \(40%\)\./);
    assert.match(shortfall.text, /give them events of their own/);
});

test("the floor does not apply to a handful of events, or when it is switched off", () => {
    const playerOnly = Array.from({ length: WORLD_SHARE_MIN_EVENTS - 1 }, () => event("x", "", { playerRelated: true }));
    assert.equal(worldShareShortfall(playerOnly, 50, { playerNames: PLAYER }), null);
    const many = Array.from({ length: 6 }, () => event("x", "", { playerRelated: true }));
    assert.equal(worldShareShortfall(many, 0, { playerNames: PLAYER }), null);
    assert.equal(worldShareShortfall(many, undefined, { playerNames: PLAYER }), null);
    assert.equal(worldShareShortfall(null, 50), null);
    assert.equal(worldShareShortfall(many, 50, { playerNames: PLAYER }).needed, 3);
});

test("the simulator is told the floor as a number, that the engine counts it, and how an event counts", () => {
    const directive = buildWorldDirectionDirective({ eventPace: 100, worldShare: 35, priorityRules: "" }, { playerPolity: "Russian Federation" });
    assert.match(directive, /^\[The World's Share — counted by the engine\]/);
    assert.match(directive, /At least 35% of this period's events/);
    assert.match(directive, /names Russian Federation, or that you mark playerRelated/);
    assert.doesNotMatch(directive, /PRIORITY RULES/);
});

test("priority rules come last, word for word, and say what they outrank", () => {
    const rules = "No power may field nuclear weapons before 1945.\nThe Ottoman Empire cannot collapse before 1918.";
    const directive = buildWorldDirectionDirective({ worldShare: 35, priorityRules: rules }, { playerPolity: "France" });
    assert.ok(directive.endsWith(rules));
    assert.ok(directive.indexOf("[The World's Share") < directive.indexOf(PRIORITY_RULES_HEADING));
    assert.match(directive, /outrank everything else you have been told/);
    assert.match(directive, /anything a field description of the output function suggests/);
});

test("nothing set, or world direction off, adds nothing to the prompt", () => {
    assert.equal(buildWorldDirectionDirective(null), "");
    assert.equal(buildWorldDirectionDirective({ eventPace: 150, worldShare: 0, priorityRules: "  " }), "");
    // Pace alone is not said: it is already in the numbers the skip asks for.
    assert.equal(buildWorldDirectionDirective({ eventPace: 40, worldShare: 0, priorityRules: "" }), "");
});

// --- scripted events ---

test("a beat is a dated line in the author's words; the rest of the text is ignored", () => {
    const beats = parseScriptedEvents([
        "# the war",
        "1914-06-28  Archduke Franz Ferdinand is assassinated in Sarajevo. Vienna blames Belgrade.",
        "1914-07-28 — Austria-Hungary declares war on Serbia",
        "a line with no date",
        "1914-08-01: Germany declares war on Russia",
        "-0218-08-02 Hannibal destroys the Roman army at Cannae.",
        "",
    ].join("\n"));
    assert.deepEqual(beats.map((beat) => beat.date), ["-0218-08-02", "1914-06-28", "1914-07-28", "1914-08-01"]);
    assert.equal(beats[1].title, "Archduke Franz Ferdinand is assassinated in Sarajevo");
    assert.equal(beats[1].text, "Archduke Franz Ferdinand is assassinated in Sarajevo. Vienna blames Belgrade.");
    assert.equal(beats[2].title, "Austria-Hungary declares war on Serbia");
    assert.deepEqual(parseScriptedEvents(""), []);
    assert.deepEqual(parseScriptedEvents(null), []);
});

test("dates sort as numbers, years before AD 1 included", () => {
    assert.ok(dateKey("-0218-08-02") < dateKey("0001-01-01"));
    assert.ok(dateKey("1914-07-28") < dateKey("1914-08-01"));
    assert.equal(dateKey("not a date"), null);
});

test("a period covers the beats after its origin up to its target; the first skip covers its origin day too", () => {
    const beats = parseScriptedEvents("2014-04-21 A\n2014-05-01 B\n2014-05-21 C\n2014-05-22 D");
    const span = { originDate: "2014-04-21", targetDate: "2014-05-21" };
    assert.deepEqual(scriptedBeatsInSpan(beats, span).map((beat) => beat.text), ["B", "C"]);
    assert.deepEqual(scriptedBeatsInSpan(beats, { ...span, includeOrigin: true }).map((beat) => beat.text), ["A", "B", "C"]);
    assert.deepEqual(scriptedBeatsInSpan(beats, { originDate: "bad", targetDate: "2014-05-21" }), []);
});

test("a beat is written when an event near its date shares its particular words", () => {
    const beat = parseScriptedEvents("2014-05-25 Ukraine holds a presidential election; Petro Poroshenko wins outright in the first round.")[0];
    assert.equal(beatIsWritten(beat, [{ date: "2014-05-26", title: "Poroshenko elected", description: "Petro Poroshenko wins Ukraine's presidential election outright." }]), true);
    assert.equal(beatIsWritten(beat, [{ date: "2014-05-25", title: "Fighting near Donetsk", description: "Separatists seize the airport." }]), false, "same day, different event");
    assert.equal(beatIsWritten(beat, [{ date: "2014-07-25", title: "Poroshenko elected", description: "Petro Poroshenko wins Ukraine's presidential election outright." }]), false, "two months out is not this beat");
});

test("a beat the answer left out is written by the engine, in the author's words, without impacts", () => {
    const beats = parseScriptedEvents("2014-05-25 Ukraine holds a presidential election; Petro Poroshenko wins outright.\n2014-05-02 Clashes in Odesa leave dozens dead at the Trade Unions House.");
    const answer = [{ date: "2014-05-26", title: "Poroshenko wins", description: "Petro Poroshenko wins the Ukraine presidential election outright." }];
    const { events, written, inserted } = ensureScriptedEvents(answer, beats);
    assert.equal(written.length, 1);
    assert.equal(inserted.length, 1);
    assert.equal(events.length, 2);
    const engineWrote = events[1];
    assert.equal(engineWrote.date, "2014-05-02");
    assert.equal(engineWrote.description, "Clashes in Odesa leave dozens dead at the Trade Unions House.");
    assert.equal(engineWrote.kind, "world");
    assert.equal(engineWrote.notable, true);
    assert.deepEqual(engineWrote.impacts, {});
    assert.equal(answer.length, 1, "the answer itself is not mutated");
});

test("the period is told its beats, dated, and what happens to one it leaves out", () => {
    const beats = parseScriptedEvents("1914-06-28 Archduke Franz Ferdinand is assassinated in Sarajevo.");
    const text = buildScriptedEventsInstruction(beats);
    assert.match(text, /^\[Scripted events this period/);
    assert.match(text, /- 1914-06-28 — Archduke Franz Ferdinand is assassinated in Sarajevo\./);
    assert.match(text, /written by the engine/);
    assert.equal(buildScriptedEventsInstruction([]), "");
});

// --- scripted-event impacts ---

test("an impact line is a verb, its subject and its fields", () => {
    assert.deepEqual(parseImpactLine("transfer Sarajevo -> Austria-Hungary").impacts.regionTransfers,
        [{ regionName: "Sarajevo", toCode: "Austria-Hungary" }]);
    assert.deepEqual(parseImpactLine("control Belgium -> Germany note=blitz").impacts.regionControlOps,
        [{ op: "control", regionName: "Belgium", toCode: "Germany", note: "blitz" }]);
    assert.deepEqual(parseImpactLine("contest Donbas by Ukraine").impacts.regionControlOps,
        [{ op: "contest", regionName: "Donbas", actorCode: "Ukraine" }]);
    assert.deepEqual(parseImpactLine("clear Donbas from Russia").impacts.regionControlOps,
        [{ op: "clear_contest", regionName: "Donbas", claimantCode: "Russia" }]);
    assert.deepEqual(parseImpactLine("claim Bosnia by Serbia").impacts.regionClaims,
        [{ regionName: "Bosnia", claimantCode: "Serbia" }]);
    assert.deepEqual(parseImpactLine("unclaim Bosnia by Serbia").impacts.regionClaims,
        [{ regionName: "Bosnia", claimantCode: "Serbia", drop: true }]);
    assert.deepEqual(parseImpactLine('polity create Poland name="Polish Republic"').impacts.polityChanges,
        [{ operation: "create", code: "Poland", name: "Polish Republic" }]);
    assert.deepEqual(parseImpactLine('unit spawn "1st Army" ownerCode=Germany type=armor strength=90 at="western Poland"').impacts.unitOps,
        [{ op: "spawn", unit: { name: "1st Army", ownerCode: "Germany", type: "armor", strength: 90, at: "western Poland" } }]);
    assert.deepEqual(parseImpactLine("unit move unit-3 at=Krakow").impacts.unitOps,
        [{ op: "move", unitId: "unit-3", at: "Krakow" }]);
    assert.deepEqual(parseImpactLine('marker build "Fort X" kind=fort at=Krakow').impacts.markerOps,
        [{ op: "build", marker: { name: "Fort X", kind: "fort", at: "Krakow" } }]);
    assert.deepEqual(parseImpactLine("project complete Bridge").impacts.projectOps,
        [{ op: "complete", name: "Bridge" }]);
    assert.deepEqual(parseImpactLine("chat Serbia, Russia title=Terms").impacts.createdChats,
        [{ countries: ["Serbia", "Russia"], title: "Terms" }]);
    assert.deepEqual(parseImpactLine('unit spawn "1st Army" note="held in reserve"').impacts.unitOps,
        [{ op: "spawn", unit: { name: "1st Army", note: "held in reserve" } }]);
});

test("an impact line that cannot be read is dropped, with a reason", () => {
    assert.equal(parseImpactLine("teleport Sarajevo -> Mars").impacts, null);
    assert.match(parseImpactLine("teleport Sarajevo -> Mars").error, /unknown verb/i);
    assert.equal(parseImpactLine("transfer Sarajevo").impacts, null);
    assert.match(parseImpactLine("transfer Sarajevo").error, /->/);
    assert.equal(parseImpactLine("unit explode unit-1").impacts, null);
    assert.match(parseImpactLine("unit explode unit-1").error, /no operation/i);
    assert.equal(parseImpactLine("claim Bosnia by").impacts, null);
    assert.equal(parseImpactLine("transfer Sarajevo -> Austria-Hungary note=").impacts, null);
    assert.equal(parseImpactLine("").impacts, null);
    assert.equal(parseImpactLine('transfer "Sarajevo -> Austria').impacts, null, "an unbalanced quote is a bad line, not a silent guess");
});

test("a block keeps the lines it could read and lists the ones it could not", () => {
    const { impacts, errors } = parseImpactBlock([
        "transfer Sarajevo -> Austria-Hungary",
        "teleport Sarajevo -> Mars",
        "claim Bosnia by Serbia",
    ]);
    assert.equal(impacts.regionTransfers.length, 1);
    assert.equal(impacts.regionClaims.length, 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /teleport/);
    assert.deepEqual(Object.keys(impacts).sort(), [
        "createdChats", "markerOps", "polityChanges", "projectOps",
        "regionClaims", "regionControlOps", "regionTransfers", "unitOps",
    ]);
});

test("the verb table is what the parser accepts", () => {
    for (const verb of ["transfer", "control", "contest", "clear", "claim", "unclaim", "polity", "unit", "marker", "project", "chat"]) {
        assert.equal(IMPACT_VERBS.has(verb), true, verb);
    }
});

test("a beat's indented lines become its impacts; the block ends at the next date or a blank line", () => {
    const beats = parseScriptedEvents([
        "1914-06-28 Archduke Franz Ferdinand is assassinated in Sarajevo.",
        "  transfer Sarajevo -> Austria-Hungary",
        "  claim Bosnia by Serbia",
        "",
        "1914-08-04 Germany invades Belgium.",
        "  control Belgium -> Germany note=blitz",
    ].join("\n"));
    assert.equal(beats.length, 2);
    assert.deepEqual(beats[0].impacts.regionTransfers, [{ regionName: "Sarajevo", toCode: "Austria-Hungary" }]);
    assert.deepEqual(beats[0].impacts.regionClaims, [{ regionName: "Bosnia", claimantCode: "Serbia" }]);
    assert.deepEqual(beats[0].errors, []);
    assert.deepEqual(beats[1].impacts.regionControlOps, [{ op: "control", regionName: "Belgium", toCode: "Germany", note: "blitz" }]);
    assert.equal(beats[0].text, "Archduke Franz Ferdinand is assassinated in Sarajevo.");
});

test("a beat with no impacts is exactly what it was, and an unreadable line is reported not fatal", () => {
    const plain = parseScriptedEvents("2014-05-02 Clashes in Odesa leave dozens dead.");
    assert.deepEqual(plain[0].impacts, { regionTransfers: [], regionControlOps: [], regionClaims: [], polityChanges: [], unitOps: [], markerOps: [], createdChats: [], projectOps: [] });
    assert.deepEqual(plain[0].errors, []);
    const broken = parseScriptedEvents("2014-05-02 Clashes in Odesa.\n  teleport Odesa -> Mars");
    assert.equal(broken[0].impacts.regionControlOps.length, 0);
    assert.equal(broken[0].errors.length, 1);
    assert.equal(broken[0].text, "Clashes in Odesa.");
});

test("serializing a parsed text gives the same beats back", () => {
    const text = [
        "1914-06-28 Archduke Franz Ferdinand is assassinated in Sarajevo.",
        "  transfer Sarajevo -> Austria-Hungary",
        '  unit spawn "1st Army" ownerCode=Germany strength=90 at="western Poland"',
        "",
        "1914-08-04 Germany invades Belgium.",
    ].join("\n");
    const first = parseScriptedEvents(text);
    const again = parseScriptedEvents(serializeScriptedEvents(first));
    assert.deepEqual(again.map((beat) => beat.date), first.map((beat) => beat.date));
    assert.deepEqual(again.map((beat) => beat.text), first.map((beat) => beat.text));
    assert.deepEqual(again.map((beat) => beat.impacts), first.map((beat) => beat.impacts));
});

test("a line the parser could not read survives a round trip, verbatim, attached to nothing", () => {
    const text = "2014-05-02 Clashes in Odesa.\n  teleport Odesa -> Mars";
    const once = serializeScriptedEvents(parseScriptedEvents(text));
    assert.match(once, /teleport Odesa -> Mars/);
    const twice = parseScriptedEvents(once);
    assert.equal(twice.length, 1);
    assert.equal(twice[0].date, "2014-05-02");
    assert.deepEqual(twice[0].impacts.regionTransfers, []);
});

test("the event a beat is written as can be found by index; -1 when it is not written", () => {
    const beat = parseScriptedEvents("2014-05-25 Ukraine holds a presidential election; Petro Poroshenko wins outright.")[0];
    const events = [
        { date: "2014-05-20", title: "Unrelated", description: "Nothing here." },
        { date: "2014-05-26", title: "Poroshenko elected", description: "Petro Poroshenko wins Ukraine's presidential election outright." },
    ];
    assert.equal(beatEventIndex(beat, events), 1);
    assert.equal(beatIsWritten(beat, events), true);
    assert.equal(beatEventIndex(beat, [{ date: "2014-05-25", title: "Fighting", description: "Separatists seize the airport." }]), -1);
    assert.equal(beatEventIndex(beat, []), -1);
});

// --- the map's tempo ---

test("the allowance is the ceiling scaled to the period, never below one; 0 is no ceiling", () => {
    assert.equal(territoryTempoAllowance(3, 30), 3);
    assert.equal(territoryTempoAllowance(3, 10), 1);
    assert.equal(territoryTempoAllowance(3, 90), 9);
    assert.equal(territoryTempoAllowance(0, 30), Infinity);
    assert.equal(territoryTempoAllowance(null, 30), Infinity);
});

test("transfers and captures beyond the allowance are withheld in event order; contests are not counted", () => {
    const events = [
        { date: "2014-05-01", title: "A", impacts: { regionTransfers: [{ regionId: "r1", toCode: "X" }, { regionId: "r2", toCode: "X" }], regionControlOps: [{ op: "contest", regionId: "r9", fromCode: "Y", actorCode: "X" }] } },
        { date: "2014-05-10", title: "B", impacts: { regionControlOps: [{ op: "control", regionId: "r3", fromCode: "Y", toCode: "X" }, { op: "clear_contest", regionId: "r9" }] } },
        { date: "2014-05-20", title: "C", impacts: { regionTransfers: [{ regionId: "r4", toCode: "X" }] } },
    ];
    const { events: next, withheld, allowance } = applyTerritoryTempo(events, { ceilingPerMonth: 3, spanDays: 30 });
    assert.equal(allowance, 3);
    assert.equal(withheld, 1);
    assert.equal(next[0].impacts.regionTransfers.length, 2);
    assert.equal(next[0].impacts.regionControlOps.length, 1, "the contest stays");
    assert.equal(next[1].impacts.regionControlOps.length, 2, "the capture is the third and last allowed; the clearing is free");
    assert.deepEqual(next[2].impacts.regionTransfers, [], "the fourth region is withheld");
    assert.equal(events[2].impacts.regionTransfers.length, 1, "the input is not mutated");
    assert.equal(applyTerritoryTempo(events, { ceilingPerMonth: 0, spanDays: 30 }).withheld, 0);
});

test("a whole-country entry is the ceiling's worth by itself", () => {
    const events = [
        { impacts: { regionTransfers: [{ regionId: "Y", toCode: "X", wholeCountry: true }, { regionId: "r2", toCode: "X" }] } },
    ];
    const { events: next, withheld } = applyTerritoryTempo(events, { ceilingPerMonth: 5, spanDays: 30 });
    assert.equal(withheld, 1);
    assert.equal(next[0].impacts.regionTransfers.length, 1);
    assert.equal(next[0].impacts.regionTransfers[0].wholeCountry, true);
});

test("the simulator is told the tempo as a number for the period", () => {
    const directive = buildWorldDirectionDirective({ worldShare: 0, priorityRules: "", territoryTempo: 2 }, { playerPolity: "France", spanDays: 45 });
    assert.match(directive, /^\[The Map's Tempo — counted by the engine\]/);
    assert.match(directive, /no faster than 2 regions per thirty days: 3 this period/);
    assert.equal(buildWorldDirectionDirective({ worldShare: 0, priorityRules: "", territoryTempo: 0 }), "");
});
