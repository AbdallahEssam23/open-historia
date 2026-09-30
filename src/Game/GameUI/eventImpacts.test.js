/*! Open Historia — event impact summary tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/eventImpacts.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { summarizeEventImpacts } from "./eventImpacts.js";

test("an event that moved nothing has no rows and no total", () => {
    assert.deepEqual(summarizeEventImpacts({ impacts: { regionTransfers: [], unitOps: [] } }), { rows: [], total: 0 });
});

test("a missing impacts object (or event) reads as nothing, never throws", () => {
    assert.deepEqual(summarizeEventImpacts({}), { rows: [], total: 0 });
    assert.deepEqual(summarizeEventImpacts(null), { rows: [], total: 0 });
    assert.deepEqual(summarizeEventImpacts(undefined), { rows: [], total: 0 });
});

test("territorial changes count together: transfers, control flips and claims", () => {
    const summary = summarizeEventImpacts({
        impacts: {
            regionTransfers: [{ regionId: "a" }],
            regionControlOps: [{ regionId: "b", op: "control" }],
            regionClaims: [{ regionId: "c" }],
        },
    });
    assert.equal(summary.total, 3);
    assert.deepEqual(summary.rows, [{ key: "regions", glyph: "⌖", count: 3, label: "regions", text: "3 regions" }]);
});

test("each kind is summarised in the card's order, singular when one", () => {
    const summary = summarizeEventImpacts({
        impacts: {
            regionTransfers: [{}, {}],
            polityChanges: [{}],
            unitOps: [{}],
            markerOps: [{}],
            projectOps: [{}],
        },
    });
    assert.equal(summary.total, 6);
    assert.deepEqual(summary.rows.map((row) => row.key), ["regions", "polities", "forces", "structures", "projects"]);
    assert.equal(summary.rows[0].text, "2 regions");
    assert.equal(summary.rows[1].text, "1 polity");
    assert.equal(summary.rows[2].text, "1 formation");
});

test("a non-array impacts value is ignored rather than counted", () => {
    const summary = summarizeEventImpacts({ impacts: { unitOps: "one", markerOps: null, polityChanges: [{}] } });
    assert.equal(summary.total, 1);
    assert.equal(summary.rows[0].key, "polities");
});

test("a fallback turn (every array empty) reports nothing changed", () => {
    const summary = summarizeEventImpacts({
        source: "fallback",
        impacts: {
            regionTransfers: [],
            regionControlOps: [],
            regionClaims: [],
            polityChanges: [],
            unitOps: [],
            markerOps: [],
            projectOps: [],
        },
    });
    assert.equal(summary.total, 0);
    assert.deepEqual(summary.rows, []);
});
