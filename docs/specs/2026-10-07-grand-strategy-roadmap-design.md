# Grand-Strategy Roadmap: Triage of an External Proposal

> Status: triage and sequencing proposal, being delivered item by item. Every
> claim about the repository below was verified against `HEAD 74d9871`; the
> suite counter is refreshed as items land (`npm test` = 3355 tests, 3353 pass,
> 0 fail, 2 todo after Wave 1 item 4 and Wave 2 items 5-7).

## Why this document exists

An external "senior co-founder" review proposed roughly thirty libraries and
architectures to push Historia Nova toward Paradox-scale grand strategy. This
document audits each proposal against what the repository actually contains,
assigns a verdict, and sequences the survivors into implementation waves. The
point is to spend effort where a real gap exists, not to re-buy what is already
built or to replace a working subsystem with a heavier one.

The external review is enthusiastic but working from a stale picture: it claims
"3,222+" tests and describes several shipped subsystems as missing. Treat its
recommendations as hypotheses, not findings.

## Method

For each proposal: what it claims to add, what the repository already does, and a
verdict of one of

- **Done** - already implemented and tested; no work.
- **Extract** - the capability exists but is buried; the work is exposing a
  clean, tested interface, not adding a dependency.
- **Build small** - a real gap; solve it with a small pure module, no new
  dependency where the platform already provides the primitive.
- **Evaluate** - plausible but high cost or risk; needs a spike and an explicit
  opt-in, never a default.
- **Reject** - duplicates or degrades a working subsystem, or violates project
  constraints.

## Constraints that outrank the proposals

- `src/engine/**` is pure, import-free, deterministic; `enginePurity.test.js`
  forbids browser globals, `Date.now`, `new Date` and `Math.random` there.
- The project adds no runtime dependency without a concrete need; several
  proposals are dependency adds whose benefit is already present.
- The mobile and web builds share one bundle; anything that inflates it hurts
  every platform. Models measured in gigabytes are disqualified by default.
- Interface text is extracted from source and translated by the custom i18n
  pipeline; a string written for a generic i18n library would not be extracted
  the same way.

## Verdict table

