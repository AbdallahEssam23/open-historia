<!-- Open Historia - deterministic war settlement (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# War Settlement: Deterministic Ends to a Declared War

The sixth increment of the deterministic simulation. The first increment built
the reserves and the manpower pools; the second built the production and
construction line; the third gave research a clock, a cost and a rate; the
fourth made a completed programme change the simulation; the fifth made the
reserves and the roster fight a declared battle. This one gives a war an end:
each side declares what it is fighting for, the engine measures how far it has
got and how exhausted it is, and a peace is derived from those facts and
written back through the doors the ledger already opens.

## Why this increment exists

1. **A war can begin and never end.** `nativeWarLedger.js` owns the whole
   belligerency lifecycle - `start`, `join-a`, `join-b`, `leave`, `ceasefire`,
   `resume`, `end` - but every one of those transitions is the model's prose.
   Nothing measures whether a war is being won or lost, so nothing ever
   compels it to close. A model that stops narrating a war leaves it `active`
   forever, and the fifth increment keeps resolving battles inside it.
2. **A battle has arithmetic and no object.** The fifth increment computes
   casualties, spends reserves and moves control - but only where a battle is
   declared. It has no notion of what the fighting is *for*, so a war with ten
   victories and a war with none have identical standing in the ledger. The
   force pools the war is paid from exist precisely so that a long war becomes
   an increasing burden; nothing reads that burden to end the war.
3. **Every door the peace needs already exists.** A change of legal sovereignty
   is a `regionTransfers` entry; a reserve transfer is a pool write; closing a
   war is the ledger's own `end` op. A settlement needs no new mutation
   vocabulary and no new panel - only a core that derives one.

The fifth specification records the deferral this increment discharges: "War
goals, peace terms and computer-opponent decision making. Explicitly deferred
by the first specification; still deferred here."

This specification delivers **war settlement**: declared war goals, a
deterministic measure of goal progress and weariness, a derived peace when a
war is compelled to close or a side declares a capitulation, and the write of
that peace through the existing ledgers. It is not a front line, an occupation
model, a puppet or regime-change system, nor a player-facing peace dialogue;
none of those is built here.

## Goals

- A war carries declared goals, one closed kind per side (`annex`,
  `reparations`, `status_quo`) and, for `annex`, an explicit list of target
  regions canonicalized to region ids.
- A pure function measures, per side, goal progress (`warGoalScore`) and
  cumulative weariness (`wearinessStep`), and turns the two into a mandatory
  signal (`warPressure`): a peace is *compelled* at a weariness threshold and a
  side *capitulates* at a higher one.
- A pure function (`settleWar`) derives the concrete peace - which regions
  change hands, what reparations are paid, or a white peace - and returns
  nothing until a peace is due. Same inputs, same terms, byte for byte.
- The decision-maker (the AI, and later the player) asks for, accepts or
  refuses a peace; the engine never decides *whether* to make peace on a
  political basis, only *when the facts force one*.
- `src/runtime/` is the sole authority that executes a settlement: it closes
  the war in `nativeWarLedger.js`, moves the regions through the existing
  `applyEventImpactsToWorld` door, and transfers the reserves with an absolute
  zero floor.
- The model keeps the semantic WHAT (what a war is fought for); the engine owns
  the HOW (how far it has got, and what the peace costs).
- No new runtime dependency, no new panel, no new required event field, no
  migration of existing saves.

## Non-goals

- **Player peace decisions.** A war the player is a party to is deliberately
  left active this increment and noted; the offer/accept/refuse surface is a
  later, smaller increment. Settling the player's wars on their behalf is out
  of scope.
- **Puppets, regime change and disarmament.** The only peace terms are
  territorial transfer, reparations and a white peace. A vassal or a forced
  government change is a whole dependent system and is not built here.
- **Front lines, attrition between turns, supply and encirclement.** A war's
  weariness accumulates from elapsed time, this turn's battle losses and the
  mobilization posture; it is not a map of fronts.
- **Terrain, weather, doctrine and a full type-versus-type matrix.** The battle
  arithmetic is the fifth increment's and is unchanged.
- **Occupation as a separate state.** Control reads the existing
  `regionOwnershipOverrides`; there is no bespoke occupation ledger.
- **Multi-region war goals in one war beyond a bounded list.** A side may annex
  only the regions it declared and actually controls.
- **Retro-fitting.** `goals` and `weariness` are optional on a war; a save
  without them is settled as `status_quo` with weariness starting at zero, so
  there is nothing to migrate and no `ENGINE_VERSION` bump.

## Design

### 1. Layers

The same three layers and the same direction of dependency the five earlier
increments established.

| Layer | Location | Rule in this increment |
|---|---|---|
| Pure core | `src/engine/warSettlement.js` (new) | The goal-kind enum, the weariness constants, `normalizeWarGoals`, `warGoalScore`, `wearinessStep`, `warPressure` and `settleWar`. Imports only `./economyMath.js` (the shared `clamp`/`roundTo`), so it stays inside the engine purity allow-list. No browser import, no `Date.now`, no `Math.random`. |
| Adapter | `src/runtime/warSettlement.js` (new) | Reads the active wars, the ownership overrides, the turn's battle losses and the pools; calls the core; turns a settlement into a narrated peace event and a set of `regionTransfers`; and transfers the reparations between the pools. Never writes the war ledger itself. |
| Boundary | `src/Game/AI/` | `nativeWarLedger.js` learns the `goals` op and the two optional war fields (`goals`, `weariness`); `combatRegionResolution.js` is generalized so the same resolver canonicalizes a declared `combatRegion` and a declared goal region; `gameplay.js` runs the adapter in the turn, appends the peace event, closes the war through the existing `applyWarUpdates`, and pays the reparations after the impacts land. |

The settlement core is a separate file from `engine/combat.js` because the two
answer different questions: `combat.js` resolves one battle between two present
forces; `warSettlement.js` weighs a whole war over time. They share no
arithmetic - a settlement reads the *results* of battles, never their power
computations - so they share no file.

### 2. The goal model

Three kinds, one per side:

```
WAR_GOAL_KINDS = ["annex", "reparations", "status_quo"]
```

- `annex`: the side wants the regions it lists. Its progress is the share of
  those regions it currently controls or has taken.
- `reparations`: the side wants to impose a cost. Its progress is driven by its
  battlefield advantage, measured without a separate target list.
- `status_quo`: the side wants no gain. It is satisfied from the outset, which
  is why a war with no declared goal can never stall on progress alone; only
  weariness closes it.

The stored shape, one entry per side, is:

```
goals: { a: { kind, targetRegionIds: [], note }, b: { ... } }
```

An invalid or absent `goals` normalizes to `null`, and a war without goals is
treated as `status_quo` on both sides. The model declares goals through the war
ledger (section 4), so the ledger remains the single writer of `world.wars`.

### 3. The core (`src/engine/warSettlement.js`)

Constants (first-draft calibration; the tests assert ordering and bounds, never
a magnitude):

```
WEARINESS_COMPEL       = 0.6    // at or above, a peace is mandatory
WEARINESS_CAPITULATION = 0.9    // at or above, the side collapses
WEARINESS_MONTHLY_GAIN = 0.04   // time alone
WEARINESS_LOSS_GAIN    = 0.5    // this turn's own losses
REPARATION_SHARE       = 0.25   // of the loser's pools
REPARATION_MANPOWER_CAP = 1000000
```

`normalizeWarGoals(value) -> { a, b } | null` validates the declared shape,
folds the kind to the closed enum, dedupes and caps `targetRegionIds`, and
drops an invalid entry without throwing (the same posture as
`normalizeMobilization`). It never fails the turn.

`warGoalScore({ kind, targetRegionIds, heldRegionIds, advantage }) -> 0..1`
returns the share of the target regions the side holds for `annex`, `1` for
`status_quo`, and the clamped `advantage` (the side's share of the turn's
battle power, `0..1`) for `reparations`, so each kind reads exactly one input
and no field is overloaded. `targetRegionIds` and `heldRegionIds` are empty for
the kinds that do not use them; a side that controls no target and holds no
advantage scores `0`.

`wearinessStep({ prior, months, lossFraction, mobilization }) -> 0..1` is a
pure accumulation: `clamp(prior + months * WEARINESS_MONTHLY_GAIN +
lossFraction * WEARINESS_LOSS_GAIN + postureDrag(mobilization), 0, 1)`, where
`postureDrag` reads the mobilization posture from `forcePools.js`'s closed set
and adds nothing for `peacetime`. It never decreases while the war is active.

`warPressure({ wearinessA, wearinessB }) -> { compelled, capitulationA,
capitulationB }` turns the two weariness values into the signal: `compelled` is
true when either side is at or above `WEARINESS_COMPEL`; a capitulation is a
side at or above `WEARINESS_CAPITULATION`.

`settleWar(input) -> null | settlement` derives the peace, in this order:

1. One side capitulates: the other is the victor and takes every target it
   holds.
2. Both capitulate: the victor is the side with the higher goal score, tie
   broken by the lower weariness, then by side A.
3. No capitulation, not `compelled`, and no side has achieved a declared aim:
   return `null` (no peace is due). An aim is achieved when the side's kind is
   not `status_quo` and its score is `1`, so a `status_quo` side - satisfied
   from the outset - never forces a peace by its satisfaction alone; only
   weariness closes a goal-less war.
4. Otherwise the victor is the side with the higher goal score, tie broken by
   the lower weariness, then by side A.

The returned settlement:

```
{
  key, victor, loser, capitulation, white,
  transfers: [{ regionId, fromCode, toCode }],
  reparations: { fromCode, toCode, manpower, materiel },
}
```

Terms depend on the victor's goal kind: `annex` transfers the regions the
victor declared and actually controls (all of them on a capitulation);
`reparations` transfers `REPARATION_SHARE` of the loser's pools, capped by
`REPARATION_MANPOWER_CAP`; `status_quo` is a white peace with no transfer and
no reparations. A `reparations` victor that also holds declared regions may
take neither land nor reparations at all if its goal is purely reparations;
the kind is what the side declared, not what the engine infers.

### 4. The declaration channel

`warUpdates` gains one op, `goals`, on the existing line
`warId~op~actorsCSV~opponentsCSV~eventNumbersCSV~note`:

```
war-france-germany-1914~goals~France:annex:Alsace|Lorraine;Germany:reparations~~~~
```

Each `actorsCSV` entry is `polity:kind[:region|region]`, one per side; the rest
of the fields are unused. A comma cannot separate regions because the transport
itself splits `actorsCSV` on commas, so sides are joined with `;` and regions
are pipe-separated. `decodeWarUpdates` already slices and validates the record,
so the op needs only a parser and a store step: it writes
`war.goals`, normalizing the kinds through `normalizeWarGoals`, and drops an
entry naming an unknown or inactive war with a warning, exactly as the other
ops do.

The target regions are canonicalized to region ids in the turn's existing
validation pass. `combatRegionResolution.js` is generalized from
`resolveCombatRegionIds(containers, catalog)` to a shared helper that
canonicalizes a value against the same catalog, so `combatRegion` and each goal
region are folded to a known id or cleared. `gameplay.js` calls it once over
the containers and once over the decoded goal updates, using the same primed
catalog the transfer and control resolvers already use.

Because the declaration is a war-ledger op, no event schema field is added and
no new transport string is introduced.

### 5. The adapter (`src/runtime/warSettlement.js`)

`resolveWarSettlements({ world, wars, engagements, round, date, catalog,
playerPolity }) -> { settlements, weariness, unresolved }`:

- Reads the active wars from the world it is given (the turn's normalized
  pre-merge world) and skips each of: a war the player is a party to (recorded
  in `unresolved` so the caller can note it), a war past `active`, a war whose
  `startedDate` is this round or later, and, when the caller is the GM apply
  pass, every war.
- For each remaining war, derives `held` from `regionOwnershipOverrides` for
  the declared `targetRegionIds`, reads this turn's battle losses for the war
   from `engagements` (as a per-side share of the turn's battle power, the
   `advantage` input, and as a loss fraction for weariness), reads each side's
   mobilization posture, steps each side's weariness from `war.weariness` (zero
   when absent), and calls `settleWar`.
