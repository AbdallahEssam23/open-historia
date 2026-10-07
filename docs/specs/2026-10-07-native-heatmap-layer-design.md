# Native Heatmap Layer: Engine Data as a Map Gradient

> Status: delivered. Wave 2, item 7 of
> `docs/specs/2026-10-07-grand-strategy-roadmap-design.md`. Verdict there:
> "Build small on MapLibre; no dependency." This spec expands the original
> "end-of-era conflict map" into three selectable gradients, because the pure
> data that drives them already exists. Implemented as `src/engine/heatmapModel.js`
> (pure), `src/runtime/heatmapData.js` (adapter) and `src/Game/Map/HeatmapLayer.jsx`
> (native MapLibre `heatmap` layer), with the two Settings keys and the layer id
> registered in `mapLayerOrder.js`. Suite: 3345 tests, 0 failing; `npm run build`
> succeeds.

## Problem

The world's numbers never appear on the map. A player can open the Stats panel
and read a table, but cannot see at a glance where the wealth is, where the
opponents' plans point, or where a war is actually burning. The roadmap asks for
a conflict heatmap; the same native MapLibre primitive answers all three
questions, and the game already computes the data:

- wealth per polity lives in `world.countryStats[polity].economy`,
- a strategic plan per polity is what `src/engine/strategicPlanner.js` derives,
- military tension per region is what `src/engine/frontLines.js` already
  derives (`roles: ["contested", "front"]`) but nothing renders.

MapLibre GL renders a heatmap layer type natively from a GeoJSON source, so no
`heatmap.js`, no canvas layer, and no new dependency are needed.

## Goal

One map overlay, off by default, with three modes:

| Mode | Point weight per region | Source |
|---|---|---|
| `wealth` | the controlling polity's GDP | `world.countryStats[owner].economy.gdp` |
| `strategy` | the controlling polity's GOAP plan score | `derivePlan` (per polity) |
| `tension` | the region's front-line role | `deriveFrontLines` roles |

The data-to-feature mapping is a pure engine module, so it is deterministic and
tested headless under `node --test`; the world-to-inputs mapping is a runtime
adapter, so it is tested without a DOM; the React component is thin and follows
the existing `<Source>` + `<Layer>` pattern (`MarkersLayer.jsx`).

## Non-goals

- No new runtime dependency and no change to the basemap styles. The three
  style modules (`modernTacticalStyle.js`, `parchmentStyle.js`,
  `natGeoDarkStyle.js`) keep their closed `{background, fill, line, symbol}` type
  sets and their tests; the heatmap is a game overlay React layer, not a style
  layer.
- No per-region economics. Region geometry carries no population or GDP, so a
  region's weight is its controller's polity-level figure, not a per-region
  value. A future per-region split is a data change, not a render change.
- No new simulation. The overlay reads the plan the planner already derives and
  the front lines `frontLines.js` already derives; it never writes state.
- No legend beyond the Settings picker and the mode name. A legend is a possible
  follow-up.

## Architecture

### Pure core: `src/engine/heatmapModel.js`

Import-free except `./economyMath.js`, so `enginePurity.test.js` covers it with
no change: no clock, no entropy, no browser global. It knows points and weights,
nothing about MapLibre or React.

```
HEATMAP_MODES = ["wealth", "strategy", "tension"]

regionPoint(region) -> { lng, lat } | null
buildHeatmapModel({ mode, regions, countryStats, plans, frontLines }) -> {
  mode, pointCount, max, features   // a GeoJSON FeatureCollection
}
```

`regionPoint` uses `region.lng`/`region.lat` when both are finite, else the
centre of `region.bounds` (a `[[west, south], [east, north]]` box). A region
with neither is skipped, never placed at `[0, 0]`.

`buildHeatmapModel` computes a raw weight per region, finds the maximum, and
normalizes each to `raw / max` in `[0, 1]` (all zero when `max` is `0`). Each
feature carries `{ regionId, owner, weight, raw }`. The output is plain JSON, so
a test compares it by value.

The mode-to-weight rules are deterministic:

- `wealth`: `countryStats[owner]?.economy?.gdp`, `0` when absent.
- `strategy`: `plans[owner]?.score`, `0` when the polity has no plan. This is the
  "where is each power's attention" gradient.
- `tension`: `frontLines.regions[regionId]?.roles` gives `1` for `contested`,
  `0.7` for `front`, else `0`. Contested beats a front, and a region with both
  takes the contested weight.

### Runtime adapter: `src/runtime/heatmapData.js`

The seam between the stored world and the pure model. It imports no Game/AI
module (the runtime rule), and it is DOM-free, so it runs under `node --test`.

```
heatmapRegionsFromCatalog(catalog, overrides) -> [{ id, owner, lng, lat, bounds }]
buildHeatmapPlans(world, { playerPolity, limit }) -> { [polity]: { goal, score } }
buildHeatmapData(world, catalog, { mode, playerPolity }) -> model
```

`heatmapRegionsFromCatalog` resolves each region's live controller through
`regionOwnerName` (the one shared definition the prompt layer also uses), so the
heatmap and the AI agree on who holds a region.

`buildHeatmapPlans` walks `politiesInPlay`, builds each polity's compact planner
state (growth, debt, unemployment, stability, force share, mobilization, active
wars, claims, allies) plus the personality profile `worldFactsFor` +
`derivePersonality` already produce, and calls `derivePlan`. A polity with no
sheet or no plan is simply absent.

