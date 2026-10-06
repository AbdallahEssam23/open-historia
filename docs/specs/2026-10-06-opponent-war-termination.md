# The opponent war termination surface

Date: 2026-10-06
Status: approved for implementation

## Problem

The opponent decision gateway owns escalation and nothing else. The legal menu
is `{ declareWar, pressClaim }` (`deriveIntentMenu`,
`src/engine/strategicIntent.js:44`): a computer power may open a war and stripe a
claim, and it may never decide to stop. How a war between two computer powers
ends is not a choice at all. `resolveWarSettlements`
(`src/runtime/warSettlement.js:92`) settles every non-player war on the turn
`settleWar` first reports it due (`src/engine/warSettlement.js:155`), and a war
the player is a party to is held back as an offer (`peaceOffer.js`). The model is
asked what each power does this period and is never offered "stop".

The asymmetry is the whole problem: the line "the model chooses, the engine owns
the law" is enforced for war but not for peace. A power that is exhausted, with
no path to its declared aim, has no legal move that says so, and the engine's
automatic settlement is a fact that arrives without anyone having chosen it.

This increment gives the opponent that missing agency, inside the same
discipline: a new `seek_peace` intent whose legality the engine derives and whose
terms the engine computes, so a war can end because a power sued for peace and
not only because the arithmetic forced it.

## Goals

- A new legal option, `seek_peace`, for an active war the actor is a party to,
  governed by a single pure predicate `canSeekPeace`.
- Split the pure settlement core into terms and due-ness: `settlementTerms`
  always derives the peace, `settleWar` keeps the existing due gate. The
  automatic path is unchanged.
- The gateway re-derives the menu and refuses a `seek_peace` outside it, exactly
  as it does a declaration. It applies nothing itself.
- An accepted seek ends an **AI-vs-AI** war this turn on engine-derived terms,
  through the same event, ledger `end` record and reparations the automatic path
  already uses, so one war closes once and by one mechanism.
- The player is told, on the timeline, through the surface from
  `docs/specs/2026-10-06-opponent-strategic-moves-surface.md`.
- Byte-for-byte inert without a `seek_peace` intent: the settlements, the events,
  the ledger records and the applied world are exactly what they were.
- Decision locked: with no battle this turn `advantage` is 0, so a `reparations`
  aim scores 0 for both sides and `pickVictor` (`src/engine/warSettlement.js:140`)
  falls back to the lower weariness, then to side A. This is accepted as-is; the
  increment adds no new weighting rule.

## Non-goals

- **A new model request.** The decision rides the turn's existing jump answer,
  like every other `strategicIntents` line.
- **The player's own wars (Slice 33b).** A war the player is a party to is the
  player's decision, offered through `peaceOffer.js`. In this increment the menu
  does not offer `seek_peace` on such a war and the application does not touch
  one.
- **The model writing peace.** The model never writes the event, the transfers
  or the reparations; it names the war it wants out of, and the engine derives
  the rest. The `warUpdates`-with-`end` path the model already has for the
  player's wars is untouched.
- **Ceasefire as a strategic choice.** The ledger's `ceasefire`/`resume` pair
  exists; offering it as an opponent option is a separate increment.
- **A peace ledger or a second war panel.** The Stats "Current conflicts" card
  already lists the resulting state; this increment adds the moment and its
  cause.

## Essence: one new intent

`seek_peace` is a third `op` beside `declare_war` and `press_claim`. It is
additive by construction: an answer that carries none leaves `warUpdates`, the
claims, the settlements and the applied world exactly as they were, which is the
same inert-path argument the gateway already rests on
(`src/Game/AI/strategicGateway.js:138`).

Its record is `op~polity~target~goal~regions~note`, with `target` holding the
**war id** the menu printed for that war (`seek_peace~Ruritania~war-ruritania-syldavia~~~`).
The war id, not the opponent's name, is the key: it is the engine's own stable
id and it cannot be ambiguous when two powers are in more than one war.

Two fates, decided by whether the player is in the war:

- **AI vs AI:** the war ends this turn, on terms the engine derives, through the
  automatic settlement path.
- **Player vs AI:** not part of this increment. The menu does not offer it, so
  the gateway never accepts it, so nothing is silently swallowed.

## The pure law

Two additions in `src/engine/warSettlement.js`, both import-free.

**Terms versus due-ness.** The current `settleWar` body computes the scores, the
pressure and the victor, and returns `null` from one branch
(`src/engine/warSettlement.js:215`) when nothing forces a peace. Split it so the
derivation can be asked for on purpose:

- `settlementTerms(input)` is the whole body, and always returns the terms: the
  `key`, `victor`, `loser`, `capitulation`, `white`, `punitive`, `transfers` and
  `reparations`. When nothing forces a peace it still derives them from the goal
  scores and the weariness, using `pickVictor` on the same facts.
- `settleWar(input)` keeps the gate exactly as it is: `null` while no peace is
  due, otherwise the very object `settlementTerms` returns.

One body, one `pickVictor`, one set of terms; the refactor is behaviour
preserving for every currently-due war and is pinned by a parity test.

**The seek predicate.**

