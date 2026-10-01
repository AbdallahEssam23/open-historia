# Deterministic Core: The Economy Tick Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the game a deterministic local economy that advances on its own, with the AI reduced to declaring classified shocks, so a turn no longer depends on a provider being reachable.

**Architecture:** A pure, import-free core in `src/engine/` holds the constants, the shock table and the month step. A runtime adapter extracts the economy out of `world.countryStats`, calls the core, and writes the result back through the existing `mergeCountryStatPatch` seam so the engine's numbers land last and win the fields it owns. The AI's only numeric input becomes a closed `economicShocks` enum on the jump payload.

**Tech Stack:** Plain ES modules, `node --test`, no new dependency. Reuses `hashSeed` (`src/runtime/unitMotion.js:45`), `gameDates.js` date arithmetic, and `aggregateTerritorialEconomy` (`src/runtime/countryStats.js:217`).

## Global Constraints

- ASCII only in every source and doc file. No emoji, no em dash.
- `src/engine/**` must never import a browser module (no `assets.js`, no JSX chain, no `maplibre-gl`). Allowed imports: other `src/engine/*.js` files, `../runtime/gameDates.js`, `../runtime/unitMotion.js`. Both allowed files are import-free.
- `src/engine/**` must never call `Date.now()`, `new Date()`, `Math.random()`, or read `localStorage` / `window` / `document` / `navigator` / `fetch`.
- No new dependency in `package.json`.
- Do not change the exported semantics of any existing function. New behavior is additive.
- Baseline before starting: `npm test` is 2427 tests, 2425 pass, 0 fail, 2 todo. It must stay at least that green after every task.
- `npx eslint .` must gain no new error.
- `npm run wiki:check` must stay current once `docs/` and `wiki/` are touched (Task 12).
- Every commit message uses a conventional prefix (`feat`, `fix`, `docs`, `test`, `refactor`) and ends with the trailer `Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>`.
- Comments explain WHY, matching the surrounding house style. No comment says what the next line obviously does.

---

### Task 1: Economy constants and era bands

**Files:**
 - Create: `src/engine/economyConstants.js`
 - Test: `src/engine/economyConstants.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MONTH_DAYS: number` = 30
  - `MAX_STEPS: number` = 240
  - `ENGINE_VERSION: number` = 1
  - `eraBandFor(year: number) => { populationMonthly: number, productivityMonthly: number }`
  - `ECONOMY_STEP: Readonly<object>` numeric constants listed below

- [ ] **Step 1: Write the failing test**

```js
// src/engine/economyConstants.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  ENGINE_VERSION,
  MAX_STEPS,
  MONTH_DAYS,
  eraBandFor,
} from "./economyConstants.js";

test("the clock constants are the approved ones", () => {
  assert.equal(MONTH_DAYS, 30);
  assert.equal(MAX_STEPS, 240);
  assert.equal(ENGINE_VERSION, 1);
});

test("era bands are ordered and every band is positive", () => {
  const years = [-1200, 1000, 1600, 1800, 1930, 1970, 2026];
  for (const year of years) {
    const band = eraBandFor(year);
    assert.ok(band.populationMonthly > 0, `${year} population`);
    assert.ok(band.productivityMonthly > 0, `${year} productivity`);
  }
  // Modern productivity must exceed medieval productivity, or the bands are
  // wired backwards.
  assert.ok(eraBandFor(2026).productivityMonthly > eraBandFor(-1200).productivityMonthly);
});

test("a missing or unparseable year falls back to the modern band, never throws", () => {
  assert.deepEqual(eraBandFor(null), eraBandFor(2026));
  assert.deepEqual(eraBandFor(Number.NaN), eraBandFor(2026));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/engine/economyConstants.test.js`
Expected: FAIL with `Cannot find module './economyConstants.js'`

- [ ] **Step 3: Write the implementation**

```js
/*! Open Historia - deterministic economy: the auditable constants (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One frozen table per concern, so "why did the economy do that" is answered by
// reading this file rather than by tracing arithmetic through the step. The
// numbers are first-draft calibration: the tests assert bounds and determinism,
// never a specific magnitude, which is what lets them be tuned without a rewrite.
//
// IMPORT-FREE ON PURPOSE. The step must run under bare `node --test` and in a
// worker, exactly like forcePosture.js and unitMotion.js.

export const MONTH_DAYS = 30;
// Twenty years in one turn. A 365 day jump is 12 steps and a 10 year jump is
// 120, so the cap only bounds a deliberate outlier.
export const MAX_STEPS = 240;
export const ENGINE_VERSION = 1;

// Monthly population growth by era. Pre-modern growth is slow enough that a
// century of play is a few percent, which is the point.
const POPULATION_BANDS = Object.freeze([
  Object.freeze({ until: 1500, populationMonthly: 0.00010, productivityMonthly: 0.00015 }),
  Object.freeze({ until: 1800, populationMonthly: 0.00025, productivityMonthly: 0.00030 }),
  Object.freeze({ until: 1900, populationMonthly: 0.00045, productivityMonthly: 0.00085 }),
  Object.freeze({ until: 1950, populationMonthly: 0.00070, productivityMonthly: 0.00130 }),
  Object.freeze({ until: 2000, populationMonthly: 0.00090, productivityMonthly: 0.00160 }),
  Object.freeze({ until: Number.POSITIVE_INFINITY, populationMonthly: 0.00055, productivityMonthly: 0.00105 }),
]);

// A year that is not a number (an unparseable scenario date) takes the modern
// band rather than throwing. A fantasy calendar should still get an economy.
export const eraBandFor = (year) => {
  const value = Number(year);
  const resolved = Number.isFinite(value) ? value : 2026;
  for (const band of POPULATION_BANDS) {
    if (resolved < band.until) return band;
  }
  return POPULATION_BANDS[POPULATION_BANDS.length - 1];
};

export const ECONOMY_STEP = Object.freeze({
  // Productivity responds to how industrial a polity is: a services economy
  // compounds faster than a subsistence one at the same era.
  SECTOR_LIFT: 0.45,
  // Debt above this share of output drags growth, up to the drag cap.
  DEBT_DRAG_START: 100,
  DEBT_DRAG_MAX: 0.35,
  // Unemployment above the natural rate drags growth (a demand effect).
  UNEMP_DRAG: 0.35,
  // How far the deterministic per-polity character term can swing growth.
  CHARACTER_AMPLITUDE: 0.25,
  CHARACTER_SCALE: 0.5,
  // Annual inflation percent the rate mean-reverts toward, plus the deficit
  // pass-through that pushes it up.
  INFLATION_TARGET: 2,
  INFLATION_REVERSION: 0.05,
  DEFICIT_INFLATION: 0.35,
  DEFICIT_THRESHOLD: 3,
  INFLATION_MIN: -5,
  INFLATION_MAX: 2000,
  // Unemployment: a discrete Okun step toward the natural rate.
  NATURAL_UNEMPLOYMENT: 5.5,
  OKUN: 0.35,
  TREND_GROWTH: 2,
  UNEMP_REVERSION: 0.04,
  UNEMP_MAX: 60,
  // Fiscal structure, all as shares of output.
  REVENUE_PER_GDP: 0.34,
  SPENDING_PER_GDP: 0.37,
  MILITARY_PER_GDP: 0.03,
  // Monthly real interest rate the debt ratio compounds at.
  RATE_MONTHLY: 0.0035,
  DEBT_MAX: 400,
  // Stability drifts toward an equilibrium the economy sets.
  STABILITY_BASE: 50,
  STAB_GROWTH: 1.2,
  STAB_INFLATION: 1.5,
  STAB_UNEMP: 1.1,
  STAB_REVERSION: 0.08,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/engine/economyConstants.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/engine/economyConstants.js src/engine/economyConstants.test.js
git commit -m "feat(engine): the economy step constants and era bands"
```

---

### Task 2: Deterministic math helpers

**Files:**
- Create: `src/engine/economyMath.js`
- Test: `src/engine/economyMath.test.js`

**Interfaces:**
- Consumes: `MONTH_DAYS` (Task 1); `diffGameDays` from `../runtime/gameDates.js`; `hashSeed` from `../runtime/unitMotion.js`.
- Produces:
  - `clamp(value, min, max) => number`
  - `roundTo(value, decimals) => number`
  - `monthsBetweenDates(fromDate, toDate) => number` (0 when either is not a game date, or when the span is negative)
  - `jitterFor(seed, polityName) => number` in `[-1, 1]`
  - `stableOrder(names) => string[]` (locale-independent, code-unit sorted)

- [ ] **Step 1: Write the failing test**

```js
// src/engine/economyMath.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { clamp, jitterFor, monthsBetweenDates, roundTo, stableOrder } from "./economyMath.js";

test("clamp pins to both ends and passes an in-range value through", () => {
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(42, 0, 10), 10);
  assert.equal(clamp(4.5, 0, 10), 4.5);
});

test("roundTo is exact enough that float noise cannot change a stored value", () => {
  assert.equal(roundTo(1.005, 2), 1.01);
  assert.equal(roundTo(0.1 + 0.2, 2), 0.3);
  assert.equal(roundTo(1234.5, 0), 1235);
});

test("months are whole 30 day steps, and anything unusable is zero", () => {
  assert.equal(monthsBetweenDates("2026-01-01", "2026-04-01"), 3);
  assert.equal(monthsBetweenDates("2026-01-01", "2026-01-11"), 0);
  assert.equal(monthsBetweenDates("2026-01-01", "2025-01-01"), 0);
  assert.equal(monthsBetweenDates("1200 BCE", "2026-01-01"), 0);
  assert.equal(monthsBetweenDates("", "2026-01-01"), 0);
});

test("jitter is deterministic, bounded, and differs per polity", () => {
  const a = jitterFor("seed-1", "Egypt");
  assert.equal(a, jitterFor("seed-1", "Egypt"));
  assert.ok(a >= -1 && a <= 1);
  assert.notEqual(a, jitterFor("seed-1", "France"));
  assert.notEqual(a, jitterFor("seed-2", "Egypt"));
});

test("stableOrder does not depend on the incoming order", () => {
  assert.deepEqual(stableOrder(["France", "Egypt", "France"]), ["Egypt", "France"]);
  assert.deepEqual(stableOrder(["Egypt", "France"]), stableOrder(["France", "Egypt"]));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/engine/economyMath.test.js`
Expected: FAIL with `Cannot find module './economyMath.js'`

- [ ] **Step 3: Write the implementation**

