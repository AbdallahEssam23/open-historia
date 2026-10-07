# Analytics Completion: A World View Over Polity Sheets

> Status: delivered. Wave 1, item 3 of
> `docs/specs/2026-10-07-grand-strategy-roadmap-design.md`. Implemented as
> `src/engine/polityAnalytics.js` and the World sub-tab in
> `src/Game/GameUI/stats.jsx`.

## Problem

Every statistics view in the game is single-polity and line-only.

- `src/Game/GameUI/stats.jsx` has two sub-tabs, Diplomacy and Economy/National,
  and both read one polity's sheet.
- `AdvancedStatsModal` plots one polity's `countryStatsHistory` through
  `AdvancedLineChart`, a hand-written SVG chart that takes exactly one
  `samples` array. It cannot overlay a second polity, and the metric picker
  refuses mixed units, so "my GDP against my rival's" is impossible.
- `HistoricalTrackingModal` already collects up to
  `COUNTRY_STATS_TRACKING_MAX_POLITIES` (8) polities, but only lists their
  names and readiness badges. It charts nothing.

So the questions a grand-strategy player actually asks - who is the largest
economy, how much of the world is mine, how do the great powers rank on
stability or on a strategic index - have no answer in the UI. `chart.js` is a
dependency (`package.json`) and is already wired in `advisor.jsx` (bar, line,
pie, doughnut), but the deterministic stats area never uses it.

## Goal

Add one **World** sub-tab to the stats pane. It ranks every polity that has a
canonical `countryStats` sheet by a chosen metric and shows, for volume
metrics, each polity's share of the world.

The arithmetic is a new pure engine module, so it is deterministic and tested
with plain objects under `node --test`. The rendering uses the `chart.js`
already in the project, for the two views SVG cannot draw well: a ranked bar
chart and a share doughnut. No new dependency, no change to what is recorded.

## Non-goals

- No new data. The view reads `world.countryStats`; it never generates or
  mutates a sheet and never writes history.
- No change to `AdvancedStatsModal` or `AdvancedLineChart`. The single-polity
  line chart is complete for one polity and stays exactly as it is; it remains
  the `countryStatsHistory` view the roadmap names.
- No world-total time series. Only the current sheet is ranked; a history of
  the aggregate is a separate question.
- No interactive timeline replay. History is read-only (roadmap Wave 1 item 4,
  resolved): this view is a static reading, not a scrubber.
- No new chart type in the advisor and no change to `validateChartConfig`.

## Architecture

### Pure core: `src/engine/polityAnalytics.js`

Import-free and pure, like every other engine module, so it falls under
`src/engine/enginePurity.test.js`: no clock, no entropy, no browser global. It
knows sheets and metrics, nothing about the DOM or React. `stats.jsx` already
imports a pure engine module directly (`tradeMultipliers` from
`engine/tradeCore.js`), so this is the established shape.

```
POLITY_METRICS = [
  { key, label, group, unit, additive, path },   // stock economy metrics
  ...
]

metricValueFor(sheet, metric) -> number | null
polityMetricCatalog(indexRows = []) -> [{ key, label, icon, metrics }]
rankPolities({ sheets, metric, limit }) -> {
  metric: string,
  additive: boolean,
  total: number,
  rows: [{ polity, value, share }],
}
```

A metric is data, not a function: `path` walks the sheet (`["economy","gdp"]`,
`["population","total"]`, `["stability"]`), and an index metric carries
`index: "<key>"` and reads `sheet.indices[key]`. `metricValueFor` returns
`null` for a missing or non-finite value so a half-assessed sheet is skipped
rather than ranking as zero.

`rankPolities` is deterministic. It keeps only finite values, sums them into
`total`, sorts by value descending, and breaks ties by the polity key compared
by code unit (never `localeCompare`, which is locale-dependent). `share` is
`value / total` when `total > 0`, else `0`. It is only meaningful for an
`additive` metric (a total, not an average or a percentage), which the caller
uses to decide whether to draw the share view. `limit` is clamped to a sane
integer; the default is 12.

