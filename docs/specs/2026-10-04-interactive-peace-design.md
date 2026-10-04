<!-- Open Historia - the player's own peace, offered and decided (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# Interactive Peace: The Player Decides Their Own Settlement

The fifteenth increment of the deterministic simulation, and the branch that
closes the mechanical diplomacy layer for the player. The seventh increment gave
the settlement core its arithmetic. The thirteenth judged the moment a war
begins. The fourteenth made an unjust war cost more at the peace. All of them
settle the wars the model runs, and all of them deliberately leave the player's
own wars open. This increment hands the player the decision the engine has been
making on behalf of every other power.

## Why this increment exists

1. **The player's wars are withheld, not settled, and the withholding has a
   cost.** `src/runtime/warSettlement.js` skips any war a side the player leads
   is a party to, before any term is derived, and records the reason
   `the player is a party to <warId>`. The player never gets to end a war the
   way every other power does; the war simply stays open until the model writes
   a peace through the war ledger by hand.

2. **The withholding also skips the weariness step.** The skip happens before
   the adapter steps weariness, so a player's wars never accumulate the
   exhaustion the whole settlement model is built on. There is no concept of a
   settlement being *due* for the player today: the very signal that would
   trigger an offer is never computed. This increment has to step those wars
   before it can offer anything.

3. **Everything the offer needs already exists.** The war carries its declared
   goals, its weariness and its unjust-aggressor record. `settleWar` already
   derives the victor and the terms from exactly those facts, punishing an
   unjust side and reading raw score for the achieved gate. An offer is the same
   settlement the engine would have applied, held back for one decision instead
   of written.

4. **The interaction pattern is already in the house.** The interactive-event
   engine (`src/runtime/interactiveOffer.js` and `GameUI/interactive.jsx`)
   already shows the shape: the turn offers, the player decides, the offer is
   re-derived each turn and never forces anything. This increment borrows the
   shape, not the machinery: a peace decision is deterministic and costs no AI
   request, so it gets its own small surface rather than riding the narrated
   scene panel.

5. **Every prior specification named this increment.** The settlement
   specification recorded the player offer/accept/refuse surface as "a later,
   smaller increment"; the casus, breach and settlement-reaction specifications
   each deferred "the interactive path" and closed with the player's wars as the
   remaining case. This increment is the one they pointed at.

## Scope

This increment is one decision per turn: a war the player is a party to whose
settlement has become due is offered to the player, who accepts or declines it.

1. `resolveWarSettlements` steps the weariness of every active war, including
   the player's, and classifies a due player war as an `offer` instead of a
   settlement. A party war whose settlement is not yet due stays in `unresolved`
   with the reason it already carries.
2. A new, import-free runtime helper `src/runtime/peaceOffer.js` chooses the
   single most pressing offer and normalizes the stored offer defensively,
   mirroring `interactiveOffer.js`.
3. The chosen offer is stored on `world.peaceOffer` (a defaulted, optional
   field, with a defensive normalizer, exactly like `world.interactiveOffer`).
   It is re-derived every turn; declining clears it and the next turn may offer
   again.
4. A deterministic accept and decline, with no AI request. Accepting writes the
   settlement event, applies its region transfers and reparations through the
   doors the AI settlement already uses, ends the war in the ledger, and clears
   the offer. Declining only clears the offer and leaves the war open.
5. A dedicated panel `src/Game/GameUI/peaceOffer.jsx` showing the terms and the
   two actions. It does not reuse the scene panel, so a deterministic decision
   never pays for narration.
6. One section in `docs/runtime-services.md`, and a row in its module map.

## Non-goals

- **The player proposing or bargaining.** The player accepts or declines the
  terms the engine derived; there is no player-authored offer, no counter-offer
  and no multi-round negotiation. The offer is a take-it-or-leave-it read of the
  facts, exactly as it is for every other power.
- **Forcing a capitulation onto the player.** An AI side capitulates when its
  weariness reaches the capitulation threshold; the player always retains the
  choice. A declined offer leaves the war open even at that threshold. This is a
  deliberate asymmetry in favour of player agency, recorded here so it is not
  mistaken for an oversight.
- **A penalty for declining.** Declining costs nothing beyond the war staying
  open and its weariness continuing to rise, which is its own consequence next
  turn. No reputation event, no relation event, no extra weariness.
- **New core arithmetic.** `src/engine/warSettlement.js` is unchanged. The offer
  is `settleWar`'s own result; the core remains the single source of the terms.
- **Player puppets, regime change and disarmament.** A peace still moves only
  territory, reparations or nothing, as the seventh increment fixed it.
- **A stored negotiation state or a migration.** `peaceOffer` is optional and
  re-derived; a save without it is a save with no offer. No `ENGINE_VERSION`
  bump and no migration are introduced.
- **A model-facing directive for the offer.** Telling the model a peace is
  pending so it does not narrate a settlement that did not happen is deferred,
  as the standing obligations and the breach digest deferred the same question;
  the war ledger already shows the war active.

## Design

### 1. Layers

The same three layers and the same direction of dependency the earlier
increments established.

