# Visual Regression: a Non-Blocking Screenshot Job

> Status: delivered. Wave 3, item 9 of
> `docs/specs/2026-10-07-grand-strategy-roadmap-design.md`, which lists it as
> "Evaluate in CI as a scoped, non-blocking job". The owner opted in, so this
> spec scoped and built it: `visual/views.mjs` (pure, covered by `npm test`),
> Playwright config and spec, and the `continue-on-error`
> `.github/workflows/visual-regression.yml`. Suite: 3361 tests, 0 failing;
> `npm run build` succeeds; `@playwright/test` is a devDependency only.

## Problem

The suite (`node --test`) covers logic but not layout. Every panel in this app is
styled with inline styles and has no class names or component tests, so a change
that moves a toolbar off-screen, collapses a chart or blanks the map passes CI
green. The wiki's screenshot guidance (`docs/wiki.md` section 6) already names
the shape that works: Playwright's Chromium with SwiftShader against the built
app, waiting on the `oh:map-idle` signal from `src/runtime/mapReadiness.js`. What
does not exist is a committed, repeatable job.

The surfaces worth guarding are exactly the ones this quarter's roadmap touched:
the map, the native heatmap overlay (item 7), and the Stats panels including the
Chronicle (items 3 and 4).

## Goal

A scoped visual job that:

1. boots the app deterministically with no API key and no real data directory;
2. captures a named set of views (map, map with heatmap on, Stats World, Stats
   Chronicle, library);
3. compares each against a committed baseline and emits a diff report;
4. never fails the build on a pixel difference unless explicitly asked to.

## Non-goals

- No runtime dependency and no change to the shipped bundle. Playwright is a
  `devDependency` only; nothing under `src/` imports it.
- No replacement for `node --test`. The visual job is separate and advisory.
- Not a pixel-perfect gate. Map imagery, flags and fonts come from the network
  and are not byte-stable across machines; the job tolerates a per-snapshot
  pixel ratio and is non-blocking besides.
- No new screenshot tooling beyond one runner. Puppeteer would need a second
  package for pixel diffing (`pixelmatch` + `pngjs`); Playwright's own
  `toHaveScreenshot` ships the comparator and the diff image, so it is the
  smaller dependency and is the tool `docs/wiki.md` already names.

## Architecture

### Pure plan: `visual/views.mjs`

Import-free, deterministic, unit-tested by `node --test`. It is the single
source of truth for what is captured and how a run is judged.

```
VISUAL_VIEWS = [
  { id, description, waitFor, steps: [ ... ] },
  ...
]

visualPolicy(env) -> { strict, update, maxDiffPixels, maxDiffPixelRatio,
                       threshold, nav, settleMs, timeoutMs }

summarizeVisualRun(results) -> { total, passed, failed, skipped, blocking, diffs }
```

A `step` is a declarative action: `{ click: "Play" }` (exact label, preferring a
`button`, as `docs/wiki.md` requires), `{ clickIfPresent: "Not now" }`,
`{ waitForMapIdle: true }`, `{ waitMs }`, or `{ key }`. The runner interprets
them; the plan holds no selectors beyond accessible label text, which is the
maintenance surface if the UI copy changes.

`visualPolicy` reads the environment once: `strict` only when `OH_VISUAL_STRICT`
is set, `update` only when `OH_VISUAL_UPDATE` is set. Everything else has a fixed
default. `summarizeVisualRun` is pure over per-view results and reports
`blocking = strict && failed > 0`, which is the whole non-blocking contract and
is what the unit tests pin.

### Runner: `visual/visual.spec.mjs` + `visual/playwright.config.mjs`

Playwright drives the web build, because web mode seeds its own playable default
scenario into IndexedDB and needs no Express server, no API key and no
`OH_DATA_DIR` (the wiki's "never against the real data directory" rule is
satisfied by construction: there is no server data directory to touch).