```js
export const PEACE_REQUEST_WEARINESS = 0.5;

// A power may sue for peace when it is exhausted and is not ahead: a side that
// has achieved its aim, or is closer to it than its enemy, may not freeze a win
// by asking for terms. `ahead` is the caller's `warGoalScore` comparison.
export const canSeekPeace = ({ weariness = 0, ahead = false } = {}) =>
  clamp(weariness, 0, 1) >= PEACE_REQUEST_WEARINESS && ahead !== true;
```

`ahead` is computed from `warGoalScore` for both sides with `advantage` 0 (the
turn's battle has not happened when the menu is built), and only for a side whose
goal is not `status_quo`: a `status_quo` side wants nothing, so it is never
"ahead" and may seek peace whenever it is weary. This is the progress guard: an
annexing side holding more of its declared targets than its enemy is refused.

The `advantage = 0` choice is deliberate and locked. With no battle,
`warGoalScore({ kind: "reparations" })` is 0 for both sides, so `pickVictor`
falls to the lower weariness and then to side A. No rule is added; the existing
deterministic tie-break is what settles an even war.

## The menu

`src/engine/strategicIntent.js`:

- `deriveIntentMenu` accepts a new `wars` fact list and returns `seekPeace`
  beside `declareWar` and `pressClaim`. Each entry is
  `{ warId, opponent, weariness }`.
- For each war: skip it when the actor is not a side, skip it when the player is
  a party (`party === true`: the player's war is the player's decision), and skip
  it unless `canSeekPeace({ weariness, ahead })`. Bound the list with
  `MAX_PEACE_SEEKS = 6`, after the same dedupe discipline as the others.

`src/runtime/opponentContext.js`:

- `menuInputsFromNormalized(world, polity, regions, { playerPolity })` gains the
  war facts and the player. It returns `wars`, one entry per active war the actor
  is a side of: `{ warId, opponent, weariness, ahead, party }`.
- `strategicInputsFor(world, polity, { regions, playerPolity })` forwards the
  player; `buildStrategicMenus` already holds it.
- The facts are read by one shared reader exported from
  `src/runtime/warSettlement.js`, `seekPeaceFacts`, which reuses the same
  `heldRegions`/`canonicalKeys`/`canonical` logic the settlement loop already
  uses, so the goal-progress comparison has a single definition and cannot drift
  from the solver.

`playerPolity` is optional. When it is absent (the segment preflight,
`src/Game/AI/gameplay.js:889`, has no player in scope) every `party` reads false.
That is harmless: the preflight only rewrites `warUpdates` from accepted
declarations, and a `seek_peace` produces none. The authoritative pass that
produces `accepted` and the applied world (`src/Game/AI/gameplay.js:6943`) is
given `baseGame.country`, so it sees the same menu the prompt showed.

## The gateway

`src/Game/AI/strategicGateway.js`, in `applyStrategicIntents`:

- Accept `playerPolity` and forward it to `strategicInputsFor`, so the
  re-derived menu is the menu the model was shown.
- Handle `intent.op === "seek_peace"`: require an actor and a `target` war id;
  find the matching `menu.seekPeace` entry; refuse with a stated reason when the
  actor is not a part of that war, when it may not seek (not weary enough, or
  ahead), or when the war is the player's; otherwise push
  `{ actor: menu.polity, target: entry.opponent, warId: entry.warId }` onto
  `accepted.seekPeace`.
- Apply nothing. No `warUpdates`, no `claimOps`. The terms need this turn's
  battle arithmetic, which only the settlement phase has.
- Add `seekPeace: []` to both the inert early return and the normal return.

An unknown `op` keeps its existing rejection. A `seek_peace` with no war id is
rejected as "no war named", a war outside the menu as "not a war it may seek
peace in this turn".

## Application

`src/runtime/warSettlement.js`:

- `resolveWarSettlements` returns `peaceTermsByWarId` beside its current output:
  for every active war that is **not** the player's and was **not** already due,
  `{ settlement, belligerents }`, where `settlement` is `settlementTerms` on the
  exact inputs the loop already gathered (goals, held regions, this turn's
  `advantage`, the stepped weariness, the pools, the unjust marks). One gather,
  so a sought peace obeys the same numbers as an automatic one.
- `settlements`, `offers`, `weariness` and `unresolved` keep their meaning
  byte-for-byte.

`src/Game/AI/gameplay.js`, immediately after the gateway has run and
`warUpdates` has been rebuilt in place (`:6956-6958`):

- Build a closed set of `dueSettlements` war ids plus `modelClosedWarIds`, the
  same set that already shields the automatic path from the model's own `end`.
- For each accepted `seekPeace`, skip it when the war is already in that set,
  look up `peaceTermsByWarId`, and skip when there is no entry (already due, or
  the player's war).
- Otherwise record it exactly as the automatic loop does: push the settlement
  event (`buildSettlementEvent`), push the ledger `end` record with that event
  id, add it to `dueSettlements` so the existing `applyWarReparations` call
  (`:7375`) pays it, and note it on the receipt.

The settlement phase itself is not run again; the sought settlement is folded
into the list the phase already produced. A war the engine settled this turn, or
the model closed through `warUpdates`, is closed once.

## Narration

The row is `{ kind: "seek_peace", actor, target, warId, eventId, date }`, where
`eventId` is the settlement event the application just wrote, resolved through
the same `eventIdByWarId` map `buildTurnMoves` already builds
(`src/runtime/strategicNarration.js:44`). `describeStrategicMove` reads
`"<actor> seeks peace with <target>"` with no detail and no reason chips: a seek
has no recorded cause, and inventing one would be the very thing the menu exists
to prevent.

`src/runtime/gameState.js` gains `seek_peace` in `TURN_MOVE_KINDS` and a branch
in `normalizeTurnMove` requiring an actor and an opponent, keeping `warId`,
`eventId` and `date` when present. `src/Game/GameUI/time.jsx`
`StrategicMoveBanner` gains the third tone and label; its shape is unchanged.

## The directive

`buildStrategicDirective` (`src/Game/AI/gameplay.js:658`):

- List each `menu.seekPeace` entry with its war id and opponent, so the model has
  the exact key to put in the `target` field.
- Add `seek_peace` to the sentence that names the legal ops, and say that it
  takes the polity and the war id, that the engine derives the terms, and that it
  is not offered for a war the player is in.

## Delivery

**Slice 33a (this increment):** the pure law (`settlementTerms`, `canSeekPeace`),
the menu (`seekPeace` plus `seekPeaceFacts`), the gateway (`seek_peace`), the
AI-vs-AI settlement fold in `gameplay.js`, and the narration on the timeline.

**Slice 33b (next):** the player-vs-AI initiative: offer a seeking opponent's
peace to the player through `peaceOffer.js`, so the menu may offer `seek_peace`
on a war the player is in and the player decides.

## Tests

- `src/engine/warSettlement.test.js`: `settlementTerms` equals `settleWar` for
  every due case (the parity lock), returns terms for a not-due case where
  `settleWar` returns `null`, and `canSeekPeace` is false below the weariness
  floor and false when ahead, true when weary and not ahead.
- `src/engine/strategicIntent.test.js`: a weary, not-ahead, non-player war yields
  a `seekPeace` entry; a fresh war, an ahead war, a player war and a war the
  actor is not in yield none; the list is bounded.
- `src/Game/AI/strategicGateway.test.js`: an accepted seek appears in
  `accepted.seekPeace` with its war id and opponent and changes no `warUpdates`;
  a seek on a war outside the menu, a weak war and a player war are rejected with
  reasons; the inert path is unchanged with `seekPeace: []`.
- A wiring assertion beside the other architecture guards that `applySimulationResult`
  passes `playerPolity` to the gateway and folds `peaceTermsByWarId` into
  `dueSettlements`.
- `src/runtime/strategicNarration.test.js`: a seek row is built with the
  settlement event's id and narrated.
- `src/runtime/gameState.turnMoves.test.js`: a `seek_peace` row round-trips and a
  malformed one is dropped.
- **Zero-drift:** a turn with no `seek_peace` produces the same `settlements`,
  the same `peaceTermsByWarId` keys, the same events and the same ledger records
  as before the increment, asserted on a fixture and on the full suite.

Regression: `npm test` stays green (3182 today, 0 fail), `npx eslint` gains no
error, `npm run wiki:check` stays current, and `npm run build` succeeds.

## Docs

- `docs/ai-overview.md`: `seek_peace` in the opponent-menu section and the
  narration's handling of it.
- `docs/world-state.md`: no new world field; the increment writes only through
  the existing `simulationHistory` `strategicMoves` and the war ledger, so only
  the turn-writer paragraph changes if at all.
- `docs/specs/2026-10-06-opponent-strategic-moves-surface.md` stays the record of
  the surface this increment reuses.

## Considered options

- **Let the model write the peace `end` and its event, with the engine
  validating the terms.** Rejected. It gives the model authority over transfers
  and reparations the engine derives, and makes a model-written peace and an
  automatic one two different paths to the same state.
- **The gateway derives the terms.** Rejected: the gateway is the door, not the
  arithmetic, and it has no access to this turn's battle results. It would either
  duplicate the solver or misprice a `reparations` peace.
- **Resolve a seeked war by re-running `resolveWarSettlements`.** Rejected: the
  phase steps weariness and aggregates battles, so a second run would double both.
  The single gather, folded into `dueSettlements`, avoids it.
- **Let a single side end a war with the player by seeking peace.** Deferred to
  33b. A war the player is in is the player's decision, exactly as
  `peaceOffer.js` already holds it; ending it from one side alone would remove
  the player's agency, which is the opposite of this increment's point.
- **Gate the seek on weariness alone, with no progress guard.** Rejected: a side
  that has effectively won could then ask for terms and freeze its win before the
  automatic settlement reached it. The guard is the point of `canSeekPeace`.
- **Include `reparations` in the early seek and blend weariness into the score.**
  Rejected as a new rule: it would make a sought peace price differently from an
  automatic one. With `advantage = 0` the existing `pickVictor` tie-break settles
  it, and that is locked.
