# Coastal terrain gates naval support in the engagement core

Date: 2026-10-06
Status: approved for implementation

## Problem

The engagement core gives naval formations shore support: a side that holds the
larger share of the naval power multiplies its raw power, so a fleet fights
stronger in a battle it is already in
(`docs/specs/2026-10-05-naval-air-domain-tactics-design.md`). The rule is keyed
on the unit's declared `type` only. Nothing knows where the battle is, so a fleet
supports a battle in an inland, landlocked province exactly as well as one on the
coast. The domain increment recorded this as a non-goal: "Terrain, coasts and sea
zones. The engine has no map: the runtime region catalog carries no water flag
today, and plumbing one is a separate data-model decision."

This is that deferred increment. The data already exists: an authored scenario's
`regions.geojson` carries a `typeId` property on every feature (`coastal` or
`land`; `modern-day-copy-5` ships 1,893 coastal and 3,095 land regions). It never
reaches the engine, because three places drop it:

- `src/runtime/assets.js:1632` reads `props.type`, which no authored feature
  carries, instead of `props.typeId`, so the catalog's `type` field is always
  `""`;
- `src/Game/Map/vnext/polityBoundariesWorker.js:249` reads `props.type` the same
  way, so the map worker's records also lose it;
- the adapter (`src/runtime/combatEngagements.js`) has no terrain input at all.

The plumbing, not the rule, is the increment. `typeId` is the one official field:
`src/Editor/exportPreset.js:88` writes it, `src/Editor/regionImport.js:74`
defaults it to `land`, and `src/runtime/scenarioChanges.js:330` already reads it.

## Goals

- A battle in a non-coastal region gives no naval shore support; a battle in a
  coastal region does.
- The region's terrain reaches the core by value, so `combat.js` stays
  import-free and reads no map.
- The catalog carries the terrain it already has in its source geometry.
- A world with no coastal data at all is left exactly as it is today: the rule
  is inert when the data does not exist, so no scenario changes behaviour merely
  because the field is now read.
- The adapter stays the only place that knows about the catalog and the region
  ids; the core knows a boolean.

## Non-goals

- **Deriving the coast from geometry.** Whether a polygon touches the sea is a
  spatial computation; this increment reads the declared `typeId` instead. A
  region whose author did not classify it stays `land`, exactly as the editor
  writes it.
- **Any other terrain effect.** Only naval shore support is gated. Unit weight,
  the air edge, the anti-type factor, destruction reach and control are
  unchanged.
- **Sea zones as a battle domain.** A `water` region is not coastal; a battle
  declared there gets no shore support, the same as any other non-coastal region.
  Naval engagements in a dedicated sea zone are a later increment.
- **Backfilling the stock scenario.** `default` and the stock tile archive ship
  every region as `land`, so the rule stays inert there by design; classifying
  the stock world coastally is a data change, not an engine one.
- **A model-facing readout.** No new event field and no prompt change.

## Design

### 1. Layers

| Layer | Location | Rule in this increment |
|---|---|---|
| Catalog | `src/runtime/assets.js` | Reads `props.typeId` (falling back to `props.type`) so the entry's `type` is the declared terrain. |
| Map worker | `src/Game/Map/vnext/polityBoundariesWorker.js` | Reads `props.typeId` the same way, so the record's `type` matches the catalog's. |
| Adapter | `src/runtime/combatEngagements.js` | Gains a pure `regionCoastal(regionId, catalog)` and passes its tri-state result into the core. |
| Boundary | `src/Game/AI/gameplay.js` | Passes the primed scenario catalog into the adapter call. |
| Pure core | `src/engine/combat.js` | Takes `coastal` by value; a `false` zeroes the naval edge. Still imports nothing. |

### 2. Reading the terrain

Both projections read `typeId` first, keeping any legacy `type` as a fallback:

```
// assets.js, primeCustomRegionCatalogEntries / primeCustomRegionCatalog
type: props?.typeId ?? props?.type ?? "",

// polityBoundariesWorker.js
type: props.typeId ? String(props.typeId) : props.type ? String(props.type) : "",
```

An entry's `type` is therefore `"coastal"`, `"land"`, `"water"` or `""` (the
stock tiles carry no classification). This fills a field the catalog already has;
no consumer reads it today, so nothing else changes.

### 3. The adapter's tri-state

The adapter turns a region id and the catalog into a tri-state, because "this
region is inland" and "this world has no coastal data" are different facts:

- `true` - the region is declared `coastal`;
- `false` - the region is declared something else, in a world that declares at
  least one coastal region;
- `undefined` - the world declares no coastal region at all, or the region is
  not in the catalog. This is the inert case.

```
export const regionCoastal = (regionId, catalog) => {
  const id = name(regionId);
  if (!id) return undefined;
  const rows = list(catalog);
  // A world with no coastal region anywhere carries no coastal data to apply.
  if (!rows.some((row) => name(row?.type).toLowerCase() === "coastal")) return undefined;
  const match = rows.find((row) => name(row?.id) === id);
  if (!match) return undefined;
  return name(match.type).toLowerCase() === "coastal";
};
```