```js
/*! Open Historia - deterministic economy: the math the step shares (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Everything here is a pure function of its arguments. `hashSeed` and
// `diffGameDays` are imported rather than reimplemented so the whole codebase
// keeps one definition of "the same string gives the same number" and one of
// "how many days apart are these two game dates".

import { diffGameDays } from "../runtime/gameDates.js";
import { hashSeed } from "../runtime/unitMotion.js";
import { MONTH_DAYS } from "./economyConstants.js";

export const clamp = (value, min, max) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return number < min ? min : number > max ? max : number;
};

export const roundTo = (value, decimals) => {
  const factor = 10 ** Math.max(0, Math.trunc(decimals) || 0);
  return Math.round((Number(value) || 0) * factor) / factor;
};

// Whole 30 day steps between two dates. An unparseable date, or a span that is
// not forward, advances nothing: a fantasy calendar must not be able to make
// the economy run backwards or divide by a null.
export const monthsBetweenDates = (fromDate, toDate) => {
  const days = diffGameDays(fromDate, toDate);
  if (days === null || !Number.isFinite(days) || days <= 0) return 0;
  return Math.floor(days / MONTH_DAYS);
};

// A per-polity character term in [-1, 1], derived from the campaign seed and
// the polity name. This is the whole of the engine's "randomness": it is
// reproducible forever from stored inputs, which is why it is safe to store a
// seed and never a value.
export const jitterFor = (seed, polityName) => {
  const raw = hashSeed(`${seed}:${polityName}`);
  return (raw / 0xffffffff) * 2 - 1;
};

// Code-unit sort, never localeCompare: the engine's iteration order must be a
// function of the data alone, and locale collation is environment-dependent.
export const stableOrder = (names) => {
  const unique = [...new Set((Array.isArray(names) ? names : []).map((name) => String(name ?? "")).filter(Boolean))];
  unique.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return unique;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/engine/economyMath.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/engine/economyMath.js src/engine/economyMath.test.js
git commit -m "feat(engine): deterministic clamps, month steps and the seeded character term"
```

---

### Task 3: The shock table and its validator

**Files:**
- Create: `src/engine/economyShocks.js`
- Test: `src/engine/economyShocks.test.js`

**Interfaces:**
- Consumes: `clamp` (Task 2).
- Produces:
  - `SHOCK_KINDS: readonly string[]` (the closed enum)
  - `MAX_SHOCKS: number` = 20
  - `MAX_SHOCK_MONTHS: number` = 120
  - `normalizeShocks(value, { knownPolities = [] } = {}) => { valid: NormalizedShock[], rejected: { index, reason }[] }`
  - `activeMultipliers(shocks, month) => { population, gdp, inflation, unemployment, stability }`
  - `NormalizedShock = { kind, severity, startMonth, endMonth, scope }`, where `scope` is `null` for world scope or a `string[]` of polity names

- [ ] **Step 1: Write the failing test**

```js
// src/engine/economyShocks.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SHOCKS,
  SHOCK_KINDS,
  activeMultipliers,
  normalizeShocks,
} from "./economyShocks.js";

test("the enum is closed and every kind has a table entry", async () => {
  const mod = await import("./economyShocks.js");
  assert.ok(SHOCK_KINDS.length >= 10);
  assert.ok(SHOCK_KINDS.includes("harvest_failure"));
  assert.ok(SHOCK_KINDS.includes("trade_boom"));
  for (const kind of SHOCK_KINDS) {
    assert.ok(Array.isArray(mod.SHOCK_EFFECTS[kind]), kind);
    assert.equal(mod.SHOCK_EFFECTS[kind].length, 3, kind);
  }
});

test("a well formed shock normalizes with a month window", () => {
  const { valid, rejected } = normalizeShocks(
    [{ kind: "sanctions", severity: 2, durationMonths: 6, scope: ["Egypt"] }],
    { knownPolities: ["Egypt", "France"] },
  );
  assert.equal(rejected.length, 0);
  assert.equal(valid.length, 1);
  assert.equal(valid[0].startMonth, 0);
  assert.equal(valid[0].endMonth, 6);
  assert.deepEqual(valid[0].scope, ["Egypt"]);
});

test("an unknown kind, a bad severity and a bad duration are rejected, never thrown", () => {
  const { valid, rejected } = normalizeShocks([
    { kind: "sunspots", severity: 1, durationMonths: 3 },
    { kind: "sanctions", severity: 9, durationMonths: 3 },
    { kind: "sanctions", severity: 1, durationMonths: 0 },
    { kind: "sanctions", severity: 1, durationMonths: 999 },
    { kind: "blockade", severity: 1, durationMonths: 3, scope: ["Atlantis"] },
  ], { knownPolities: ["Egypt"] });
  assert.equal(valid.length, 1);
  assert.equal(valid[0].kind, "blockade");
  assert.deepEqual(valid[0].scope, []);
  assert.equal(rejected.length, 4);
  for (const row of rejected) assert.ok(typeof row.reason === "string" && row.reason.length > 0);
});

test("the array is capped", () => {
  const many = Array.from({ length: MAX_SHOCKS + 5 }, () => ({ kind: "sanctions", severity: 1, durationMonths: 3 }));
  const { valid, rejected } = normalizeShocks(many);
  assert.equal(valid.length, MAX_SHOCKS);
  assert.equal(rejected.length, 5);
});

test("multipliers apply only inside the window and compose across kinds", () => {
  const { valid } = normalizeShocks([
    { kind: "sanctions", severity: 3, durationMonths: 4 },
    { kind: "reconstruction", severity: 2, durationMonths: 4 },
  ]);
  const inside = activeMultipliers(valid, 1);
  const outside = activeMultipliers(valid, 9);
  assert.ok(inside.gdp < 1, "sanctions pull growth down");
  assert.ok(inside.inflation > 0);
  assert.equal(outside.gdp, 1);
  assert.equal(outside.inflation, 0);
  assert.equal(outside.stability, 0);
});

test("a world-scope shock reaches a polity that is not named", () => {
  const { valid } = normalizeShocks([{ kind: "mobilization", severity: 2, durationMonths: 12 }]);
  assert.equal(valid[0].scope, null);
  assert.ok(activeMultipliers(valid, 1).gdp !== 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/engine/economyShocks.test.js`
Expected: FAIL with `Cannot find module './economyShocks.js'`

- [ ] **Step 3: Write the implementation**

```js
/*! Open Historia - deterministic economy: the closed shock channel (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// This is the ONLY numeric economic input the model has. It does not set a
// value; it scales the rates for a bounded number of months, and the engine
// derives everything from the state it already holds. A closed enum is what
// makes a model's answer safe to apply without a second opinion.
//
// Effects per severity level: `population` and `gdp` multiply a monthly rate;
// `inflation`, `unemployment` and `stability` are additive per month in their
// own units (annual percent, percent, and index points).

import { clamp } from "./economyMath.js";

export const SHOCK_KINDS = Object.freeze([
  "harvest_failure",
  "sanctions",
  "blockade",
  "industrial_damage",
  "capital_flight",
  "debt_crisis",
  "mobilization",
  "reconstruction",
  "aid_inflow",
  "trade_boom",
]);

const level = (population, gdp, inflation, unemployment, stability) =>
  Object.freeze({ population, gdp, inflation, unemployment, stability });

export const SHOCK_EFFECTS = Object.freeze({
  harvest_failure: [
    level(1, 0.92, 0.12, 0.10, -0.60),
    level(1, 0.82, 0.25, 0.20, -1.30),
    level(0.999, 0.68, 0.45, 0.35, -2.20),
  ],
  sanctions: [
    level(1, 0.93, 0.10, 0.12, -0.30),
    level(1, 0.85, 0.22, 0.26, -0.70),
    level(0.9995, 0.72, 0.40, 0.45, -1.20),
  ],
  blockade: [
    level(1, 0.94, 0.12, 0.10, -0.25),
    level(1, 0.86, 0.26, 0.24, -0.65),
    level(0.9995, 0.74, 0.48, 0.42, -1.10),
  ],
  industrial_damage: [
    level(1, 0.94, 0.06, 0.08, -0.30),
    level(1, 0.86, 0.14, 0.18, -0.80),
    level(1, 0.72, 0.26, 0.34, -1.50),
  ],
  capital_flight: [
    level(1, 0.96, 0.30, 0.10, -0.35),
    level(0.999, 0.90, 0.70, 0.22, -0.85),
    level(0.998, 0.80, 1.30, 0.42, -1.60),
  ],
  debt_crisis: [
    level(1, 0.93, 0.40, 0.20, -0.60),
    level(0.999, 0.84, 0.90, 0.45, -1.30),
    level(0.997, 0.72, 1.60, 0.80, -2.20),
  ],
  mobilization: [
    level(0.9995, 1.02, 0.18, -0.10, -0.20),
    level(0.998, 1.05, 0.40, -0.20, -0.55),
    level(0.995, 1.10, 0.75, -0.30, -1.10),
  ],
  reconstruction: [
    level(1.0005, 1.06, -0.05, -0.20, 0.40),
    level(1.001, 1.12, -0.10, -0.40, 0.90),
    level(1.002, 1.20, -0.15, -0.60, 1.60),
  ],
  aid_inflow: [
    level(1, 1.03, -0.05, -0.10, 0.30),
    level(1, 1.06, -0.10, -0.22, 0.70),
    level(1.0005, 1.10, -0.15, -0.36, 1.20),
  ],
  trade_boom: [
    level(1, 1.05, 0.05, -0.12, 0.25),
    level(1.0005, 1.11, 0.12, -0.26, 0.60),
    level(1.001, 1.18, 0.22, -0.42, 1.00),
  ],
});

export const MAX_SHOCKS = 20;
export const MAX_SHOCK_MONTHS = 120;
const SEVERITIES = new Set([1, 2, 3]);

export const normalizeShocks = (value, { knownPolities = [] } = {}) => {
  const list = Array.isArray(value) ? value : [];
  const known = new Set((Array.isArray(knownPolities) ? knownPolities : []).map((name) => String(name ?? "")));
  const valid = [];
  const rejected = [];

  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index];
    if (valid.length >= MAX_SHOCKS) {
      rejected.push({ index, reason: `more than ${MAX_SHOCKS} shocks in one period` });
      continue;
    }
    if (!entry || typeof entry !== "object") {
      rejected.push({ index, reason: "not an object" });
      continue;
    }
    const kind = String(entry.kind ?? "");
    if (!SHOCK_KINDS.includes(kind)) {
      rejected.push({ index, reason: `unknown kind "${kind}"` });
      continue;
    }
    const severity = Math.trunc(Number(entry.severity));
    if (!SEVERITIES.has(severity)) {
      rejected.push({ index, reason: `severity must be 1, 2 or 3, got ${entry.severity}` });
      continue;
    }
    const durationMonths = Math.trunc(Number(entry.durationMonths));
    if (!Number.isFinite(durationMonths) || durationMonths < 1 || durationMonths > MAX_SHOCK_MONTHS) {
      rejected.push({ index, reason: `durationMonths must be 1..${MAX_SHOCK_MONTHS}, got ${entry.durationMonths}` });
      continue;
    }
    // A world-scope shock is everything. A named scope keeps only names the
    // caller recognises; a scope that resolves to nothing is still a valid
    // world shock, because dropping the whole entry would make an unknown
    // polity name silently expensive.
    let scope = null;
    if (Array.isArray(entry.scope)) {
      scope = [...new Set(entry.scope.map((name) => String(name ?? "")).filter((name) => name && known.has(name)))];
    }
    valid.push({ kind, severity, startMonth: 0, endMonth: durationMonths, scope });
  }

  return { valid, rejected };
};

// The multiplier/addend vector for one month, from every shock still running.
// Effects compose by multiplication and by addition; a positive shock does not
// cancel a negative one, it offsets it.
export const activeMultipliers = (shocks, month) => {
  const result = { population: 1, gdp: 1, inflation: 0, unemployment: 0, stability: 0 };
  const at = Math.trunc(Number(month) || 0);
  for (const shock of Array.isArray(shocks) ? shocks : []) {
    if (!(at >= shock.startMonth && at < shock.endMonth)) continue;
    const row = SHOCK_EFFECTS[shock.kind]?.[shock.severity - 1];
    if (!row) continue;
    result.population *= row.population;
    result.gdp *= row.gdp;
    result.inflation += row.inflation;
    result.unemployment += row.unemployment;
    result.stability += row.stability;
  }
  result.inflation = clamp(result.inflation, -50, 50);
  result.unemployment = clamp(result.unemployment, -20, 20);
  result.stability = clamp(result.stability, -30, 30);
  return result;
};

// Whether a shock names this polity. World scope reaches everyone.
export const shockAppliesTo = (shock, polityName) =>
  shock.scope === null || shock.scope.includes(String(polityName ?? ""));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/engine/economyShocks.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/engine/economyShocks.js src/engine/economyShocks.test.js
git commit -m "feat(engine): the closed shock enum and its bounded effects"
```