`buildHeatmapData` reads the front lines through `readFrontLines` only for the
`tension` mode, so a wealth or strategy render never pays for the graph.

### UI: `src/Game/Map/HeatmapLayer.jsx`

A React component mounted in `MapScene.jsx`, following `MarkersLayer.jsx`:

- reads `worldState` from `useWorldState()` and the region catalog (primed
  synchronously when available, else `loadScenarioRegionCatalog()`, refreshed on
  the `oh:region-catalog-primed` event);
- reads the visibility toggle with `useMapSetting(MAP_SETTING_KEYS.heatmap)` and
  the mode with `useMapSettingValue(MAP_SETTING_KEYS.heatmapMode, "tension")`;
- renders `<Source id="heatmap-source" type="geojson">` with one
  `<Layer id="conflict-heatmap" type="heatmap">`;
- calls `enforceMapLayerOrder(map)` once after the layer is added, so an
  asynchronously added overlay still lands at its declared position;
- renders nothing when the toggle is off.

Layer paint (all native MapLibre heatmap properties): `heatmap-weight` from the
feature's `weight`, a zoom-interpolated `heatmap-intensity` and `heatmap-radius`,
a fixed multi-stop `heatmap-color` ramp from transparent through blue and yellow
to red, and a `heatmap-opacity`.

### Stacking: `src/Game/Map/mapLayerOrder.js`

`"conflict-heatmap"` joins `MAP_LAYER_ORDER` immediately after
`"polity-boundaries"`, above every political fill and boundary, and below the
draped standing-order lines, labels, cities, markers and unit counters, so the
overlay tints the political body without burying readable content.

### Settings

New `MAP_SETTING_KEYS.heatmap` (visibility, off by default) and
`MAP_SETTING_KEYS.heatmapMode` (value, default `tension`), with a `Toggle` and a
`<select>` in the Map section of `settings.jsx`, and the matching lines in the
`"Map"` snapshot of `settingsLog.js` so the diagnostics guard passes.

## Data flow

```
world.countryStats ----\
world.wars/units ------+--> runtime/heatmapData.js --> engine/heatmapModel.js
scenario region catalog/         (plans, regions, frontLines)      |
                                                                   v
                                                     GeoJSON FeatureCollection
                                                                   |
                                                          <Source>+<Layer heatmap>
```

The overlay is a leaf: it reads and renders, and writes nothing.

## Edge cases

- No region catalog (a stock world that never primed it): the layer renders
  nothing and the game is unchanged.
- A region with no coordinates: skipped, never pinned at null island.
- A region whose owner has no sheet or plan: weight `0`, and it still appears as
  a transparent point (harmless) or is dropped when `max` is `0`.
- Mode `tension` with no active war: every weight is `0`, `max` is `0`, and the
  map draws no colour.
- An unknown mode string: falls back to `tension`.
- The toggle is off: no `Source`, no `Layer`, no work.

## Testing

- `src/engine/heatmapModel.test.js` (new): `regionPoint` prefers lng/lat, falls
  back to the bounds centre, and skips a coordinate-less region; `wealth` reads
  GDP and skips a missing sheet; `strategy` reads plan scores; `tension` maps
  contested above front and ignores a region with no role; normalization reaches
  `1` for the maximum and stays within `[0, 1]`; an empty or all-zero input
  gives `max 0` and no division; the result is deep-equal across two calls; an
  unknown mode falls back. `enginePurity.test.js` covers the new engine file
  automatically.
- `src/runtime/heatmapData.test.js` (new): `heatmapRegionsFromCatalog` resolves
  an override over the base owner; `buildHeatmapPlans` returns a plan for a
  known polity and omits an unknown one; `buildHeatmapData` produces features for
  each mode and never throws on an empty world.
- `src/Game/Map/mapLayerOrder.test.js` (edit): assert `conflict-heatmap` sits
  above the political fills and `polity-boundaries`, and below `cities-shapes`
  and `units-fill`.
- No component-render test is added (the repo has none for map layers). No
  existing test is rewritten to accommodate the change.

## Files

- New: `src/engine/heatmapModel.js`, `src/engine/heatmapModel.test.js`,
  `src/runtime/heatmapData.js`, `src/runtime/heatmapData.test.js`,
  `src/Game/Map/HeatmapLayer.jsx`.
- Edit: `src/Game/Map/MapScene.jsx`, `src/Game/Map/mapLayerOrder.js` (+ test),
  `src/runtime/mapSettings.js`, `src/runtime/settingsLog.js`,
  `src/Game/GameUI/settings.jsx`.

## Open questions

1. Should `wealth` show total GDP or GDP per head? This spec uses total GDP, the
   literal stock of wealth, matching the Stats panel's default ranking; a
   per-head mode is a one-line addition to the weight table if wanted.
2. Should the overlay ship on or off? Off, consistent with the audio suite: a
   first install looks like the map always did, and the feature is a deliberate
   turn-on.
3. Is a legend wanted? Deferred; the color ramp is fixed and documented here.

## TODO

- [x] Implement `heatmapModel.js` + tests (TDD).
- [x] Implement `heatmapData.js` + tests.
- [x] Add `HeatmapLayer.jsx`, mount it, register the layer id, and extend the
      order test.
- [x] Add the two settings and the `settingsLog.js` snapshot lines.
- [x] Run `npm test` and `npm run build`.