| Proposal | What it claims | What the repository has | Verdict |
|---|---|---|---|
| `@turf/turf` full bundle | Geospatial analysis | Modular Turf already installed: `@turf/area`, `@turf/boolean-point-in-polygon`, `@turf/centroid`, `@turf/helpers`, `@turf/line-intersect`, `@turf/line-split`, `@turf/polygon-to-line`, `@turf/simplify` | Reject (full bundle); the modular set is the right shape |
| `getContiguousNeighbors(polityId)` | Real adjacency for expansion and war gating | Adjacency is computed in `src/Game/AI/lookupTools.js`: author-declared `adjacencies`, else a bounding-box over-approximation; exposed to the model via `map_around`, `border_between`, `region_info` | Extract: lift the adjacency into a pure, tested engine/runtime helper the turn and AI both call |
| Web Workers + Comlink | Off-main-thread simulation | Six workers already run: `worldDirectorWorker`, `countryStatsWorker`, `ownershipTransitionWorker`, `polityBoundariesWorker`, `provinceRasterWorker`, `polityTextPlacementWorker` | Done; Comlink is an unnecessary abstraction |
| IndexedDB via Dexie.js | Robust local saves | IndexedDB used in `assets.js`, `statsSheet.js`, `regionClipboard`, `telemetry`, `main.jsx`, `MapEditor` | Done; Dexie adds weight for no new capability |
| i18next | i18n architecture | Full custom pipeline: `i18n.js`, `phraseBook.js`, `translator.js`, shipped packs, AI content translation (`docs/i18n.md`) | Reject |
| Zod for scenario/event validation | Prevent crashes on bad data | Custom `gameplaySchemas.js` plus a deliberate salvage philosophy (`jsonSalvage.js`, `schemaSalvage.js`) that repairs rather than rejects | Reject full adoption; salvage already covers the failure mode |
| `seedrandom` for deterministic combat | Reproducible battles | `src/engine/combat.js` already resolves from an FNV-1a hash of `warId\|regionId\|date\|round`; no `Math.random` | Done; a dependency would replace ten lines of tested code |
| GitHub Actions + Vitest guardrail | CI quality gate | Six workflows, `tests.yml` runs `npm test` on PRs to `beta`/`main`; the suite is `node --test` | Done (keep `node --test`; Vitest would be a migration for its own sake) |
| XState for diplomacy / event graph | Deterministic state machine | Deterministic pure engines already model intent, casus belli, settlement, personality, ticks | Reject as a dependency; if a statechart is needed, hand-write a small pure table |
| ECharts analytics sheet | Deep economy charts | `chart.js` installed; `stats.jsx` already renders `AdvancedLineChart` over `countryStatsHistory` | Reject the swap; Build small any missing analytics views on `chart.js` |
| Howler.js / Tone.js audio | Adaptive historical audio | No audio engine | Build small with the Web Audio API (no dependency); adaptive layers keyed off the tick state |
| WebLLM / `transformers.js` local LLM | Zero-cost offline narration | Multi-provider cloud AI; no on-device model; mobile ships a single web bundle | Evaluate desktop only, opt-in; Reject for mobile |
| PeerJS / WebRTC P2P multiplayer | Zero-cost multiplayer | Single-player; no authoritative server, no desync model | Reject for now; enormous scope, no auth, no determinism plan across peers |
| RBush spatial index | Fast neighbor queries at scale | Current catalogs are small; adjacency is cheap at present scale | Evaluate when a profiler shows a real cost, not before |
| `heatmap.js` / spatial heatmap | End-of-era conflict map | MapLibre GL can render heatmaps natively from a GeoJSON source | Build small on MapLibre; no dependency |
| Playwright visual regression | Catch layout regressions | No visual tests; screenshot capture is manual (`docs/wiki`) | Evaluate in CI as a scoped, non-blocking job |
| Sharp image pipeline | Smaller assets | Assets are committed and already sized; build is Vite | Evaluate; do not add a native build dependency pre-emptively |
| Sentry crash reporting | Production telemetry | `telemetry.js` records to IndexedDB locally | Evaluate; external crash upload needs a privacy decision first |
| Automerge / Yjs time-lapse | Delta-based history replay | `countryStatsHistory` and event ledgers already record history; ownership deltas exist in the event log | Build small: reuse existing deltas in a player-facing timeline; no CRDT |
| Headless AI balancing via worker threads | Balance without the UI | Tick engines are pure and import-free, so they already run headless under `node --test` | Build small: a `node --test` balance harness over the existing engines; no new runtime |
| QuickJS mod sandbox | Community mods | Data-driven scenarios (`server/data/scenarios`, `game.json`) already let authors add content without code | Build small: keep mods declarative; do not embed a JS engine |
| Azgaar procedural world generation | Random worlds mode | Authored scenarios and a full map editor | Reject/defer: separate product-scale feature |
| Radix UI / Headless UI event popups | Immersive event windows | Event UI exists and is theme-styled | Reject as a dependency; style in place |
| Piper TTS letters | Historical voice | None | Evaluate later; large per-language assets, off by default |
| `stats.js` performance budgeting | Hold 60 FPS adaptively | Adaptive quality ladder and frame-time instrumentation already ship: `runtime/adaptiveQuality.js` (p90 frame time, downgrade/upgrade hysteresis, consumed by `GlobeEffects.jsx`) plus the rAF sampler and freeze trace in `World.jsx` / `runtime/mapPerfTrace.js` | Done; no `stats.js` dependency. Add an on-screen HUD only if a device shows the need |

## Sequencing

### Wave 0 - close the loop (no work)

Turf, workers, IndexedDB, i18n, validation and deterministic combat are already
in place. Record them as Done so future reviews stop re-proposing them.

### Wave 1 - highest value, lowest risk

1. **Extract a pure adjacency API.** One tested helper that returns the
   neighboring regions of a region or polity, reusing the map's own adjacency,
   callable from `src/engine/**` (pure) and by the turn. This is the seed of
   every sane expansion and war-proximity rule and it removes the current
   duplication between the AI lookup tools and any future caller.
   Delivered: `src/engine/regionAdjacency.js` + `src/runtime/regionAdjacency.js`,
   with the war-declaration reach gate on top.
2. **Audio manager on the Web Audio API.** A small `src/runtime/audioManager.js`
   with a mute/volume setting, paper/UI clicks, war-stamp cues, and a state-driven
   music bed. No Howler.
   Delivered: `src/engine/audioCues.js` + `src/engine/warMood.js` and
   `src/runtime/audioManager.js`, with an Audio section in Settings.
