# The opponent strategic moves surface

Date: 2026-10-06
Status: approved for implementation

## Problem

The opponent decision gateway exists and works. The model chooses inside a
legal menu, `applyStrategicIntents` re-derives the menu and refuses anything
outside it, and an accepted `declare_war` becomes a ledger `start` record while
an accepted `press_claim` becomes a claim op
(`src/Game/AI/strategicGateway.js`, see
`docs/specs/2026-10-06-llm-decision-gateway-design.md`).

What the player gets from all of it is silence. The accepted and refused
outcomes go to `logDebugEvent` alone (`src/Game/AI/gameplay.js:6949-6954`).
A declaration then reaches the player only as the model's own event card, and a
pressed claim reaches them not at all: it is applied as a **board-only**
synthetic event (`STRATEGIC_CLAIMS_EVENT_ID`, `src/Game/AI/gameplay.js:7008-7023`)
that is never written to `events.json`, so it leaves no timeline record and no
trace of its cause in `world.regionClaimants`.

Two things follow. First, the player cannot see that a computer power made a
decision about them; the world simply changes. Second, the **reason** the
decision was legal - a standing claim, a recorded breach, the goal - never
surfaces at all, because `world.wars` does not store it and `regionClaimants`
is a bare name list. That reason is the whole point of the gateway: the model
chooses from a menu that states its legality, and the player is never told.

This increment gives the player a surface for the opponent's move: a short,
deterministic, engine-authored line that names the actor, the act and its
recorded cause, revealed inside the timeline as the turn's events reveal.

## Goals

- Persist the turn's accepted strategic decisions on its `simulationHistory`
  entry as `strategicMoves`, engine-authored, so the reason survives a reload.
- Narrate each move from a **pure** module: the same move and the same world
  give the same sentence in any process.
- Show a declaration inside the card of the event that narrates it, so it is
  revealed with that event and no new reveal counter is introduced. Show a
  claim (which has no event) as a closing block once the turn's events are all
  revealed.
- Byte-for-byte inert when no intent was returned: an existing turn's
  `simulationHistory` entry, and the whole 3166-green suite, are unchanged.

## Non-goals

- **A new model call.** The decision is already made in the turn request. The
  surface only renders it.
- **Surfacing refused intents.** A refused intent was never applied; it stays
  in `logDebugEvent`. Recording a refusal on the player's timeline would say
  the world changed when it did not.
