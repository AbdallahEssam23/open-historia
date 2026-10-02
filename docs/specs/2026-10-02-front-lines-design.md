<!-- Open Historia - deterministic front lines (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# Front Lines: the Operational Layer of a War (part one)

The seventh increment of the deterministic simulation, and the first of three
parts. The first increment built the reserves and the manpower pools; the second
built the production and construction line; the third gave research a clock, a
cost and a rate; the fourth made a completed programme change the simulation;
the fifth made the reserves and the roster fight a declared battle; the sixth
gave a war goals, a weariness and an end. This one gives a war a *shape*: a pure
function reads who controls which region and where the two sides of an active
war touch, and returns the front lines, the contested ground, and the same facts
grouped by war. Nothing is written and nothing is spent; the layer is derived on
demand.

## Why this increment exists

1. **A war has arithmetic and no geography.** The fifth increment resolves one
   declared battle, and the sixth measures the whole war over time, but neither
   knows where the war *is*. They read a roster and a ledger; they never read
   the map as a graph. A war with two armies facing each other across one border
   and a war with two armies a continent apart have identical standing.
2. **The next increment needs the contact.** Attrition and supply (part two)
   are defined by *who touches whom* and *who is cut off*. Both of those
   questions are graph questions over control and adjacency, and neither is
   answerable until the graph is derived. Building the derivation first, alone,
   keeps it small enough to test exhaustively.
3. **Every input already exists.** Effective control is
   `regionOwnershipOverrides[id] ?? region.country`, already read this way for
   prompts by `regionOwnerName` (`src/Game/AI/regionVocab.js`); adjacency is the
   catalog's own `adjacencies`; the belligerents are `world.wars`
   (`sideA`/`sideB`); a unit's region is `unit.regionId`, already the field the
   combat adapter matches on. This increment adds no mutation vocabulary and no
   stored state, only a core that reads what is there.

This specification delivers **front-line derivation**: a pure core that turns
active wars, effective control and region adjacency into an ordered `edges` list
(the hostile borders), a `contested` list (regions where opposing forces stand),
the same facts grouped `byWar`, and a per-region index. It is not attrition, not
supply, not a movement rule, not a zone of control, and not a map overlay; none
of those is built here.

## Goals

- A pure function derives, from active wars, effective control and adjacency,
  the front-line edges and the contested regions, byte for byte the same for the
  same inputs in a fresh process.
- The derivation never writes world state and never needs a saved field: the
  same output is produced wherever it is asked for, and there is no normalizer,
  no migration and no `ENGINE_VERSION` bump.
- The what-is-hostile rule is the ledger's own: two polities are enemies only
  inside one `active` war, compared case-insensitively, never across different
  wars and never against a polity on the same side or outside every war.
- The engine owns the graph work (folding sides, walking adjacency, deduping,
  ordering); the adapter only reads the world and the catalog into the core's
  plain inputs.
- `src/runtime/` remains the only layer that touches the world; the adapter
  reads it and returns the derivation, and the deterministic layer imports no
  `src/Game/AI/` module.
- No new runtime dependency, no new panel, no new event field, no change to the
  turn, to the prompts or to any map renderer.

## Non-goals

- **Attrition, supply, encirclement and reinforcement.** These are parts two
  and three. This increment computes the contact they will read; it produces no
  loss, no cost and no order.
- **Zones of control and movement blocking.** A front line exists where two
  hostile sides *meet*; a mere army in a friendly province projects nothing and
  forbids nothing.
- **Ceasefires and ended wars.** Only a war whose status is `active` makes two
  polities enemies here; a `ceasefire` or `ended` war contributes no edge and no
  contested region, matching how the ledger and the combat adapter already
  screen for `active`.
- **Legal claims are not fronts.** A `regionClaims` entry is a legal dispute
  with no army on the ground; it is not a front line. A border is hostile only
  when two *active* belligerents actually hold its two sides.
- **Stored or persisted fronts.** The derivation is a read, never a field in
  `world`; a save carries none and needs no migration.
- **A player-facing or model-facing surface.** No panel, no map layer, no
  receipt line and no lookup tool is added; the first real consumer is part two.
- **Occupation as a state or a map recolouring.** Control is read, never
  changed. A region's colour and its `regionOwnershipOverrides` entry are
  untouched.

## Design

### 1. Layers

The same three layers and the same direction of dependency the six earlier
increments established.

| Layer | Location | Rule in this increment |
|---|---|---|
| Pure core | `src/engine/frontLines.js` (new) | `deriveFrontLines`, the enemy-pair fold, the adjacency walk, the ordering and the per-region index. Needs no shared helper, so it imports nothing and stays inside the engine purity allow-list. No browser import, no `Date.now`, no `Math.random`, no world mutation. |
| Adapter | `src/runtime/frontLines.js` (new) | `readFrontLines(world, catalog)`: reads `world.wars` and `world.units`, builds each region's effective controller, pairs it with the catalog's `adjacencies`, calls the core and returns the result unchanged. Reads only; writes nothing. |
| Shared read | `src/runtime/regionOwners.js` (new) | `regionOwnerName(region, overrides)`, moved verbatim out of `src/Game/AI/regionVocab.js` so the adapter shares one definition of effective control without importing the AI layer. `regionVocab.js` re-exports it, so `forcePosture.js` and the existing test are unchanged. |

The core is a separate file from `engine/combat.js` and
`engine/warSettlement.js` because it answers a third question: `combat.js`
resolves one battle between two present forces, `warSettlement.js` weighs a war
over time, and `frontLines.js` looks at where the war sits on the map. They
share no arithmetic, so they share no file.

### 2. What makes a front

Two definitions, both stated in the ledger's own vocabulary:

- **Effective control.** A region is controlled by
  `regionOwnershipOverrides[id] ?? region.country` (or `region.countryCode`),
  canonicalized to the full country name. This is exactly what
  `regionOwnerName` already returns and what the prompt vocabulary already
  shows the model, so a front line and the names in a prompt can never
  disagree.
- **Enemy pair.** Two polities are enemies when one is on `sideA` and the other
  on `sideB` of the *same* `active` war. Membership is compared
  case-insensitively on the trimmed name, the same folded key the ledger and
  the combat adapter use. A polity is never its own enemy, two polities on one
  side are never enemies, and two polities in different wars are never enemies
  through those wars alone.

From those two facts:

- A **front edge** is an adjacent pair of regions whose effective controllers
  form an enemy pair in at least one active war. It carries the controllers of
  its two sides and every active war that makes the pair hostile.
- A **contested region** is a region where units of two enemy polities are both
  present, regardless of who controls it. Presence is read from
  `unit.regionId`, exactly as the combat adapter already matches a unit to its
  field; a unit with no `regionId` is not placed and does not contest anything.
  A region can be contested under more than one war at once, so contestedness is
  reported per region and per war, never merged across wars: the two sides of a
  war are not the two sides of another.

A region may be both front and contested, and is then reported in both lists;
the per-region index records both roles.

### 3. The core (`src/engine/frontLines.js`)

The core is given plain data and returns plain data; it never sees a `world`.

```
deriveFrontLines({
  wars,     // [{ id, status, sideA: [name], sideB: [name] }]
  units,    // [{ ownerCode, regionId }]
  regions,  // [{ id, controller, adjacencies: [regionId] }]
})
```

It returns:

```
{
  edges:     [{ regionA, regionB, polityA, polityB, warIds: [warId] }],
  contested: [{ regionId, warId, controller, sideA: [polity], sideB: [polity] }],
  byWar:     [{ warId, sideA: [polity], sideB: [polity], edges: [[regionA, regionB]], contested: [regionId] }],
  regions:   { [regionId]: { controller, roles: ["front" | "contested"], warIds: [warId] } },
}
```

Rules the core enforces:

- An `edges` entry is emitted once per region pair, with `regionA < regionB` by
  code-unit comparison; `polityA` and `polityB` follow that order. `warIds` is
  the sorted, deduped set of active wars hostile across that pair.
- A `contested` entry is emitted once per region and per active war in which
  both sides are present. It names the distinct enemy polities present, split
  into that war's own `sideA`/`sideB`, in the spelling the roster carries them.
- `byWar` lists every active war that produced at least one edge or one
  contested region, ordered by war id; its `sideA`/`sideB` are the war's own
  declared polities. A war with no contact is absent. Its `contested` is the
  deduped, ordered list of the regions that war contested.
- The `regions` index holds every region that appears in `edges` or
  `contested`, its effective controller, the union of its roles, and the sorted
  union of its war ids.
- Adjacency is undirected: a catalog row that lists a neighbour one way yields
  an edge both ways, and a self-adjacency is ignored.

### 4. The adapter (`src/runtime/frontLines.js`)

`readFrontLines(world, catalog)` is a pure read. It:

1. reads `world.wars` and `world.units` defensively as lists (a missing or
   malformed entry is skipped, never thrown on);
2. builds `regions` from the catalog, reading each row's `id`, its effective
   controller through `regionOwnerName`, and its `adjacencies` as a list of
   region ids;
3. calls `deriveFrontLines` and returns its result.

It never calls `normalizeWorldState`, never writes to `world`, and never imports
anything under `src/Game/AI/`. The turn's normalizer already owns the shape of
`world`; this adapter tolerates a raw read because the derivation is advisory to
the caller, and the caller that needs a normalized world already has one.

### 5. The shared owner read

`regionOwnerName` currently lives in `src/Game/AI/regionVocab.js` and is the one
place that defines effective control (an override wins, else the catalog's
country, canonicalized to the full name; a legacy code override is corrected
rather than handed on). The adapter needs exactly this definition, and
duplicating it would let the front line and the prompt vocabulary drift apart.
It is therefore moved to `src/runtime/regionOwners.js`, whose only import is
`./ownerNames.js`. `regionVocab.js` imports it for its own `groupByOwner` and
re-exports it, so `forcePosture.js` and the existing `regionVocab.test.js`
continue to work without change; the function's dedicated cases gain a home in
`src/runtime/regionOwners.test.js`.

### 6. Determinism and edges

The core is a total, order-independent function of its inputs. Ordering is by
plain code-unit comparison (`a < b`), never `localeCompare`, so the same inputs
give the same byte sequence on any machine. No clock, no entropy, no iteration
over an unordered `Map` or `Set` without an explicit sort before output. What
the adapter reads is the world as it stands; the derivation has no history and
no state, so asking twice gives the same answer.

Known edges:

- An empty or absent catalog yields no adjacency, so `edges` is empty; a region
  can still be `contested`, because contestedness needs no adjacency.
- A war with an empty side, or a polity listed on both sides, yields no enemy
  pair against itself; the war simply produces no edge where the self-pair
  would have been.
- A region with no resolvable controller (an unowned or ocean row) is not a
  front side and not a contested holder.
- A unit with no `regionId` never contests a region.
- A malformed war, unit or region row is skipped, never thrown on.

## Testing

`src/engine/frontLines.test.js` (pure, no imports beyond the core):

- Two adjacent regions, hostile controllers, one active war -> one edge with
  the right war id and controllers, both orderings of the input giving the same
  edge.
- A third polity controlling one region -> no edge (not an enemy pair).
- Two regions controlled by the two sides of an *ended* or *ceasefire* war ->
  no edge.
- Two polities hostile in two active wars -> one edge carrying both war ids,
  sorted.
- A contested region with units of two enemies -> one `contested` entry for
  that war with both sides; a region with units of one side only -> none.
- A region contested under two overlapping wars -> two `contested` entries,
  one per war, each with its own side split.
- A region that is both a front edge and contested -> present in both lists and
  in `regions` with both roles.
- Adjacency listed one way, and a self-adjacency -> symmetric edge, self
  ignored.
- Duplicate inputs (repeated adjacency, repeated unit, repeated war) -> deduped
  output.
- Empty inputs -> the empty result shape, not a throw.
- Byte-for-byte determinism: the same input serialized twice is identical, and
  reordering the wars, units and regions arrays does not change the result.

`src/runtime/frontLines.test.js` (the adapter seam):

- A composite world (two wars, overlapping sides, units with and without
  `regionId`, overrides for some regions) with a small catalog -> the expected
  `edges`, `contested`, `byWar` and `regions`.
- The adapter leaves the world and the catalog unmodified.
- `regionOwnerName` still resolves an override, a base country and a legacy
  code through both `regionOwners.js` and the `regionVocab.js` re-export.

`enginePurity.test.js` continues to pass with the new engine file present.

## Acceptance

The whole suite passes with zero failures, `node --test "src/engine/*.test.js"`
and `node --test "src/runtime/*.test.js"` pass, ESLint is clean on the new and
moved files, `npm run wiki:check` reports `Wiki is current.` after any
documentation is regenerated, and `npm run build` succeeds. No `ENGINE_VERSION`
bump, no migration, and no `world` field is introduced.

## Open questions

None block implementation. The following are deliberately deferred and recorded
so the plan does not silently decide them.

- Whether a front edge should be weighted by the forces facing each other (for
  ordering, or for part two's attrition) is a later refinement; this increment
  reports the edge and not a magnitude.
- Whether a region should count as contested when a belligerent's *ally* is
  present rather than the belligerent itself is left to the war model; this
  increment reads only the polities the war itself declares.
- Whether the derivation should ever be cached or mirrored to avoid recomputing
  it twice in one turn is a performance decision for part two, which will be the
  first repeated reader.
- Whether naval and air regions (a sea zone, an airspace) are nodes in this
  graph is a modelling decision for the naval increment; this increment treats
  the catalog it is given as the whole graph.
