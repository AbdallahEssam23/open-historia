/*! Open Historia — what an event changed, counted for its timeline card © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/GameUI/eventImpacts.test.js
//
// The timeline card has to answer one question at a glance: did this turn move
// the world, or only narrate it? The engine's changes ride on an event's
// `impacts` (runtime/gameState.js, normalizeEventImpacts), and the only way to
// show a fallback turn honestly is to count them — a fallback payload is text
// with every impacts array empty (gameplay.js fallbackJumpSimulation), so
// "no counters" is what a fallback turn actually did, not a rendering bug.
//
// Counted by the words a player reads, not by the engine's array names:
//
//   regions     a territory changed. A legal transfer (regionTransfers), a
//               de-facto control flip (regionControlOps) and a raised claim
//               (regionClaims) all move the same map, so they count together;
//               counting only transfers would call a wartime capture "no map
//               impact".
//   polities    a country was created, renamed, restyled or dissolved.
//   forces      a formation was raised, moved, resized or removed.
//   structures  a marker was built, updated, renamed or removed.
//   projects    a board entry was opened, moved or closed (the board, not the
//               map — the label says so on the card).
//
// Kept free of React and the runtime so the card and its tests share one rule
// (the same trade eventFocus.js makes).

// One row per kind of change, in the order the card reads them out. The glyphs
// are the map's own family (LINK_GLYPHS in time.jsx), so a chip here and a link
// chip there look like they belong to the same world.
const IMPACT_FAMILIES = Object.freeze([
    { key: "regions", glyph: "⌖", singular: "region", plural: "regions", impacts: ["regionTransfers", "regionControlOps", "regionClaims"] },
    { key: "polities", glyph: "⚑", singular: "polity", plural: "polities", impacts: ["polityChanges"] },
    { key: "forces", glyph: "⛊", singular: "formation", plural: "formations", impacts: ["unitOps"] },
    { key: "structures", glyph: "▣", singular: "structure", plural: "structures", impacts: ["markerOps"] },
    { key: "projects", glyph: "▤", singular: "project", plural: "projects", impacts: ["projectOps"] },
]);

// { rows: [{key, glyph, count, label, text}], total }
// `rows` holds only the kinds this event actually touched, so an event that
// moved nothing comes back as `{ rows: [], total: 0 }` — the card's cue to say
// so. A malformed impacts value (a scenario event, a half-written payload) is
// read as nothing rather than throwing mid-render.
export const summarizeEventImpacts = (event) => {
    const impacts = event?.impacts ?? {};
    const rows = [];
    for (const family of IMPACT_FAMILIES) {
        const count = family.impacts.reduce((total, key) => {
            const list = impacts[key];
            return total + (Array.isArray(list) ? list.length : 0);
        }, 0);
        if (count <= 0) continue;
        const label = count === 1 ? family.singular : family.plural;
        rows.push({ key: family.key, glyph: family.glyph, count, label, text: `${count} ${label}` });
    }
    return { rows, total: rows.reduce((total, row) => total + row.count, 0) };
};