- **Writing `applicationReceipt` notes.** The receipt is model-facing ("what
  the engine did with your answer", read by the next jump); it is not a player
  journal and this increment does not turn it into one.
- **A standalone war or claim ledger panel.** The Stats "Current conflicts"
  card and the map's disputed-region stripes already list the resulting state.
  This increment adds the *moment and its cause*, not a second list.
- **A camera flight per move.** A declaration's card already flies the camera
  through `deriveEventLinks`; a claim's region bounds are a later concern.
- **Changing what the engine applies.** Wars, claims and the ledgers are
  untouched. The stored record is additive.

## Design

### 1. Layers

| Layer | Location | Rule |
| --- | --- | --- |
| Pure narration | `src/runtime/strategicNarration.js` (new) | Builds the move records and phrases them. No browser import, no clock, no entropy, no `Game/AI` import. |
| Producer | `src/Game/AI/gameplay.js` | Composes `strategicMoves` from `strategicOutcome.accepted` and writes it on the turn's `simulationHistory` entry. |
| Persistence | `src/runtime/gameState.js` | `normalizeTurnMoves` sanitizes the field inside the `simulationHistory` map; the field is emitted only when it has valid rows. |
| Surface | `src/Game/GameUI/time.jsx` | `StrategicMoveBanner` on an event card, and a closing block for claims. |

### 2. The stored shape

`simulationHistory[i].strategicMoves` is optional and a sibling of `receipt`.
Each row:

| Field | Type | Present | Meaning |
| --- | --- | --- | --- |
| `kind` | `"declare_war"` \| `"press_claim"` | always | the act |
| `actor` | string | always | the power that decided |
| `target` | string | `declare_war` | the power it declares on |
| `goal` | string | `declare_war` | `annex` \| `reparations` \| `status_quo` |
| `justified` | boolean | `declare_war` | whether a recorded cause exists |
| `reasons` | string[] | `declare_war` | the cause tokens (`standing claim`, `recorded breach`) |
| `regionId` | string | `press_claim` | the region claimed |
| `owner` | string | `press_claim` | the region's present owner |
| `eventId` | string | when an event narrates it | the model's event, for the interleaved reveal |
| `date` | string | always | the game date of the turn |

An `existing` declaration - one the model already opened through the direct
`warUpdates` channel - is **not** recorded, because the gateway resolved it as
"this intent is the duplicate" and the direct record stands. The surface
narrates only what the gateway accepted as a fresh decision.

### 3. The narration module

`src/runtime/strategicNarration.js`, import-free, mirroring the engine cores:

`buildTurnMoves({ accepted, events, date })`:

1. Index the events by `warId`, so an accepted declaration resolves to the id of
   the event the model stamped (the gateway stamps `event.warId` at apply time).
2. Emit one row per non-`existing` `accepted.declareWar`, carrying its goal,
   `justified`, reasons and resolved `eventId`.
3. Emit one row per `accepted.pressClaim`, with `eventId: ""` (a claim has no
   event) and its region and owner.
4. Bounded to `MAX_TURN_MOVES`; a row missing its actor or its target/region is
   dropped, never thrown.

`describeStrategicMove(move, { regionName })` returns `{ headline, detail, reasons }`
or `null` for an unknown kind:

- `declare_war`: headline `"<actor> declares war on <target>"`; detail from a
  closed `GOAL_PHRASES` table (`annex`, `reparations`, `status_quo`); reasons are
  the recorded cause chips, or a single "no recorded cause" chip when unjust.
- `press_claim`: headline `"<actor> presses a claim on <region>"`, the region
  named by the caller's resolved `regionName` (falling back to `regionId`), and
  a `"held by <owner>"` detail when the owner is known.

`regionName` is a parameter, not a lookup, so the module stays pure: the
component resolves it from the region catalog it already holds.

### 4. Producing the field

In `gameplay.js`, after `applyStrategicIntents` has returned and the war-update
list is rebuilt (`:6942-6957`), compose the rows once:

```
const turnMoves = buildTurnMoves({
  accepted: strategicOutcome.accepted,
  events: freshEvents,
  date: nextGame.gameDate || "",
});
```

and spread it onto the `simulationHistory` head only when non-empty, beside
`receipt` (`:6993`). The rows are built before the impacts are applied, so the
`warId` the gateway stamped on `freshEvents` is still in hand.

### 5. Normalization and equivalence

`normalizeTurnMoves(value)` in `gameState.js`:

- accepts only an array; each row must carry a known `kind` and a non-empty
  `actor`, plus `target` (war) or `regionId` (claim), or it is dropped;
- trims strings, keeps `justified` as a boolean, keeps at most three bounded
  reason tokens and at most `MAX_TURN_MOVES` rows;
- returns `[]` for anything unusable.

It is called in the `simulationHistory` map beside `normalizeApplicationReceipt`
(`src/runtime/gameState.js:3796`). The entry spreads the field **only when the
normalized list is non-empty**, exactly as it spreads `receipt`:

```
...(turnMoves.length ? { strategicMoves: turnMoves } : {}),
```

so a turn with no strategic move - every turn before this increment, and every
turn the model returns no intent - is byte-for-byte what it is today. No
`WORLD_DEFAULTS` entry, no migration, no new world field.

### 6. The surface

`buildTurnRecord` (`src/Game/GameUI/time.jsx:506`) carries
`strategicMoves` from the entry onto the display record.

`TimelineHistoryPanel` (`:1742`) builds a `Map(eventId -> move)` and a
`closingMoves` list (rows with no `eventId`). It passes `move` to each
`EventCard`, which renders `StrategicMoveBanner` above the title when present.
Because the card is only rendered once revealed, the declaration appears with
its own event - the interleaved reveal, with no change to the reveal counter.

After the event loop, when `!hasMoreEvents` (the turn is fully revealed) and
`closingMoves` is non-empty, the panel renders one `StrategicMoveBanner` per
closing move. This is the only faithful place for a claim: it has no event to
precede, so it lands as the turn's epilogue rather than mid-sequence.

`StrategicMoveBanner` is a local component in `time.jsx`, in the style of
`MetricPill`/`InteractiveOfferStrip`. It resolves the region name through the
`regionLookup` already in `lookups`, calls `describeStrategicMove`, and renders
the headline, the goal/owner detail and the reason chips (`TagPill`).

## Tests

`src/runtime/strategicNarration.test.js` (new):

1. `buildTurnMoves` maps an accepted declaration to a row whose `eventId` is the
   id of the event stamped with that `warId`, and drops `existing` entries.
2. A claim becomes a row with `eventId: ""` and its owner.
3. It is bounded and drops a row missing its actor or its target/region, and it
   never throws on `null`/garbage input.
4. `describeStrategicMove` is deterministic across two calls; a war names goal
   and cause; an unjust war says so; a claim names the region through
   `regionName` and falls back to the id; an unknown kind returns `null`.

The `simulationHistory` normalization is asserted in a new test beside the
existing partial-normalize tests: a turn entry without `strategicMoves`
normalizes to an entry with **no** such key (the equivalence lock), and one with
a valid row round-trips.

The existing gateway tests (`strategicGateway.test.js`) stay green unchanged:
this increment reads the gateway's output and writes a record; it does not
alter the gateway.

Regression: `npm test` stays green (3166 today, 0 fail), `npx eslint` gains no
error, `npm run wiki:check` stays current, and `npm run build` succeeds.

## Docs

- `docs/world-state.md`: `strategicMoves` on the turn entry, and the turn
  writer's composition of it.
- `docs/ai-overview.md`: the player-facing surface and where it appears.

## Considered options

- **Derive the surface from `world.wars` and `regionClaimants` at read time.**
  Rejected. Neither carries the cause: a war has no `justified`/`reasons` and a
  claimant list has no provenance, so the derivation would narrate the act and
  lose exactly the legal reason the gateway exists to state.
- **Reuse `applicationReceipt` for the player.** Rejected. The receipt is
  model-facing and read once by the next jump; only the newest keeps its notes.
  Overloading it would couple the player's view to the prompt's lifecycle.
- **A persisted `world.strategicMoves` log.** Rejected for this increment. A
  world-level list needs a bound, a retention rule and a rollback story; the
  turn entry already has all three (history is capped at 12 and restored by a
  rollback).
- **A standalone moves panel.** Deferred, not rejected. The timeline is where
  the player already reads a turn; a separate panel is a second place to check
  and is not needed to close the loop.
- **A transient toast.** Rejected. A toast is gone on reload and cannot be
  re-read beside the event it explains.

## Risks

- **The line reads as advice or as an invitation to respond.** Mitigated by
  phrasing every move as past-tense narration, never as an option.
- **The card grows.** Mitigated by one bounded line and at most a few reason
  chips per card.
- **A stale `eventId` after an event is removed.** Mitigated by the panel
  looking the move up by the events actually present; a move whose event is
  gone simply shows as a closing block.
- **The field drifts from the applied world.** It cannot: it is written in the
  same turn, from the same gateway return that is applied below it.

## Decisions taken

1. The record lives on the turn's `simulationHistory` entry, not on the world.
2. Only fresh accepted decisions are recorded; `existing` declarations are not.
3. A declaration is revealed with its event; a claim is a closing block.
4. The narration is a pure runtime module with no browser or `Game/AI` import.
5. An empty field is omitted, so the change is byte-for-byte inert at rest.

## Open questions

None block implementation. The following are recorded so the plan does not
silently decide them:

- Whether a claim should also fly the camera to its region is deferred; it
  needs a region-bounds source the claim row does not currently carry.
- Whether older turns' moves should be reachable from a dedicated log is
  deferred with the standalone panel, above.
