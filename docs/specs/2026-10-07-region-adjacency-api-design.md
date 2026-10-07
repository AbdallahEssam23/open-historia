# Region Adjacency API: One Pure Contiguity Graph

> Status: design accepted for implementation. Wave 1, item 1 of
> `docs/specs/2026-10-07-grand-strategy-roadmap-design.md`.

## Problem

Region contiguity is computed in more than one place and in more than one way:

- `src/Game/AI/lookupTools.js` builds a bidirectional declared-adjacency map and
  a bounding-box fallback, caches it, and exposes it to the model through
  `region_info`, `map_around`, `border_between` and `path_between`.
- `src/runtime/frontLines.js` and `src/runtime/supplyAttrition.js` each read
  `adjacencies` from the catalog and hand a plain list to their own pure cores.

The declared-adjacency-and-bbox rule lives only inside the AI layer, so the turn
and the war engines cannot reuse it, and any future caller has to re-derive it.
There is no single, tested answer to "who does this power border".

## Goal

One pure engine module owns the contiguity graph. One runtime adapter binds it to
the world's ownership and answers `getContiguousNeighbors(world, catalog,
polityId)`. The AI lookup tools consume the engine graph directly instead of
carrying their own copy. Behavior is unchanged: the same regions, the same order,
the same declared-over-bbox precedence.

## Non-goals

- No new dependency. The graph is arithmetic and set logic.
- No real polygon clipping or geodesic distance. The bbox over-approximation is
  kept exactly as it is today; improving precision is a separate, evidence-led
  decision.
- No change to `frontLines.js`, `supplyAttrition.js` or `reinforcement.js` in this
  increment. They keep their current inputs; adopting the shared graph is a
  follow-up once the interface is proven.
- No new prompt or event field.

## Architecture

### Pure core: `src/engine/regionAdjacency.js`

Import-free and pure, like every other engine module. It knows regions by id and
geometry, nothing about owners or the world.

```
ADJACENCY_GAP_DEGREES = 0.05

geometryBounds(geometry) -> [minX, minY, maxX, maxY] | null
bboxesTouch(a, b) -> boolean

buildRegionAdjacency(rows) -> {
  size,
  has(id) -> boolean,
  neighborsOf(id) -> string[],
  areNeighbors(a, b) -> boolean,
  neighborsWithin(id, steps) -> string[],
}
```

`rows` is `[{ id, adjacencies?: string[], geometry?: object, bbox?: number[] }]`.
A row's bbox is its own `bbox` when present, else `geometryBounds(geometry)`.

Rules, byte-for-byte the ones `lookupTools.js` applies today:

1. A declared adjacency is bidirectional and only counts between ids that exist
   in `rows`, never a region with itself. Declaration order is preserved.
2. A region that declares any adjacency uses **only** its declared set. This
   matches the current precedence: once a row is in the declared map, its bbox is
   never consulted, even for a region that only appears because another region
   declared it.
3. A region with no declared adjacency falls back to every other region whose
   bbox touches its own within `ADJACENCY_GAP_DEGREES`, in catalog order. A region
   with neither a declaration nor a bbox has no neighbours.
4. `neighborsWithin(id, steps)` is a breadth-first walk over rule 2/3, nearest
   first, excluding the start region; `steps` is clamped to a sane integer.

### Runtime adapter: `src/runtime/regionAdjacency.js`

Binds the graph to ownership; imports only runtime and engine modules, never the
AI layer (same rule `regionOwners.js` states).

```
readRegionAdjacency(world, catalog) -> { graph, ownerOf(id), rowsById }
getContiguousNeighbors(world, catalog, polityId) -> {
  polity,
  regions: string[],              // the polity's own regions, catalog order
  neighbours: [{ regionId, owner }], // bordering regions held by anyone else
  polities: string[],             // distinct bordering owners, order of first appearance
}
```

Ownership resolves through `regionOwnerName(row, overrides)` and then
`createOwnerResolver(buildOwnerAliasMap(world.polityOverrides))`, exactly as
`frontLines.js` and `supplyAttrition.js` already do, so a renamed polity and a
legacy code both fold onto the name the units use. `polityId` is matched after
the same resolution, case-insensitively, so a caller may pass a name, an alias or
a legacy code. An unknown polity returns empty lists, not an error.

### War-declaration gate (delivered with this increment)

The graph is wired into the strategic menu so a power cannot declare a war the
map cannot reach:

- `src/Game/AI/gameplay.js` `buildStrategicRegionOptions` now carries each
  region's `adjacencies`, `bounds` and `type` (coastal) from the primed catalog.
- `src/runtime/opponentContext.js` classifies each target's `reach`:
  `contiguous` (a shared land border), `coalition` (the target borders a
  co-belligerent on the actor's side of an active war), `overseas` (both the
  actor and the target hold coast, so a sea route exists), else `unreachable`.
  Geography gates only when the catalog actually carries some (a declared
  adjacency anywhere, or a coastal flag); a scenario with none leaves every
  target unclassified and the menu unchanged.
- `src/engine/strategicIntent.js` `deriveIntentMenu` refuses a target whose
  `reach` is `unreachable` and passes a known `reach` through to the menu entry.
  An unclassified target (no `reach` key) stays legal, so `deriveIntentMenu` is
  inert without geography.

This blocks the arbitrary jump - a war across the map with no shared border, no
ally's front and no sea route - while keeping the existing legal cases. The menu
directive prints the `reach` beside a declaration so the model reads why it is
legal.

## Data flow

```
catalog rows + world.regionOwnershipOverrides + polityOverrides
        │
        ▼
readRegionAdjacency  ──►  engine graph (ids)
        │                        ▲
        ▼                        │
getContiguousNeighbors   lookupTools.buildLookupContext (rows mapped from ids)
```

## Error handling

- An empty or malformed catalog builds an empty graph; every query returns empty.
- A duplicate id keeps the first row, matching `byId` semantics in `lookupTools`.
- A self-declared adjacency and a declared id that does not exist are ignored.
- `neighborsWithin` treats a non-finite or negative `steps` as 0.

## Testing

- `src/engine/regionAdjacency.test.js`: declaration is bidirectional and
  order-stable; declared wins over bbox; bbox fallback touches within the gap and
  not beyond; a bbox-only region whose neighbour declared it still uses the
  declared set; unknown ids and self are ignored; `neighborsWithin` breadth-first
  order, exclusion of the start, and the `steps` clamp; `geometryBounds` on
  Polygon and MultiPolygon.
- `src/runtime/regionAdjacency.test.js`: declared adjacency resolves through a
  renamed polity (alias); `getContiguousNeighbors` returns the home regions, the
  bordering regions with owners, and the distinct bordering polities; an unknown
  polity returns empty; a bbox-only catalog still answers.
- `src/Game/AI/lookupAudience.test.js` and `lookupPlacesNamed.test.js` stay green:
  the refactor must not change `buildLookupContext` or `executeLookup` behavior.

## Success criteria

- One implementation of the contiguity rule, in the engine, used by the AI lookup
  context and available to the turn through `getContiguousNeighbors`.
- All existing tests pass unchanged; the full suite stays green (3238+).
- No new runtime dependency and no measurable bundle growth for the increment.

## Follow-ups (not this increment)

- Have `frontLines.js`, `supplyAttrition.js` and `reinforcement.js` take the
  shared graph instead of their own `adjacencies` lists.
- Use `getContiguousNeighbors` to seed expansion scoring and reinforcement
  reach, beyond the declaration gate shipped here.