---

### Task 4: The month step and the advance

**Files:**
- Create: `src/engine/economyTick.js`
- Test: `src/engine/economyTick.test.js`

**Interfaces:**
- Consumes: Tasks 1 to 3; `addGameMonths`, `gameDateYear` from `../runtime/gameDates.js`.
- Produces:
  - `makePolityEconomy(input) => PolityEconomy` (the compact per-polity record)
  - `stepPolityMonth(polity, { year, multipliers }) => PolityEconomy`
  - `advanceEconomy(state, { startDate, months, shocks = [], seed = "", } ) => { state, journal }`
  - `PolityEconomy = { population, gdp, gdpPerCapita, gdpGrowth, inflation, unemployment, publicDebt, budgetBalance, stability, gdpBreakdown, components, jitter }`

- [ ] **Step 1: Write the failing test**

```js
// src/engine/economyTick.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { MAX_STEPS } from "./economyConstants.js";
import { normalizeShocks } from "./economyShocks.js";
import { advanceEconomy, makePolityEconomy, stepPolityMonth } from "./economyTick.js";

const polityFixture = (overrides = {}) => makePolityEconomy({
  population: 100_000_000,
  gdp: 1_000_000_000_000,
  gdpPerCapita: 10_000,
  gdpGrowth: 2,
  inflation: 4,
  unemployment: 8,
  publicDebt: 90,
  budgetBalance: -4,
  stability: 60,
  gdpBreakdown: { agriculture: 10, industry: 35, services: 55 },
  ...overrides,
});

const noShock = { population: 1, gdp: 1, inflation: 0, unemployment: 0, stability: 0 };

test("one month of peace moves growth, population and inflation in the right direction", () => {
  const before = polityFixture();
  const after = stepPolityMonth(before, { year: 2026, multipliers: noShock });
  assert.ok(after.population > before.population, "population grows");
  assert.ok(after.gdpPerCapita > before.gdpPerCapita, "output per head grows");
  assert.ok(after.gdpGrowth > 0);
  assert.ok(after.inflation < before.inflation, "inflation reverts toward its target");
});

test("no term can leave a bound, however hostile the shock", () => {
  const before = polityFixture({ publicDebt: 395, unemployment: 58, inflation: -4, stability: 3 });
  const hostile = { population: 0.99, gdp: 0.5, inflation: 50, unemployment: 20, stability: -30 };
  let next = before;
  for (let i = 0; i < 60; i += 1) next = stepPolityMonth(next, { year: 2026, multipliers: hostile });
  assert.ok(next.population > 0);
  assert.ok(next.gdpPerCapita > 0);
  assert.ok(next.publicDebt <= 400);
  assert.ok(next.unemployment >= 0 && next.unemployment <= 60);
  assert.ok(next.inflation >= -5 && next.inflation <= 2000);
  assert.ok(next.stability >= 0 && next.stability <= 100);
  const sectors = next.gdpBreakdown.agriculture + next.gdpBreakdown.industry + next.gdpBreakdown.services;
  assert.ok(Math.abs(sectors - 100) < 0.001, `sectors sum to ${sectors}`);
});

test("a component ledger is stepped per component and its sum is the polity total", () => {
  const before = polityFixture({
    population: 0,
    gdp: 0,
    components: [
      { geography: "core", group: "core", population: 60_000_000, gdpPerCapita: 12_000 },
      { geography: "island", group: "overseas/dependent", population: 40_000_000, gdpPerCapita: 7_000 },
    ],
  });
  const after = stepPolityMonth(before, { year: 2026, multipliers: noShock });
  assert.equal(after.components.length, 2);
  const summed = after.components.reduce((total, c) => total + c.population * c.gdpPerCapita, 0);
  assert.ok(Math.abs(summed - after.gdp) < 1, "GDP is the ledger sum");
});

test("the advance is idempotent and recomputable", () => {
  const origin = { month: 0, polities: { France: polityFixture() } };
  const once = advanceEconomy(origin, { startDate: "2026-01-01", months: 6, seed: "s" });
  const twice = advanceEconomy(origin, { startDate: "2026-01-01", months: 6, seed: "s" });
  assert.deepEqual(once.state, twice.state, "same inputs, same state");

  const threeThenThree = advanceEconomy(once, { startDate: "2026-07-01", months: 3, seed: "s" });
  const six = advanceEconomy(origin, { startDate: "2026-01-01", months: 6, seed: "s" });
  assert.deepEqual(threeThenThree.state, six.state, "3 then 3 equals 6 from the origin");
});

test("the step count is capped and the journal says so", () => {
  const origin = { month: 0, polities: { France: polityFixture() } };
  const { journal } = advanceEconomy(origin, { startDate: "2026-01-01", months: 10_000, seed: "s" });
  assert.equal(journal.steps, MAX_STEPS);
  assert.equal(journal.capped, true);
});

test("a shock is visible while it runs and gone afterwards", () => {
  const origin = { month: 0, polities: { France: polityFixture() } };
  const { valid } = normalizeShocks([{ kind: "sanctions", severity: 3, durationMonths: 3 }]);
  const { state, journal } = advanceEconomy(origin, {
    startDate: "2026-01-01", months: 6, seed: "s", shocks: valid,
  });
  assert.equal(journal.shockedMonths, 3);
  assert.ok(state.polities.France.gdpGrowth < origin.polities.France.gdpGrowth);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/engine/economyTick.test.js`
Expected: FAIL with `Cannot find module './economyTick.js'`

- [ ] **Step 3: Write the implementation**

