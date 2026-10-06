# The player's peace initiative

Date: 2026-10-06
Status: approved for implementation

## Problem

Slice 33a gave a computer power the legal move to stop fighting, but only
between two computer powers. A war the player is a party to was deliberately
excluded: the menu did not offer `seek_peace` on it, and the settlement adapter
stored no terms for it, so an opponent facing the player could never ask for
peace. The opponent's only way to stop was the engine's automatic settlement,
which arrives when the arithmetic forces it. Against the player, the enemy has
no voice short of fighting to collapse.

Meanwhile the player's own decision already has a surface:
`runtime/peaceOffer.js` holds a due settlement as `world.peaceOffer` and the
player accepts it (`acceptPeaceOffer`) or declines (`declinePeaceOffer`), applied
through `Game/AI/peaceOffer.js` exactly where an AI settlement is. The missing
half is a *choice by the opponent* that produces that offer before the war is
forced.

## Goals

- Let a weary, not-ahead computer power sue for peace on a war the player is a
  party to. The choice is the model's, the legality is the engine's.
- Route that seek to the existing player offer path: the engine derives the same
  terms `settleWar` would, stores them as the turn's `world.peaceOffer`, and the
  player decides. The war is not ended by the seek.
- Keep the actor/party distinction exact: an AI on a war with the player may
  seek; the player's own menu never offers `seek_peace` at all (the player's
  decision is the offer, not an intent).
- Byte-for-byte inert without a `seek_peace` intent: the settlements, events,
  ledger records and applied world are exactly what they were.

## Non-goals

- **The AI-vs-AI path (Slice 33a).** Already built: an accepted seek on a war
  with no player settles immediately through the same event, ledger `end` and
  reparations. This increment does not change it.
- **A new request or a new surface.** The seek rides the existing
  `strategicIntents` line; the offer rides `world.peaceOffer` and the existing
  accept/decline actions.
- **The player seeking peace.** The player is not an intent actor; their war is
  decided through the offer. No new player action.
- **Changing the automatic due offer.** A player war whose terms the arithmetic
  already forces is offered exactly as before; a seek on such a war is redundant
  and is skipped, so one war has one offer.

## The law

`deriveIntentMenu` (`src/engine/strategicIntent.js`) gains one rule: the actor
may seek only when it is **not the player**. It already receives the actor's
`polity`; the adapter now also passes `playerPolity` in the menu inputs, and the
engine compares the two in the same canonical key space. When they match,
`seekPeace` is empty. Every other fact is unchanged: `canSeekPeace`
(`src/engine/warSettlement.js`) still gates on weariness `>= 0.5` and not ahead.

`seekPeaceFacts` (`src/runtime/warSettlement.js`) already reports `party`, the
player being a side. That fact now travels with the menu option and the accepted
intent, because it is what decides where a seek is applied.

## The menu

`deriveIntentMenu` stops skipping a war because `party` is true. It builds a
`seekPeace` entry for any active war the actor is on and `canSeekPeace` accepts,
carrying `party` so the application can route it:

```
{ warId, opponent, weariness, party }
```

`opponent` is the first belligerent of the other side, so for a war with the
player it is the player's polity. `MAX_PEACE_SEEKS` still bounds the list.

## The gateway

`applyStrategicIntents` (`src/Game/AI/strategicGateway.js`) already refuses any
seek outside the menu and records an accepted one. It now carries the option's
`party` onto `accepted.seekPeace`:

```
{ actor, target, warId, party }
```

It still applies nothing. A seek the player's own menu would have offered cannot
arrive: the re-derived menu has no such entry, so it is refused by the same
"not a war it may seek peace in this turn" path.

## The application

`resolveWarSettlements` (`src/runtime/warSettlement.js`) already derives terms
for a not-due AI-vs-AI war. It now derives them for a not-due **player** war too,
and marks the entry with the player's side and the war's pressure, the same two
fields a due offer carries:

```
{ settlement, belligerents, side, pressure }
```

In `gameplay.js`, the accepted-seek fold branches on `party`:

- **AI-vs-AI** (unchanged): write one settlement event, one `warUpdates`
  `{ op: "end" }`, and push the settlement into `dueSettlements` for reparations.
- **Player** (new): push an offer built from the entry into `duePeaceOffers`, so
  `choosePeaceOffer` and `keepHeldPeaceOffer` hold it as `world.peaceOffer`
  exactly like a due offer. No event, no ledger record, no reparations: the war
  stays open until the player accepts.

A war the model already closed this turn, or one whose peace the arithmetic
already forced, is skipped by the same `settlementClosedIds` guard, so one war
produces one outcome.

## The surface

Both branches are told on the timeline through the existing
`strategicMoves`/`StrategicMoveBanner` surface. A player-war seek has no event of
its own this turn (the settlement event is written only on acceptance), so its
row carries an empty `eventId` and reads as the turn's closing block: the
opponent asked, and the player's offer is the decision.

## The directive

`buildStrategicDirective` (`gameplay.js`) stops saying a seek is never offered
for a war the player is in. It now says a seek against the player is offered to
the player as a decision, that the engine derives the terms and the event, and
that the model writes no `warUpdates` and no peace event for it.

## Delivery

**Slice 33b (this increment):** the actor/party menu rule, the offer routing for
a sought player war, the narration, and the docs.

## Tests

- `src/engine/strategicIntent.test.js`: a weary, not-ahead player war is offered
  to a non-player actor with `party: true`; the player's own menu yields no
  `seekPeace` however weary; the list stays bounded.
- `src/Game/AI/strategicGateway.test.js`: a non-player seek on a player war is
  accepted with `party: true` and changes no `warUpdates`; the player naming
  their own war is refused.
- `src/runtime/warTermination.test.js`: a not-due player war now has an entry
  with the player's `side` and the war's `pressure`; a due war still has none; an
  intent-less turn keeps the same settlements and offers.
- A wiring assertion that `gameplay.js` routes a `party` seek into
  `duePeaceOffers` and not into `dueSettlements`.
- `src/runtime/strategicNarration.test.js` and
  `src/runtime/gameState.turnMoves.test.js`: unchanged, since the row shape is
  unchanged.
- **Zero-drift:** a turn with no `seek_peace` produces the same `settlements`,
  the same `offers`, the same events and the same ledger records as before,
  asserted on a fixture and on the full suite.

Regression: `npm test` stays green (3207 today, 0 fail), `npx eslint` gains no
error, `npm run wiki:check` stays current, and `npm run build` succeeds.

## Docs

- `docs/ai-overview.md`: the opponent-menu section states the actor/party rule
  and that a seek against the player becomes an offer.
- `docs/world-state.md`: no new world field; the offer already lives on
  `peaceOffer`.
- `docs/specs/2026-10-06-opponent-war-termination.md` stays the record of 33a.

## Considered options

- **Let an AI seek end a player war directly.** Rejected: it removes the
  player's agency, the opposite of the point, and duplicates the settlement
  application the offer path already owns.
- **Build the seek terms in the gateway or at apply time.** Rejected: the terms
  need this turn's battle balance and the stepped weariness, which only the
  settlement phase has. The gateway keeps applying nothing.
- **Re-run `resolveWarSettlements` for a seek.** Rejected, as in 33a: the phase
  steps weariness and aggregates battles, so a second run would double both.
- **Offer the seek in the player's own menu.** Rejected: the menu is for
  computer powers; the player's decision is the offer, and a player-authored seek
  would make the player offer peace to themselves.
- **A new `peaceOffer` source field.** Rejected as unnecessary: the offer the
  player accepts is the same shape whether the engine forced it or an opponent
  sought it, and the accept/decline actions need no distinction.
