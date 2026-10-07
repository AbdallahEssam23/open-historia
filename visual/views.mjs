/*! Open Historia — visual regression plan © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The pure half of the visual job: what is captured and how a run is judged.
// No Playwright import lives here, so `node --test visual/views.test.js` runs on
// a bare checkout and the deterministic contract is covered by the main suite.
//
// A view is a named screenshot. `steps` is a small declarative vocabulary the
// runner in visual.spec.mjs interprets; the plan holds only accessible label
// text, which is the one thing that moves when UI copy changes.

export const VISUAL_STEP_KEYS = [
  "dismissSetup",
  "clickRole",
  "clickAnyRole",
  "clickText",
  "waitForRole",
  "waitForText",
  "waitForMapIdle",
  "waitMs",
  "pressEscape",
];

// Exact-label clicks, preferring a button: docs/wiki.md documents that a looser
// match once photographed the main menu for an entire pass.
export const VISUAL_VIEWS = [
  {
    id: "library",
    description: "The seeded game library with the built-in default scenario.",
    waitFor: "a Play or Current button on the default game card",
    steps: [
      { dismissSetup: true },
      { waitForRole: "Play" },
    ],
  },
  {
    id: "map",
    description: "The tactical map once the polity layers settle and it goes idle.",
    waitFor: "the oh:map-idle event from mapReadiness.js",
    steps: [
      { dismissSetup: true },
      { clickAnyRole: ["Play", "Current"] },
      { waitForMapIdle: true },
      { waitMs: 800 },
    ],
  },
  {
    id: "map-heatmap",
    description: "The map with the native strategic heatmap overlay switched on.",
    waitFor: "the heatmap toggle applied after the map is idle",
    steps: [
      { dismissSetup: true },
      { clickAnyRole: ["Play", "Current"] },
      { waitForMapIdle: true },
      { clickRole: "Settings" },
      { clickText: "Strategic heatmap" },
      { pressEscape: true },
      { waitMs: 800 },
    ],
  },
  {
    id: "stats-world",
    description: "The Stats panel's World analytics tab (ranked bar and share doughnut).",
    waitFor: "the World analytics section",
    steps: [
      { dismissSetup: true },
      { clickAnyRole: ["Play", "Current"] },
      { waitForMapIdle: true },
      { clickRole: "Stats" },
      { clickText: "World" },
      { waitMs: 500 },
    ],
  },
  {
    id: "stats-chronicle",
    description: "The read-only Chronicle sub-tab in the Stats panel.",
    waitFor: "the Chronicle section",
    steps: [
      { dismissSetup: true },
      { clickAnyRole: ["Play", "Current"] },
      { waitForMapIdle: true },
      { clickRole: "Stats" },
      { clickText: "Chronicle" },
      { waitMs: 500 },
    ],
  },
];

export const VISUAL_POLICY_DEFAULTS = {
  strict: false,
  update: false,
  // The map carries network imagery (ESRI basemap, flag CDN) that is not
  // byte-stable across machines, so the tolerance is generous and the job is
  // non-blocking besides. These bounds catch a collapsed layout, not a re-render.
  maxDiffPixels: 150,
  maxDiffPixelRatio: 0.002,
  threshold: 0.2,
  viewport: { width: 1280, height: 800 },
  timeoutMs: 60_000,
  mapIdleTimeoutMs: 120_000,
  settleMs: 500,
  baseURL: "http://localhost:4173",
};

const isTruthyFlag = (value) => ["1", "true"].includes(String(value ?? "").trim().toLowerCase());

export function visualPolicy(env = {}) {
  return {
    ...VISUAL_POLICY_DEFAULTS,
    viewport: { ...VISUAL_POLICY_DEFAULTS.viewport },
    strict: isTruthyFlag(env.OH_VISUAL_STRICT),
    update: isTruthyFlag(env.OH_VISUAL_UPDATE),
  };
}

// The whole non-blocking contract: a run blocks only when strict was asked for
// and something actually failed. Everything else is a report, not a gate.
export function summarizeVisualRun(results = [], { strict = false } = {}) {
  let passed = 0;
  let skipped = 0;
  const diffs = [];
  for (const result of results) {
    const status = result && result.status;
    if (status === "passed") passed += 1;
    else if (status === "skipped") skipped += 1;
    else diffs.push(result && result.id);
  }
  const failed = diffs.length;
  return {
    total: results.length,
    passed,
    failed,
    skipped,
    diffs,
    blocking: Boolean(strict) && failed > 0,
  };
}