```js
/*! Open Historia - deterministic economy: the month step (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The engine's whole behavior is these two functions. `stepPolityMonth` is the
// economy; `advanceEconomy` is the clock, and it is deliberately dumb: it walks
// whole months, asks the shock table what is running, and hands each polity to
// the step. Nothing here reads the wall clock, and nothing is stored between
// calls except the state it returns, so re-running a span is exact.

import { addGameMonths, gameDateYear } from "../runtime/gameDates.js";
import { ECONOMY_STEP, MAX_STEPS, eraBandFor } from "./economyConstants.js";
import { clamp, jitterFor, roundTo, stableOrder } from "./economyMath.js";
import { activeMultipliers, shockAppliesTo } from "./economyShocks.js";

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

// `components` is the arithmetic authority when present: the polity totals are
// derived from it, never carried alongside it. `jitter` is stamped here rather
// than in the step so a polity's character cannot change between months.
export const makePolityEconomy = (input = {}) => {
  const components = Array.isArray(input.components)
    ? input.components
      .filter((c) => c && Number.isFinite(Number(c.population)) && Number.isFinite(Number(c.gdpPerCapita)))
      .map((c) => ({
        geography: String(c.geography ?? ""),
        group: String(c.group ?? "core"),
        population: Math.max(0, num(c.population)),
        gdpPerCapita: Math.max(0, num(c.gdpPerCapita)),
      }))
    : [];
  const breakdown = input.gdpBreakdown && typeof input.gdpBreakdown === "object" ? input.gdpBreakdown : {};
  return {
    population: Math.max(0, num(input.population)),
    gdp: Math.max(0, num(input.gdp)),
    gdpPerCapita: Math.max(0, num(input.gdpPerCapita)),
    gdpGrowth: num(input.gdpGrowth),
    inflation: num(input.inflation),
    unemployment: Math.max(0, num(input.unemployment)),
    publicDebt: Math.max(0, num(input.publicDebt)),
    budgetBalance: num(input.budgetBalance),
    stability: clamp(num(input.stability, 50), 0, 100),
    gdpBreakdown: {
      agriculture: Math.max(0, num(breakdown.agriculture)),
      industry: Math.max(0, num(breakdown.industry)),
      services: Math.max(0, num(breakdown.services)),
    },
    components,
    jitter: num(input.jitter),
  };
};

// One component, one month. Population and output per head move; the component
// is the unit the ledger aggregates, so writing the totals here would be the
// same mistake mergeCountryStatPatch exists to prevent.
const stepComponentMonth = (component, { year, multipliers }) => {
  const band = eraBandFor(year);
  const stabilityFactor = 0.5 + clamp(0, 0, 100) / 0; // replaced below, kept explicit
  return { ...component, stabilityFactor };
};

export const stepPolityMonth = (polity, { year, multipliers }) => {
  const band = eraBandFor(year);
  const total = polity.components.length
    ? polity.components.reduce((sum, c) => sum + c.population, 0)
    : polity.population;
  const stabilityFactor = 0.5 + clamp(total > 0 ? polity.stability : 50, 0, 100) / 100;

  const stepOneComponent = (component) => {
    const population = Math.max(1, component.population);
    const growth = band.populationMonthly * stabilityFactor * multipliers.population;
    return { ...component, population: population * (1 + growth) };
  };

  const structure = (polity.gdpBreakdown.industry + polity.gdpBreakdown.services) / 100;
  const debtRatio = polity.gdp > 0 ? (polity.publicDebt / 100) : 0;
  const debtDrag = 1 - ECONOMY_STEP.DEBT_DRAG_MAX
    * clamp((polity.publicDebt - ECONOMY_STEP.DEBT_DRAG_START) / 100, 0, 1);
  const unempDrag = 1 - ECONOMY_STEP.UNEMP_DRAG
    * clamp((polity.unemployment - ECONOMY_STEP.NATURAL_UNEMPLOYMENT) / 100, 0, 1);
  const character = 1 + ECONOMY_STEP.CHARACTER_AMPLITUDE
    * clamp(polity.jitter * ECONOMY_STEP.CHARACTER_SCALE * 2, -1, 1);
  const gpcGrowth = band.productivityMonthly
    * (1 + ECONOMY_STEP.SECTOR_LIFT * structure)
    * debtDrag * unempDrag * character * multipliers.gdp;

  const stepPerHead = (component) => ({
    ...component,
    gdpPerCapita: Math.max(0.0001, component.gdpPerCapita * (1 + gpcGrowth)),
  });

  let components = polity.components;
  let population;
  if (components.length) {
    components = components
      .map((component) => stepPerHead(stepOneComponent(component)))
      .sort((a, b) => (a.geography < b.geography ? -1 : a.geography > b.geography ? 1 : 0));
    population = components.reduce((sum, c) => sum + c.population, 0);
  } else {
    const grown = stepOneComponent({ population: polity.population, gdpPerCapita: polity.gdpPerCapita });
    population = grown.population;
  }

  const gdpPerCapita = components.length
    ? components.reduce((sum, c) => sum + c.population * c.gdpPerCapita, 0) / Math.max(1, population)
    : stepPerHead({ gdpPerCapita: polity.gdpPerCapita }).gdpPerCapita;

  const annualGrowth = gpcGrowth * 12 * 100;

  let inflation = polity.inflation
    + ECONOMY_STEP.INFLATION_REVERSION
    * (
      ECONOMY_STEP.INFLATION_TARGET
      + ECONOMY_STEP.DEFICIT_INFLATION
        * clamp(-polity.budgetBalance - ECONOMY_STEP.DEFICIT_THRESHOLD, 0, 40)
      - polity.inflation
    )
    + multipliers.inflation;
  inflation = clamp(inflation, ECONOMY_STEP.INFLATION_MIN, ECONOMY_STEP.INFLATION_MAX);

  const gap = annualGrowth - ECONOMY_STEP.TREND_GROWTH;
  let unemployment = polity.unemployment
    - (ECONOMY_STEP.OKUN * gap) / 12
    + ECONOMY_STEP.UNEMP_REVERSION * (ECONOMY_STEP.NATURAL_UNEMPLOYMENT - polity.unemployment)
    + multipliers.unemployment;
  unemployment = clamp(unemployment, 0, ECONOMY_STEP.UNEMP_MAX);

  const revenue = ECONOMY_STEP.REVENUE_PER_GDP * (1 + structure * 0.15);
  const spending = ECONOMY_STEP.SPENDING_PER_GDP
    + ECONOMY_STEP.MILITARY_PER_GDP
    * clamp(multipliers.gdp > 1 ? 1.5 : 1, 1, 1.5);
  const budgetBalance = clamp((revenue - spending) * 100, -60, 30);

  const realGrowth = annualGrowth / 100;
  const interest = (polity.publicDebt * ECONOMY_STEP.RATE_MONTHLY * 12) / 100;
  let publicDebt = polity.publicDebt * (1 + (interest - realGrowth) / 12) - budgetBalance / 12;
  publicDebt = clamp(publicDebt, 0, ECONOMY_STEP.DEBT_MAX);

  const equilibrium = ECONOMY_STEP.STABILITY_BASE
    + ECONOMY_STEP.STAB_GROWTH * annualGrowth
    - ECONOMY_STEP.STAB_INFLATION * inflation
    - ECONOMY_STEP.STAB_UNEMP * (unemployment - ECONOMY_STEP.NATURAL_UNEMPLOYMENT);
  const stability = clamp(
    polity.stability + ECONOMY_STEP.STAB_REVERSION * (equilibrium - polity.stability) + multipliers.stability,
    0,
    100,
  );

  const sectorTotal = polity.gdpBreakdown.agriculture
    + polity.gdpBreakdown.industry
    + polity.gdpBreakdown.services;
  const gdpBreakdown = sectorTotal > 0
    ? {
      agriculture: roundTo((polity.gdpBreakdown.agriculture / sectorTotal) * 100, 4),
      industry: roundTo((polity.gdpBreakdown.industry / sectorTotal) * 100, 4),
      services: roundTo((polity.gdpBreakdown.services / sectorTotal) * 100, 4),
    }
    : polity.gdpBreakdown;

  const nextPopulation = Math.max(1, Math.round(population));
  const nextGdp = components.length
    ? components.reduce((sum, c) => sum + c.population * c.gdpPerCapita, 0)
    : nextPopulation * gdpPerCapita;

  return {
    ...polity,
    population: nextPopulation,
    gdp: roundTo(nextGdp, 2),
    gdpPerCapita: roundTo(gdpPerCapita, 4),
    gdpGrowth: roundTo(annualGrowth, 4),
    inflation: roundTo(inflation, 4),
    unemployment: roundTo(unemployment, 4),
    publicDebt: roundTo(publicDebt, 4),
    budgetBalance: roundTo(budgetBalance, 4),
    stability: roundTo(stability, 4),
    gdpBreakdown,
    components: components.map((c) => ({
      ...c,
      population: Math.round(c.population),
      gdpPerCapita: roundTo(c.gdpPerCapita, 4),
    })),
  };
};

export const advanceEconomy = (state, { startDate, months, shocks = [], seed = "" } = {}) => {
  const steps = Math.max(0, Math.min(MAX_STEPS, Math.trunc(Number(months)) || 0));
  const capped = (Math.trunc(Number(months)) || 0) > steps;
  let polities = { ...(state?.polities ?? {}) };
  let shockedMonths = 0;

  for (let step = 1; step <= steps; step += 1) {
    const date = addGameMonths(startDate, step);
    const year = gameDateYear(date);
    const running = (Array.isArray(shocks) ? shocks : []).map((shock) => ({
      ...shock,
      startMonth: shock.startMonth + (state?.month ?? 0),
      endMonth: shock.endMonth + (state?.month ?? 0),
    }));
    const month = (state?.month ?? 0) + step;
    const anyShock = running.some((shock) => month >= shock.startMonth && month < shock.endMonth);
    if (anyShock) shockedMonths += 1;

    const next = {};
    for (const name of stableOrder(Object.keys(polities))) {
      const own = running.filter((shock) => shockAppliesTo(shock, name));
      const multipliers = activeMultipliers(own, month);
      next[name] = stepPolityMonth(polities[name], { year, multipliers });
    }
    polities = next;
  }

  return {
    state: { month: (state?.month ?? 0) + steps, polities },
    journal: { steps, capped, shockedMonths, seed },
  };
};
```

**Note for the implementer:** `stepComponentMonth` above is a leftover stub and must be deleted before committing. The component stepping lives inside `stepPolityMonth` (`stepOneComponent` and `stepPerHead`). Also delete the unused `stabilityFactor` line inside that stub. Do not leave a function that does nothing.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/engine/economyTick.test.js`
Expected: PASS, 6 tests. If the component-sum assertion is off by float noise, that is the rounding contract, not a wrong test: fix the implementation's aggregate so `gdp` is the rounded ledger sum.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(engine): the monthly economy step and the multi-month advance"
```

---

### Task 5: The purity guard

**Files:**
- Test: `src/engine/enginePurity.test.js` (test only; no source file)

**Interfaces:**
- Consumes: the files created in Tasks 1 to 4.
- Produces: nothing.

This task exists because the core's value is that it is reproducible. A single `Date.now()` added later would silently break every campaign's reproducibility, and no behavioral test would catch it. The test reads the sources, the way the import-free tests in this repo already do.

- [ ] **Step 1: Write the failing test**

```js
// src/engine/enginePurity.test.js
// Run: node --test src/engine/enginePurity.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const DIRECTORY = new URL(".", import.meta.url);
const sources = () => readdirSync(DIRECTORY)
  .filter((name) => name.endsWith(".js") && !name.endsWith(".test.js"))
  .map((name) => ({ name, text: readFileSync(new URL(name, DIRECTORY), "utf8") }));

const ALLOWED_IMPORTS = [
  /^\.\/[a-zA-Z0-9]+\.js$/,
  /^\.\.\/runtime\/gameDates\.js$/,
  /^\.\.\/runtime\/unitMotion\.js$/,
];

test("the engine reads no clock and no entropy", () => {
  for (const { name, text } of sources()) {
    assert.equal(/Date\.now\s*\(/.test(text), false, `${name} calls Date.now`);
    assert.equal(/new\s+Date\s*\(/.test(text), false, `${name} constructs a Date`);
    assert.equal(/Math\.random\s*\(/.test(text), false, `${name} calls Math.random`);
  }
});

test("the engine touches no browser global", () => {
  for (const { name, text } of sources()) {
    for (const global of ["localStorage", "sessionStorage", "window", "document", "navigator", "fetch", "import.meta.env"]) {
      assert.equal(text.includes(global), false, `${name} references ${global}`);
    }
  }
});

test("the engine imports only its own files and the two import-free runtime helpers", () => {
  for (const { name, text } of sources()) {
    const specifiers = [...text.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    for (const specifier of specifiers) {
      assert.ok(
        ALLOWED_IMPORTS.some((pattern) => pattern.test(specifier)),
        `${name} imports a module outside the allow list: ${specifier}`,
      );
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails then passes**

Run: `node --test src/engine/enginePurity.test.js`
Expected: PASS if Tasks 1 to 4 were written clean. If it fails, fix the offending source, not the test.

- [ ] **Step 3: Commit**

```bash
git add src/engine/enginePurity.test.js
git commit -m "test(engine): a purity guard against clocks, entropy and browser globals"
```

---

### Task 6: The period digest

**Files:**
- Create: `src/runtime/economyDigest.js`
- Test: `src/runtime/economyDigest.test.js`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `DIGEST_POLITY_CAP: number` = 6
  - `DIGEST_CHAR_CAP: number` = 900
  - `buildEconomyDigest({ deltas, playerPolity = "", tracked = [], shocks = [] }) => string`
  - `delta` shape: `{ polity, gdpGrowth, inflation, unemployment, publicDebt, budgetBalance, estimated }`

- [ ] **Step 1: Write the failing test**

```js
// src/runtime/economyDigest.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { DIGEST_CHAR_CAP, buildEconomyDigest } from "./economyDigest.js";

