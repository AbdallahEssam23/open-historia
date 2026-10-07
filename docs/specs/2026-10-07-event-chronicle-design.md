# Event Chronicle: a Read-Only History of What Actually Changed

> Status: approved for implementation. Wave 1, item 4 of
> `docs/specs/2026-10-07-grand-strategy-roadmap-design.md`. The scope there is
> decided: history is read-only, there is no interactive replay, and any missing
> view is "a static reading of those diffs". This spec builds that missing view.

## Problem

The game records every turn's changes but the player can only ever see the
newest one. The Events panel builds a record for the whole campaign
(`historyRecords` in `time.jsx`) and renders `historyRecords[0]`; the other turns
are built and thrown away. The Stats panel's "Campaign history" charts
`countryStatsHistory` (population, GDP, index samples over time), which is a
different record: it says where the economy ended up, never what a turn did.

So "what happened in this campaign, turn by turn" has no answer in the UI. The
data to answer it is already stored and already normalized:

- `world.simulationHistory` is the turn ledger, newest first;
- each entry carries `fromDate`/`toDate`, `round`, `mode`, `source`,
  `plannedActions`, `strategicMoves`, `tradeClimate`, `eventIds`, and a
  `receipt` whose `applied` counts are exactly what the engine did
  (`src/runtime/applicationReceipt.js`).

No new state, no re-simulation, no CRDT: a static read of the ledger.

## Goal

One read-only "Chronicle" view: a header rollup of the campaign and one compact
row per recorded turn, newest first, showing the period, the outcome, and the
count of changes by kind. Pure aggregation, tested headless; the UI only formats.

## Non-goals

- No interactive replay, no scrubber, no map rollback. Decided in the roadmap.
- No new persisted state and no writes. The view reads `world.simulationHistory`
  and nothing else.
- No loading of the separate events store. The receipt's `applied` counts are
  already on every turn entry after normalization, so the chronicle names impact
  families per turn without a second fetch.
- No per-region narrative detail. The Events panel keeps the detailed cards for
  the current turn.

## Architecture

### Pure core: `src/engine/eventChronicle.js`

Import-free (like `applicationReceipt.js`), so `enginePurity.test.js` covers it
with no change. It owns the canonical player-facing grouping of impact keys and
the two read functions.

```
PLAYER_IMPACT_FAMILIES = [
  { key: "regions",    impacts: ["regionTransfers", "regionControlOps", "regionClaims"] },
  { key: "polities",   impacts: ["polityChanges"] },
  { key: "forces",     impacts: ["unitOps"] },
  { key: "structures", impacts: ["markerOps"] },
  { key: "projects",   impacts: ["projectOps"] },
]

receiptFamilyCounts(receipt) -> { regions, polities, forces, structures, projects, events, total }
chronicleTurnRows(history, { limit }) -> [row]
chronicleStats(history) -> { turns, jumps, fallbackTurns, events, regions, polities,
                             forces, structures, projects, totalChanges, firstDate, lastDate }
```

`PLAYER_IMPACT_FAMILIES` is the one definition of the grouping; the Events panel's
`eventImpacts.js` imports it and keeps only the glyphs and labels, so a card and a
chronicle row can never disagree about what "regions" means.

Every count is read from `receipt.applied` through a non-negative integer guard,
so a turn with no receipt, a malformed one, or a non-array value contributes zero
rather than throwing. A row's `eventCount` is the applied event count, falling
back to `eventIds.length` when the older entry predates receipts.

`chronicleTurnRows` is bounded by `limit` (default 240) taken from the head of
the newest-first ledger, so the render is O(limit) and deterministic. Dates are
the stored strings; formatting belongs to the caller.

### UI: a Chronicle sub-tab in `stats.jsx`

The Stats panel already hosts the campaign's other read-only history ("Campaign
history"), so the chronicle joins it as a fourth sub-tab rather than opening a
new surface:

- a header card from `chronicleStats` (rounds recorded, fallback turns, events,
  total changes, date span);
- a list from `chronicleTurnRows`, each row showing the period
  (`formatGameDateReadable`), the round and source, the turn's title (first line
  of `summary`, else a round label), a fallback badge where the turn fell back,
  and the change chips from the family counts;
- an empty state when no turn has been recorded yet.

The view is a leaf: it reads `worldSnapshot.simulationHistory` and writes nothing.

## Data flow

```
world.simulationHistory ----\
  entry.receipt.applied ----+--> engine/eventChronicle.js --> ChronicleSection (stats.jsx)
  entry.summary/dates ------/
```

## Edge cases

- No turns recorded: header zeros and the empty state; no error.
- A turn with no receipt (a pre-receipt save): its family counts are zero and its
  event count falls back to `eventIds.length`; the row still appears.
- A malformed entry (null, a string): skipped.
- A non-array `applied` value: counted as zero.
- A very long campaign: the row list is capped at `limit`; the rollup is exact.

## Testing

- `src/engine/eventChronicle.test.js` (new): family counts sum the right keys;
  a missing/malformed receipt is zero; rows are newest-first and bounded;
  `eventCount` falls back to `eventIds`; `chronicleStats` totals across turns and
  reports the span; an empty history is all zeros; the result is deep-equal across
  two calls. `enginePurity.test.js` covers the new engine file automatically.
- `src/Game/GameUI/eventImpacts.test.js` (existing) stays green after the mapping
  is lifted into the engine, proving the refactor changed no behaviour.
- No component-render test is added (the repo has none for these panels). No
  existing test is rewritten to accommodate the change.

## Files

- New: `src/engine/eventChronicle.js`, `src/engine/eventChronicle.test.js`.
- Edit: `src/Game/GameUI/eventImpacts.js` (import the shared family mapping),
  `src/Game/GameUI/stats.jsx` (the Chronicle sub-tab).

## Open questions

1. Should a past turn open its full event cards? Deferred: the Events panel owns
   the detailed cards, and this view is deliberately a digest. A later increment
   can hand a row to that panel.
2. Should the chronicle filter by family or source? Not now; the header rollup
   plus the chips answer the common question and the row cap bounds the render.

## TODO

- [ ] Implement `eventChronicle.js` + tests (TDD).
- [ ] Lift `PLAYER_IMPACT_FAMILIES` into the engine and re-point `eventImpacts.js`.
- [ ] Add the Chronicle sub-tab to `stats.jsx`.
- [ ] Run `npm test`, `npm run build` and `enginePurity.test.js`.