- Returns the new `weariness` per war so `gameplay.js` persists it, and the
  settlements due this turn. It returns at most one settlement per war, so a
  second battle on the same war cannot settle twice.

`buildSettlementEvent(settlement, { date, round }) -> event` builds the narrated
peace: a `military` event carrying `warId` and the two sides' polities in
`combatants`, and `impacts.regionTransfers` for the transfers. It carries **no**
`combatRegion`, so the fifth increment's resolver treats it as narrative rather
than as a battle to resolve. The event is appended to `freshEvents`, so its
transfers travel through `applyEventImpactsToWorld` - the one door every
narrated territorial change already uses - and the receipt records it.

`applyWarReparations(world, settlements) -> world` reads the pools once, moves
the capped manpower and materiel from the loser to the victor with an absolute
zero floor (the same posture as `applyCombatReserveCost`), refreshes the forces
mirror, and returns a new world. A settlement with no reparations returns the
world unchanged.

### 6. Execution in the turn

Inside `applySimulationResult`, in this order:

1. The battles resolve (fifth increment) and yield their casualties.
2. `resolveWarSettlements` runs against the pre-turn world and the battles'
   losses, once per turn.
3. Each settlement appends a `buildSettlementEvent` to `freshEvents`, and an
   `end` record is appended to the turn's `warUpdates`.