The stock catalog is economics and population plus a `strategic` group built
from `indexRows`, so a custom scenario's indices appear in the picker the same
way `advancedMetricGroupsFor` already builds them for the line chart.

### UI: a third sub-tab in `src/Game/GameUI/stats.jsx`

`statsView` gains `"world"`, beside `"diplomacy"` and `"economy"`. It renders a
metric picker (the catalog's groups) and, for the selected metric:

- a ranked **bar** chart of the top `limit` polities,
- a **doughnut** of share-of-world, shown only when the metric is `additive`,
- a ranked list (name, value, share) that also carries the text values the
  charts summarise, so the view is readable without hovering.

Names resolve through the pane's existing `polityDisplayName(world, key)`, and
the player's own polity is marked, exactly as the rest of the pane does. The
rows come from `worldSnapshot.countryStats`, already loaded.

Two small components carry the rendering, copying the `AdvisorChart` pattern
verbatim (an existing, working use of `chart.js`):

- `import { Chart, registerables } from "chart.js";` and a module-scope
  `Chart.register(...registerables);` (idempotent with the advisor's).
- `canvasRef` plus `chartRef`; build the `Chart` in a `useEffect` keyed on the
  data, `chartRef.current?.destroy()` first, and return a cleanup that destroys
  it. `responsive: true`, `maintainAspectRatio: false`, legend hidden, tooltips
  themed as the advisor's.
- The bar chart is a single dataset with `indexAxis: "y"`. The doughnut uses
  the same palette the advisor uses for pie and doughnut (`CHART_COLORS`).

`stats.jsx` renders only in the browser, so the canvas is always in a DOM; the
node tests never import it (there is no `stats.test.js`, and none is added).

## Data flow

```
world.countryStats  ->  rankPolities (pure)  ->  rows  ->  chart.js canvas
        |                       ^                              |
        |                       |                              v
   (already loaded)      POLITY_METRICS                 ranked list + share
```

The view is a leaf: it reads the world snapshot and renders. It writes nothing.

## Edge cases

- No `countryStats` at all, or none with the metric: the view shows an empty
  state, the same wording the line chart uses for "no samples".
- One polity only: a bar of one and a doughnut of one are still valid.
- A metric that is `0` everywhere: `total` is `0`, every `share` is `0`, and no
  division happens.
- Negative values (a budget deficit, a negative growth): ranking still sorts
  descending; share is not offered, because shares of a signed total are
  meaningless, and no stock additive metric can be negative in the first place.
- Ties: broken deterministically by key, so the order never flickers between
  renders or reloads.

## Testing

- `src/engine/polityAnalytics.test.js` (new): `metricValueFor` reads economy,
  population and indices and returns `null` for missing/non-finite; the stock
  catalog has unique keys and every `path` resolves on a full sheet;
  `rankPolities` orders descending, breaks ties by key, drops non-finite
  values, clamps `limit`, computes `total` and `share`, returns `share` 0 when
  the total is 0, and is byte-identical across two calls. The existing
  `enginePurity.test.js` covers the new engine file automatically.
- No existing test is edited. The view adds no data and touches no recording
  path, so the country-stats guards (`server/countryStats.test.js`,
  `src/runtime/countryStatsCustomIndices.test.js`) are unaffected.

## Files

- New: `src/engine/polityAnalytics.js`, `src/engine/polityAnalytics.test.js`.
- Edit: `src/Game/GameUI/stats.jsx` (the sub-tab, the two chart components, the
  `chart.js` import, and the metric catalog call).

## Open questions

1. Should the World tab default its `limit` to the top 12, or to the 8
   `HistoricalTrackingModal` already tracks? The spec assumes top 12, always
   available, independent of tracking.
2. Should the ranking include landless polities? The spec includes every polity
   with a canonical sheet; filtering landless would reuse the tracking modal's
   own rule and can be added if a report shows noise.

## TODO

- [x] Implement `polityAnalytics.js` + tests (TDD).
- [x] Add the World sub-tab and the two chart.js components to `stats.jsx`.
- [x] Run `npm test` and `npm run build`.
