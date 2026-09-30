/*! Open Historia — scripted-event impacts: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/scriptedImpacts.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
    authoredImpactTargets,
    hasImpacts,
    stampResolvedImpacts,
    withAuthorImpacts,
    withoutAuthorImpacts,
} from "./scriptedImpacts.js";

const beat = (date, text, impacts) => ({ date, title: text, text, impacts, errors: [] });
const empty = () => ({ regionTransfers: [], regionControlOps: [], regionClaims: [], polityChanges: [], unitOps: [], markerOps: [], createdChats: [], projectOps: [] });

test("only a beat that declares impacts and has an event is a target", () => {
    const events = [
        { date: "1914-06-28", title: "Franz Ferdinand is assassinated", description: "Archduke Franz Ferdinand is assassinated in Sarajevo." },
        { date: "1914-08-04", title: "Belgium invaded", description: "Germany invades Belgium." },
    ];
    const beats = [
        beat("1914-06-28", "Archduke Franz Ferdinand is assassinated in Sarajevo.", { ...empty(), regionTransfers: [{ regionName: "Sarajevo", toCode: "Austria-Hungary" }] }),
        beat("1914-08-04", "Germany invades Belgium.", empty()),
    ];
    const targets = authoredImpactTargets(beats, events);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].eventIndex, 0);
    assert.equal(hasImpacts(empty()), false);
    assert.equal(hasImpacts({ ...empty(), unitOps: [{ op: "spawn" }] }), true);
});

test("the model's impacts are stripped and the author's come in without touching the source", () => {
    const events = [
        { date: "1914-06-28", title: "Franz Ferdinand is assassinated", description: "Archduke Franz Ferdinand is assassinated in Sarajevo.", impacts: { regionTransfers: [{ regionName: "Invented" }] } },
        { date: "1914-07-01", title: "Elsewhere", description: "Something else happened.", impacts: { regionTransfers: [] } },
    ];
    const targets = [{ eventIndex: 0, impacts: { ...empty(), regionClaims: [{ regionName: "Bosnia", claimantCode: "Serbia" }] } }];
    const stripped = withoutAuthorImpacts(events, targets);
    assert.deepEqual(stripped[0].impacts, {}, "the model's own impacts are gone");
    assert.deepEqual(events[0].impacts.regionTransfers, [{ regionName: "Invented" }], "the source is not mutated");
    const stamped = withAuthorImpacts(stripped, targets);
    assert.deepEqual(stamped[0].impacts.regionClaims, [{ regionName: "Bosnia", claimantCode: "Serbia" }]);
    stamped[0].impacts.regionClaims.push({ regionName: "X", claimantCode: "Y" });
    assert.equal(targets[0].impacts.regionClaims.length, 1, "the author's object is not shared");
});

test("resolved impacts are written back to their events", () => {
    const events = [{ date: "1914-06-28", description: "x", impacts: {} }, { date: "1914-07-01", description: "y", impacts: {} }];
    const targets = [{ eventIndex: 0, impacts: { ...empty(), regionClaims: [{ regionName: "Bosnia" }] } }];
    const resolved = [{ ...events[0], impacts: { ...empty(), regionClaims: [{ regionName: "Bosnia", regionId: "BA-BIH" }] } }];
    const out = stampResolvedImpacts(events, targets, resolved);
    assert.equal(out[0].impacts.regionClaims[0].regionId, "BA-BIH");
    assert.deepEqual(out[1], events[1]);
});

test("a target the resolver dropped keeps the author's raw impacts", () => {
    const events = [{ date: "1914-06-28", description: "x", impacts: {} }];
    const targets = [{ eventIndex: 0, impacts: { ...empty(), regionClaims: [{ regionName: "Bosnia" }] } }];
    const out = stampResolvedImpacts(events, targets, []);
    assert.deepEqual(out[0].impacts.regionClaims, [{ regionName: "Bosnia" }]);
});