| Layer | Location | Rule in this increment |
|---|---|---|
| Pure core | `src/engine/warSettlement.js` | Unchanged. `settleWar` owns the terms; the offer is its result. |
| Runtime adapter | `src/runtime/warSettlement.js`, `src/runtime/peaceOffer.js` (new) | Steps weariness for all wars and splits due player wars into offers; chooses and normalizes the stored offer. No browser import; imports no `src/Game/AI/` module. |
| Model-facing | `src/Game/AI/gameplay.js` | Chooses the offer where the turn's events are final; exposes deterministic accept and decline. |
| UI | `src/Game/GameUI/peaceOffer.jsx` (new) | The terms and the two actions; no AI request. |
| Docs | `docs/runtime-services.md` | A module-map row and one section. |

`src/runtime/peaceOffer.js` imports nothing, the same posture as the parts of
`interactiveOffer.js` that carry no draw, so it runs under `node --test` with no
browser and no AI.

### 2. Stepping weariness for the player's wars

Today the party check runs before the weariness step, so a player's wars are
stepped never and stored never. The step must move above the check, and the
check becomes a classification rather than a skip.

For every active war that started before the turn date:

1. Compute the battle advantage and step both sides' weariness exactly as the
   adapter already does, and write the pair into the returned `weariness` map.
   This now includes the player's wars.
2. Call `settleWar` with the same inputs as any other war, including the derived
   `unjustA` and `unjustB`.
3. If `settleWar` returns nothing the war is not due. A non-party war adds
   nothing, exactly as today. A party war pushes
   `{ warId, reason: "the player is a party to <warId>" }` into `unresolved`,
   the same line it carries today, so the player's open wars remain visible to
   the caller as before.
4. If `settleWar` returns a settlement and the player is a party, push it into
   `offers`, annotated with the player's side and the pressing value, instead of
   `settlements`.
5. Otherwise push it into `settlements`, unchanged.

The return shape becomes `{ settlements, offers, weariness, unresolved }`. This
is a purely additive change for every existing caller of `settlements`,
`weariness` and `unresolved`; only the party-war case changes, and it changes
from "no weariness, unresolved" to "weariness, and an offer when due".

The weariness persisted for a party war is the plain stepped value; it is not
consumed by a settlement until the player accepts, and it steps again from
`throughDate` on the next turn like any other.

### 3. The pressing value and the player's side

An offer must be ranked, and the ranking must be a function of stored facts so
the same turn always ranks the same way. Two derived fields are added to the
offer object only:

- `side`: `"a"`, `"b"` or `""`. It is the side whose belligerents include the
  player, folded through the same canonical key space as every other name.
- `pressure`: the highest of the two stepped weariness values, a number in
  `0..1`. It is the settlement pressure the war has reached; the closer a side is
  to capitulating, the more pressing its peace.

Neither field reaches `settleWar`; they describe the offer, not the terms.

### 4. Choosing the one offer

`choosePeaceOffer({ offers, round })` returns one stored offer or `null`.

- Filter to entries with a non-empty `warId`.
- Sort by `pressure` descending, then `warId` ascending, so the choice is a
  total order and never depends on array order.
- Return the first, shaped as the stored object (section 5), or `null` when
  there are none.

The round is stamped onto the stored offer for display and for the turn record,
not for any cooldown: a due peace is offered every turn until it is decided,
because it is a fact of the world, not a random gift.

### 5. The stored offer and its normalizer

`world.peaceOffer` holds one object:

```
{
  warId, round, side, pressure,
  victor, loser, capitulation, white, punitive,
  transfers, reparations, belligerents
}
```

The terms (`victor` through `belligerents`) are the settlement `settleWar` and
the adapter already produced, stored whole because re-deriving them at accept
time would need the turn's `advantage` and `engagements`, which are gone. The
offer is a fact read back, not a promise to recompute.

`normalizePeaceOffer(value)` returns `null` unless the value is an object with a
non-empty `warId`; it keeps the fields it recognizes, coerces `round` and
`pressure` to bounded numbers, defaults `transfers` to `[]` and `reparations`
to the zero shape, and drops everything else. A corrupt or partial value is
never an offer.

### 6. Turn wiring

In `applySimulationResult`, where the settlement is resolved
(`gameplay.js:6733`):

1. `resolveWarSettlements` now returns `offers` alongside `settlements`.
2. The `applyWarUpdates` call at `gameplay.js:6960` is already handed
   `settlementOutcome.weariness`; it now also persists the player's wars'
   weariness because section 2 put it in the map. No new argument.
3. Each `settlement` is applied exactly as before: event, `warUpdates {op:"end"}`,
   receipt. The `offers` array is not applied.
4. Near the interactive-offer block (`gameplay.js:7469`), and after the turn's
   events are final, set `world.peaceOffer = choosePeaceOffer({ offers, round })`.
   This runs on every turn mode, because a due peace does not wait for a skip.
   The previous offer is replaced, taken up or not.

A war this same turn's `warUpdates` already ends or ceasefires is withheld from
`settlements` by `modelClosedWarIds` (`gameplay.js:6743`); the same filter is
applied to `offers`, so the model's own peace cannot be offered back to the
player.

