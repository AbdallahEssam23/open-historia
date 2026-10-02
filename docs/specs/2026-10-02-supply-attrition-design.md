<!-- Open Historia - deterministic supply and attrition (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# Supply and Attrition: the Operational Layer of a War (part two)

The eighth increment of the deterministic simulation, and the second of three
parts. The sixth increment gave a war goals, a weariness and an end; the seventh
gave it a shape, deriving the front lines and the contested ground from
effective control and adjacency. This one gives the shape a *cost*: a pure
function walks the graph the seventh increment already reads, asks whether each
formation can trace a line of supply back to its own homeland, and returns the
supply state and the attrition that follows. The adapter applies the losses
through the unit seam the battles already use, before the economy advances.
Nothing new is stored and no new currency is created.

## Why this increment exists

1. **A war has a shape and no wear.** Part one derived which borders are
   hostile and where opposing forces stand. Nothing yet makes holding a front,
   or standing behind one, cost a formation anything. A unit on the map is
   immortal until a declared battle names it.
2. **Supply is a graph question over data that already exists.** A formation is
   supplied when a path of its own side's controlled regions runs from where it
   stands back to ground its own polity holds as home. A formation is isolated
   when no such path exists. Encirclement and siege are the same predicate
   applied to a pocket; no new map field and no new control rule is needed.
3. **The economic surface is already there.** `manpower` and `materiel` are
   stepped every month and a flat `UNIT_UPKEEP` is already charged off the
   roster. That upkeep is the *economic* cost of an army; this increment adds
   the *operational* cost, and reads the same roster and the same control the
   earlier increments read. It introduces no currency, no stockpile and no
   third reserve.

This specification delivers **supply state and per-turn attrition**: a pure core
that classifies every placed formation as `supplied`, `strained` or `isolated`,
and returns the strength each formation loses this period and whether it
collapses, plus an adapter that reads the world and the catalog into the core's
plain inputs and translates the result into the unit ops the turn already
applies. It is not reinforcement, not rotation, not merging, and not a naval or
air supply rule; none of those is built here.

## Goals

- A pure function classifies each placed formation from active wars, effective
  control, a region's home owner, adjacency and the roster, and returns the same
  answer byte for byte for the same inputs in a fresh process.
- Attrition scales with the period: a formation loses its state's rate per whole
  month the turn spans, so a one-day turn costs nothing and a long time skip
  costs a long siege.
- Losses are applied to the world, through the same unit seam the combat
  resolver already uses, before the economy advances; a collapse removes the
  formation. The engine never writes a supply field and never invents a unit.
- Only a belligerent suffers attrition. A polity that is not on a side of any
  active war is reported by state but loses nothing, so a peacetime garrison is
  never worn down by standing where it stands.
- The engine owns the graph walk and the arithmetic; the adapter only reads the
  world and the catalog into plain inputs and maps the result to unit ops.
- `src/runtime/` remains the only layer that touches the world; the core imports
  no browser global and no `src/Game/AI/` module.
- No new runtime dependency, no new panel, no new event field and no change to
  the prompt layer.

## Non-goals

- **Reinforcement, rotation and merging.** These are part three. A unit is worn
  down here; it is never rebuilt, moved to the rear or folded into another.
- **A new currency or a per-unit supply stockpile.** The existing
  `manpower`/`materiel` reserves and `UNIT_UPKEEP` are the only economic
  surface. Attrition is a readiness loss, not a depot draw, so it charges no
  reserve.
- **Allied supply.** A formation draws only on regions its own polity controls.
  Coalition logistics is a later refinement, recorded under open questions.
- **Naval, air and strategic supply.** Sea zones and airspaces are not modelled
  as supply nodes; the catalog the adapter is given is the whole graph.
- **A stored supply field.** Supply is derived on demand; a save carries none
  and needs no migration and no `ENGINE_VERSION` bump.
- **A player-facing or model-facing surface.** No panel, no map layer, no
  receipt line and no prompt change is added.

## Design

### 1. Layers

The same three layers and the same direction of dependency the seven earlier
increments established.

| Layer | Location | Rule in this increment |
|---|---|---|
| Pure core | `src/engine/supplyAttrition.js` (new) | `deriveSupplyAttrition`: the control map, the supply walk, the contact lookup, the state ladder and the loss arithmetic. Imports only the sibling `./frontLines.js` for the contact roles, so `enginePurity` holds. No browser import, no `Date.now`, no `Math.random`, no world mutation. |
| Adapter | `src/runtime/supplyAttrition.js` (new) | `readSupplyAttrition(world, catalog, { fromDate, toDate })`: reads `world.wars`, `world.units` and the catalog, computes whole months with the shared `monthsBetweenDates`, calls the core and maps the result to unit ops. Reads only; writes nothing. |
| Shared read | `src/runtime/regionOwners.js` (existing) | The one definition of effective control, already shared by the prompt vocabulary and part one. This increment reads it a second time for the base (home) owner, so supply and the front line agree on which polity holds a region. |

The core is a separate file from `engine/frontLines.js` because it answers a
different question, even though it reads the sibling's answer: `frontLines.js`
says where two sides touch; `supplyAttrition.js` says whether each formation can
be sustained there. It imports the sibling rather than re-deriving contact, so a
front line and a front-line loss can never disagree about which regions are in
contact.

### 2. What supply and attrition mean

Every term is stated in vocabulary an earlier increment already fixed.

- **Effective control.** A region is controlled by
  `regionOwnershipOverrides[id] ?? region.country`, canonicalized to the full
  country name by `regionOwnerName`. This is part one's definition, unchanged.
- **Home owner.** A region's base owner is `regionOwnerName(region, {})`: the
  catalog's own country, ignoring every override. A region is a polity's *home*
  only while that polity still controls it, so lost homeland soil is not a
  source.
- **Belligerent.** A polity is a belligerent when it appears on `sideA` or
  `sideB` of at least one `active` war, compared case-insensitively on the
  trimmed name. A `ceasefire` or `ended` war makes no belligerent, matching the
  ledger, the combat adapter and part one.
- **Supplied network.** For one polity, its supplied network is the union of the
  connected components of the regions it controls that contain at least one of
  its own home regions. In words: supply flows through ground you hold, from the
  home soil you still hold. A sphere of conquest with no home region left to
  anchor it is not a supply network.
- **Contact.** A region is in contact when part one's per-region index gives it
  the role `front` or `contested`: it is a side of a hostile border, or opposing
  forces stand in it.

From those facts, each placed formation is given exactly one state:

| State | Condition | Meaning |
|---|---|---|
| `supplied` | Its region is in its owner's supplied network and is not in contact. | The line runs home and nothing is shooting at it. |
| `strained` | Its region is in the network but in contact, or its region is not in the network yet is adjacent to it. | A front or a forward position: fed, but under friction. |
| `isolated` | Its region is neither in the network nor adjacent to it. | Encirclement or a severed line: the pocket. |

Attrition is a rate per whole month, applied only to a belligerent:

| State | Strength points lost per month |
|---|---|
| `supplied` | 0 |
| `strained` | 2 |
| `isolated` | 10 |

A formation's next strength is its current strength minus `rate * months`,
floored at zero. A formation whose next strength reaches zero collapses and is
removed. First-draft calibration: the tests assert ordering among the three
states and the direction of the period multiplier, never a magnitude, exactly
as `forcePools.js` states for its own constants.

### 3. The graph walk

The core builds the graph once and answers every unit's question against it.

1. Build the effective controller map and the undirected neighbourhood exactly
   as part one does: an ownerless row is skipped, a self-adjacency and an
   adjacency to an unknown region are ignored, and an adjacency listed one way
   yields the edge both ways.
2. Fold the active wars and record the set of belligerent polities. A war that
   is not `active`, or that lists a polity on both sides, contributes no new
   belligerent.
3. Mark the home regions: every region whose base owner and effective controller
   fold to the same non-empty polity. These are the supply sources.
4. For each owner that has at least one placed unit, compute its supplied
   network lazily and cache it: a breadth-first walk seeded by that owner's
   sources and expanding only through regions that owner controls. Two owners
   never share a network, and no region enters another owner's walk.
5. Ask part one for the contact roles, passing the same wars, units and regions
   so the two layers see one graph.
6. Classify each placed unit by the state ladder above, then compute its loss
   and collapse from the period in whole months.

The walk is a function of the data alone: the seed set is derived from home
control, the expansion is over a bounded region set, and the output is sorted
afterwards, so a `Map` or `Set` iteration order never leaks into the result.

### 4. The core (`src/engine/supplyAttrition.js`)

The core is given plain data and returns plain data; it never sees a `world`.

```
deriveSupplyAttrition({
  wars,     // [{ id, status, sideA: [name], sideB: [name] }]
  units,    // [{ id, ownerCode, regionId, strength }]
  regions,  // [{ id, controller, home, adjacencies: [regionId] }]
  months,   // whole months this turn spans, a non-negative integer
})
```

It returns:

```
{
  units: [
    {
      unitId, ownerCode, regionId,
      state,          // "supplied" | "strained" | "isolated"
      belligerent,    // boolean
      reachable,      // region in the owner's supplied network
      contact,        // region has role "front" or "contested"
      loss,           // strength points lost this period
      nextStrength,   // max(0, strength - loss)
      destroyed,      // loss > 0 and nextStrength reached 0
    },
  ],
  summary: {
    supplied, strained, isolated,   // unit counts by state
    damaged, destroyed,             // units with a loss, and units removed
  },
}
```

Rules the core enforces:

- A unit needs an id, a non-empty owner and a region that the graph knows; a
  unit missing any of them is skipped, never thrown on.
- Duplicate unit rows fold by id, first one winning, because a unit is one
  formation.
- `ownerCode` matching is case-insensitive on the trimmed name, the same folded
  key part one and the ledger use; the reported `ownerCode` is the roster's own
  spelling.
- The state ladder is evaluated in the order `supplied`, `strained`, `isolated`;
  the three conditions are mutually exclusive, so a unit gets exactly one state.
- `loss` is zero when the unit is not a belligerent, when `months` is zero, or
  when its rate is zero; `destroyed` is never true on a zero `loss`.
- The unit list is ordered by `unitId` by plain code-unit comparison, so the
  result is independent of roster order.
- Empty inputs yield the empty shape (`units: []` and all-zero summary), not a
  throw.

### 5. The adapter (`src/runtime/supplyAttrition.js`)

`readSupplyAttrition(world, catalog, { fromDate, toDate })` is a pure read. It:

1. reads `world.wars`, `world.units` and the catalog defensively as lists (a
   missing or malformed entry is skipped, never thrown on);
2. computes `months = max(0, monthsBetweenDates(fromDate, toDate))`, the same
   whole-month step the economy uses, so a one-day turn is a zero-month turn;
3. builds `regions` from the catalog, each row carrying its `id`, its effective
   controller through `regionOwnerName(row, overrides)`, its base home owner
   through `regionOwnerName(row, {})`, and its `adjacencies`;
4. calls `deriveSupplyAttrition` and maps its units to ops: a collapsed unit
   becomes `{ op: "remove", unitId }`, and any other unit with a loss becomes
   `{ op: "strength", unitId, strength: nextStrength }`;
5. returns `{ units, ops, summary }`, where `summary` is the core's summary plus
   `opCount`, the number of ops it built.

It never calls `normalizeWorldState`, never writes to `world`, never charges a
reserve and never imports anything under `src/Game/AI/`. The turn's normalizer
already owns the shape of `world`; this adapter tolerates a raw read because the
derivation is applied through the same normalizing applier every other op uses.

### 6. Where it runs in the turn

The attrition step is a consequence of the same turn's battles, so it runs in
`applySimulationResult` (`src/Game/AI/gameplay.js`) immediately after the
combat reserve cost is applied and before the economy advances:

1. read the region catalog already primed for this turn;
2. call `readSupplyAttrition` with the post-impact world and the turn's
   `baseGame.gameDate` -> `nextGame.gameDate` span;
3. when the adapter returned any op, apply them through
   `applyEventImpactsToWorld` as a board-only synthetic event, exactly as the
   production and research completions are applied, so the ops travel the one
   unit path and no narrative event is written;
4. take the returned world and colours forward.

The whole step is wrapped so a failure never loses a completed turn: the events
and the date are already correct, and the supply step is simply skipped for that
turn, and the skipped period is not replayed later. The economy keeps its own
place at the end of the turn and its own one-period lag; attrition changes
readiness, not the upkeep charged this period.

### 7. Determinism and edges

The core is a total, order-independent function of its inputs. Ordering is by
plain code-unit comparison (`a < b`), never `localeCompare`, so the same inputs
give the same byte sequence on any machine. No clock, no entropy, no iteration
over an unordered `Map` or `Set` without an explicit sort before output. The
period arrives as a number, so the core itself never reads a date.

Known edges:

- An empty or absent catalog leaves every region unknown, so every placed unit
  is skipped and the pass yields no ops; an unknown region is never treated as
  `isolated`.
- A region with no resolvable home owner is never a source, but it can still be
  controlled and can therefore carry supply.
- A polity with no home region it still controls has no source and no network,
  so every one of its placed units is `isolated`. A government in exile is
  handled the same way; see open questions.
- A unit with no `regionId`, an unknown region or a malformed row is skipped.
- `months` of zero makes every loss zero, so a same-day turn leaves the roster
  untouched.
- A malformed war, unit or region row is skipped, never thrown on.

## Testing

`src/engine/supplyAttrition.test.js` (pure, no imports beyond the core):

- A unit standing on its own home region connected to a source -> `supplied`
  with a zero loss.
- A unit in an owner-controlled region cut off from every source -> `isolated`
  with the isolated rate for one month.
- A unit in a region the owner does not control but that is adjacent to the
  supplied network -> `strained`.
- A supplied unit standing on a `front` or `contested` region -> `strained`.
- A non-belligerent owner's cut-off unit -> reported `isolated` with a zero loss
  and no `destroyed`.
- The period multiplier: zero months loses nothing, and three months costs three
  times one month, with `nextStrength` floored at zero.
- A unit whose next strength reaches zero -> `destroyed` true and present in the
  summary's `destroyed` count.
- A polity whose home region is occupied (controlled by an enemy) -> no source,
  so its units are `isolated`.
- Adjacency listed one way, and a self-adjacency -> symmetric walk, self
  ignored.
- Duplicate unit rows -> one result, first spelling winning.
- Empty inputs -> the empty result shape, not a throw.
- Byte-for-byte determinism: the same input serialized twice is identical, and
  reordering the wars, units and regions arrays does not change the result.

`src/runtime/supplyAttrition.test.js` (the adapter seam):

- A composite world (an active war, a home network, a pocket, a forward unit,
  units with and without `regionId`, an override for one region) with a small
  catalog -> the expected states, ops and summary.
- An ownership override changes effective control and therefore the state.
- The adapter leaves the world and the catalog unmodified.
- A zero-month span yields no ops.
- The adapter imports no `src/Game/AI/` module (source-text guard).

`src/runtime/supplyAttritionWiringArchitecture.test.js` (the wiring guard):

- The turn calls `readSupplyAttrition` after the combat reserve cost and before
  `advanceWorldEconomy`.
- The turn applies the attrition ops through `applyEventImpactsToWorld` as a
  board-only synthetic event.

`enginePurity.test.js` continues to pass with the new engine file present.

## Acceptance

The whole suite passes with zero failures, `node --test "src/engine/*.test.js"`
and `node --test "src/runtime/*.test.js"` pass, ESLint is clean on the new
files, `npm run wiki:check` reports `Wiki is current.` after any documentation
is regenerated, and `npm run build` succeeds. No `ENGINE_VERSION` bump, no
migration, no `world` field and no new `package.json` entry is introduced.

## Open questions

None block implementation. The following are deliberately deferred and recorded
so the plan does not silently decide them.

- Whether a formation should draw supply from an ally's controlled regions, not
  only its own polity's, is left to the war model; this increment reads only the
  owner.
- Whether attrition should escalate the longer a pocket stays cut off, beyond
  the linear period multiplier, needs a stored counter and is deferred with the
  rest of the stored-state work.
- Whether a government whose homeland is entirely occupied should still supply
  from its largest held component is a modelling decision; this increment says
  no source, no network.
- Whether the rates should vary by unit type (armor thirstier than infantry) is
  a later refinement; this increment uses one ladder for every type.
- Whether attrition should also charge the manpower or materiel reserves, as
  the combat reserve cost does, is deferred; this increment charges readiness
  only.
- Whether naval and air regions are supply nodes is a modelling decision for the
  naval increment; this increment treats the catalog it is given as the whole
  graph.