4. `applyEventImpactsToWorld` applies the peace events with the rest of the
   turn's impacts.
5. The existing `applyWarUpdates` closes the war in `world.wars`.
6. `applyWarReparations` transfers the pools after the impacts land.

The war is closed by the ledger's own `end`, so there is exactly one writer of
`world.wars` and exactly one writer of the pools.

### 7. Edges, receipts and determinism

- A player war, a non-active war, a war started this round and every GM apply
  war are skipped; the first is noted on the receipt as `withheld`, the rest
  silently.
- A settlement is noted on the receipt as `adjusted` ("the war with X closed:
  N regions, reparations ..."), using the existing note kinds.
- No clock and no entropy: weariness accumulates from the date difference the
  game already stores plus this turn's losses; the terms are a pure function of
  the inputs; replaying a turn against the same state yields the same peace.
- Reparations are floored at zero and a loser with empty pools pays nothing
  rather than going negative.
- A war whose `goals` are absent settles as `status_quo`: the war can still end
  on weariness, but takes nothing.

## Testing

The core's tests run under a bare `node --test` and assert:

- Every tie-break branch of `settleWar` (one capitulation, both, goal score,
  lower weariness, side A) and the `null` return before a peace is due.
- The terms per goal kind (`annex` transfers only held declared regions;
  `reparations` transfers the capped share; `status_quo` transfers nothing).
- The weariness step is monotone, bounded to `0..1`, and adds nothing for
  `peacetime` beyond time.
- `normalizeWarGoals` drops invalid entries without throwing and treats an
  absent value as `null`.
- Determinism: the same input yields a byte-identical settlement.

The adapter's tests assert: the player war and non-active war are skipped and
the former is noted; a settlement is produced at most once per war per turn;
`buildSettlementEvent` carries no `combatRegion`; `applyWarReparations` moves
the capped amount with a zero floor and leaves the world unchanged when there
is nothing to pay.

The ledger's tests assert: the `goals` op round-trips through
`decodeWarUpdates` and `applyWarUpdates`; an op naming an unknown war is
dropped; an old war without `goals` or `weariness` still normalizes and is
settled as `status_quo`.

A wiring guard in the spirit of `combatWiringArchitecture.test.js` reads the
source and asserts the seams by position: `resolveWarSettlements` is called
after the battles resolve and before `applyEventImpactsToWorld`; the peace
event is appended to `freshEvents`; `applyWarReparations` runs after
`applyWarUpdates`.

## Acceptance

The whole suite passes with zero failures, ESLint is clean on the changed files,
`npm run wiki:check` reports `Wiki is current.` after the documentation is
regenerated, and `npm run build` succeeds. No `ENGINE_VERSION` bump and no
migration are introduced.

## Open questions

None block implementation. The following are deliberately deferred and recorded
so the plan does not silently decide them.

- The constants (`WEARINESS_COMPEL`, `WEARINESS_CAPITULATION`, the two weariness
  gains, `REPARATION_SHARE`, `REPARATION_MANPOWER_CAP`) are first-draft
  calibration, expected to be tuned against a few campaigns. The tests assert
  ordering and bounds, never a magnitude.
- Whether the player should receive a formal peace offer with accept/refuse is
  a UI decision for a later increment; this one leaves the player's wars open.
- Whether a `reparations` goal should also take land is a modelling decision
  for later; this increment keeps one kind per side and takes only what the
  declared kind names.
- Whether weariness should carry across a `ceasefire` and resume is a later
  refinement; this increment treats a ceasefire as a war that is not settled.
