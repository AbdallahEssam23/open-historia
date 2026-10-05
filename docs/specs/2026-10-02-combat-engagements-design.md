<!-- Open Historia - deterministic combat engagements (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# Combat Engagements: Deterministic Resolution of a Declared Battlefield

The fifth increment of the deterministic simulation. The first increment built
the reserves and the manpower pools; the second built the production and
construction line; the third gave research a clock, a cost and a rate; the
fourth made a completed programme change the simulation. This one makes the
reserves and the roster fight: when a narrated battle belongs to an active
canonical war, the engine computes the casualties, spends the reserves and
decides whether a province changes hands.

## Why this increment exists

1. **Combat already has a ledger and no arithmetic.** `world.wars` is the only
   source of belligerency, and an event that narrates battlefield combat must
   carry `warId` and `combatants` naming polities from both sides of an active
   war, or the segment is rejected (`nativeWarLedger.js`). The ledger says a
   war exists and who is in it; nothing computes what a battle does to the
   forces that fight it. `strength` on `world.units` is a percentage the model
   writes, and the outcome of an assault is prose.
2. **The reserves were built to be spent by combat.** The first increment
   exists so that an army costs something, and its own specification records
   that "upkeep makes large armies unplayable before combat exists" and that
   the constraint "becomes a real constraint in the combat increment"
   (`docs/superpowers/specs/2026-10-01-force-pools-design.md`). Three
   specifications defer the same system: "Combat resolution, attrition, front
   lines. Later increment."
3. **The engine already owns every door the result needs.** Unit strength and
   removal are expressed as `unitOps`; a change of de-facto control is a
   `regionControlOps` entry; both are applied by existing normalizers. A combat
   result needs no new mutation vocabulary, only a core that produces one.

This specification delivers **engagement resolution**: one declared battle at a
time, resolved deterministically into casualties, a reserve cost and, when the
defender breaks, a change of control. It is not a front line, a logistics
network or a war-goal system; none of those is built here.

## Goals

- A pure function resolves one engagement between two declared sides on a
  declared region: same inputs, same outputs, byte for byte, in a fresh
  process.
- Force is derived from the roster the engine already reads (unit type, current
  `strength`, unit count) and from the mobilization posture the first increment
  owns. No model declares a number.
- Casualties reduce `strength`, destroy broken formations and spend `manpower`
  and `materiel` from the reserves, both floored at zero.
- A province changes hands only when its defender breaks, through the existing
  `regionControlOps` door.
- The model keeps the semantic WHAT (which polities fight, where, and why); the
  engine owns the HOW (who loses what, and which province falls).
- A jitter derived from a fixed hash makes a battle non-deterministic in
  outcome but perfectly reproducible for the same inputs and the same turn.
- No new runtime dependency, no new panel, no migration of existing saves.

## Non-goals

- **Front lines, attrition between turns, supply and encirclement.** A battle
  is resolved once, at the turn that declares it. A standing front is a later
  increment.
- **War goals, peace terms and computer-opponent decision making.** Explicitly
  deferred by the first specification; still deferred here.
- **Terrain, weather, doctrine and a full type-versus-type matrix.** The model
  of force is one weight per unit type and one posture multiplier.
- **Multiple battles in the same region in the same turn.** The snapshot is the
  pre-turn world; a second engagement in the same region reads the same roster.
  Resolving a sequence of them is out of scope.
- **Special rules for naval and air formations beyond their weight.** They
  fight like any other unit here; superseded by
  `docs/specs/2026-10-05-naval-air-domain-tactics-design.md`, which gives air
  and naval formations a tactical effect.
- **Direct player control of a battle.** The player keeps the levers the board
  already exposes; the model declares, the engine resolves.
- **Retro-fitting.** No stored battle state is introduced, so there is nothing
  to migrate.

## Design

### 1. Layers

The same three layers and the same direction of dependency the earlier
increments established.

| Layer | Location | Rule in this increment |
|---|---|---|
| Pure core | `src/engine/combat.js` (new) | The type weights, the mobilization multiplier, the fixed-hash jitter, the loss fraction, the destruction rule and the control threshold. No browser import, no `Date.now`, no `Math.random`, no import at all. Importable by bare `node --test`. |
| Adapter | `src/runtime/combatEngagements.js` (new) | Gathers the two sides from `world.units` on the declared region, reads the mobilization posture from `economyEngine.mobilization`, calls the core, converts the casualty points into reserve cost from the force-pool table, and returns the ops and the reserve deltas. |
| Boundary | `src/Game/AI/` and `src/runtime/` | The event schema, normalizer and prompt gain `combatRegion`; the async region resolver canonicalizes it; `gameplay.js` runs the adapter over the events of a turn and merges its result through the existing doors. |

`src/engine/combat.js` is import-free like `researchEffects.js`: it reads no
sibling table. The casualty-to-reserve mapping lives in the adapter because the
reserves are a force-pool concern, and the adapter imports `UNIT_UPKEEP` from
`forcePools.js` so the per-type size proxy has one source of truth.

### 2. The declaration

No new payload is introduced. The event that already carries `warId` and
`combatants` gains one field, `combatRegion`:

```
{
  title, description, kind, date,
  warId: "war-france-prussia-18700719",
  combatants: ["France", "Prussia"],
  combatRegion: "Alsace"          // name or id; the resolver canonicalizes it
}
```

`normalizeEventEntry` (`src/runtime/gameState.js`) learns `combatRegion` beside
`warId` and `combatants`. It is a single optional string, default `""`, carried
through normalization and persisted verbatim so an event written before the
field existed round-trips byte for byte.

The event schema (`gameplaySchemas.js`) and the prompt gain the field and the
rule: a narrated battlefield battle must name the region it is fought in. The
existing hard-combat detection and the war-ledger validation are unchanged:
`combatants` is still validated against an active war, and combat still cannot
exist without one.

`combatRegion` is required to RESOLVE an engagement, not to keep the event.
An event that narrates hard combat but names no region stays on the timeline as
narrative, is not resolved, and draws a note in the application receipt. This
matches the fail-open salvage the ledger already uses for an unbound battle.

### 3. The battlefield snapshot

The adapter receives the world the turn is about to modify, before any of the
turn's unit operations are applied. A unit ordered into the region this turn
does not fight until it is there, which is the same moment the engine already
stamps it `engaged`; a force already standing in the region fights now.

For each candidate event (an event carrying a `warId` that resolves to an
active canonical war, at least one combatant from each side, and a
`combatRegion` that canonicalized to a region id), the adapter builds two
sides:

1. Read the war from `world.wars` by id; its `sideA` and `sideB` are the two
   sides, compared through the same case-folded polity key the ledger uses.
2. Assign each declared combatant to the side that contains it.
3. Collect every entry of `world.units` whose `ownerCode` is on one of the two
   sides AND whose `regionId` equals the engagement region. Each unit
   contributes `{ id, type, strength, polity }`.
4. Read each polity's committed posture from `economyEngine.mobilization`;
   absent means `peacetime`.

The region stamp is the same one the engine already grounds a formation with:
`resolvePlacements` writes `regionId` from the resolved point, so a unit the
engine or the unit director placed is counted. A unit with no `regionId` (a dot
a scenario author dropped without a region) is **not** counted; the adapter
never guesses membership from raw coordinates.

If either side has no units in the region, the engagement is **not resolved**:
there is no battle to compute, nothing is written, and the receipt records that
the declaration named a side that was not on the field. The engine never
invents a loser for a force that is not there.

The engagement region is the same `regionId` the transfer and control resolvers
use, and the current controller is read through the same `resolveOwner`
callback `applyPolityAndTerritoryImpacts` already receives, over
`regionOwnershipOverrides` and the base map.

### 4. The combat model

**Unit power** is `TYPE_WEIGHT[type] * (strength / 100)`. The weights are a
closed table, ordered so heavier formations weigh more; the tests assert the
ordering and the determinism, never a magnitude:

| Type | Weight |
|---|---|
| garrison | 0.4 |
| infantry | 1.0 |
| artillery | 1.2 |
| armor | 1.6 |
| air | 2.0 |
| naval | 2.2 |

**Side power** is the sum of its units' power, multiplied by each owning
polity's mobilization multiplier. A side that is a coalition multiplies each
polity's contribution by that polity's own posture:

| Posture | Combat multiplier |
|---|---|
| demobilized | 0.75 |
| peacetime | 1.0 |
| partial | 1.25 |
| total | 1.5 |

This is a dedicated combat table, not the extraction table the first increment
uses for the economy: a mobilized economy extracts more resources, and a
mobilized army also fights better, but the two are different quantities. The
table is first-draft calibration.

**The jitter** is derived from a fixed FNV-1a hash over one key, the same
algorithm `spycraft.js` uses so a replay is consistent across systems:

```
key = `${warId}|${regionId}|${date}|${round}`
rollA = engagementRoll(`${key}|a`)     // [0, 1)
rollB = engagementRoll(`${key}|b`)
adjustedA = powerA * (0.85 + 0.30 * rollA)
adjustedB = powerB * (0.85 + 0.30 * rollB)
```

Same war, same region, same date and same round always produce the same two
adjustments. A different round is a different battle. The core carries its own
`engagementRoll` rather than importing the runtime's, because the engine may
not import a runtime module; the algorithm is deliberately the same.

**The outcome and the losses.** `shareA = adjustedA / (adjustedA +
adjustedB)`. The side with the larger adjusted power wins; a tie is held by the
defender. Each side loses a fraction of its current strength:

```
lossFraction(side) = clamp(0.45 * shareOpponent, 0.03, 0.45)
```

The loss is applied uniformly to every unit on that side:
`next = Math.round(strength * (1 - lossFraction))`. Even the winner pays a
price, and a side that is overwhelmed pays the cap while the winner pays close
to the floor.

**Destruction.** On the losing side, a unit whose rounded `next` is below the
destruction threshold (15) is removed rather than written to a token strength.
A unit on the winning side is written down but never removed by the floor:
`next` is clamped to at least 1. This is what makes a rout decisive instead of
an endless exchange of a few points.

### 5. Control transfer

The defender is the side that currently controls the engagement region. If the
region's controller is a third party that is not one of the two belligerents,
the battle still resolves its losses but can never transfer the province: the
engine does not invent an owner for a region neither side held.

The province changes hands only when both hold:

1. The attacker is the winner.
2. The defender's adjusted share is below `CONTROL_THRESHOLD` (0.4).

When it does, the adapter emits one `regionControlOps` entry with `op:
"control"`, the engagement `regionId`, and `toCode` the first combatant of the
winning side that has units in the region, in the war's declared side order.
That order is stable, so the new controller is deterministic. Nothing is
emitted when the defender holds, even after a costly battle.

### 6. The reserve cost

A strength point is a share of a formation, and the per-type monthly upkeep is
the engine's existing proxy for how large that formation is. For every unit
that lost points (and, at its full current strength, every unit destroyed):

```
manpower = UNIT_UPKEEP[type].manpower * lostPoints / 100 * COMBAT_POOL_FACTOR
materiel = UNIT_UPKEEP[type].materiel * lostPoints / 100 * COMBAT_POOL_FACTOR
```

The cost is charged to the polity that owns the unit. `COMBAT_POOL_FACTOR` is
the single calibration constant that converts a month of upkeep into a one-shot
battle cost; it is first-draft, and the tests assert the zero floor and the
determinism, not a magnitude.

The deduction is applied to `economyEngine.pools` with the absolute zero floor
the first increment established: each pool is `Math.max(0, pool - cost)`, never
negative. The `forces` mirror on `countryStats` is refreshed in the same write
so the panel shows the post-battle reserve without waiting for the next month.

### 7. The seams, and the one authority

The resolution runs inside the turn that applies the events, over the world the
applier is about to receive, so the battle is fought against the pre-turn
roster (section 3).

For each resolved engagement, the adapter returns:

- `unitOps`: one `strength` op per surviving damaged unit and one `remove` op
  per destroyed unit. Merged into `event.impacts.unitOps`, they are applied by
  `applyUnitOpBatch` through the same door every narrated op uses, with the
  same `updatedAt` stamp.
- `regionControlOps`: the single control entry of section 5, merged into
  `event.impacts.regionControlOps` and applied by
  `applyPolityAndTerritoryImpacts`.
- `reserveCost`: applied after `applyEventImpactsToWorld`, by the adapter,
  to the reserve record.

**One authority over the result.** Once an engagement is resolved, the turn
drops, for that event and that region only, the model's own
`regionControlOps`/`regionTransfers` targeting the region, and the model's own
`strength`/`remove` unit ops on the event. The model keeps the `move` and
`spawn` ops that put forces on the map; the engine is the only writer of the
numbers and of the ownership outcome. Without the territory drop, the model and
the engine could write opposite results for the same province; without the
strength drop, the model's narrated casualties would be charged twice.

Dropping an op never drops the event: the event stands as history and the
receipt records what the engine substituted.

### 8. Persistence

The only new persisted field is `combatRegion` on an event, normalized and
round-tripped like `warId`. Every result of a resolution is consumed in the
turn that produced it:

- `strength`, `remove` and control are written into existing world fields;
- the reserve cost is written into the existing `economyEngine.pools`.

There is no new engine record, no new `economyEngine` field, no `ENGINE_VERSION`
raise and no migration. An old save opens with events that carry no
`combatRegion`, which is exactly "not resolvable", and behaves as before.

### 9. Visibility

No new panel is introduced. Casualties are visible on the existing unit roster
and the Forces panel, control on the map, and the narrative in the event. The
application receipt gains one line per resolved engagement, in the style of the
existing salvage notes:

```
"Battle of <region>" (<war title>): <n> casualties on <side>, <m> formations
destroyed; <province> fell to <polity> / <province> held.
```

A resolved engagement always produces one such line; an unresolvable
declaration (no units on a side, no region) produces a note saying why it was
left as narrative. This is the same receipt the next turn already reads, so the
model learns what the engine did without a second channel.

### 10. The model's role, and the guards

The model owns the WHAT: that a battle happened, between which belligerents, in
which region, and the prose around it. It does not own a single number that
decides the battle.

A model attempt to write `strength` or `remove` for a resolved engagement is
dropped (section 7), so a convenient "the enemy was annihilated" cannot be
written onto the roster. A model attempt to hand a province to the wrong side
in the same event is dropped for that region. A declaration that names a side
not on the field resolves nothing. The engine resolves only when the ledger
binds the event to an active war, both sides are present, and the region
resolves; otherwise the event stays narrative.

### 11. Interaction with the earlier increments

- **The economy** is untouched except that the reserve record it owns can be
  charged between its monthly steps. The pools keep their zero floor.
- **The force pools** are the consumer this increment was built for; the
  per-type upkeep table is reused as the size proxy, so no second table exists.
- **The production line** is untouched: a destroyed formation is erased from
  the roster, never refunded or rebuilt automatically.
- **Research effects** are untouched: the research target table has no combat
  domain, and this increment adds none. A later increment may add a combat
  domain; this one does not.

## Compatibility

- No new runtime dependency, no `package.json` change.
- One new event field, normalized on read and written verbatim, so an old event
  and an old save open unchanged.
- No new engine record and no migration; the ambient world fields the result
  uses already exist.
- The existing unit-op and control-op normalizers are reused unchanged.
- Existing tests are not edited to accommodate the change; new tests assert the
  new behavior.

## Testing

- **Core** (`src/engine/combat.test.js`): the type weights and the mobilization
  multipliers are total over their enums and ordered as documented;
  `engagementRoll` is stable for a key and differs across keys; the same
  engagement key always yields the same adjusted powers; a tie is held by the
  defender; the loss fraction sits between the floor and the cap and is larger
  for the weaker side; a losing unit below the threshold is destroyed and a
  winning unit at the same strength is not; the control threshold fires exactly
  when the defender's share is below it.
- **Adapter** (`src/runtime/combatEngagements.test.js`): the two sides are
  gathered by region and by ledger side, not by the order of `combatants`; a
  side with no unit in the region resolves nothing; the mobilization posture is
  read per polity; the reserve cost is charged to the owner and floored at
  zero; the control target is the first winning combatant in side order.
- **Wiring** (`src/Game/AI/gameplay` or a sibling guard): the adapter runs over
  the pre-turn world; its `unitOps` and `regionControlOps` are merged before
  `applyEventImpactsToWorld`; the model's `strength`/`remove` and its
  region-targeted territory ops are dropped for a resolved event and kept for
  an unresolved one; the reserve cost is applied to `economyEngine.pools` and
  mirrored to `forces`.
- **Persistence** (`src/runtime/gameState.test.js` or a sibling):
  `combatRegion` round-trips, is absent on an old event, and a save without it
  normalizes unchanged.
- **Purity**: `enginePurity.test.js` already scans the directory, so it covers
  `combat.js` with no new test; `combat.js` imports nothing.

## Acceptance

The increment is done when a turn that declares a battle between belligerents
of an active war, in a named region, against forces the engine can find there,
produces the same casualties and the same control outcome on every replay of
the same turn; when the losing formations lose more strength than the winning
ones and a broken formation is removed; when both sides' reserves fall by the
cost of their losses and never below zero; when the province changes hands only
when the defender breaks and otherwise holds; when a model attempt to write the
casualties or the ownership of a resolved battle has no effect; when an
unresolvable declaration stays narrative with a receipt note and no invented
losses; when the result appears in the application receipt; and when an
unmodified campaign and the existing suite are numerically unchanged.

## Open questions

None block implementation. The following are deliberately deferred and recorded
so the plan does not silently decide them.

- The exact constants (`TYPE_WEIGHT`, the mobilization multipliers, the loss
  base and bounds, `CONTROL_THRESHOLD`, `COMBAT_POOL_FACTOR`) are first-draft
  calibration and are expected to be tuned against a few campaigns. The tests
  assert ordering, bounds and determinism, never a magnitude.
- Whether a battle should be resolved against the roster after the event's own
  move ops (so a force ordered into the region this turn fights now) is a later
  refinement; this increment uses the pre-turn snapshot.
- Whether a combat research domain should exist is a later research decision;
  this increment adds none.
- Whether the player should be able to order an engagement directly, rather
  than declare it through the narration, is a UI decision for a later increment
  and does not change the engine contract.