The config boots the app with a `webServer` entry
(`npm run dev:web -- --port 4173 --strictPort`), launches headless Chromium with
`--use-angle=swiftshader --enable-unsafe-swiftshader` so MapLibre gets a WebGL
context, and sets `expect.toHaveScreenshot` defaults from `visualPolicy`. The
spec walks `VISUAL_VIEWS`, performs the steps, and screenshots each view with
`toHaveScreenshot("<id>.png", { maxDiffPixels, maxDiffPixelRatio, threshold })`.

Baselines live under `visual/visual.spec.mjs-snapshots/` and are committed. They
start empty: until an owner runs the update command on a machine with a browser
and commits the output, every view is a "missing snapshot", which Playwright
records as a failure and the CI step swallows. That is the correct first state
for an advisory job and is called out in `docs/wiki.md`.

### CI: `.github/workflows/visual-regression.yml`

- Triggers on `pull_request` to `beta`/`main` and `workflow_dispatch`.
- `npm ci`, then `npx playwright install --with-deps chromium`.
- The visual step carries `continue-on-error: true`, so a diff cannot block.
- The HTML report and `test-results/` (actual/expected/diff PNGs) upload as the
  `visual-regression` artifact with `if: always()`.

The full suite stays on `node --test`. `npm test` gains the `visual/**/*.test.js`
glob so the pure plan is covered by the existing runner; Playwright specs are
named `*.spec.mjs`, which `node --test` never collects, so a machine without
Playwright still runs `npm test` clean.

## Data flow

```
env ----------------------\
VISUAL_VIEWS ---------------> visual.spec.mjs --> Chromium --> toHaveScreenshot
                             (web build, seeded)         |--> baselines (committed)
                                                         |--> test-results (diffs)
summarizeVisualRun <-- per-view results <----------------/
        |
        v
  blocking = strict && failed > 0   (false by default: the build is not blocked)
```

## Edge cases

- Playwright or its browser is absent (a bare checkout, this sandbox):
  `npm test` still passes, because the spec file is not collected and the pure
  test imports nothing from Playwright.
- The web seed or a click fails: that view is recorded as failed; the run
  continues to the next view and the report names the failing step.
- A network only used by the map (ESRI basemap, flag CDN): its absence changes
  pixels, not the run; the pixel tolerance absorbs the rest, and the artifact
  shows the difference for a human.
- No baselines committed yet: every view is missing and recorded; with
  `continue-on-error` the build is green and the report is the deliverable.

## Testing

- `visual/views.test.js` (new, `node --test`): every view id is unique and
  kebab-case; every view has at least one step and a `waitFor`; `visualPolicy`
  defaults are non-strict and non-update and `OH_VISUAL_STRICT`/`OH_VISUAL_UPDATE`
  flip only their own flag; `summarizeVisualRun` counts statuses and sets
  `blocking` only under strict.
- `npm test` stays green with the added glob; `npm run build` is untouched (no
  `src/` change).
- Playwright itself is exercised in CI, not in the sandbox. This is stated here
  rather than implied.

## Files

- New: `docs/specs/2026-10-07-visual-regression-design.md`,
  `visual/views.mjs`, `visual/views.test.js`, `visual/visual.spec.mjs`,
  `visual/playwright.config.mjs`, `.github/workflows/visual-regression.yml`.
- Edit: `package.json` (`@playwright/test` devDependency, `test:visual` scripts,
  the `test` glob), `package-lock.json`, `vite.config.ts` (the
  `allowedHosts` the project rule requires so the seeded host can serve the
  harness), `docs/wiki.md` (point section 6 at the committed job).

## Open questions

1. Should the job ever gate? Not now: the roadmap calls it non-blocking and a
   network-dependent map makes a hard gate a flake source. `OH_VISUAL_STRICT`
   exists so an owner can try it in a branch without changing the workflow.
2. Should baselines be refreshed from a scheduled job? Deferred; the update
   command is manual so a regression cannot be blessed by a cron.

## TODO

- [x] Write `visual/views.mjs` + `visual/views.test.js` (TDD).
- [x] Write the Playwright config and spec.
- [x] Add the non-blocking workflow and npm scripts, update the lock.
- [x] Run `npm test` and `npm run build`; confirm the pure plan is covered and
      the build is untouched.