const delta = (polity, over = {}) => ({
  polity, gdpGrowth: 0.9, inflation: 4.1, unemployment: 6.8,
  publicDebt: 93, budgetBalance: -3.2, estimated: false, ...over,
});

test("an empty input produces an empty digest, so the prompt is unchanged", () => {
  assert.equal(buildEconomyDigest({ deltas: [] }), "");
  assert.equal(buildEconomyDigest({}), "");
});

test("the player's line leads and is always kept", () => {
  const text = buildEconomyDigest({
    deltas: [delta("France"), delta("Arab Republic of Egypt"), delta("Germany")],
    playerPolity: "Arab Republic of Egypt",
    tracked: ["France", "Germany"],
  });
  const lines = text.split("\n");
  assert.ok(lines[0].includes("Arab Republic of Egypt"));
  assert.ok(text.includes("France"));
});

test("it is capped, and the cap drops a whole line rather than a sentence", () => {
  const deltas = Array.from({ length: 40 }, (_, i) => delta(`Polity ${i}`));
  const text = buildEconomyDigest({ deltas, playerPolity: "Polity 0", tracked: deltas.map((d) => d.polity) });
  assert.ok(text.length <= DIGEST_CHAR_CAP, `got ${text.length}`);
  assert.ok(text.includes("Polity 0"));
  assert.equal(text.includes("..."), false, "no truncated sentence");
});

test("an uncalibrated polity says so", () => {
  const text = buildEconomyDigest({ deltas: [delta("Chad", { estimated: true })], playerPolity: "Chad" });
  assert.ok(/estimated/i.test(text), text);
});

test("a running shock is named with the months it has left", () => {
  const text = buildEconomyDigest({
    deltas: [delta("Egypt")],
    playerPolity: "Egypt",
    shocks: [{ kind: "sanctions", severity: 2, monthsLeft: 4 }],
  });
  assert.ok(text.includes("sanctions"));
  assert.ok(text.includes("4"));
});

