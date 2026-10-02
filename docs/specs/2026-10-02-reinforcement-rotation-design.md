<!-- Open Historia - deterministic reinforcement and rotation (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# Reinforcements and Rotation: the Operational Layer of a War (part three)

The ninth increment of the deterministic simulation, and the last of three
parts. The seventh gave a war its shape; the eighth gave that shape a cost,
wearing a formation down on a front or in a pocket. This one gives the wear a
remedy: a formation still in supply draws on the manpower and materiel its
polity has already accumulated to buy its strength back, and the two
consolidation moves a commander holds over the roster - rotating a fresh
formation forward in place of an exhausted one, and folding two weak formations
of one type into one - are resolved from declared intent with the engine owning
every number. Nothing new is stored beyond two declared fields, no new currency
is created, and the shape of the eighth increment is read, never re-derived.
The only new state is the committed reinforcement policy and last turn's pending
declaration, mirroring mobilization.

## Why this increment exists

1. **A war has a cost and no remedy.** Part two wears a formation down each
   period and can remove it; nothing rebuilds it, so a rich polity and a
   bankrupt one lose a war identically. The reserves the economy already steps
   are the one surface a remedy needs, and it is already there.
2. **Replacement is a battle's reserve charge read in reverse.** A battle
   charges `manpower` and `materiel` per strength point lost
   (`runtime/combatEngagements.js`, `COMBAT_POOL_FACTOR`). Buying strength back
   from the same pools at the same per-point price needs no new table and no new
   field.
3. **Consolidation adds no new unit op.** Rotation and merging are a
   deterministic choice of which formation keeps the strength and where it
   stands; the world is then changed by the same `strength`, `move` and `remove`
   ops the battle resolver already emits. The seam exists; only the decision is
   new.

## Scope

This specification delivers **replenishment and consolidation over the
roster**: a pure core that turns a declared reinforcement policy, a polity's
reserves, the supply states part two already derives and the declared rotation
and merge orders into reserve draws and unit ops; an adapter that reads the
world into the core's plain inputs and maps the result to the unit seam; the
turn wiring; a short declaration surface so the model can order a rotation or a
merge; and the service documentation.

- **The reserve draw.** Strength is bought from `manpower`/`materiel` at the
  same per-point price a battle charges, so losing a point and buying it back
  costs what the two halves of the same event should cost.
- **Reinforcement.** A formation that is reachable in its polity's supplied
  network recovers strength from its polity's reserves, bounded by the period,
  by full strength and by what the reserves can afford. A cut-off formation
  cannot be reinforced.
- **Rotation.** A fresh formation is moved forward in place of an exhausted one
  of the same type, along the supplied network the eighth increment reads.
- **Merging.** Two formations of one type and one polity on one region fold into
  one, capped at full strength, freeing a slot.

## Non-goals

- **A new currency or a per-unit supply stockpile.** The existing
  `manpower`/`materiel` reserves and `UNIT_UPKEEP` are the only economic
  surface.
- **Allied, naval and air supply.** A formation draws only on its own polity's
  reserves, and the catalog the adapter is given is the whole graph. Coalition
  logistics is deferred with part two's open question.
- **Escalating attrition.** Part two's linear period multiplier is unchanged.
- **A change to the attrition, front-line or combat cores.** They are read.
- **A new panel or map layer.** The unit seam and the reserves are the only
  surfaces touched. The one new player-facing surface is the short declaration
  the model writes, described in section 8: unlike part two, this increment
  needs the model to be told the two orders exist.
- **A stored reinforcement field beyond the policy.** The effective state is the
  committed policy plus last turn's pending declaration, the same two fields
  mobilization uses; the rotation and merge orders are actions of the turn and
  are never persisted. No migration and no `ENGINE_VERSION` bump is introduced.

## Design

### 1. Layers

The same three layers and the same direction of dependency every earlier
increment established.

| Layer | Location | Rule in this increment |
|---|---|---|
| Pure core | `src/engine/reinforcement.js` (new) | `deriveReinforcement`: the policy ladder, the per-point reserve price, the recovery arithmetic and the rotation and merge folds, all as a total function of its inputs. Imports only the sibling `./forcePools.js` for `UNIT_UPKEEP` and `./economyMath.js` for `roundTo`, so `enginePurity` holds. No browser import, no `Date.now`, no `Math.random`, no world mutation. |
| Adapter | `src/runtime/reinforcement.js` (new) | `readReinforcement(world, catalog, { fromDate, toDate, rotations, merges })`: reads the effective policy, the reserves, the roster, the supply states part two already derives and the declared orders; calls the core; maps the result to the unit seam and a reserve draw. Reads only; writes nothing. |
| Shared read | `src/runtime/supplyAttrition.js` (existing) | The adapter calls `readSupplyAttrition` once, so "in supply" means exactly what part two means by it and the two can never disagree. Only each unit's `state` and `reachable` are read; the attrition `loss` is ignored. |

The core is a separate file from `engine/supplyAttrition.js` because it answers
a different question: part two asks whether a formation can be sustained where
it stands; this asks what it costs to make it whole again. It reads the
sibling's answer through the adapter rather than re-walking the graph, so a
formation is never reinforced in one layer and cut off in the other.

### 2. The declared policy (the hybrid model)

Reinforcement is AUTOMATIC under a per-polity policy the model declares, in the
same way mobilization is. The policy is one of three words:

- `none` - the polity runs no automatic reinforcement this period.
- `replacements` (the default) - every in-supply formation is topped up,
  weakest first, until the reserves run out or every formation is full.
- `belligerent` - only the formations of a polity on a side of an active war
  are topped up, weakest first.

The declaration follows the one-period lag every other declaration follows. A
policy declared in the turn the model is narrating is stored on the world and is
in force from the next turn; the policy in force this turn is the committed
policy overridden by last turn's pending declaration. This mirrors
`mobilization`/`pendingMobilization` and `production`/`pendingProduction` line
for line, so the period the model just narrated is never rewritten by the policy
it declared for it. Only non-default policies are stored, so a polity that never
declared one reads as `replacements` and a save that never used this increment
is unchanged.

Rotation and merging are the other half of the hybrid: they are not automatic
and not lagged, because they are direct actions of the narrated turn, not a
standing posture. A declared order applies in the same turn it is declared,
exactly as an event's unit ops do. Section 8 describes the declaration surface.

### 3. The reserve draw

Restoring `d` strength points to a formation of type T costs the same per-point
price a battle's reserve charge uses, read from the same `UNIT_UPKEEP[T]` row:

    manpower = UNIT_UPKEEP[T].manpower * (d / 100) * REINFORCEMENT_POOL_FACTOR
    materiel = UNIT_UPKEEP[T].materiel * (d / 100) * REINFORCEMENT_POOL_FACTOR

`REINFORCEMENT_POOL_FACTOR` is the core's own constant, equal to the runtime's
`COMBAT_POOL_FACTOR`, and a runtime test pins the two together exactly as the
production unit types are pinned to the roster's, so a lost point and a bought
point cost the same and cannot drift. An unknown type prices as infantry,
matching the combat reserve charge.

The draw has the same absolute zero floor the pools already use: a polity buys
the points its reserves can afford and never goes negative, so a poor polity
reinforces slowly rather than not at all. Affordability is evaluated once per
formation as the largest whole number of points whose manpower and materiel
cost both fit the pool at that moment, so a formation is topped by whole points
and the pool is never read as negative. A formation the reserves cannot afford
even one point is skipped silently, not reported as a rejection: a full pool is
not an error.

### 4. Reinforcement

A formation recovers strength only when it is REACHABLE in its polity's supplied
network, the `reachable` flag part two already computes. It never recovers when
it is cut off, so part two and part three tell one story: standing isolated both
costs strength and forbids replacing it. Recovery is bounded three ways: by the
period, at `REINFORCEMENT_RATE_PER_MONTH` strength points per whole month the
turn spans; by full strength; and by what the polity's reserves can afford. It
is bought in whole points, in a deterministic order, so a scarce reserve is
spent the same way on any machine.

The order is weakest first, because a formation near collapse is the one the
reserve should save; ties break by `unitId` by plain code-unit comparison, so
the same roster yields the same allocation. Polities are processed in stable
name order, each against its own pool, so one polity's draw cannot change
another's.

### 5. Rotation

A rotation order names two formations of one polity and one type: `out`, the
exhausted one in the line, and `in`, the fresh one behind it. The engine moves
`in` into `out`'s station and `out` back into `in`'s, as two ordinary move ops
along the same unit seam. Both formations must be REACHABLE in the polity's
supplied network, so a rotation is a relief in place and never a teleport
through a front. Both must stand on different regions, and both must carry the
coordinates the world already stores on the roster, so no catalog lookup is
needed to place them.

A rotation is a swap, so the two orders it emits must not be able to disagree:
the engine emits both moves from one validated order, never one without the
other. Because the step is engine-sourced with no elapsed motion, both moves
arrive in the same turn. Next turn's reinforcement refills the formation now in
the rear, so the two halves of this increment compose: rotate the worn formation
out, then let it rebuild in supply.

### 6. Merging

A merge order names two formations of one polity and one type standing on one
region: `survivor` and `absorbed`. The survivor's strength becomes the two
strengths summed and capped at full, and the absorbed formation is removed,
freeing a roster slot. The survivor's identity, name and composition are kept:
the engine adds strength, it never invents a new formation. The survivor's
strength never falls, because the sum of two clamped strengths capped at full is
never below either.

Whether a merge should be permitted only inside the supplied network is
deliberate: merging is a consolidation of two formations already standing
together, not a movement, so it needs no supply predicate of its own. An
isolated pair may merge, because that is exactly the situation in which folding
two spent formations into one is worth doing.

### 7. Determinism and edges

The core is a total, order-independent function of its inputs. Units and orders
are ordered by plain code-unit comparison (`a < b`), never `localeCompare`;
owner names fold with `toLowerCase`, never `toLocaleLowerCase`; ops are emitted
in a fixed order (reinforcement, then rotations, then merges) with a stable key
inside each, so the same inputs give the same byte sequence in a fresh process.
No clock, no entropy, no iteration over an unordered map or set without an
explicit sort before output. The period arrives as a number, so the core never
reads a date.

Known edges:

- A rotation or merge order naming an unknown unit, a unit of another polity, a
  unit of another type, or a non-reachable station is skipped and recorded in
  the returned rejections, never thrown on.
- Two orders that name the same unit are folded by key, first one winning, so a
  formation cannot be both rotated and merged in one turn.
- `months` of zero restores nothing, but a declared rotation or merge still
  applies, because those are actions of the turn rather than period-scaled
  recovery.
- A formation already at full strength is not reinforced and draws nothing.
- An empty or absent policy map, reserves, roster, supply list or order list
  yields the empty shape, not a throw.
- A region whose centroid the world does not carry on a unit is only relevant to
  rotation, and a unit without usable coordinates is skipped with a rejection.

### 8. The declaration surface

Reinforcement needs no declaration: the default policy reinforces automatically.
Rotation and merging cannot happen unless the model knows they exist, so this
increment adds the one surface part two deliberately avoided. It is short and
closed, and it follows the shape the production and mobilization declarations
already use.

On the turn contract, three optional top-level fields are added beside
`productionOrders` and `mobilization`:

- `reinforcement`: a list of `{ polity, policy }` with `policy` from the closed
  list `none`, `replacements`, `belligerent`. Capped at `MAX_REINFORCEMENT`
  entries, one per polity, exactly as `mobilization` is capped. It is stored and
  takes effect next period.
- `rotations`: a list of `{ out, in }` naming two unit ids. Capped at
  `MAX_ROTATIONS` orders. It applies this period.
- `merges`: a list of `{ survivor, absorbed }` naming two unit ids. Capped at
  `MAX_MERGES` orders. It applies this period.

The schema validates the closed policy list and the caps, and the existing
rejection path records a malformed entry without failing the turn. The prompt
gains one paragraph in the `[National Forces]` block: that reserves can rebuild
an in-supply formation automatically under a declared policy, and that a worn
formation can be rotated out or two weak formations of one type merged, with the
engine owning the cost and the result. Every other prompt and panel is
untouched.

### 9. Wiring and ordering

The step runs in `applySimulationResult` (`src/Game/AI/gameplay.js`), on the
world the battles and part two have already reshaped, immediately after the
supply attrition step and before the war settlements and the economy advance.
The order is deliberate: this period's readiness loss is already in the roster,
and the replacement draw competes for the same reserves as the war reparations
and the production queue that follow, which is the economic tension this
increment exists to create.

1. read the effective policy from the world, and the declared rotations and
   merges from the model's result for this turn;
2. read the region catalog already primed for this turn;
3. call `readReinforcement` with the post-attrition world and the turn's
   `baseGame.gameDate` -> `nextGame.gameDate` span;
4. when the adapter returned any op, apply them through
   `applyEventImpactsToWorld` as a board-only synthetic event, exactly as the
   attrition and production completions are applied, so the ops travel the one
   unit path and no narrative event is written;
5. charge the reserve draw with the same reserve-charge path the combat cost
   uses (`applyCombatReserveCost`), so the pools and the forces mirror the panel
   reads stay correct;
6. take the returned world and colours forward.

The whole step is wrapped so a failure never loses a completed turn: the events
and the date are already correct, so the step is simply skipped for that turn
and the skipped period is not replayed later.

## Testing

`src/engine/reinforcement.test.js` (pure, no imports beyond the core):

- An in-supply formation below full strength under `replacements` recovers the
  monthly rate and draws the per-point cost from its pool.
- A cut-off formation (`reachable` false) recovers nothing and draws nothing.
- `none` reinforces nobody; `belligerent` reinforces only a polity on a side of
  an active war.
- The draw is bounded by the pool: with a pool too small for a full top-up, the
  formation is topped by the points the pool affords and the pool is not
  negative.
- Weakest-first ordering: with a pool enough for one formation only, the weakest
  is served first, and the same roster in a different order gives the same
  result.
- A rotation of two valid, reachable, same-type formations yields two moves that
  swap their stations; a rotation naming an unknown, mismatched or unreachable
  formation is rejected and yields no move.
- A merge yields a `strength` op capped at full and a `remove` op, keeps the
  survivor's id, and never lowers its strength.
- Duplicate orders fold by key, first one winning.
- Determinism: the same input serialized twice is identical, and reordering the
  units, supply and order arrays does not change the result.
- Empty inputs -> the empty result shape, not a throw.

`src/runtime/reinforcement.test.js` (the adapter seam):

- A composite world (a home network, an in-supply weakened formation, a cut-off
  one, a declared rotation and a declared merge) with a small catalog -> the
  expected ops, reserve draw and summary.
- An empty catalog leaves the formations unreachable, so no reinforcement is
  drawn, matching part two's graph.
- The adapter leaves the world and the catalog unmodified.
- `REINFORCEMENT_POOL_FACTOR` equals the runtime's `COMBAT_POOL_FACTOR`, so no
  runtime test can let the two drift.
- The adapter imports no `src/Game/AI/` module (source-text guard).

`src/engine/enginePurity.test.js` continues to pass with the new engine file
present, and the existing declaration-schema and prompt tests still pass with
the new fields present.

## Acceptance

The whole suite passes with zero failures, `node --test "src/engine/*.test.js"`
and `node --test "src/runtime/*.test.js"` pass, ESLint is clean on the new
files, `npm run wiki:check` reports `Wiki is current.` after any documentation
is regenerated, and `npm run build` succeeds. No `ENGINE_VERSION` bump, no
migration, no stored `world` field beyond the committed reinforcement policy and
last turn's pending declaration, and no new `package.json` entry is introduced.

## Open questions

None block implementation. The following are deliberately deferred and recorded
so the plan does not silently decide them.

- Whether a formation should draw replacements from an ally's reserves, not only
  its own polity's, is left to the war model, as in part two.
- Whether the reinforcement rate should vary by unit type or by posture (a
  mobilized polity replacing faster) is a later refinement; this increment uses
  one rate for every type and posture.
- Whether a rotation should cost a movement allotment of its own, rather than
  arriving in one turn, is deferred; this increment treats a rotation as an
  in-place relief.
- Whether a merge of two different types (an understrength armor folded into
  infantry) should be allowed is a modelling decision; this increment requires
  one type.
- Whether the automatic policy should prefer formations near a front over rear
  garrisons beyond weakest-first is deferred; weakest-first is the whole rule.
