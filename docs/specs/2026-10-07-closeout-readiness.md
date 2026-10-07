# Grand-Strategy Closeout: Wave 1, 2 and 3 Readiness

> Status: closeout record for
> `docs/specs/2026-10-07-grand-strategy-roadmap-design.md`. It states what was
> delivered, the evidence that it is green, and what remains deliberately open.
> Branch: `261001-feat-combat-engagements`.

## What this pass checked

1. Every build item in Waves 1 and 2, and the one opted-in Wave 3 item, has a
   pure or runtime module, a guard test, and a spec document.
2. The architecture invariants held: `src/engine/**` stays import-free, no
   runtime dependency was added, and no `src/` file imports the tooling added for
   tests.
3. The full suite, the production build and the engine-purity guard are green.
4. The working tree is clean and every change is committed on the branch.

## Evidence

| Check | Command | Result |
|---|---|---|
| Full suite | `npm test` | 3361 tests, 3359 pass, 0 fail, 2 todo |
| Production build | `npm run build` | built in ~1m29s, no error |
| Engine purity + item guards | `node --test src/engine/enginePurity.test.js ...` | 68 tests, 0 fail |
| Visual plan | `node --test "visual/**/*.test.js"` | 6 tests, 0 fail |
| Lint, changed files | `npx eslint visual/* vite.config.ts` | 0 errors |
| Tooling isolation | `rg playwright src/ server/` | no matches |
| Dependency scope | `package.json` | `@playwright/test` in `devDependencies` only |
| Tree state | `git status --porcelain` | empty |

The visual job itself was run in the sandbox and reaches test execution; it
stops only because no Chromium is installed here (`npx playwright install` is
the fix) and the workflow is `continue-on-error` by construction. That is the
documented first state, not a defect.

## Delivery by item

### Wave 1

| Item | Spec | Core | Guard |
|---|---|---|---|
| 1 adjacency API | `2026-10-07-region-adjacency-api-design.md` | `src/engine/regionAdjacency.js`, `src/runtime/regionAdjacency.js` | `regionAdjacency.test.js` (x2) |
| 2 audio manager | `2026-10-07-audio-manager-design.md` | `src/engine/audioCues.js`, `src/engine/warMood.js`, `src/runtime/audioManager.js` | `audioCues.test.js`, `warMood.test.js`, `audioManager.test.js` |
| 3 analytics completion | `2026-10-07-analytics-completion-design.md` | `src/engine/polityAnalytics.js`, World sub-tab in `stats.jsx` | `polityAnalytics.test.js` |
| 4 event chronicle | `2026-10-07-event-chronicle-design.md` | `src/engine/eventChronicle.js`, Chronicle sub-tab in `stats.jsx` | `eventChronicle.test.js`, `eventImpacts.test.js` |

### Wave 2

| Item | Spec | Core | Guard |
|---|---|---|---|
| 5 strategic planner | `2026-10-07-strategic-planner-design.md` | `src/engine/strategicPlanner.js` | `strategicPlanner.test.js` |
| 6 balance harness | `2026-10-07-balance-harness-design.md` | `src/engine/balanceHarness.js` | `balanceHarness.test.js` |
| 7 native heatmap | `2026-10-07-native-heatmap-layer-design.md` | `src/engine/heatmapModel.js`, `src/runtime/heatmapData.js`, `src/Game/Map/HeatmapLayer.jsx` | `heatmapModel.test.js`, `heatmapData.test.js`, `mapLayerOrder.test.js` |

### Wave 3

| Item | Status |
|---|---|
| 9 visual regression | Delivered: `visual/views.mjs`, `visual/playwright.config.mjs`, `visual/visual.spec.mjs`, `.github/workflows/visual-regression.yml`; spec `2026-10-07-visual-regression-design.md` |
| 8 local narration model | Open. Needs an explicit opt-in; the gigabytes-scale bundle rule disqualifies it for mobile. |
| 10 crash reporting | Open. Needs a privacy decision before any external upload. |

## Invariants held

- **Engine purity.** `src/engine/enginePurity.test.js` passes with every new
  engine module in place; none imports another module or a runtime path.
- **Runtime layering.** `src/runtime/**` still does not import `src/Game/AI/**`.
- **No new runtime dependency.** `dependencies` is unchanged; Playwright is a
  `devDependency` and no `src/` file references it, so the shipped bundle is
  untouched. Its only config change is the `server.allowedHosts` entry the
  project rule requires.
- **No edits to existing tests to make a change pass.** The only test edits are
  additive guards and the one `mapLayerOrder.test.js` expectation the heatmap
  layer necessarily extends.
- **Docs correction.** The roadmap's claim that no FPS governor exists was
  wrong; `src/runtime/adaptiveQuality.js` ships one, and the table now says so.

## Known gaps

1. **Visual baselines are not committed yet.** They need a machine with a
   browser: `npx playwright install chromium`, then `npm run test:visual:update`,
   then commit `visual/visual.spec.mjs-snapshots/`. Until then the CI artifact
   is a record of missing snapshots.
2. **No visual verification in this environment.** There is no browser here, so
   the Playwright path is verified by configuration parse, test collection and
   the clean "install browsers" failure, not by an actual capture.
3. **The seeded default scenario is the only campaign the visual job knows.**
   Beta-only surfaces (interactive events, group polls) remain uncovered, as the
   wiki's known-gaps list already records for manual capture.

## How to reproduce

```
npm test
npm run build
npx playwright install chromium
npm run test:visual
```