3. **Analytics completion on `chart.js`.** Any missing polity analytics views
   reuse `AdvancedLineChart` and `countryStatsHistory`.
   Delivered: `src/engine/polityAnalytics.js` (pure ranking core) plus a World
   sub-tab in `stats.jsx` with ranked bar and share doughnut views over
   `world.countryStats`; `AdvancedLineChart` over `countryStatsHistory` stays
   the single-polity view.
4. **Read-only history from event diffs.** SCOPE DECIDED: history is read-only,
   not an interactive replay. The event log already carries formatted diffs
   (`event.impacts`: `regionTransfers`, `regionControlOps`, `regionClaims`,
   `polityChanges`, `unitOps`, `markerOps`, `projectOps`) and the Timeline and
   Events panels already read them; no scrubber, no "replay the map" mode, and
   no new state. If a view is missing it is a static reading of those diffs.
   Delivered: `src/engine/eventChronicle.js` aggregates the turn ledger
   (`world.simulationHistory` and each turn's application receipt) into a
   deterministic, bounded rollup and per-turn rows, and a read-only Chronicle
   sub-tab in `stats.jsx` renders it. The Events panel's family grouping is now
   the engine's own `PLAYER_IMPACT_FAMILIES`, so the card and the chronicle
   cannot disagree.

### Wave 2 - depth, still pure and cheap

5. **GOAP-lite strategic planner** as a pure `src/engine` module beside
   `strategicIntent.js`: goal selection plus a scored action sequence, fully
   deterministic, unit-tested headless. No Yuka.
   Delivered: `src/engine/strategicPlanner.js` scores economic-expansion,
   military-insurance and political-bloc goals from compact state and the
   personality profile, expands the winner into a prerequisite-first bounded
   action chain, and bridges a plan to the economy clock so
   `balanceHarness.js` can run it; `strategicPlanner.test.js` includes that
   harness integration.
6. **Headless balance harness** driving the existing pure tick engines under
   `node --test`, reporting snowballing and collapse.
   Delivered (economy scope): `src/engine/balanceHarness.js` composes the pure
   `advanceEconomy` clock over many polities and months and reports concentration
   drift and per-polity collapse; `src/engine/balanceHarness.test.js` pins the
   balanced, snowball and debt-crisis cases.
7. **Native heatmap layer** for the end-of-era conflict map.
   Delivered: `src/engine/heatmapModel.js` normalizes per-region weights into a
   GeoJSON FeatureCollection, `src/runtime/heatmapData.js` feeds it the country
   sheets, the derived plans and the front lines, and `HeatmapLayer.jsx` draws it
   with MapLibre's native `heatmap` layer in three modes (wealth, strategy,
   tension), off by default and selectable in Settings. No new dependency.

### Wave 3 - evaluate only, explicit opt-in

8. Desktop-only local narration model (never shipped in the mobile bundle).
9. Visual regression job in CI, non-blocking.
10. Optional crash reporting, pending a privacy decision.

None of the three is started: each needs a decision this document cannot make
(an on-device model is disqualified by the gigabytes-scale bundle rule, and
crash upload needs a privacy call), and each is "Evaluate", not "Build". They
stay open until the owner opts in.

### Rejected

i18next, Zod full adoption, Dexie, XState, ECharts, seedrandom, `@turf/turf`
full, Yuka, PeerJS, Azgaar, Radix as a dependency.

## Success criteria

- Every Wave 1 item lands with tests and without a new runtime dependency.
- The suite stays green and the mobile/web bundle does not grow for a Wave 1
  item.
- The extracted adjacency API has one implementation, used by both the AI lookup
  tools and the turn, and pinned by a test.

## Open questions

1. Which Wave 1 item is first? The adjacency API is the highest leverage and the
   most reusable; the audio manager is the most visible to a player.
2. RESOLVED: history is read-only. No interactive timeline replay; the event
   log's formatted diffs are the record, and any player-facing history reads
   them rather than re-simulating or scrubbing the map.
3. Does the owner want an on-device model attempt at all, even desktop-only?

## TODO

- [ ] Approve or reorder the waves above.
- [x] Write `docs/specs/2026-10-07-region-adjacency-api-design.md` for Wave 1 item 1.
- [x] Write `docs/specs/2026-10-07-audio-manager-design.md` (Wave 1 item 2).
- [x] Decide the timeline replay scope (Wave 1 item 4): read-only, no replay.
- [x] Deliver Wave 1 item 4: `src/engine/eventChronicle.js` plus the read-only
      Chronicle sub-tab in `stats.jsx`.
- [x] Record the rejected proposals in `docs/architecture.md` so they are not
      re-proposed.