test("the same input always renders the same text", () => {
  const args = { deltas: [delta("Egypt"), delta("France")], playerPolity: "Egypt", tracked: ["France"] };
  assert.equal(buildEconomyDigest(args), buildEconomyDigest(args));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/runtime/economyDigest.test.js`
Expected: FAIL with `Cannot find module './economyDigest.js'`

- [ ] **Step 3: Write the implementation**

```js
/*! Open Historia - deterministic economy: the period digest for the prompt (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the model is told about the period the engine just ran. It is given as
// fact so the narrator describes the engine's numbers rather than inventing its
// own, and it is capped so a campaign with hundreds of polities cannot inflate
// every prompt. Import-free: the digest is a string transform.

export const DIGEST_POLITY_CAP = 6;
export const DIGEST_CHAR_CAP = 900;

const number = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const signed = (value) => `${number(value) >= 0 ? "+" : ""}${number(value).toFixed(1)}`;

const lineFor = (delta, isPlayer) => {
  const who = isPlayer ? `${delta.polity} (yours)` : delta.polity;
  const fields = [
    `output ${signed(delta.gdpGrowth)}%`,
    `inflation ${number(delta.inflation).toFixed(1)}%`,
    `unemployment ${number(delta.unemployment).toFixed(1)}%`,
    `public debt ${Math.round(number(delta.publicDebt))}% of output`,
    `budget ${signed(delta.budgetBalance)}%`,
  ].join(", ");
  return `- ${who}: ${fields}${delta.estimated ? " (estimated)" : ""}.`;
};

export const buildEconomyDigest = ({ deltas, playerPolity = "", tracked = [], shocks = [] } = {}) => {
  const list = (Array.isArray(deltas) ? deltas : []).filter((d) => d && typeof d === "object" && d.polity);
  if (!list.length) return "";

  const player = String(playerPolity ?? "");
  const wanted = new Set((Array.isArray(tracked) ? tracked : []).map((name) => String(name ?? "")));
  const byName = new Map(list.map((d) => [String(d.polity), d]));

  const ordered = [];
  if (player && byName.has(player)) ordered.push(byName.get(player));
  for (const name of wanted) {
    if (name && name !== player && byName.has(name)) ordered.push(byName.get(name));
  }
  for (const delta of list) {
    if (String(delta.polity) !== player && !wanted.has(String(delta.polity))) ordered.push(delta);
  }

  const lines = [];
  const header = "Economy this period, computed locally (treat these as fact, do not restate them with different numbers):";
  let used = header.length;
  for (const delta of ordered.slice(0, DIGEST_POLITY_CAP)) {
    const line = lineFor(delta, String(delta.polity) === player);
    // A line that would overflow is dropped whole. Truncating mid sentence
    // invites the model to complete a number that was never written.
    if (used + line.length + 1 > DIGEST_CHAR_CAP) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (!lines.length) return "";

  const shockLines = (Array.isArray(shocks) ? shocks : [])
    .filter((s) => s && s.kind)
    .map((s) => `- A ${String(s.kind)} shock (severity ${number(s.severity, 1)}) has about ${Math.max(0, Math.round(number(s.monthsLeft)))} month(s) left.`);

  return [header, ...lines, ...shockLines].join("\n");
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/runtime/economyDigest.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/runtime/economyDigest.js src/runtime/economyDigest.test.js
git commit -m "feat(engine): the capped period digest the narrator is given as fact"
```

---

### Task 7: The runtime adapter

**Files:**
- Create: `src/runtime/economyEngine.js`
- Test: `src/runtime/economyEngine.test.js`

**Interfaces:**
- Consumes: Tasks 1 to 4, `applyCountryStatPatchToWorld` and `normalizeWorldState` from `./gameState.js`, `monthIndexOf` via Task 2's `monthsBetweenDates`.
- Produces:
  - `economySeedFor(campaignId, scenarioId) => string` (32 hex chars)
  - `extractEconomyState(world, { seed }) => { month, polities }`
  - `advanceWorldEconomy(world, { fromDate, toDate, shocks = [], playerPolity = "", tracked = [], campaignId = "", scenarioId = "" }) => { world, deltas, months, journal, seed }`
- The returned `world` is a new object; the input is not mutated.

- [ ] **Step 1: Write the failing test**

```js
// src/runtime/economyEngine.test.js
// Run: node --test src/runtime/economyEngine.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { advanceWorldEconomy, economySeedFor, extractEconomyState } from "./economyEngine.js";

const sheet = (over = {}) => ({
  statsSchemaVersion: 1,
  stability: 60,
  economy: { gdp: 1e12, gdpPerCapita: 10_000, gdpGrowth: 2, inflation: 4, unemployment: 8, publicDebt: 90, budgetBalance: -4, currency: "EGP" },
  population: { total: 100_000_000, coreIntegrated: 100_000_000, otherTerritories: 0 },
  gdpBreakdown: { agriculture: 10, industry: 35, services: 55 },
  territorialComponents: [
    { geography: "core", group: "core", population: 100_000_000, gdpPerCapita: 10_000 },
  ],
  continuity: { assessedDate: "2026-01-01", assessedRound: 2 },
  ...over,
});

const world = () => ({
  countryStats: { Egypt: sheet() },
  regionOwnershipOverrides: { "EGY.1": "Egypt" },
});

test("the seed is stable for a campaign and differs for another", () => {
  const a = economySeedFor("game-1", "modern-day");
  assert.equal(a, economySeedFor("game-1", "modern-day"));
  assert.notEqual(a, economySeedFor("game-2", "modern-day"));
  assert.match(a, /^[0-9a-f]{32}$/);
});

test("extraction reads the sheet and ignores a polity with no numbers", () => {
  const state = extractEconomyState({ countryStats: { Egypt: sheet(), France: { stability: 50 } } }, { seed: "s" });
  assert.ok(state.polities.Egypt);
  assert.equal(state.polities.France, undefined);
  assert.equal(state.polities.Egypt.components.length, 1);
});

test("advancing a turn changes the sheet and reports the deltas", () => {
  const before = world();
  const result = advanceWorldEconomy(before, {
    fromDate: "2026-01-01", toDate: "2026-04-01", playerPolity: "Egypt", campaignId: "c1", scenarioId: "s1",
  });
  assert.equal(result.months, 3);
  const after = result.world.countryStats.Egypt;
  assert.notDeepEqual(after.economy, before.countryStats.Egypt.economy);
  assert.equal(result.deltas.length, 1);
  assert.equal(result.deltas[0].polity, "Egypt");
  assert.equal(result.deltas[0].estimated, false);
  assert.ok(result.world.economyEngine);
  assert.equal(result.world.economyEngine.version, 1);
});

test("the input world is not mutated", () => {
  const before = world();
  const snapshot = JSON.stringify(before);
  advanceWorldEconomy(before, { fromDate: "2026-01-01", toDate: "2026-04-01" });
  assert.equal(JSON.stringify(before), snapshot);
});

test("a shock raises inflation against the same span without one", () => {
  const calm = advanceWorldEconomy(world(), { fromDate: "2026-01-01", toDate: "2026-10-01" });
  const shocked = advanceWorldEconomy(world(), {
    fromDate: "2026-01-01",
    toDate: "2026-10-01",
    shocks: [{ kind: "capital_flight", severity: 3, durationMonths: 9 }],
  });
  assert.ok(shocked.world.countryStats.Egypt.economy.inflation > calm.world.countryStats.Egypt.economy.inflation);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/runtime/economyEngine.test.js`
Expected: FAIL with `Cannot find module './economyEngine.js'`

- [ ] **Step 3: Write the implementation**

IMPORTANT: Task 8 adds the `economyEngine` field to the world normalizer. Write this task's code against `nextWorld.economyEngine = ...` on the plain object; it will survive the write because `applyCountryStatPatchToWorld` mutates the object we pass and `normalizeWorldState` is not called here. The field only needs to survive `normalizeWorldState` once Task 8 lands. Sequence: implement Task 7, run its test (it passes without Task 8 because the test does not normalize), then do Task 8.

```js
/*! Open Historia - deterministic economy: the runtime adapter (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The ONLY place that knows both the world shape and the engine. It extracts a
// compact economic state out of world.countryStats, hands it to the pure core,
// and writes the result back through the existing country-stat seam. Nothing
// else in the game needs to know the engine exists.

import { applyCountryStatPatchToWorld } from "./gameState.js";
import { hashSeed } from "./unitMotion.js";
import { advanceEconomy, makePolityEconomy } from "../engine/economyTick.js";
import { jitterFor, monthsBetweenDates, roundTo } from "../engine/economyMath.js";
import { normalizeShocks } from "../engine/economyShocks.js";

const ENGINE_VERSION = 1;
const OWNED_ECONOMY_FIELDS = ["gdp", "gdpPerCapita", "gdpGrowth", "inflation", "unemployment", "publicDebt", "budgetBalance"];

const hex32 = (text) => hashSeed(text).toString(16).padStart(8, "0").repeat(4);

export const economySeedFor = (campaignId, scenarioId) =>
  hex32(`${String(campaignId ?? "")}|${String(scenarioId ?? "")}|economy-v${ENGINE_VERSION}`);

const sheetToPolity = (name, sheet, seed) => {
  const economy = sheet?.economy ?? {};
  const population = sheet?.population ?? {};
  const components = Array.isArray(sheet?.territorialComponents)
    ? sheet.territorialComponents.map((c) => ({
      geography: String(c.geography ?? ""),
      group: String(c.group ?? "core"),
      population: Number(c.population) || 0,
      gdpPerCapita: Number(c.gdpPerCapita) || 0,
    }))
    : [];
  const totalPopulation = Number(population.total) || 0;
  const gdp = Number(economy.gdp) || 0;
  const gdpPerCapita = Number(economy.gdpPerCapita) || (totalPopulation > 0 ? gdp / totalPopulation : 0);
  if (!(totalPopulation > 0) || !(gdpPerCapita > 0)) return null;
  return makePolityEconomy({
    population: totalPopulation,
    gdp,
    gdpPerCapita,
    gdpGrowth: economy.gdpGrowth,
    inflation: economy.inflation,
    unemployment: economy.unemployment,
    publicDebt: economy.publicDebt,
    budgetBalance: economy.budgetBalance,
    stability: sheet.stability,
    gdpBreakdown: sheet.gdpBreakdown,
    components,
    jitter: jitterFor(seed, name),
  });
};

export const extractEconomyState = (world, { seed = "" } = {}) => {
  const polities = {};
  for (const [name, sheet] of Object.entries(world?.countryStats ?? {})) {
    const polity = sheetToPolity(name, sheet, seed);
    if (polity) polities[name] = polity;
  }
  const fromDate = String(world?.economyEngine?.lastDate ?? "");
  return { month: monthsBetweenDates("2000-01-01", fromDate), polities };
};

// The engine's patch. Only the fields the engine owns are written, so an event
// that set an index or a stability the same turn is not disturbed.
  stability: roundTo(polity.stability, 4),
  economy: {
    gdp: roundTo(polity.gdp, 2),
    gdpPerCapita: roundTo(polity.gdpPerCapita, 4),
    gdpGrowth: roundTo(polity.gdpGrowth, 4),
    inflation: roundTo(polity.inflation, 4),
    unemployment: roundTo(polity.unemployment, 4),
    publicDebt: roundTo(polity.publicDebt, 4),
    budgetBalance: roundTo(polity.budgetBalance, 4),
  },
  gdpBreakdown: { ...polity.gdpBreakdown },
  ...(polity.components.length
    ? {
      replaceComponents: true,
      territorialComponents: polity.components.map((c) => ({
        geography: c.geography,
        group: c.group,
        population: Math.round(c.population),
        gdpPerCapita: roundTo(c.gdpPerCapita, 4),
      })),
    }
    : {}),
});

export const advanceWorldEconomy = (
  world,
  {
    fromDate = "",
    toDate = "",
    shocks = [],
    playerPolity = "",
    tracked = [],
    campaignId = "",
    scenarioId = "",
  } = {},
) => {
  const seed = String(world?.economyEngine?.seed ?? economySeedFor(campaignId, scenarioId));
  const committed = extractEconomyState(world, { seed });
  const months = monthsBetweenDates(fromDate, toDate);
  if (months <= 0 || Object.keys(committed.polities).length === 0) {
    return { world, deltas: [], months: 0, journal: { steps: 0, capped: false, shockedMonths: 0, seed }, seed };
  }

  const knownPolities = Object.keys(committed.polities);
  const { valid, rejected } = normalizeShocks(shocks, { knownPolities });
  const { state, journal } = advanceEconomy(committed, { startDate: fromDate, months, shocks: valid, seed });

  const nextWorld = {
    ...world,
    countryStats: { ...(world?.countryStats ?? {}) },
    economyEngine: { version: ENGINE_VERSION, seed, lastDate: toDate, lastMonth: state.month },
  };

  const deltas = [];
  for (const [name, polity] of Object.entries(state.polities)) {
    const patch = polityToPatch(polity);
    // Engine sourced: Task 9 makes the continuity guard skip a marked write.
    applyCountryStatPatchToWorld(nextWorld, name, patch, { engineSourced: true });
    const engineSourced = OWNED_ECONOMY_FIELDS.every((field) => (nextWorld.countryStats[name]?.economy?.[field] ?? null) !== null);
    deltas.push({
      polity: name,
      gdpGrowth: polity.gdpGrowth,
      inflation: polity.inflation,
      unemployment: polity.unemployment,
      publicDebt: polity.publicDebt,
      budgetBalance: polity.budgetBalance,
      estimated: !engineSourced,
    });
  }

  if (rejected.length) {
    nextWorld.economyEngine.rejectedShocks = rejected;
  }
  return { world: nextWorld, deltas, months, journal, seed };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/runtime/economyEngine.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/runtime/economyEngine.js src/runtime/economyEngine.test.js
git commit -m "feat(engine): the runtime adapter that reads, advances and writes the economy"
```

---

### Task 8: Persist the engine clock

**Files:**
- Modify: `src/runtime/gameState.js` (`WORLD_DEFAULTS` around line 204; `normalizeWorldState` return around line 3674)
- Test: `src/runtime/gameState.economyEngine.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `world.economyEngine` survives a normalize round trip as `{ version, seed, lastDate, lastMonth }`, or is `null` when absent.

- [ ] **Step 1: Write the failing test**

```js
// src/runtime/gameState.economyEngine.test.js
// Run: node --test src/runtime/gameState.economyEngine.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { WORLD_DEFAULTS, normalizeWorldState } from "./gameState.js";

test("the default world carries a null engine clock", () => {
  assert.ok("economyEngine" in WORLD_DEFAULTS);
  assert.equal(WORLD_DEFAULTS.economyEngine, null);
});

test("the clock survives a normalize round trip", () => {
  const normalized = normalizeWorldState({
    economyEngine: { version: 1, seed: "abcdef0123456789", lastDate: "2026-04-01", lastMonth: 3 },
  });
  assert.deepEqual(normalized.economyEngine, {
    version: 1, seed: "abcdef0123456789", lastDate: "2026-04-01", lastMonth: 3,
  });
  assert.deepEqual(normalizeWorldState(normalized).economyEngine, normalized.economyEngine);
});

test("a missing or malformed clock normalizes to null rather than a half record", () => {
  assert.equal(normalizeWorldState({}).economyEngine, null);
  assert.equal(normalizeWorldState({ economyEngine: { seed: "" } }).economyEngine, null);
  assert.equal(normalizeWorldState({ economyEngine: "nonsense" }).economyEngine, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/runtime/gameState.economyEngine.test.js`
Expected: FAIL, `WORLD_DEFAULTS.economyEngine` is undefined

- [ ] **Step 3: Write the implementation**

In `src/runtime/gameState.js`, add to `WORLD_DEFAULTS` immediately before `units: []` (around line 204):

```js
  // The deterministic economy's clock. `seed` is generated once per campaign
  // and never regenerated, which is what makes the per-polity character term
  // and every value derived from it reproducible across reloads and devices.
  // `lastDate` says where the committed economy stands; `lastMonth` is the
  // derived month index, kept only so a report can read it without date math.
  // Listed in the normalizeWorldState return too, for the usual reason.
  economyEngine: null,
```

Then add a normalizer beside the other small normalizers, above `normalizeWorldState`:

```js
// The engine clock. A half record (a version with no seed) is treated as no
// record at all: an engine that thinks it has a seed it does not have would
// produce numbers nobody can reproduce, which is worse than not running.
const normalizeEconomyEngine = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const seed = normalizeOptionalString(value.seed);
  const version = Math.trunc(Number(value.version));
  if (!seed || !Number.isFinite(version) || version < 1) return null;
  const lastMonth = Math.trunc(Number(value.lastMonth));
  return {
    version,
    seed,
    lastDate: normalizeOptionalString(value.lastDate),
    lastMonth: Number.isFinite(lastMonth) && lastMonth >= 0 ? lastMonth : 0,
  };
};
```

And in the `normalizeWorldState` return object, beside `units` (around line 3658):

```js
    economyEngine: normalizeEconomyEngine(nextWorld.economyEngine),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/runtime/gameState.economyEngine.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Run the world-state suite for regressions**

Run: `node --test src/runtime/gameState*.test.js`
Expected: PASS. If a snapshot-style test asserts the exact key set of a normalized world, update it to include `economyEngine`; that is a legitimate contract change, and the test is the place it is recorded.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/gameState.js src/runtime/gameState.economyEngine.test.js
git commit -m "feat(engine): persist the deterministic clock on the world"
```

---

### Task 9: The engine-sourced write skips the continuity guard

**Files:**
- Modify: `src/runtime/countryStats.js` (`mergeCountryStatPatch`, around line 946; `mergeCountryStatContinuity` call around line 965)
- Test: `src/runtime/countryStats.engineWrite.test.js`

**Interfaces:**
- Consumes: the `options.engineSourced` flag Task 7 passes.
- Produces: `mergeCountryStatPatch(base, patch, { engineSourced: true })` records `continuity.engineSourced = true`; every other field behaves exactly as today.

The guard itself is applied by callers (`guardCountryStatContinuity`), not inside `mergeCountryStatPatch`. The flag exists so a caller can tell, from the sheet alone, that the last write was the engine's and must not be banded. The change here is to carry the flag into the sheet's `continuity`.

- [ ] **Step 1: Write the failing test**

```js
// src/runtime/countryStats.engineWrite.test.js
// Run: node --test src/runtime/countryStats.engineWrite.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { mergeCountryStatPatch } from "./countryStats.js";

const base = () => ({
  statsSchemaVersion: 1,
  stability: 60,
  economy: { gdp: 1e12, gdpPerCapita: 10_000, gdpGrowth: 2, inflation: 4, unemployment: 8, publicDebt: 90, budgetBalance: -4 },
  population: { total: 100_000_000, coreIntegrated: 100_000_000, otherTerritories: 0 },
  gdpBreakdown: { agriculture: 10, industry: 35, services: 55 },
  continuity: { assessedDate: "2026-01-01", assessedRound: 2 },
});

test("an engine write is marked in continuity", () => {
  const merged = mergeCountryStatPatch(base(), { economy: { gdpGrowth: 3.5 } }, { engineSourced: true });
  assert.equal(merged.continuity.engineSourced, true);
  assert.equal(merged.economy.gdpGrowth, 3.5);
});

test("an ordinary write does not carry the mark", () => {
  const merged = mergeCountryStatPatch(base(), { economy: { gdpGrowth: 3.5 } });
  assert.notEqual(merged.continuity.engineSourced, true);
});

test("the mark does not survive a later ordinary write on the same sheet", () => {
  const engineWritten = mergeCountryStatPatch(base(), { economy: { gdpGrowth: 3.5 } }, { engineSourced: true });
  const later = mergeCountryStatPatch(engineWritten, { indices: { sovereignty: 50 } });
  assert.notEqual(later.continuity.engineSourced, true);
});

test("a marked write changes no other field", () => {
  const plain = mergeCountryStatPatch(base(), { economy: { gdpGrowth: 3.5 } });
  const marked = mergeCountryStatPatch(base(), { economy: { gdpGrowth: 3.5 } }, { engineSourced: true });
  delete marked.continuity.engineSourced;
  assert.deepEqual(marked, plain);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/runtime/countryStats.engineWrite.test.js`
Expected: FAIL on the first test, `merged.continuity.engineSourced` is undefined

- [ ] **Step 3: Write the implementation**

In `mergeCountryStatPatch` (`src/runtime/countryStats.js:946`), change the signature to accept the flag and thread it into the continuity merge:

```js
export const mergeCountryStatPatch = (baseValue, patchValue, options = {}) => {
```

Find the existing continuity merge (around line 965, `continuity: mergeCountryStatContinuity(...)`) and replace it with a two-step so the mark is stamped on the result of the merge rather than passed through a function that does not know about it:

```js
    continuity: stampEngineSourced(
      mergeCountryStatContinuity(/* the existing arguments, unchanged */),
      options.engineSourced === true,
    ),