`buildEngagement` and `resolveEventEngagements` gain a `regionCatalog` option and
carry `coastal` on the engagement input beside `regionId`:

```
const coastal = regionCoastal(regionId, options.regionCatalog);
return { warId, regionId, coastal, ... };
```

### 4. The core's gate

`resolveEngagement` takes `coastal` by value. Only `false` changes anything: it
zeroes the naval edge, so the naval factor is exactly `1` and the fleet adds no
shore support. `true` and `undefined` both leave the edge as computed, which is
today's behaviour:

```
export const resolveEngagement = ({ ..., coastal, ... } = {}) => {
  ...
  const navalEdge = coastal === false ? 0 : domainEdge(navalA, navalB);
  ...
};
```

The result gains a top-level `coastal`, `true`, `false` or `null`, mirroring the
`airEdge`/`navalEdge`/`antiEdge` observations. It is the tri-state the core
applied, with `null` standing for the inert `undefined`.

The gate is symmetric because terrain is a property of the region, not of a side:
both sides lose naval support in a non-coastal province. A fleet's weight and its
reach in the destruction rule are untouched; only shore support is withheld.

### 5. The boundary

The turn passes the same primed catalog the combat-region resolver already uses:

```
const engagementOutcome = resolveEventEngagements(freshEvents, baseWorldNormalized, {
  round: nextGame.round,
  regionCatalog: getPrimedScenarioRegionCatalog() ?? [],
});
```

The catalog is primed from the scenario's own `regions.geojson` before the turn
runs (the map worker primes it, and the AI's preview path re-primes it), so the
`typeId` fix in section 2 is what makes this input non-empty.

### 6. Inert when the data is absent

This is the safety property. `coastal` is `undefined` (and the core's gate is a
no-op) whenever:

- the world declares no coastal region, which is every stock and `default`
  scenario;
- the region is not in the catalog;
- no catalog is passed at all, which is every direct `resolveEngagement` call and
  every adapter call that omits the option.

No naval units on either side already make the edge zero, independently. The
arithmetic is unchanged rather than merely close in all of these, so the existing
combat and engagement suites are a regression test for the inert case.

## Tests

Core (`src/engine/combat.test.js`):

1. **`coastal: false` withholds shore support**: a fleet on one side gives no
   power edge and no raw-power bonus; the side's power equals its plain score.
2. **`coastal: true` and `coastal: undefined` are identical**: both leave the
   naval edge at its full value, pinning that only `false` gates.
3. **The gate is symmetric**: both sides lose the edge in a non-coastal region.

Adapter (`src/runtime/combatEngagements.test.js`):

4. **`regionCoastal` tri-state**: `coastal` returns `true` and a land region
   returns `false` in a world with coastal data; a world without coastal data
   returns `undefined`; a missing region returns `undefined`.
5. **An inland battle carries `coastal: false` and no naval edge**: the adapter
   passes the terrain through and the resolved result reflects it.

Catalog (`src/runtime/assets.test.js`, new):

6. **The catalog reads `typeId`**: a feature with `typeId: "coastal"` projects a
   `type` of `coastal`, and a `typeId: "land"` projects `land`.

Wiring (`src/runtime/combatWiringArchitecture.test.js`):

7. **The boundary passes the catalog and the adapter reads the terrain**: source
   guards that the adapter calls `regionCoastal` and the turn passes
   `regionCatalog`.

Workers (`src/Game/Map/vnext/politicalCartographyArchitecture.test.js`):

8. **The map worker reads `typeId`**: a source guard on
   `polityBoundariesWorker.js`.

Regression:

- `npm test` stays green.
- `src/engine/enginePurity.test.js` and
  `src/runtime/combatWiringArchitecture.test.js` stay green: `combat.js` still
  imports nothing.
- `npx eslint` gains no new error.

## Docs

- `docs/runtime-services.md`: the combat section gains the coastal gate, and the
  catalog row notes the terrain field.

## Considered options

- **Passing the catalog to the core directly.** Rejected: `combat.js` must stay
  import-free and map-free, and a typed boolean is the smallest value the core
  needs. A catalog is the adapter's knowledge.
- **Routing the terrain through `combatRegionResolution.js`.** Rejected: that
  module canonicalizes a declared name to an id and holds no region data; giving
  it terrain would widen its responsibility for no gain.
- **Treating every non-coastal region as inland.** Rejected: in a world with no
  coastal data every region would read inland, silently disabling naval support
  that works today. The tri-state keeps the rule inert until the data exists.
- **A strict `coastal === true` gate, failing closed.** Rejected: it is the same
  data-absent failure by another route, and it would gate the stock world.

## Risks

- **A non-coastal battle drifting by a float.** `coastal: false` sets the edge to
  exactly `0`, so the factor is exactly `1`; `true` and `undefined` never touch
  the computation. The inert tests pin it.
- **A world silently losing naval support.** Only a world that declares at least
  one coastal region can gate, and only its non-coastal regions are gated; a
  world with no coastal data never gates. The tri-state test pins this.
- **A `typeId` mismatch between the catalog and the worker.** Both now read the
  same field; the catalog test and the worker source guard pin them.