### 7. Accepting an offer

`acceptPeaceOffer()` is a deterministic, no-request action:

1. Refuse while a turn is being generated (`isSimulationBusy`), the same guard
   every other player action uses.
2. Read the live world and its stored `peaceOffer`. If there is none, return the
   unchanged offer state.
3. Build the peace event with `buildSettlementEvent(offer, { date, round })`.
4. Apply its region transfers by routing the event through
   `applyEventImpactsToWorld` with a synthetic event, the same door
   `applyIdlePulseUnitOps` uses, so owner-name resolution and the transfer rules
   behave exactly as on a real turn.
5. Apply reparations with `applyWarReparations(world, [offer])`.
6. End the war with `applyWarUpdates({ op: "end", id: offer.warId, eventIds })`
   and persist the settlement's weariness for that war.
7. Clear `peaceOffer`, append the event to the record, and write the world.

The accepted terms are the stored ones. The engine does not recompute the peace
at accept time; the player accepts the offer they were shown.

### 8. Declining an offer

`declinePeaceOffer()` clears `world.peaceOffer` and writes, and does nothing
else. The war stays `active`, its weariness stays stepped, and the next turn
re-derives an offer from the new facts. Declining is never punished and never
forced, per the non-goals.

### 9. The panel

`peaceOffer.jsx` is a small modal in the interactive panel's visual language:
the war, the two sides, the terms in plain words (the regions that would move,
the reparations, a white peace, and whether the terms are punitive), and two
buttons, accept and decline, each labelled with its cost (none). It reads
`world.peaceOffer` through `useRuntimeState` and calls the two lazy-wrapped
actions. It is inert while a turn is being generated, like the scene panel.

## Testing

The settlement adapter tests (`src/runtime/warSettlement.test.js`) change two
existing expectations and gain the rest. The default fixture war is already due
(weariness `0.6` two months on is `0.68`, at `WEARINESS_COMPEL`), so the change
is real and the existing party-war test must move with it:

1. The existing party-war test (`:44`) keeps its "a war the player is a party to
   is withheld with a player reason" case, but re-pins it to a not-due war (low
   weariness stepped from a recent `throughDate`), so `unresolved` still carries
   the player reason and the weariness is now stepped instead of `{}`. This is
   the intended behaviour change: the test's subject is the open, not-due war.
2. A new test uses the default due party war: it produces one `offer` carrying
   the player's `side` and a `pressure`, produces no `settlement`, and leaves
   `unresolved` empty for that war.
3. A non-party war is unaffected: still a settlement, and the `offers` array is
   empty.
4. A war the model ends or ceasefires this turn is withheld from `offers` as
   well as `settlements`, so the model's own peace is never offered back.
5. `settleWar` and `buildSettlementEvent` are unchanged by this increment, which
   the existing core tests already cover.

The new helper tests (`src/runtime/peaceOffer.test.js`), runnable with no
browser and no AI:

1. `choosePeaceOffer` returns `null` for no offers and for offers with no
   `warId`.
2. It returns the highest `pressure`, and breaks a tie by the lowest `warId`,
   independent of input order.
3. `normalizePeaceOffer` rejects a missing or empty `warId`, keeps a full offer,
   defaults the empty transfers and reparations, and bounds `round` and
   `pressure`.
4. The chosen stored offer carries the terms the settlement produced, so the
   accept path has them without the turn's battle inputs.

The world-state test (`src/runtime/gameState.interactiveEvents.test.js` or a
sibling) covers the default `peaceOffer: null` and normalization, mirroring the
interactive-offer cases.

The accept path is split so the arithmetic can be tested without importing
`gameplay.js` (which pulls in `main.jsx`): a pure helper that turns an offer plus
a world into the next world (event, transfers, reparations, ended war, cleared
offer) is exercised with `node --test`, and a source-text architecture test
(`src/Game/AI/peaceOfferWiringArchitecture.test.js`) pins the wiring order in
`gameplay.js`: the offer is chosen after the settlements are applied, the accept
path routes transfers through `applyEventImpactsToWorld` and reparations through
`applyWarReparations`, and no `src/Game/AI/` import reaches
`src/runtime/warSettlement.js` or `src/runtime/peaceOffer.js`.

## Compatibility

`peaceOffer` is optional and defaulted; a save without it loads with no offer.
The `resolveWarSettlements` return shape is additive. A war the model ends this
turn is still withheld. No `ENGINE_VERSION` bump and no migration are
introduced.

## Open questions

None block implementation. The following are deliberately deferred and recorded
so the plan does not silently decide them.

- Whether the model should be told a peace is pending for the player, so its
  narration does not close a war the engine is holding open, is deferred to the
  same later increment that would surface the standing obligations, the breach
  digest and the casus verdict.
- Whether the player may later author or counter an offer is deferred; this
  increment is accept or decline only.
- Whether weariness persisted while an offer is pending should carry any decay
  if the player declines repeatedly is deferred; this increment keeps stepping
  it upward, which is the consequence declining already has.