```

Add the helper above `mergeCountryStatPatch`:

```js
// Marks a sheet whose last writer was the deterministic engine. The continuity
// guard bands a value that moved further than a language model plausibly should
// have moved it, but an engine result is a fact about the simulation, so a
// caller must be able to tell the two apart from the sheet alone. A later
// ordinary write clears the mark, because the guard is then the right arbiter
// again.
const stampEngineSourced = (continuity, engineSourced) => {
  const next = continuity && typeof continuity === "object" ? { ...continuity } : {};
  if (engineSourced) next.engineSourced = true;
  else delete next.engineSourced;
  return next;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/runtime/countryStats.engineWrite.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Guard the guard**

The flag is only useful if `guardCountryStatContinuity` reads it. Add to the start of `guardCountryStatContinuity` (`src/runtime/countryStats.js:1406`), immediately after `const candidate = finalizeCountryStatSheet(candidateValue);`:

```js
  // An engine-sourced sheet is a simulation result, not a model estimate. Banding
  // it would revert a real war or a real boom back to last period's number, and
  // do it silently. The engine's own clamps are its guardrails.
  if (candidate?.continuity?.engineSourced === true) {
    return { sheet: candidate, restored: [] };
  }
```

Add this test to the same test file:

```js
test("the guard stands down for an engine write and still bands an ordinary one", async () => {
  const { guardCountryStatContinuity } = await import("./countryStats.js");
  const engineSheet = mergeCountryStatPatch(base(), { economy: { gdpGrowth: 40 } }, { engineSourced: true });
  const passed = guardCountryStatContinuity(base(), engineSheet, { elapsedYears: 0 });
  assert.equal(passed.restored.length, 0);
  assert.equal(passed.sheet.economy.gdpGrowth, 40);

  const modelSheet = mergeCountryStatPatch(base(), { economy: { gdpGrowth: 40 } });
  const banded = guardCountryStatContinuity(base(), modelSheet, { elapsedYears: 0 });
  assert.ok(banded.restored.some((row) => row.field === "gdpGrowth"));
  assert.equal(banded.sheet.economy.gdpGrowth, 2);
});
```

Run: `node --test src/runtime/countryStats.engineWrite.test.js`
Expected: PASS, 5 tests

- [ ] **Step 6: Commit**

```bash
git add src/runtime/countryStats.js src/runtime/countryStats.engineWrite.test.js
git commit -m "feat(engine): an engine write is a fact, so the continuity band stands down"
```

---

### Task 10: The `economicShocks` schema field

**Files:**
- Modify: `src/Game/AI/gameplaySchemas.js` (`JUMP_FORWARD_SCHEMA`, around line 995)
- Test: `src/Game/AI/economicShocksSchema.test.js`

**Interfaces:**
- Consumes: `SHOCK_KINDS`, `MAX_SHOCKS`, `MAX_SHOCK_MONTHS` from `src/engine/economyShocks.js`.
- Produces: `JUMP_FORWARD_SCHEMA.properties.economicShocks`, an optional array the validator accepts.

- [ ] **Step 1: Write the failing test**

```js
// src/Game/AI/economicShocksSchema.test.js
// Run: node --test src/Game/AI/economicShocksSchema.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { JUMP_FORWARD_SCHEMA } from "./gameplaySchemas.js";
import { MAX_SHOCKS, SHOCK_KINDS } from "../../engine/economyShocks.js";

test("the jump schema offers an optional shock array and does not require it", () => {
  const field = JUMP_FORWARD_SCHEMA.properties.economicShocks;
  assert.ok(field, "economicShocks is missing from JUMP_FORWARD_SCHEMA");
  assert.equal(field.type, "array");
  assert.equal(field.maxItems, MAX_SHOCKS);
  assert.equal(JUMP_FORWARD_SCHEMA.required.includes("economicShocks"), false);
  assert.equal(JUMP_FORWARD_SCHEMA.additionalProperties, false);
});

test("the enum is the engine's list, not a copy", () => {
  const item = JUMP_FORWARD_SCHEMA.properties.economicShocks.items;
  assert.deepEqual(item.properties.kind.enum, [...SHOCK_KINDS]);
  assert.deepEqual(item.properties.severity.enum, [1, 2, 3]);
  assert.equal(item.properties.durationMonths.minimum, 1);
  assert.equal(item.required.includes("kind"), true);
  assert.equal(item.required.includes("severity"), true);
  assert.equal(item.required.includes("durationMonths"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/Game/AI/economicShocksSchema.test.js`
Expected: FAIL, `economicShocks is missing`

- [ ] **Step 3: Write the implementation**

In `src/Game/AI/gameplaySchemas.js`, add an import at the top beside the existing ones:

```js
import { MAX_SHOCKS, MAX_SHOCK_MONTHS, SHOCK_KINDS } from "../../engine/economyShocks.js";
```

Define the item schema above `JUMP_FORWARD_SCHEMA`:

```js
// The model's ONLY numeric economic input: a classified, bounded shock. It does
// not set a value, the deterministic engine derives every number from the state
// it already holds and applies this as a transient modifier. An optional field,
// so a model that says nothing about the economy is still a valid answer.
const economicShockSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: [...SHOCK_KINDS], description: "Classified shock. Closed list." },
    severity: { type: "integer", enum: [1, 2, 3], description: "1 is mild, 3 is severe." },
    durationMonths: { type: "integer", minimum: 1, maximum: MAX_SHOCK_MONTHS, description: "How many months the shock runs." },
    scope: {
      type: "array",
      items: { type: "string" },
      description: "Polity names the shock hits. Omit for a world-wide shock.",
    },
  },
  required: ["kind", "severity", "durationMonths"],
  additionalProperties: false,
};
```

And add the property to `JUMP_FORWARD_SCHEMA.properties`, after `agreementUpdates`:

```js
    economicShocks: {
      type: "array",
      maxItems: MAX_SHOCKS,
      description:
        "Classified shocks the period inflicts on the economy (a blockade, a failed harvest, sanctions, "
        + "a reconstruction programme). The engine turns each into transient parameters. Do NOT state GDP, "
        + "growth, inflation or debt as numbers anywhere; those are computed locally from these shocks.",
      items: economicShockSchema,
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/Game/AI/economicShocksSchema.test.js`
Expected: PASS, 2 tests

- [ ] **Step 5: Run the schema suite for regressions**

Run: `node --test src/Game/AI/*schema*.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/Game/AI/gameplaySchemas.js src/Game/AI/economicShocksSchema.test.js
git commit -m "feat(engine): the jump schema accepts classified shocks and nothing numeric"
```

---

### Task 11: The prompt tells the model the rules and the facts

**Files:**
- Modify: `src/Game/AI/gameplayPrompts.js` (add the instruction block and the digest slot)
- Modify: `src/Game/AI/gameplay.js` (pass the digest into the prompt variables)
- Test: `src/Game/AI/economyPrompt.test.js`

**Interfaces:**
- Consumes: `buildEconomyDigest` (Task 6).
- Produces: a prompt block builder `buildEconomyEngineInstructions({ digest })` that returns the rules plus the digest, or an empty string when there is no digest.

- [ ] **Step 1: Write the failing test**

```js
// src/Game/AI/economyPrompt.test.js
// Run: node --test src/Game/AI/economyPrompt.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const prompts = readFileSync(new URL("./gameplayPrompts.js", import.meta.url), "utf8");

test("the prompt says the economy is computed locally and numbers must not be restated", () => {
  assert.ok(prompts.includes("computed locally"));
  assert.ok(/do not (state|restate)/i.test(prompts));
  assert.ok(prompts.includes("economicShocks"));
});

test("the prompt names the shock list it may use", () => {
  for (const kind of ["harvest_failure", "sanctions", "mobilization", "reconstruction"]) {
    assert.ok(prompts.includes(kind), kind);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/Game/AI/economyPrompt.test.js`
Expected: FAIL, `computed locally` not present

- [ ] **Step 3: Write the implementation**

At the end of `src/Game/AI/gameplayPrompts.js`, add:

```js
// The economy block: the rule and the facts. The rule exists because a model
// that has spent a career inventing plausible GDP figures will keep doing it
// unless told plainly that the numbers are not its job any more. The digest
// exists because a narrator who cannot see the engine's numbers would describe
// a different period than the one that was simulated.
export const buildEconomyEngineInstructions = ({ digest = "" } = {}) => {
  const rules = [
    "[National Economy]",
    "A deterministic simulation computes every national economic figure locally: output, output per head, "
    + "growth, inflation, unemployment, public debt and the budget balance. They are already decided by the time "
    + "you are asked, and they are not yours to invent. Do not state, estimate, imply or restate a numeric "
    + "economic value in prose or in an event, and never write one into an impact.",
    "What you DO control is the shocks. When the period's events genuinely inflict or relieve economic pressure, "
    + "declare it in economicShocks, choosing from this closed list: "
    + "harvest_failure, sanctions, blockade, industrial_damage, capital_flight, debt_crisis, mobilization, "
    + "reconstruction, aid_inflow, trade_boom. Give each the severity (1 mild, 2 serious, 3 severe) and how many "
    + "months it runs. A shock declared now takes effect from the NEXT period, so judge it from this period's "
    + "cause, not from a number you want to see.",
    "Declare shocks sparingly and only when the events you are writing justify them. Most periods have none.",
  ].join("\n\n");
  const facts = String(digest ?? "").trim();
  return facts ? `${rules}\n\n[The Period's Economy, as simulated]\n${facts}` : rules;
};
```

In `src/Game/AI/gameplay.js`, where the jump prompt variables are assembled, add the digest:

```js
import { buildEconomyEngineInstructions } from "./gameplayPrompts.js";
```

```js
  variables.economyEngineInstructions = buildEconomyEngineInstructions({ digest: variables.economyDigest });
```

Then include `${variables.economyEngineInstructions}` in the jump system prompt beside the other bracketed blocks.

The producer of `variables.economyDigest` is Task 12's wiring; until then the block renders rules only, which is exactly the intended behavior for a campaign with no engine data. Add this test to confirm the empty path:

```js
test("with no digest the block is rules only and never an empty heading", async () => {
  const { buildEconomyEngineInstructions } = await import("./gameplayPrompts.js");
  const block = buildEconomyEngineInstructions({ digest: "" });
  assert.ok(block.includes("computed locally"));
  assert.equal(block.includes("The Period's Economy"), false);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/Game/AI/economyPrompt.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/Game/AI/gameplayPrompts.js src/Game/AI/economyPrompt.test.js
git commit -m "feat(engine): the prompt states the rule and hands over the simulated facts"
```

---

### Task 12: Wire the engine into the turn

**Files:**
- Modify: `src/Game/AI/gameplay.js` (the adapter call before writing the world, around line 7179; the prompt digest variable; the suppression of the tracked refresh around line 7163)
- Test: `src/Game/AI/economyWiringArchitecture.test.js`

**Interfaces:**
- Consumes: `advanceWorldEconomy` (Task 7), `buildEconomyDigest` (Task 6).
- Produces: the turn produces `nextWorld` with the engine's economy applied last.

- [ ] **Step 1: Write the failing test**

This task is mostly wiring inside a 15000 line function that cannot be imported, so the guard is an architecture test on the source, in the same style as `turnOrdering.test.js` and `aiGenerationDeadlineArchitecture.test.js`.

```js
// src/Game/AI/economyWiringArchitecture.test.js
// Run: node --test src/Game/AI/economyWiringArchitecture.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");

test("the engine runs in applySimulationResult, before the world is written", () => {
  const engineAt = source.indexOf("advanceWorldEconomy(");
  const writeAt = source.indexOf("writeWorldState(nextWorld)");
  assert.notEqual(engineAt, -1, "the engine is not wired into the turn");
  assert.notEqual(writeAt, -1, "writeWorldState(nextWorld) moved; update this guard");
  assert.ok(engineAt < writeAt, "the engine must advance before the world is written");
});

test("the engine runs after the event impacts, so its fields win", () => {
  const impactsAt = source.indexOf("applyEventImpactsToWorld(");
  const engineAt = source.indexOf("advanceWorldEconomy(");
  assert.ok(impactsAt !== -1 && impactsAt < engineAt, "the engine must land after the event impacts");
});

test("the tracked stats refresh is suppressed behind a named switch", () => {
  assert.ok(source.includes("ECONOMY_ENGINE_OWNS_STANDARD_STATS"));
});

test("the digest is built for the prompt", () => {
  assert.ok(source.includes("buildEconomyDigest("));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/Game/AI/economyWiringArchitecture.test.js`
Expected: FAIL, `the engine is not wired into the turn`

- [ ] **Step 3: Write the implementation**

At the top of `src/Game/AI/gameplay.js`, add:

```js
import { advanceWorldEconomy } from "../../runtime/economyEngine.js";
import { buildEconomyDigest } from "../../runtime/economyDigest.js";
```

Add the switch beside the other module constants:

```js
// The deterministic engine owns the standard economy, so the periodic AI stats
// batch would be a second writer of the same fields. Kept as a named switch
// rather than deleted, because during rollout the two paths are compared
// side by side on real campaigns, and because a custom scenario sheet still
// uses the AI path (refreshTrackedCustomStatsIfDue), which this does not touch.
const ECONOMY_ENGINE_OWNS_STANDARD_STATS = true;
```

Wrap the existing tracked refresh (around line 7163) so it is skipped for standard sheets:

```js
  if (!ECONOMY_ENGINE_OWNS_STANDARD_STATS) {
    try {
      nextWorld = await refreshTrackedCountryStatsIfDue({
        bundle: { actions: nextActions, chats: nextChats, events: nextEvents, game: nextGame, world: nextWorld },
        signal: projects?.signal,
        requests,
      });
    } catch (error) {
      if (projects?.signal?.aborted) throw error;
      console.warn("[stats auto] unexpected scheduler failure; the completed turn is preserved.", error);
    }
  }
```

Immediately before `captureCountryStatsHistory` (around line 7182), advance the engine and build the digest:

```js
  // The deterministic economy advances AFTER the event impacts and immediately
  // BEFORE the write, so the engine's fields are the last word on a sheet the
  // event path may also have touched, and so nothing downstream can observe a
  // half-applied turn. A failure here must never lose a completed turn: the
  // events and the date are already correct, and the economy is simply one
  // period behind, which the clock on the world then reports honestly.
  let economyDigest = "";
  try {
    const economy = advanceWorldEconomy(nextWorld, {
      fromDate: baseGame.gameDate || "",
      toDate: nextGame.gameDate || "",
      shocks: normalizeArray(result.economicShocks),
      playerPolity: nextGame.country || "",
      tracked: Object.keys(nextWorld.countryStats ?? {}),
      campaignId,
      scenarioId: nextGame.scenarioId || "",
    });
    nextWorld = economy.world;
    economyDigest = buildEconomyDigest({
      deltas: economy.deltas,
      playerPolity: nextGame.country || "",
      tracked: Object.keys(nextWorld.countryStats ?? {}),
      shocks: [],
    });
    logDebugEvent("turn", `Economy advanced ${economy.months} month(s) locally.`, {
      steps: economy.journal?.steps ?? 0,
      capped: Boolean(economy.journal?.capped),
      shockedMonths: economy.journal?.shockedMonths ?? 0,
    });
  } catch (error) {
    console.warn("[engine] the economy step failed; the completed turn is preserved.", error);
  }
```

Pass the digest to the prompt builder. Find where `variables` for the jump request are assembled (the object later read as `variables.economyEngineInstructions` in Task 11) and add:

```js
  variables.economyDigest = economyDigest;
```

**Ordering note for the implementer:** the prompt is built before the model call, while the engine runs after it. That is deliberate and is section 7 of the spec: the engine advances to the projected date before the call (using `targetDate`), and the block above re-derives to the model's final `stopDate` after. If you find the projected-date advance is easier to place, add it there and keep this recompute as the authority; the recompute is exact because the step is a pure function of state and months.

**Correction, made during implementation (do not follow the snippet above literally):** `shocks: normalizeArray(result.economicShocks)` applies this turn's shocks in the same period the model just narrated, which contradicts Task 11's prompt ("a shock declared now takes effect from the NEXT period") and spec section 7. The turn passes them as `declaredShocks:` instead; the adapter stores them on `economyEngine.pendingShocks` and the **following** turn's advance applies them. The digest therefore carries `shocks: <adapter's shocksRunning>` (the leftovers), and spec section 11 gained the `pendingShocks` field. The projected advance in `simulateTimelineJump` builds the digest from `projected.shocksRunning`; the post-answer advance only stores. See `src/runtime/economyEngine.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/Game/AI/economyWiringArchitecture.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: at least 2427 tests, 0 fail. Investigate any failure before committing; do not skip a failing test to move on.

Run: `npx eslint .`
Expected: no new error.

- [ ] **Step 6: Commit**

```bash
git add src/Game/AI/gameplay.js src/Game/AI/economyWiringArchitecture.test.js
git commit -m "feat(engine): the economy advances every turn and the AI batch stands down"
```

---

### Task 13: Documentation and wiki freshness

**Files:**
- Modify: `docs/world-state.md`
- Modify: `docs/ai-overview.md`
- Modify: `docs/runtime-services.md`
- Modify: `docs/architecture.md`
- Modify: `wiki/reference/troubleshooting.md`

**Interfaces:** none; documentation only.

- [ ] **Step 1: Document the world field**

In `docs/world-state.md`, in the field table, add a `economyEngine` row: `null`, or `{ version, seed, lastDate, lastMonth }`, the deterministic economy's clock, with the rule that the seed is generated once per campaign and never regenerated, and the list of fields the engine owns (`gdp`, `gdpPerCapita`, `gdpGrowth`, `inflation`, `unemployment`, `publicDebt`, `budgetBalance`).

- [ ] **Step 2: Document the shock channel**

In `docs/ai-overview.md`, add a short subsection naming the `economicShocks` field, the closed enum, the bounds, and the one-period lag. State plainly: the model narrates the engine's numbers, it does not produce them.

- [ ] **Step 3: Document the layer**

In `docs/runtime-services.md`, add the `src/engine/` core and the `src/runtime/economyEngine.js` adapter, with the purity rule (no clock, no entropy, no browser global) and the reason (reproducibility).

In `docs/architecture.md`, add the engine to the tech-stack or directory table as the first engine layer, one or two sentences.

- [ ] **Step 4: Document the new failure mode**

In `wiki/reference/troubleshooting.md`, in the "Turns hang forever" section, add: the economy no longer depends on the provider, so a stalled turn is a narration problem, not a simulation one; a stalled provider now costs prose, not progress.

- [ ] **Step 5: Verify freshness**

Run: `npm run wiki:check`
Expected: `Wiki is current.` and exit 0. If it reports a page out of date, update it and run again.

- [ ] **Step 6: Commit**

```bash
git add docs wiki
git commit -m "docs(engine): record the deterministic economy, its clock and its shock channel"
```

---

## Post-implementation verification

Run all three, in this order, and paste the output into the completion report:

```bash
npm test
npx eslint .
npm run wiki:check
```

Expected: tests at least as green as the 2427 / 2425 pass / 0 fail / 2 todo baseline, no new eslint error, and `Wiki is current.`

Then, on the running preview (port 3000), start a fresh campaign and jump 90 days with the network disabled. The date must advance, the economy digest must appear in the log with `Economy advanced 3 month(s) locally.`, and the client must not wait on any provider.
