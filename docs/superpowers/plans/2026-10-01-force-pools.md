# Force Pools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every polity deterministic manpower and materiel reserves that advance on the existing economy clock, carry a monthly upkeep cost read from the unit roster, and respond to a model-declared mobilization posture.

**Architecture:** The engine already has a pure month step (`advanceEconomy`, `src/engine/economyTick.js`) driven by the adapter `advanceWorldEconomy` (`src/runtime/economyEngine.js`). This plan adds one pure module `src/engine/forcePools.js`, threads a pool and shortfall map through the same loop, reads the roster in the adapter without ever writing it, and mirrors the result onto the country stat sheet behind the existing `engineSourced` gate.

**Tech Stack:** Vanilla ES modules, Node's built-in test runner (`node --test`), no new dependency. React/JSX only in the final panel task.

## Global Constraints

- ASCII only in source and docs. No emoji, no em dash.
- No new dependency in `package.json`.
- `src/engine/**` imports only `src/engine/*.js` and the two import-free runtime helpers `../runtime/gameDates.js` and `../runtime/unitMotion.js`. No `Date.now`, `new Date`, `Math.random`, `localStorage`, `window`, `document`, `navigator`, `fetch`.
- `node --test <dir>` does not work in this environment. Run engine tests with the glob form: `node --test "src/engine/*.test.js"`.
- Every commit uses a conventional-commit prefix and the trailer `Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>`.
- No existing function changes meaning. All additions are additive.
- `public/wiki/**` is generated but committed (`docs/wiki.md`). Any task that touches `docs/` regenerates and commits it with `npm run build:wiki`.
- Reference range in this plan is the tree at commit `112a58b` (the force-pools design spec).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/engine/forcePools.js` (new) | Posture enum, `MOBILIZATION_EFFECTS`, `UNIT_UPKEEP`, `FORCE_POOLS` constants, all pool/posture normalizers, `initialPoolsFor`, `stepPolityPools`, `applyMobilization`, `shortfallPressureFor`. Pure. |
| `src/engine/economyTick.js` (modify) | Thread `pools`/`shortfall` through `advanceEconomy` and call `stepPolityPools` after `stepPolityMonth`. |
| `src/runtime/gameState.js` (modify) | `normalizeEconomyEngine` learns `pools`, `mobilization`, `pendingMobilization`, `upkeepShortfall`. |
| `src/runtime/countryStats.js` (modify) | `normalizeForces` on read; the `forces` merge gated by `engineSourced`. |
| `src/runtime/economyEngine.js` (modify) | `buildUpkeepTable`, extract pools/posture/shortfall, apply pending mobilization, write everything back. |
| `src/runtime/economyDigest.js` (modify) | The player pool line. |
| `src/Game/AI/gameplaySchemas.js` (modify) | The `mobilization` field in `JUMP_FORWARD_SCHEMA`. |
| `src/Game/AI/gameplayPrompts.js` (modify) | `buildForcePoolsInstructions`. |
| `src/Game/AI/gameplay.js` (modify) | Thread upkeep table and `declaredMobilization` into both `advanceWorldEconomy` calls; inject the pool digest. |
| `src/Game/AI/jumpSegments.js` (modify) | Merge `mobilization` across segments, folded to one entry per polity. |
| `src/Game/GameUI/stats.jsx` (modify) | The read-only Forces section. |

---

### Task 1: The force-pools core tables and normalizers

**Files:**
- Create: `src/engine/forcePools.js`
- Test: `src/engine/forcePools.test.js`

**Interfaces:**
- Consumes: `clamp`, `roundTo` from `./economyMath.js`.
- Produces: `MOBILIZATION_POSTURES`, `DEFAULT_POSTURE`, `MAX_MOBILIZATION`, `MOBILIZATION_EFFECTS`, `UNIT_UPKEEP`, `FORCE_POOLS`, `normalizeMobilization(value, {knownPolities}) -> {valid, rejected}`, `normalizePendingMobilization(value) -> [{polity, posture}]`, `normalizePools(value) -> {[name]: {manpower, materiel}}`, `normalizeMobilizationMap(value) -> {[name]: posture}`, `normalizeUpkeepShortfall(value) -> {[name]: {manpower, materiel}}`, `postureFor(map, name) -> posture`.

- [ ] **Step 1: Write the failing test**

```js
// src/engine/forcePools.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_POSTURE,
  MOBILIZATION_EFFECTS,
  UNIT_UPKEEP,
  normalizeMobilization,
  normalizeMobilizationMap,
  normalizePendingMobilization,
  normalizePools,
  normalizeUpkeepShortfall,
  postureFor,
} from "./forcePools.js";

test("the posture table is closed and peacetime is the identity", () => {
  assert.deepEqual(Object.keys(MOBILIZATION_EFFECTS), ["demobilized", "peacetime", "partial", "total"]);
  assert.deepEqual(
    MOBILIZATION_EFFECTS.peacetime,
    { extraction: 1, allocation: 1, growthDrag: 0, stabilityDrag: 0 },
  );
  assert.equal(DEFAULT_POSTURE, "peacetime");
});

test("mobilizing raises production and raises the drag", () => {
  assert.ok(MOBILIZATION_EFFECTS.partial.extraction > MOBILIZATION_EFFECTS.peacetime.extraction);
  assert.ok(MOBILIZATION_EFFECTS.total.growthDrag > MOBILIZATION_EFFECTS.partial.growthDrag);
  assert.ok(MOBILIZATION_EFFECTS.total.stabilityDrag > MOBILIZATION_EFFECTS.partial.stabilityDrag);
});

test("every unit type the roster can hold has an upkeep row", () => {
  for (const type of ["infantry", "armor", "air", "naval", "artillery", "garrison"]) {
    assert.ok(UNIT_UPKEEP[type], `${type} has upkeep`);
    assert.ok(UNIT_UPKEEP[type].manpower >= 0);
    assert.ok(UNIT_UPKEEP[type].materiel >= 0);
  }
});

test("a declared mobilization drops an unknown polity and an unknown posture", () => {
  const { valid, rejected } = normalizeMobilization(
    [
      { polity: "France", posture: "total" },
      { polity: "Atlantis", posture: "partial" },
      { polity: "France", posture: "waving" },
    ],
    { knownPolities: ["France", "Germany"] },
  );
  assert.deepEqual(valid, [{ polity: "France", posture: "total" }]);
  assert.equal(rejected.length, 2);
  assert.match(rejected[0].reason, /unknown polity/);
  assert.match(rejected[1].reason, /unknown posture/);
});

test("a duplicate polity folds, last one winning", () => {
  const { valid } = normalizeMobilization(
    [
      { polity: "France", posture: "partial" },
      { polity: "France", posture: "total" },
    ],
    { knownPolities: ["France"] },
  );
  assert.deepEqual(valid, [{ polity: "France", posture: "total" }]);
});

test("the pending mobilization round-trips through storage and rejects a bad posture", () => {
  assert.deepEqual(
    normalizePendingMobilization([{ polity: "France", posture: "total" }, { polity: "X", posture: "nope" }]),
    [{ polity: "France", posture: "total" }],
  );
});

test("normalizePools floors at zero and drops a non-numeric row", () => {
  assert.deepEqual(
    normalizePools({ France: { manpower: 1200.7, materiel: -3 }, Ghost: "nope" }),
    { France: { manpower: 1201, materiel: 0 } },
  );
});

test("the mobilization map omits the default posture", () => {
  assert.deepEqual(
    normalizeMobilizationMap({ France: "peacetime", Germany: "total", Italy: "junk" }),
    { Germany: "total" },
  );
});

test("the shortfall map keeps only a real shortfall", () => {
  assert.deepEqual(
    normalizeUpkeepShortfall({ France: { manpower: 400, materiel: 0 }, Germany: { manpower: 0, materiel: 0 } }),
    { France: { manpower: 400, materiel: 0 } },
  );
});

test("postureFor returns the default for an absent polity", () => {
  assert.equal(postureFor({ Germany: "total" }, "France"), "peacetime");
  assert.equal(postureFor({ Germany: "total" }, "Germany"), "total");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/engine/forcePools.test.js`
Expected: FAIL with "Cannot find module './forcePools.js'".

- [ ] **Step 3: Write the module**

```js
/*! Open Historia - deterministic economy: the force pools (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Manpower and materiel, in the same month step as the economy so one clock
// drives both. The model declares a POSTURE, never a number: the pool is drawn
// from the population and output the economy step already computed, and every
// value here is a function of the state. IMPORT-FREE apart from the shared math.

import { clamp, roundTo } from "./economyMath.js";

export const MOBILIZATION_POSTURES = Object.freeze(["demobilized", "peacetime", "partial", "total"]);
export const DEFAULT_POSTURE = "peacetime";
export const MAX_MOBILIZATION = 20;

const POSTURES = new Set(MOBILIZATION_POSTURES);

// extraction: multiplies manpower production. allocation: multiplies materiel
// production. growthDrag: the share of output the call-up removes. stabilityDrag:
// index points the posture costs every month. First-draft calibration; the tests
// assert ordering, never a magnitude.
const posture = (extraction, allocation, growthDrag, stabilityDrag) =>
  Object.freeze({ extraction, allocation, growthDrag, stabilityDrag });

export const MOBILIZATION_EFFECTS = Object.freeze({
  demobilized: posture(0.6, 0.7, -0.02, 0),
  peacetime: posture(1, 1, 0, 0),
  partial: posture(1.8, 1.6, 0.15, 0.05),
  total: posture(3, 2.6, 0.4, 0.12),
});

// Monthly cost per unit type. Keyed by UNIT_TYPES (gameState.js). A passive cost
// only: it is read from the roster and never written back to it.
const upkeep = (manpower, materiel) => Object.freeze({ manpower, materiel });

export const UNIT_UPKEEP = Object.freeze({
  infantry: upkeep(1200, 0.5),
  armor: upkeep(900, 2.4),
  air: upkeep(400, 3.2),
  naval: upkeep(1500, 5),
  artillery: upkeep(800, 1.6),
  garrison: upkeep(600, 0.3),
});

export const FORCE_POOLS = Object.freeze({
  MANPOWER_PER_CAPITA_MONTHLY: 0.0009,
  MATERIEL_PER_OUTPUT_MONTHLY: 0.0012,
  MANPOWER_CAP_SHARE: 0.06,
  MATERIEL_CAP_SHARE: 0.12,
  INITIAL_MANPOWER_SHARE: 0.02,
  INITIAL_MATERIEL_SHARE: 0.03,
  STABILITY_UPKEEP_SHORTFALL: 4,
});

const name = (value) => String(value ?? "").trim();

// The model's mobilization declaration. Like normalizeShocks: an entry that fails
// is dropped, never fatal to the turn, and returned so the caller can log it.
// Duplicates fold by polity, last one winning, because a posture is one value.
export const normalizeMobilization = (value, { knownPolities = [] } = {}) => {
  const list = Array.isArray(value) ? value : [];
  const known = new Set((Array.isArray(knownPolities) ? knownPolities : []).map(name));
  const byPolity = new Map();
  const rejected = [];

  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index];
    if (!entry || typeof entry !== "object") {
      rejected.push({ index, reason: "not an object" });
      continue;
    }
    const polity = name(entry.polity ?? entry.country);
    if (!polity || !known.has(polity)) {
      rejected.push({ index, reason: `unknown polity "${polity}"` });
      continue;
    }
    const post = name(entry.posture).toLowerCase();
    if (!POSTURES.has(post)) {
      rejected.push({ index, reason: `unknown posture "${entry.posture}"` });
      continue;
    }
    if (!byPolity.has(polity) && byPolity.size >= MAX_MOBILIZATION) {
      rejected.push({ index, reason: `more than ${MAX_MOBILIZATION} polities in one period` });
      continue;
    }
    byPolity.set(polity, { polity, posture: post });
  }

  return { valid: [...byPolity.values()], rejected };
};

// The storage shape: what the model declared, validated without a world. A
// corrupted save costs the entry, never the world.
export const normalizePendingMobilization = (value) => {
  const list = Array.isArray(value) ? value : [];
  const byPolity = new Map();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    if (byPolity.size >= MAX_MOBILIZATION && !byPolity.has(name(entry.polity))) continue;
    const polity = name(entry.polity ?? entry.country);
    const post = name(entry.posture).toLowerCase();
    if (!polity || !POSTURES.has(post)) continue;
    byPolity.set(polity, { polity, posture: post });
  }
  return [...byPolity.values()];
};

export const normalizePools = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const key of Object.keys(value).map(name).filter(Boolean)) {
    const row = value[key];
    if (!row || typeof row !== "object") continue;
    const manpower = Number(row.manpower);
    const materiel = Number(row.materiel);
    if (!Number.isFinite(manpower) || !Number.isFinite(materiel)) continue;
    out[key] = { manpower: Math.max(0, Math.round(manpower)), materiel: Math.max(0, roundTo(materiel, 2)) };
  }
  return out;
};

// The committed posture. Sparse: only non-default entries are stored, so an
// absent name is peacetime and a save that never mobilized is unchanged.
export const normalizeMobilizationMap = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const key of Object.keys(value).map(name).filter(Boolean)) {
    const post = name(value[key]).toLowerCase();
    if (post && post !== DEFAULT_POSTURE && POSTURES.has(post)) out[key] = post;
  }
  return out;
};

export const normalizeUpkeepShortfall = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const key of Object.keys(value).map(name).filter(Boolean)) {
    const row = value[key];
    if (!row || typeof row !== "object") continue;
    const manpower = Math.max(0, Math.round(Number(row.manpower) || 0));
    const materiel = Math.max(0, roundTo(Number(row.materiel) || 0, 2));
    if (manpower > 0 || materiel > 0) out[key] = { manpower, materiel };
  }
  return out;
};

export const postureFor = (map, polityName) => map?.[name(polityName)] ?? DEFAULT_POSTURE;

export const clampPercent = (value) => clamp(value, 0, 100);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/engine/forcePools.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Run the purity guard**

Run: `node --test src/engine/enginePurity.test.js`
Expected: PASS. The guard scans the directory, so the new file is covered already.

- [ ] **Step 6: Commit**

```bash
git add src/engine/forcePools.js src/engine/forcePools.test.js
git commit -m "feat(engine): add the force-pool tables, the posture enum and their normalizers" -m "Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>"
```

---

### Task 2: The pool month step

**Files:**
- Modify: `src/engine/forcePools.js`
- Test: `src/engine/forcePools.test.js`

**Interfaces:**
- Consumes: `FORCE_POOLS`, `MOBILIZATION_EFFECTS`, `DEFAULT_POSTURE`, `normalizeUpkeepShortfall` from Task 1.
- Produces: `initialPoolsFor(polity) -> {manpower, materiel}`, `stepPolityPools(polity, {pools, posture, upkeep}) -> {pools, shortfall}`, `shortfallPressureFor(shortfall, upkeep) -> number`, `applyMobilization(multipliers, posture, {shortfallPressure}) -> multipliers`.

- [ ] **Step 1: Write the failing test**

```js
// append to src/engine/forcePools.test.js
import {
  FORCE_POOLS,
  applyMobilization,
  initialPoolsFor,
  shortfallPressureFor,
  stepPolityPools,
} from "./forcePools.js";
import { makePolityEconomy } from "./economyTick.js";

const polityFixture = (over = {}) =>
  makePolityEconomy({
    population: 100_000_000,
    gdp: 1_000_000_000_000,
    gdpPerCapita: 10_000,
    gdpBreakdown: { agriculture: 10, industry: 35, services: 55 },
    stability: 60,
    ...over,
  });

test("a polity with no committed pools starts from its population and output", () => {
  const pools = initialPoolsFor(polityFixture());
  assert.equal(pools.manpower, Math.round(100_000_000 * FORCE_POOLS.INITIAL_MANPOWER_SHARE));
  assert.ok(pools.materiel > 0);
});

test("the pools are deterministic for the same inputs", () => {
  const p = polityFixture();
  const a = stepPolityPools(p, { pools: { manpower: 1_000_000, materiel: 100 }, posture: "peacetime" });
  const b = stepPolityPools(p, { pools: { manpower: 1_000_000, materiel: 100 }, posture: "peacetime" });
  assert.deepEqual(a, b);
});

test("total mobilization drains faster than peacetime over a year", () => {
  let war = { manpower: 500_000, materiel: 50 };
  let peace = { manpower: 500_000, materiel: 50 };
  const p = polityFixture();
  const upkeep = { manpower: 2_000_000, materiel: 400 };
  for (let i = 0; i < 12; i += 1) {
    war = stepPolityPools(p, { pools: war, posture: "total", upkeep }).pools;
    peace = stepPolityPools(p, { pools: peace, posture: "peacetime", upkeep }).pools;
  }
  assert.ok(war.materiel > peace.materiel, "total allocates more materiel");
});

test("the zero floor holds when upkeep exceeds the pool, and the shortfall is exact", () => {
  const p = polityFixture({ population: 1_000, gdp: 1000 });
  const result = stepPolityPools(p, {
    pools: { manpower: 100, materiel: 0 },
    posture: "peacetime",
    upkeep: { manpower: 50_000, materiel: 900 },
  });
  assert.equal(result.pools.manpower, 0, "never negative");
  assert.equal(result.pools.materiel, 0, "never negative");
  assert.ok(result.shortfall.manpower > 0);
  assert.ok(result.shortfall.materiel > 0);
});

test("a hundred peaceful years stay under the cap", () => {
  const p = polityFixture();
  let pools = initialPoolsFor(p);
  for (let i = 0; i < 1200; i += 1) pools = stepPolityPools(p, { pools, posture: "peacetime" }).pools;
  assert.ok(pools.manpower <= Math.round(100_000_000 * FORCE_POOLS.MANPOWER_CAP_SHARE));
  assert.ok(pools.materiel <= 1_000_000_000_000 * FORCE_POOLS.MATERIEL_CAP_SHARE);
});

test("a shortfall becomes stability pressure, bounded", () => {
  const pressure = shortfallPressureFor({ manpower: 1_000_000, materiel: 500 }, { manpower: 1_000_000, materiel: 500 });
  assert.ok(pressure > 0 && pressure <= FORCE_POOLS.STABILITY_UPKEEP_SHORTFALL);
  assert.equal(shortfallPressureFor(null, { manpower: 1, materiel: 1 }), 0);
});

test("mobilization folds into the multiplier vector without touching inflation", () => {
  const base = { population: 1, gdp: 1, inflation: 3, unemployment: 5, stability: 10 };
  const war = applyMobilization(base, "total", { shortfallPressure: 2 });
  assert.ok(war.gdp < 1, "the call-up drags output");
  assert.equal(war.inflation, 3);
  assert.ok(war.stability < 10, "it costs stability");
  assert.deepEqual(applyMobilization(base, "peacetime"), base);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/engine/forcePools.test.js`
Expected: FAIL with "stepPolityPools is not a function".

- [ ] **Step 3: Add the functions to `src/engine/forcePools.js`**

```js
// A polity's reserves before the first step: drawn from the population and
// output already committed, so a pre-increment save opens with full reserves
// rather than an empty ledger.
export const initialPoolsFor = (polity) => {
  const population = Math.max(0, Number(polity?.population) || 0);
  const gdp = Math.max(0, Number(polity?.gdp) || 0);
  return {
    manpower: Math.max(0, Math.round(population * FORCE_POOLS.INITIAL_MANPOWER_SHARE)),
    materiel: Math.max(0, roundTo(gdp * FORCE_POOLS.INITIAL_MATERIEL_SHARE, 2)),
  };
};

// One month: production first, then upkeep, with the ABSOLUTE zero floor. A pool
// is never negative under any input; the unmet remainder is recorded as a
// shortfall and becomes stability pressure next month, never a unit change.
export const stepPolityPools = (polity, { pools = null, posture: postureName = DEFAULT_POSTURE, upkeep: cost = null } = {}) => {
  const effects = MOBILIZATION_EFFECTS[postureName] ?? MOBILIZATION_EFFECTS[DEFAULT_POSTURE];
  const base = pools ?? initialPoolsFor(polity);
  const population = Math.max(0, Number(polity?.population) || 0);
  const gdp = Math.max(0, Number(polity?.gdp) || 0);
  const industryShare = clamp(Number(polity?.gdpBreakdown?.industry) || 0, 0, 100) / 100;

  let manpower = Math.max(0, Number(base.manpower) || 0)
    + population * FORCE_POOLS.MANPOWER_PER_CAPITA_MONTHLY * effects.extraction;
  manpower = Math.min(manpower, population * FORCE_POOLS.MANPOWER_CAP_SHARE);

  let materiel = Math.max(0, Number(base.materiel) || 0)
    + gdp * industryShare * FORCE_POOLS.MATERIEL_PER_OUTPUT_MONTHLY * effects.allocation;
  materiel = Math.min(materiel, gdp * FORCE_POOLS.MATERIEL_CAP_SHARE);

  const needManpower = Math.max(0, Number(cost?.manpower) || 0);
  const needMateriel = Math.max(0, Number(cost?.materiel) || 0);
  const availableManpower = manpower;
  const availableMateriel = materiel;
  manpower = Math.max(0, availableManpower - needManpower);
  materiel = Math.max(0, availableMateriel - needMateriel);

  return {
    pools: {
      manpower: Math.max(0, Math.round(manpower)),
      materiel: Math.max(0, roundTo(materiel, 2)),
    },
    shortfall: {
      manpower: Math.max(0, needManpower - availableManpower),
      materiel: Math.max(0, needMateriel - availableMateriel),
    },
  };
};

// The stability cost of an unmet upkeep. Measured against the upkeep that was
// owed, so a small army whose full cost is unmet is not confused with a huge one.
export const shortfallPressureFor = (shortfall, upkeep) => {
  if (!shortfall) return 0;
  const needManpower = Math.max(0, Number(upkeep?.manpower) || 0);
  const needMateriel = Math.max(0, Number(upkeep?.materiel) || 0);
  const ratioManpower = needManpower > 0 ? clamp((Number(shortfall.manpower) || 0) / needManpower, 0, 1) : 0;
  const ratioMateriel = needMateriel > 0 ? clamp((Number(shortfall.materiel) || 0) / needMateriel, 0, 1) : 0;
  return FORCE_POOLS.STABILITY_UPKEEP_SHORTFALL * clamp(ratioManpower + ratioMateriel, 0, 1);
};

// Fold a posture into the month's multiplier vector, in place of a second pass
// through stepPolityMonth. growthDrag scales output; stabilityDrag and any
// carried shortfall subtract index points. stepPolityMonth is not touched.
export const applyMobilization = (multipliers, postureName = DEFAULT_POSTURE, { shortfallPressure = 0 } = {}) => {
  const effects = MOBILIZATION_EFFECTS[postureName] ?? MOBILIZATION_EFFECTS[DEFAULT_POSTURE];
  const base = multipliers ?? { population: 1, gdp: 1, inflation: 0, unemployment: 0, stability: 0 };
  return {
    population: base.population,
    gdp: base.gdp * (1 - effects.growthDrag),
    inflation: base.inflation,
    unemployment: base.unemployment,
    stability: base.stability - effects.stabilityDrag - (Number(shortfallPressure) || 0),
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/engine/forcePools.test.js`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add src/engine/forcePools.js src/engine/forcePools.test.js
git commit -m "feat(engine): step the force pools with a hard zero floor and a cap" -m "Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>"
```

---

### Task 3: Drive the pools from the economy clock

**Files:**
- Modify: `src/engine/economyTick.js`
- Test: `src/engine/economyTick.test.js`

**Interfaces:**
- Consumes: `DEFAULT_POSTURE`, `applyMobilization`, `shortfallPressureFor`, `stepPolityPools` from `./forcePools.js`.
- Produces: `advanceEconomy(state, { startDate, months, shocks, seed, upkeep, posture })` where `state` may carry `pools` and `shortfall`, and the returned `state` carries `pools` and `shortfall`.

- [ ] **Step 1: Write the failing test**

```js
// append to src/engine/economyTick.test.js
import { addGameMonths, gameDateYear } from "../runtime/gameDates.js";

test("the pools ride the same clock as the economy", () => {
  const origin = { month: 0, polities: { France: polityFixture() } };
  const { state } = advanceEconomy(origin, {
    startDate: "2026-01-01",
    months: 3,
    seed: "s",
    upkeep: { France: { manpower: 10_000, materiel: 5 } },
  });
  assert.ok(state.pools.France.manpower > 0);
  assert.ok(state.shortfall.France.manpower === 0);
});

test("with no upkeep and no posture the economy is byte-identical to before", () => {
  const origin = { month: 0, polities: { France: polityFixture() } };
  const withPools = advanceEconomy(origin, { startDate: "2026-01-01", months: 6, seed: "s" });

  // Baseline: the same six per-polity steps driven directly, without the pools
  // path, on the identity shock multipliers. If the default posture or the
  // shortfall composition ever stopped being the identity, this would diverge.
  let expected = origin.polities.France;
  for (let step = 1; step <= 6; step += 1) {
    const year = gameDateYear(addGameMonths("2026-01-01", step));
    expected = stepPolityMonth(expected, { year, multipliers: noShock });
  }
  assert.deepEqual(withPools.state.polities, { France: expected });
});

test("a carried shortfall drags stability, and the posture drags output", () => {
  const origin = {
    month: 0,
    polities: { France: polityFixture() },
    shortfall: { France: { manpower: 1_000_000, materiel: 0 } },
  };
  const upkeep = { France: { manpower: 1_000_000, materiel: 0 } };
  const base = advanceEconomy(origin, { startDate: "2026-01-01", months: 1, seed: "s", upkeep });
  const war = advanceEconomy(
    { ...origin },
    { startDate: "2026-01-01", months: 1, seed: "s", upkeep, posture: { France: "total" } },
  );
  assert.ok(war.state.polities.France.stability < base.state.polities.France.stability);
  assert.ok(war.state.polities.France.gdpGrowth < base.state.polities.France.gdpGrowth);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/engine/economyTick.test.js`
Expected: FAIL on `state.pools` being undefined.

- [ ] **Step 3: Modify `advanceEconomy`**

Add the import at the top of `src/engine/economyTick.js`:

```js
import { DEFAULT_POSTURE, applyMobilization, shortfallPressureFor, stepPolityPools } from "./forcePools.js";
```

Change the signature and the loop body. Replace the existing definition of `advanceEconomy` with:

```js
export const advanceEconomy = (
  state,
  { startDate, months, shocks = [], seed = "", upkeep = {}, posture = {} } = {},
) => {
  const requested = Math.trunc(Number(months)) || 0;
  const steps = Math.max(0, Math.min(MAX_STEPS, requested));
  const capped = requested > steps;
  const origin = state?.month ?? 0;
  let polities = { ...(state?.polities ?? {}) };
  let pools = { ...(state?.pools ?? {}) };
  let shortfall = { ...(state?.shortfall ?? {}) };
  let shockedMonths = 0;

  // Shock spans are relative to the moment they were declared, so they are
  // shifted once onto the absolute clock rather than re-based every step.
  const running = (Array.isArray(shocks) ? shocks : []).map((shock) => ({
    ...shock,
    startMonth: shock.startMonth + origin,
    endMonth: shock.endMonth + origin,
  }));

  for (let step = 1; step <= steps; step += 1) {
    // The month being simulated out of `origin` is `origin` itself: month 0 is
    // the span from origin to origin+1. Using `origin + step` would skip the
    // opening month of every shock span.
    const month = origin + step - 1;
    const year = gameDateYear(addGameMonths(startDate, step));
    if (running.some((shock) => month >= shock.startMonth && month < shock.endMonth)) shockedMonths += 1;

    const next = {};
    const nextPools = {};
    const nextShortfall = {};
    for (const name of stableOrder(Object.keys(polities))) {
      const own = running.filter((shock) => shockAppliesTo(shock, name));
      const postureName = posture?.[name] ?? DEFAULT_POSTURE;
      // The shortfall from LAST month is what drags stability now, so this
      // month's multipliers are a function of committed state, not of the pool
      // step that has not run yet.
      const multipliers = applyMobilization(activeMultipliers(own, month), postureName, {
        shortfallPressure: shortfallPressureFor(shortfall?.[name], upkeep?.[name]),
      });
      const steppedPolity = stepPolityMonth(polities[name], { year, multipliers });
      const steppedPools = stepPolityPools(steppedPolity, {
        pools: pools?.[name] ?? null,
        posture: postureName,
        upkeep: upkeep?.[name] ?? null,
      });
      next[name] = steppedPolity;
      nextPools[name] = steppedPools.pools;
      nextShortfall[name] = steppedPools.shortfall;
    }
    polities = next;
    pools = nextPools;
    shortfall = nextShortfall;
  }

  return {
    state: { month: origin + steps, polities, pools, shortfall },
    journal: { steps, capped, shockedMonths, seed },
  };
};
```

- [ ] **Step 4: Run the engine suite**

Run: `node --test "src/engine/*.test.js"`
Expected: PASS. The existing `economyTick` tests still pass because `deepEqual` compares the pools the new code adds symmetrically, and the `3 then 3 equals 6` assertion compares only `.polities`.

- [ ] **Step 5: Commit**

```bash
git add src/engine/economyTick.js src/engine/economyTick.test.js
git commit -m "feat(engine): advance the force pools inside the economy clock" -m "Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>"
```

---

### Task 4: Persist the new engine fields

**Files:**
- Modify: `src/runtime/gameState.js`
- Test: `src/runtime/gameState.economyEngine.test.js`

**Interfaces:**
- Consumes: `normalizePools`, `normalizeMobilizationMap`, `normalizePendingMobilization`, `normalizeUpkeepShortfall` from `../engine/forcePools.js`.
- Produces: `normalizeEconomyEngine` persists `pools`, `mobilization`, `pendingMobilization`, `upkeepShortfall`, each omitted when empty.

- [ ] **Step 1: Write the failing test**

```js
// append to src/runtime/gameState.economyEngine.test.js
import { normalizeWorldState } from "./gameState.js";

test("the force-pool engine fields round-trip through a world normalize", () => {
  const world = normalizeWorldState({
    economyEngine: {
      version: 1,
      seed: "abc",
      lastDate: "2026-04-01",
      lastMonth: 3,
      pools: { France: { manpower: 1200, materiel: 40.5 } },
      mobilization: { France: "total" },
      pendingMobilization: [{ polity: "Germany", posture: "partial" }],
      upkeepShortfall: { France: { manpower: 30, materiel: 0 } },
    },
  });
  assert.deepEqual(world.economyEngine.pools, { France: { manpower: 1200, materiel: 40.5 } });
  assert.deepEqual(world.economyEngine.mobilization, { France: "total" });
  assert.deepEqual(world.economyEngine.pendingMobilization, [{ polity: "Germany", posture: "partial" }]);
  assert.deepEqual(world.economyEngine.upkeepShortfall, { France: { manpower: 30, materiel: 0 } });
});

test("an engine block with none of the new fields keeps its old shape", () => {
  const world = normalizeWorldState({
    economyEngine: { version: 1, seed: "abc", lastDate: "2026-04-01", lastMonth: 3 },
  });
  assert.deepEqual(Object.keys(world.economyEngine).sort(), ["lastDate", "lastMonth", "seed", "version"]);
});

test("a half-written pool row is dropped, not defaulted", () => {
  const world = normalizeWorldState({
    economyEngine: {
      version: 1,
      seed: "abc",
      pools: { France: { manpower: 1200 }, Ghost: null },
    },
  });
  assert.equal(world.economyEngine.pools, undefined);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/runtime/gameState.economyEngine.test.js`
Expected: FAIL, `world.economyEngine.pools` is undefined.

- [ ] **Step 3: Extend `normalizeEconomyEngine`**

Add the import near the existing engine import at `src/runtime/gameState.js:21`:

```js
import {
  normalizeMobilizationMap,
  normalizePendingMobilization,
  normalizePools,
  normalizeUpkeepShortfall,
} from "../engine/forcePools.js";
```

Inside `normalizeEconomyEngine` (`src/runtime/gameState.js:3417`), after the `pendingShocks` block and before `return out;`, add:

```js
  // The force pools and the posture that is in force. All four are sparse: an
  // empty one is omitted, so a campaign that never mobilizes keeps a record
  // byte-identical to the economy increment's.
  const pools = normalizePools(value.pools);
  if (Object.keys(pools).length) out.pools = pools;
  const mobilization = normalizeMobilizationMap(value.mobilization);
  if (Object.keys(mobilization).length) out.mobilization = mobilization;
  const pendingMobilization = normalizePendingMobilization(value.pendingMobilization);
  if (pendingMobilization.length) out.pendingMobilization = pendingMobilization;
  const upkeepShortfall = normalizeUpkeepShortfall(value.upkeepShortfall);
  if (Object.keys(upkeepShortfall).length) out.upkeepShortfall = upkeepShortfall;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/runtime/gameState.economyEngine.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/gameState.js src/runtime/gameState.economyEngine.test.js
git commit -m "feat(runtime): persist the force pools, the posture and the shortfall" -m "Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>"
```

---

### Task 5: The `forces` sheet field, engine-only

**Files:**
- Modify: `src/runtime/countryStats.js`
- Test: `src/runtime/countryStats.forces.test.js`

**Interfaces:**
- Consumes: `MOBILIZATION_POSTURES` from `../engine/forcePools.js`.
- Produces: `normalizeCountryStatSheet` reads `forces`; `mergeCountryStatPatch` writes `forces` only when `engineSourced === true`.

- [ ] **Step 1: Write the failing test**

```js
// src/runtime/countryStats.forces.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { mergeCountryStatPatch, normalizeCountryStatSheet } from "./countryStats.js";

const forces = { manpower: 1200, materiel: 40.5, mobilization: "total" };

test("the sheet reads a well-formed forces block", () => {
  const sheet = normalizeCountryStatSheet({ statsSchemaVersion: 1, forces });
  assert.deepEqual(sheet.forces, forces);
});

test("a bad posture is dropped and a negative pool is floored", () => {
  const sheet = normalizeCountryStatSheet({
    statsSchemaVersion: 1,
    forces: { manpower: -5, materiel: 3, mobilization: "waving" },
  });
  assert.deepEqual(sheet.forces, { manpower: 0, materiel: 3 });
});

test("an engine-sourced patch writes forces", () => {
  const merged = mergeCountryStatPatch({ statsSchemaVersion: 1 }, { forces }, { engineSourced: true });
  assert.deepEqual(merged.forces, forces);
});

test("an ordinary patch cannot write forces", () => {
  const merged = mergeCountryStatPatch({ statsSchemaVersion: 1 }, { forces }, { engineSourced: false });
  assert.equal(merged.forces, undefined);
});

test("an ordinary patch cannot overwrite engine-written forces", () => {
  const base = normalizeCountryStatSheet({ statsSchemaVersion: 1, forces });
  const merged = mergeCountryStatPatch(base, { forces: { manpower: 1, materiel: 1, mobilization: "peacetime" } }, {});
  assert.deepEqual(merged.forces, forces);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/runtime/countryStats.forces.test.js`
Expected: FAIL, `sheet.forces` is undefined.

- [ ] **Step 3: Add `normalizeForces` and the gated merge**

Add the import near the top of `src/runtime/countryStats.js`, beside the `gameDates.js` import:

```js
import { MOBILIZATION_POSTURES } from "../engine/forcePools.js";
```

Add the normalizer just before `normalizeCountryStatSheet`:

```js
const FORCE_POSTURES = new Set(MOBILIZATION_POSTURES);

// The engine's readable mirror of the pools. It is written only through an
// engine-sourced patch (see the gate in mergeCountryStatPatch), so the model
// cannot state a reserve, but it is normalized here like any other sheet field
// because a save is read from disk and must be defensively bounded.
const normalizeForces = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out = {};
  const manpower = parseStatNumber(value.manpower);
  if (Number.isFinite(manpower)) out.manpower = Math.max(0, Math.round(manpower));
  const materiel = parseStatNumber(value.materiel);
  if (Number.isFinite(materiel)) out.materiel = Math.max(0, Math.round(materiel * 100) / 100);
  const mobilization = clean(value.mobilization).toLowerCase();
  if (FORCE_POSTURES.has(mobilization)) out.mobilization = mobilization;
  return Object.keys(out).length ? out : undefined;
};
```

Inside `normalizeCountryStatSheet`, after the `stability` block, add:

```js
  const forces = normalizeForces(value.forces);
  if (forces) out.forces = forces;
```

Inside `mergeCountryStatPatch`, after the `stability` block and before the `customStatsPatch` block, add:

```js
  // The forces block is engine-only. An ordinary event patch or an advisor write
  // that carries one is ignored field by field, so the model can never move a
  // reserve. The schema is the first line of defence; this is the second.
  if (engineSourced === true) {
    const forcesPatch = normalizeForces(patch.forces);
    if (forcesPatch) merged.forces = { ...(base.forces || {}), ...forcesPatch };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/runtime/countryStats.forces.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the country stat suite for regressions**

Run: `node --test "src/runtime/countryStats*.test.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/countryStats.js src/runtime/countryStats.forces.test.js
git commit -m "feat(runtime): mirror the force pools onto the sheet behind the engine gate" -m "Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>"
```

---

### Task 6: The adapter builds upkeep and writes the pools back

**Files:**
- Modify: `src/runtime/economyEngine.js`
- Test: `src/runtime/economyEngine.test.js`

**Interfaces:**
- Consumes: `UNIT_UPKEEP`, `DEFAULT_POSTURE`, `normalizeMobilization`, `normalizePools`, `normalizeMobilizationMap`, `normalizeUpkeepShortfall` from `../engine/forcePools.js`.
- Produces: `buildUpkeepTable(world) -> {[polity]: {manpower, materiel}}`; `advanceWorldEconomy(world, { ..., declaredMobilization, upkeep })` returns `{ world, deltas, months, journal, seed, shocksRunning, pools, posture, shortfall, declaredMobilization }` and writes `pools`, `mobilization`, `pendingMobilization`, `upkeepShortfall` onto `world.economyEngine` plus a `forces` block per sheet.

- [ ] **Step 1: Write the failing test**

```js
// append to src/runtime/economyEngine.test.js
import { buildUpkeepTable, advanceWorldEconomy as advance } from "./economyEngine.js";

const roster = () => ({
  countryStats: { Egypt: sheet() },
  units: [
    { ownerCode: "Egypt", type: "infantry", strength: 100, lng: 1, lat: 1 },
    { ownerCode: "Egypt", type: "armor", strength: 100, lng: 1, lat: 1 },
  ],
});

test("the upkeep table groups by owner and is order-independent", () => {
  const a = buildUpkeepTable(roster());
  const b = buildUpkeepTable({ ...roster(), units: [...roster().units].reverse() });
  assert.deepEqual(a, b);
  assert.ok(a.Egypt.materiel > 0);
  assert.ok(a.Egypt.manpower > 0);
});

test("the advance writes pools, a forces mirror and the committed posture", () => {
  const world = { ...roster(), economyEngine: { version: 1, seed: "s", lastDate: "2026-01-01", lastMonth: 0 } };
  const result = advance(world, {
    fromDate: "2026-01-01",
    toDate: "2026-04-01",
    declaredMobilization: [{ polity: "Egypt", posture: "total" }],
  });
  assert.ok(result.world.economyEngine.pools.Egypt.manpower > 0);
  assert.equal(result.world.economyEngine.mobilization, undefined);
  assert.deepEqual(result.world.economyEngine.pendingMobilization, [{ polity: "Egypt", posture: "total" }]);
  assert.equal(result.world.countryStats.Egypt.forces.mobilization, "peacetime");
});

test("the declared posture runs in the NEXT advance, not this one", () => {
  const world = { ...roster(), economyEngine: { version: 1, seed: "s", lastDate: "2026-01-01", lastMonth: 0 } };
  const first = advance(world, {
    fromDate: "2026-01-01",
    toDate: "2026-04-01",
    declaredMobilization: [{ polity: "Egypt", posture: "total" }],
  });
  const second = advance(first.world, { fromDate: "2026-04-01", toDate: "2026-07-01" });
  assert.equal(second.world.countryStats.Egypt.forces.mobilization, "total");
  assert.equal(second.world.economyEngine.mobilization.Egypt, "total");
  assert.equal(second.world.economyEngine.pendingMobilization, undefined);
});

test("an unknown polity declared for mobilization is rejected, not thrown", () => {
  const world = { ...roster(), economyEngine: { version: 1, seed: "s", lastDate: "2026-01-01", lastMonth: 0 } };
  const result = advance(world, {
    fromDate: "2026-01-01",
    toDate: "2026-04-01",
    declaredMobilization: [{ polity: "Atlantis", posture: "total" }],
  });
  assert.equal(result.world.economyEngine.pendingMobilization, undefined);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/runtime/economyEngine.test.js`
Expected: FAIL, `buildUpkeepTable` is not exported.

- [ ] **Step 3: Extend the adapter**

Replace the imports at the top of `src/runtime/economyEngine.js` with:

```js
import { advanceEconomy, makePolityEconomy } from "../engine/economyTick.js";
import { jitterFor, monthsBetweenDates, roundTo, stableOrder } from "../engine/economyMath.js";
import { MAX_SHOCKS, normalizeShocks } from "../engine/economyShocks.js";
import {
  DEFAULT_POSTURE,
  UNIT_UPKEEP,
  normalizeMobilization,
  normalizeMobilizationMap,
  normalizePools,
  normalizeUpkeepShortfall,
} from "../engine/forcePools.js";
import { applyCountryStatPatchToWorld } from "./gameState.js";
import { hashSeed } from "./unitMotion.js";
```

Add `buildUpkeepTable` before `advanceWorldEconomy`:

```js
// What the roster costs every month, grouped by owner. Read only: a unit is
// never edited, moved or disbanded here. Units are counted per owner and type
// first, then each owner's row is summed in a stable type order. The materiel
// costs are floats and float addition is not associative, so summing them in
// roster order would make the total depend on the roster order; a fixed type
// order makes the arithmetic order-independent.
export const buildUpkeepTable = (world) => {
  const counts = {};
  for (const unit of Array.isArray(world?.units) ? world.units : []) {
    const owner = String(unit?.ownerCode ?? "").trim();
    if (!owner) continue;
    const type = String(unit?.type ?? "").toLowerCase();
    if (!UNIT_UPKEEP[type]) continue;
    const byType = counts[owner] ?? {};
    byType[type] = (byType[type] ?? 0) + 1;
    counts[owner] = byType;
  }
  const table = {};
  for (const owner of stableOrder(Object.keys(counts))) {
    let manpower = 0;
    let materiel = 0;
    for (const type of stableOrder(Object.keys(counts[owner]))) {
      const count = counts[owner][type];
      manpower += count * UNIT_UPKEEP[type].manpower;
      materiel += count * UNIT_UPKEEP[type].materiel;
    }
    table[owner] = { manpower, materiel };
  }
  return table;
};
```

Add the pools/posture to the extracted state. In `extractEconomyState`, change the return to:

```js
  const fromDate = String(world?.economyEngine?.lastDate ?? "");
  return {
    month: monthsBetweenDates("2000-01-01", fromDate),
    polities,
    pools: normalizePools(world?.economyEngine?.pools),
    shortfall: normalizeUpkeepShortfall(world?.economyEngine?.upkeepShortfall),
  };
```

Change `advanceWorldEconomy`'s options and body. Replace the parameter list additions and the block after the early return with:

```js
export const advanceWorldEconomy = (
  world,
  {
    fromDate = "",
    toDate = "",
    declaredShocks = [],
    declaredMobilization = [],
    playerPolity = "",
    tracked = [],
    campaignId = "",
    scenarioId = "",
    // The period's OPENING roster cost, built by the caller so the dry run and
    // the authoritative advance charge the same army. Absent, it is built here.
    upkeep = null,
  } = {},
) => {
  const seed = String(world?.economyEngine?.seed ?? economySeedFor(campaignId, scenarioId));
  const committed = extractEconomyState(world, { seed });
  const months = monthsBetweenDates(fromDate, toDate);
  const knownPolities = Object.keys(committed.polities);
  if (months <= 0 || knownPolities.length === 0) {
    return {
      world,
      deltas: [],
      months: 0,
      journal: { steps: 0, capped: false, shockedMonths: 0, seed },
      seed,
      shocksRunning: [],
      pools: committed.pools,
      posture: {},
      shortfall: committed.shortfall,
      declaredMobilization: [],
    };
  }

  const { valid: applied, rejected } = normalizeShocks(world?.economyEngine?.pendingShocks, { knownPolities });
  const { valid: declared, rejected: declaredRejected } = normalizeShocks(declaredShocks, { knownPolities });

  // The posture in force this period: committed, overridden by last turn's
  // pending declaration. This turn's declaration is stored for next period.
  const posture = { ...normalizeMobilizationMap(world?.economyEngine?.mobilization) };
  const { valid: pendingNow } = normalizeMobilization(world?.economyEngine?.pendingMobilization, { knownPolities });
  for (const entry of pendingNow) posture[entry.polity] = entry.posture;
  const { valid: declaredNow, rejected: declaredMobilizationRejected } =
    normalizeMobilization(declaredMobilization, { knownPolities });

  const upkeepTable = upkeep ?? buildUpkeepTable(world);
  const { state, journal } = advanceEconomy(committed, {
    startDate: fromDate,
    months,
    shocks: applied,
    seed,
    upkeep: upkeepTable,
    posture,
  });

  const leftovers = applied
    .filter((shock) => shock.endMonth > months)
    .map((shock) => ({
      kind: shock.kind,
      severity: shock.severity,
      durationMonths: shock.endMonth - months,
      scope: Array.isArray(shock.scope) ? shock.scope : "world",
    }));
  const pendingShocks = [
    ...leftovers,
    ...declared.map((shock) => ({
      kind: shock.kind,
      severity: shock.severity,
      durationMonths: shock.endMonth,
      scope: Array.isArray(shock.scope) ? shock.scope : "world",
    })),
  ].slice(0, MAX_SHOCKS);

  // Only non-default postures are stored, so an absent name reads as peacetime.
  const committedMobilization = Object.fromEntries(
    stableOrder(Object.keys(posture))
      .filter((name) => posture[name] && posture[name] !== DEFAULT_POSTURE)
      .map((name) => [name, posture[name]]),
  );
  const shortfall = normalizeUpkeepShortfall(state.shortfall);

  const nextWorld = {
    ...world,
    countryStats: { ...(world?.countryStats ?? {}) },
    economyEngine: {
      version: ENGINE_VERSION,
      seed,
      lastDate: toDate,
      lastMonth: state.month,
      ...(pendingShocks.length ? { pendingShocks } : {}),
      ...(Object.keys(state.pools).length ? { pools: state.pools } : {}),
      ...(Object.keys(committedMobilization).length ? { mobilization: committedMobilization } : {}),
      ...(declaredNow.length ? { pendingMobilization: declaredNow } : {}),
      ...(Object.keys(shortfall).length ? { upkeepShortfall: shortfall } : {}),
    },
  };

  const deltas = [];
  for (const [name, polity] of Object.entries(state.polities)) {
    applyCountryStatPatchToWorld(nextWorld, name, {
      ...polityToPatch(polity),
      forces: {
        manpower: state.pools[name]?.manpower ?? 0,
        materiel: state.pools[name]?.materiel ?? 0,
        mobilization: posture[name] ?? DEFAULT_POSTURE,
      },
    }, {
      replaceComponents: true,
      engineSourced: true,
    });
    const engineSourced = OWNED_ECONOMY_FIELDS.every(
      (field) => (nextWorld.countryStats[name]?.economy?.[field] ?? null) !== null,
    );
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

  const rejectedAll = [...rejected, ...declaredRejected, ...declaredMobilizationRejected];
  if (rejectedAll.length) nextWorld.economyEngine.rejectedShocks = rejectedAll;
  const shocksRunning = leftovers.map((shock) => ({
    kind: shock.kind,
    severity: shock.severity,
    monthsLeft: shock.durationMonths,
  }));
  return {
    world: nextWorld,
    deltas,
    months,
    journal,
    seed,
    shocksRunning,
    pools: state.pools,
    posture,
    shortfall,
    declaredMobilization: declaredNow,
  };
};
```

Delete the old `advanceWorldEconomy` body: the new function above replaces it in full. `polityToPatch`, `OWNED_ECONOMY_FIELDS`, `ENGINE_VERSION`, `sheetToPolity` and `economySeedFor` are unchanged.

- [ ] **Step 4: Run the adapter suite**

Run: `node --test src/runtime/economyEngine.test.js`
Expected: PASS. The existing adapter tests still pass because the pools are additive to the returned object and the sheet patch only gains a `forces` key.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/economyEngine.js src/runtime/economyEngine.test.js
git commit -m "feat(runtime): read the roster, charge upkeep and write the pools back" -m "Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>"
```

---

### Task 7: The mobilization field in the jump schema

**Files:**
- Modify: `src/Game/AI/gameplaySchemas.js`
- Test: `src/Game/AI/gameplaySchemas.mobilization.test.js`

**Interfaces:**
- Consumes: `MOBILIZATION_POSTURES`, `MAX_MOBILIZATION` from `../../engine/forcePools.js`.
- Produces: `JUMP_FORWARD_SCHEMA.properties.mobilization`, an optional array of `{ polity, posture }`.

- [ ] **Step 1: Write the failing test**

```js
// src/Game/AI/gameplaySchemas.mobilization.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { JUMP_FORWARD_SCHEMA } from "./gameplaySchemas.js";
import { MOBILIZATION_POSTURES } from "../../engine/forcePools.js";

test("the jump schema carries a closed mobilization enum and a cap", () => {
  const field = JUMP_FORWARD_SCHEMA.properties.mobilization;
  assert.equal(field.type, "array");
  assert.equal(field.maxItems, 20);
  assert.deepEqual(field.items.properties.posture.enum, [...MOBILIZATION_POSTURES]);
  assert.deepEqual(field.items.required, ["polity", "posture"]);
});

test("mobilization is optional, so a turn that says nothing still validates", () => {
  assert.ok(!JUMP_FORWARD_SCHEMA.required.includes("mobilization"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/Game/AI/gameplaySchemas.mobilization.test.js`
Expected: FAIL, `properties.mobilization` is undefined.

- [ ] **Step 3: Add the field**

Change the engine import at `src/Game/AI/gameplaySchemas.js:2` to also bring in the posture constants:

```js
import { MAX_SHOCKS, MAX_SHOCK_MONTHS, SHOCK_KINDS } from "../../engine/economyShocks.js";
import { MAX_MOBILIZATION, MOBILIZATION_POSTURES } from "../../engine/forcePools.js";
```

Add the item schema just after `economicShockSchema` is defined:

```js
// The model's mobilization declaration: a scoped posture, one per polity, from a
// closed list. Like a shock, it carries no number the model could invent, and a
// declared posture takes effect in the NEXT period.
const mobilizationEntrySchema = {
  type: "object",
  properties: {
    polity: { type: "string", description: "Country name the posture applies to." },
    posture: { type: "string", enum: [...MOBILIZATION_POSTURES], description: "Closed list. peacetime is the default." },
  },
  required: ["polity", "posture"],
  additionalProperties: false,
};
```

Add the property inside `JUMP_FORWARD_SCHEMA.properties`, immediately after the `economicShocks` entry:

```js
    mobilization: {
      type: "array",
      maxItems: MAX_MOBILIZATION,
      description:
        "Mobilization postures for named polities (demobilized, peacetime, partial, total). "
        + "Each takes effect from the NEXT period. Do NOT state manpower, materiel or any reserve "
        + "as a number anywhere; the engine computes the pools locally from the roster and the posture.",
      items: mobilizationEntrySchema,
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/Game/AI/gameplaySchemas.mobilization.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/Game/AI/gameplaySchemas.js src/Game/AI/gameplaySchemas.mobilization.test.js
git commit -m "feat(ai): let the jump declare a scoped mobilization posture" -m "Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>"
```

---

### Task 8: The prompt instruction block

**Files:**
- Modify: `src/Game/AI/gameplayPrompts.js`
- Modify: `src/Game/AI/gameplay.js`
- Test: `src/Game/AI/forcePoolsPrompt.test.js`

**Interfaces:**
- Consumes: `buildEconomyDigest` variables from Task 9 are used here as an optional `forcePools` digest string.
- Produces: `buildForcePoolsInstructions({ digest }) -> string`; `gameplay.js` injects it after the economy block at `src/Game/AI/gameplay.js:2608`.

- [ ] **Step 1: Write the failing test**

```js
// src/Game/AI/forcePoolsPrompt.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { buildForcePoolsInstructions } from "./gameplayPrompts.js";

test("the instructions forbid stating a reserve and name the closed list", () => {
  const text = buildForcePoolsInstructions();
  assert.match(text, /\[National Forces\]/);
  assert.match(text, /demobilized, peacetime, partial, total/);
  assert.match(text, /never state/i);
  assert.match(text, /NEXT period/i);
});

test("a digest is appended as given facts", () => {
  const text = buildForcePoolsInstructions({ digest: "Your reserves: manpower 1,000." });
  assert.match(text, /Your reserves: manpower 1,000\./);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/Game/AI/forcePoolsPrompt.test.js`
Expected: FAIL, `buildForcePoolsInstructions` is not exported.

- [ ] **Step 3: Add the instruction builder**

Add to `src/Game/AI/gameplayPrompts.js`, immediately after `buildEconomyEngineInstructions`:

```js
export const buildForcePoolsInstructions = ({ digest = "" } = {}) => {
  const rules = [
    "[National Forces]",
    "Every polity keeps a manpower pool and a materiel pool, computed locally by the same deterministic "
    + "simulation that runs the economy. They are already decided by the time you are asked, and they are not "
    + "yours to invent. Never state, estimate, imply or restate a manpower or materiel number in prose or in "
    + "an event.",
    "What you control is the mobilization posture. When the period's events genuinely call up or stand down "
    + "forces, declare one for each named polity in mobilization, choosing from this closed list: "
    + "demobilized, peacetime, partial, total. A posture takes effect from the NEXT period, and total "
    + "mobilization raises production at the cost of output and stability.",
    "Declare a posture sparingly and only when the events you are writing justify it. Most periods have none.",
  ].join("\n\n");
  const facts = String(digest ?? "").trim();
  return facts ? `${rules}\n\n[The Period's Reserves, as simulated]\n${facts}` : rules;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/Game/AI/forcePoolsPrompt.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Inject the block in `gameplay.js`**

Add `buildForcePoolsInstructions` to the existing prompt import list at the top of `src/Game/AI/gameplay.js` (beside `buildEconomyEngineInstructions` at line 6).

Immediately after the economy block at `src/Game/AI/gameplay.js:2608`, add:

```js
    const forceBlock = buildForcePoolsInstructions({ digest: variables?.forcePoolsDigest });
    if (forceBlock) systemPrompt = `${systemPrompt}\n\n${forceBlock}`;
```

Match the surrounding code's exact pattern for appending; if the economy block assigns to `systemPrompt` differently, follow that same shape.

- [ ] **Step 6: Run the prompt suite**

Run: `node --test "src/Game/AI/*prompt*.test.js" "src/Game/AI/*Prompt*.test.js"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/Game/AI/gameplayPrompts.js src/Game/AI/gameplay.js src/Game/AI/forcePoolsPrompt.test.js
git commit -m "feat(ai): tell the model it declares a posture and states no reserve" -m "Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>"
```

---

### Task 9: The digest pool line

**Files:**
- Modify: `src/runtime/economyDigest.js`
- Test: `src/runtime/economyDigest.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure string transform).
- Produces: `buildEconomyDigest({ ..., playerPools, playerPosture }) -> string` with a kept player pool line and a posture-changed clause.

- [ ] **Step 1: Write the failing test**

```js
// append to src/runtime/economyDigest.test.js
import { DIGEST_CHAR_CAP, buildEconomyDigest } from "./economyDigest.js";

const delta = { polity: "Egypt", gdpGrowth: 1, inflation: 3, unemployment: 6, publicDebt: 90, budgetBalance: -3 };

test("the player pool line appears when the engine produced pools", () => {
  const text = buildEconomyDigest({
    deltas: [delta],
    playerPolity: "Egypt",
    playerPools: { manpower: 1_240_000, materiel: 318.4 },
    playerPosture: "peacetime",
  });
  assert.match(text, /Your reserves: manpower 1,240,000, materiel 318\.40\./);
  assert.match(text, /Mobilization: peacetime\./);
});

test("without pools the digest is byte-identical to the economy-only digest", () => {
  // The pre-pools output, pinned byte-for-byte: no stray separator or blank line.
  const expected = "Economy this period, computed locally (treat these as fact, do not restate them with different numbers):\n"
    + "- Egypt (yours): output +1.0%, inflation 3.0%, unemployment 6.0%, public debt 90% of output, budget -3.0%.";
  const without = buildEconomyDigest({ deltas: [delta], playerPolity: "Egypt" });
  const explicitNull = buildEconomyDigest({ deltas: [delta], playerPolity: "Egypt", playerPools: null });
  assert.equal(without, expected);
  assert.equal(without, explicitNull);
  assert.doesNotMatch(without, /\n\n/);
  assert.notEqual(without[0], "\n");
  assert.notEqual(without[without.length - 1], "\n");
});

test("an empty delta list still reports the reserves and mobilization line", () => {
  const text = buildEconomyDigest({
    deltas: [],
    playerPolity: "Egypt",
    playerPools: { manpower: 800, materiel: 12.5 },
    playerPosture: "total",
  });
  assert.match(text, /Your reserves: manpower 800, materiel 12\.50\./);
  assert.match(text, /Mobilization: total\./);
});

test("the pool line survives when the only economy line is too long to fit", () => {
  const text = buildEconomyDigest({
    deltas: [{ ...delta, polity: "x".repeat(DIGEST_CHAR_CAP) }],
    playerPolity: "Egypt",
    playerPools: { manpower: 10, materiel: 1 },
    playerPosture: "peacetime",
  });
  assert.equal(text, "Your reserves: manpower 10, materiel 1.00. Mobilization: peacetime.");
  assert.equal(text.includes("Economy this period"), false);
});

test("a posture changed this period is named", () => {
  const text = buildEconomyDigest({
    deltas: [delta],
    playerPolity: "Egypt",
    playerPools: { manpower: 10, materiel: 1 },
    playerPosture: "total",
    postureChanged: true,
  });
  assert.match(text, /Mobilization: total \(changed this period\)\./);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/runtime/economyDigest.test.js`
Expected: FAIL, no "Your reserves" line.

- [ ] **Step 3: Extend `buildEconomyDigest`**

In `src/runtime/economyDigest.js`, add two helpers before `buildEconomyDigest`:

```js
const thousands = (value) => Math.max(0, Math.round(number(value))).toLocaleString("en-US");
const poolLineFor = ({ playerPolity, playerPools, playerPosture, postureChanged }) => {
  if (!playerPolity || !playerPools) return "";
  const posture = String(playerPosture ?? "").trim() || "peacetime";
  const clause = postureChanged ? " (changed this period)" : "";
  return `Your reserves: manpower ${thousands(playerPools.manpower)}, `
    + `materiel ${number(playerPools.materiel).toFixed(2)}. Mobilization: ${posture}${clause}.`;
};
```

Change the signature to accept the new options:

```js
export const buildEconomyDigest = ({
  deltas,
  playerPolity = "",
  tracked = [],
  shocks = [],
  playerPools = null,
  playerPosture = "",
  postureChanged = false,
} = {}) => {
```

Right after `const header = "..."`, add:

```js
  const poolLine = poolLineFor({ playerPolity: player, playerPools, playerPosture, postureChanged });
```

Change the initial `used` to account for the pool line, so the pool line is never dropped and the economy lines still respect the cap:

```js
  let used = header.length + (poolLine ? poolLine.length + 1 : 0);
```

Change the final return to place the pool line first, before the economy lines, and keep it even when no economy line fits:

```js
  return [header, poolLine, ...lines, ...shockLines].filter(Boolean).join("\n");
```

Finally, the early return for an empty delta list must still show the pool line. Change:

```js
  const list = (Array.isArray(deltas) ? deltas : []).filter((d) => d && typeof d === "object" && d.polity);
  if (!list.length) return "";
```

to:

```js
  const list = (Array.isArray(deltas) ? deltas : []).filter((d) => d && typeof d === "object" && d.polity);
  const player = String(playerPolity ?? "");
  const earlyPool = poolLineFor({ playerPolity: player, playerPools, playerPosture, postureChanged });
  if (!list.length) return earlyPool;
```

Remove the now-duplicate `const player = String(playerPolity ?? "");` line further down.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/runtime/economyDigest.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/economyDigest.js src/runtime/economyDigest.test.js
git commit -m "feat(runtime): tell the model the player's reserves and posture" -m "Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>"
```

---

### Task 10: Merge mobilization across jump segments

**Files:**
- Modify: `src/Game/AI/jumpSegments.js`
- Test: `src/Game/AI/jumpSegments.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `mergeSegmentPayloads(payloads, ...)` returns `mobilization`, folded to one entry per polity, the last segment winning.

- [ ] **Step 1: Write the failing test**

```js
// append to src/Game/AI/jumpSegments.test.js
import { mergeSegmentPayloads } from "./jumpSegments.js";

test("mobilization merges across segments, one entry per polity, last wins", () => {
  const merged = mergeSegmentPayloads([
    { events: [], mobilization: [{ polity: "France", posture: "partial" }] },
    { events: [], mobilization: [{ polity: "France", posture: "total" }, { polity: "Germany", posture: "partial" }] },
  ]);
  assert.deepEqual(merged.mobilization, [
    { polity: "France", posture: "total" },
    { polity: "Germany", posture: "partial" },
  ]);
});

test("a segment with no mobilization contributes none", () => {
  const merged = mergeSegmentPayloads([{ events: [] }, { events: [], mobilization: [{ polity: "France", posture: "total" }] }]);
  assert.deepEqual(merged.mobilization, [{ polity: "France", posture: "total" }]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/Game/AI/jumpSegments.test.js`
Expected: FAIL, `merged.mobilization` is undefined.

- [ ] **Step 3: Add the merge**

In `src/Game/AI/jumpSegments.js`, beside `const economicShocks = [];` at line 253, add:

```js
  // The model's mobilization declarations. Like the shocks they concatenate, but
  // a posture is one value per polity, so the list is folded below, last segment
  // winning, rather than stacked.
  const mobilization = [];
```

Inside the segment loop, beside `economicShocks.push(...asArray(payload.economicShocks));`, add:

```js
    mobilization.push(...asArray(payload.mobilization));
```

Before the `return {` in `mergeSegmentPayloads`, add:

```js
  // Fold to one entry per polity. Map keeps the first insertion position and the
  // last value, so a later segment overrides without reshuffling the order.
  const mobilizationByPolity = new Map();
  for (const entry of mobilization) {
    if (!entry || typeof entry !== "object") continue;
    const polity = normalizeString(entry.polity ?? entry.country);
    if (!polity) continue;
    mobilizationByPolity.set(polity.toLowerCase(), { polity, posture: normalizeString(entry.posture).toLowerCase() });
  }
```

Add `mobilization: [...mobilizationByPolity.values()],` to the returned object, beside `economicShocks`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/Game/AI/jumpSegments.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Game/AI/jumpSegments.js src/Game/AI/jumpSegments.test.js
git commit -m "feat(ai): carry mobilization through a segmented jump" -m "Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>"
```

---

### Task 11: Wire the declarations and the opening roster into the turn

**Files:**
- Modify: `src/Game/AI/gameplay.js`
- Test: `src/Game/AI/forceWiringArchitecture.test.js`

**Interfaces:**
- Consumes: `advanceWorldEconomy(world, { ..., declaredMobilization, upkeep })`, `buildUpkeepTable(world)`, `buildEconomyDigest({ ..., playerPools, playerPosture, postureChanged })`.
- Produces: both `advanceWorldEconomy` calls (`simulateTimelineJump` at `:12699`, `applySimulationResult` at `:7210`) pass an opening-roster upkeep table and this turn's `declaredMobilization`; `variables.forcePoolsDigest` is set before the model call.

- [ ] **Step 1: Write the failing architecture test**

```js
// src/Game/AI/forceWiringArchitecture.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");

const bodyOf = (marker) => {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${marker} is present`);
  const end = source.indexOf("\nconst ", start + marker.length);
  return source.slice(start, end === -1 ? source.length : end);
};

test("the real advance passes an opening-roster upkeep table and the declared mobilization", () => {
  const body = bodyOf("const applySimulationResult = async ({");
  const advance = body.indexOf("advanceWorldEconomy(nextWorld");
  assert.notEqual(advance, -1);
  const call = body.slice(advance, advance + 900);
  assert.match(call, /upkeep:/);
  assert.match(call, /declaredMobilization:/);
});

test("the projection builds the upkeep table and the pool digest before the model is asked", () => {
  const body = bodyOf("export const simulateTimelineJump = async (");
  assert.match(body, /buildUpkeepTable\(bundle\.world\)/);
  assert.match(body, /variables\.forcePoolsDigest = buildEconomyDigest\(/);
});

test("the upkeep table is built from the opening world, not the post-impact world", () => {
  const body = bodyOf("const applySimulationResult = async ({");
  assert.match(body, /buildUpkeepTable\(baseWorld\)/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/Game/AI/forceWiringArchitecture.test.js`
Expected: FAIL on the missing `upkeep:` and `declaredMobilization:`.

- [ ] **Step 3: Wire the projection**

In `src/Game/AI/gameplay.js`, import `buildUpkeepTable` beside the existing `advanceWorldEconomy` import from `../../runtime/economyEngine.js`.

In `simulateTimelineJump`, inside the existing `try` that projects the economy (around line 12699), pass the opening roster and build the pool digest. Change the `advanceWorldEconomy` call to:

```js
    const projected = advanceWorldEconomy(bundle.world, {
      fromDate: originDate,
      toDate: targetDate,
      playerPolity: normalizeString(bundle.game.country),
      tracked: Object.keys(bundle.world?.countryStats ?? {}),
      upkeep: buildUpkeepTable(bundle.world),
      campaignId: activeCampaignId(),
      scenarioId: normalizeString(bundle.game.scenarioId),
    });
```

After the existing `variables.economyDigest = buildEconomyDigest({...});`, add:

```js
    const playerPolity = normalizeString(bundle.game.country);
    variables.forcePoolsDigest = buildEconomyDigest({
      deltas: [],
      playerPolity,
      playerPools: projected.pools?.[playerPolity] ?? null,
      playerPosture: projected.posture?.[playerPolity] ?? "peacetime",
    });
```

Note: `buildEconomyDigest` returns only the pool line when `deltas` is empty, which is exactly the desired block for `[The Period's Reserves]`.

- [ ] **Step 4: Wire the authoritative advance**

In `applySimulationResult`, change the `advanceWorldEconomy(nextWorld, {...})` call at line 7210 to pass the opening roster and the declaration:

```js
    const economy = advanceWorldEconomy(nextWorld, {
      fromDate: baseGame.gameDate || "",
      toDate: nextGame.gameDate || "",
      declaredShocks: normalizeArray(result.economicShocks),
      // Declared mobilizations run NEXT period, exactly like the shocks.
      declaredMobilization: normalizeArray(result.mobilization),
      upkeep: buildUpkeepTable(baseWorld),
      playerPolity: nextGame.country || "",
      tracked: Object.keys(nextWorld.countryStats ?? {}),
      campaignId,
      scenarioId: nextGame.scenarioId || "",
    });
```

`baseWorld` is the pre-impact world already in scope in `applySimulationResult`; if the local name differs, use the function's opening-world argument. Confirm with a read before editing.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test src/Game/AI/forceWiringArchitecture.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 6: Run the AI suite**

Run: `node --test "src/Game/AI/*.test.js"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/Game/AI/gameplay.js src/Game/AI/forceWiringArchitecture.test.js
git commit -m "feat(ai): charge the opening roster and carry the mobilization into the turn" -m "Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>"
```

---

### Task 12: The Forces section on the country panel

**Files:**
- Modify: `src/Game/GameUI/stats.jsx`

**Interfaces:**
- Consumes: `sheet.forces` written by Task 5.
- Produces: a read-only Forces block listing manpower, materiel and the posture.

- [ ] **Step 1: Read the existing cards to match the local pattern**

Read `src/Game/GameUI/stats.jsx` around the Population and Economy cards (lines 2103-2148). The new block goes immediately after the Population card and before the Economy section, using the same `sectionTitleStyle`, `cardStyle` and `EconomyCard` helpers already in the file.

- [ ] **Step 2: Add the section**

Insert after the Population card's closing `</div>` (line 2117) and before the `{/* Economy */}` comment:

```jsx
                {/* Forces - engine-written reserves. Read-only: the posture is declared through the narration. */}
                {sheet.forces && (
                    <>
                    <div style={sectionTitleStyle}>Forces</div>
                    <div style={{ display: "grid", gap: "0.55rem", gridTemplateColumns: "1fr 1fr" }}>
                    <EconomyCard
                    label="Manpower"
                    value={formatPopulation(sheet.forces.manpower)}
                    sub="Reserve pool"
                    tone="#94a3b8"
                    />
                    <EconomyCard
                    label="Materiel"
                    value={Number(sheet.forces.materiel || 0).toFixed(2)}
                    sub="Reserve pool"
                    tone="#94a3b8"
                    />
                    <EconomyCard
                    label="Mobilization"
                    value={String(sheet.forces.mobilization || "peacetime")}
                    sub="Declared through the turn"
                    tone="#22c55e"
                    />
                    </div>
                    </>
                )}
```

Confirm `EconomyCard` and `formatPopulation` are in scope at that point in the file; they are used by the adjacent cards.

- [ ] **Step 3: Lint the file**

Run: `npx eslint src/Game/GameUI/stats.jsx`
Expected: no new error introduced by the change. Pre-existing errors live only in `src/Game/Map/Nations.jsx`, `labels/PolityTextLayer.jsx`, `labels/polityTextCustomLayer.js`, `vnext/ownershipFloodCustomLayer.js`.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/Game/GameUI/stats.jsx
git commit -m "feat(ui): show the reserves and the posture on the country panel" -m "Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>"
```

---

### Task 13: Documentation and the regenerated wiki

**Files:**
- Modify: `docs/world-state.md`
- Modify: `docs/ai-overview.md`
- Modify: `docs/ai-schemas.md`
- Modify: `docs/runtime-services.md`
- Modify: `docs/architecture.md`
- Modify: `wiki/**` (regenerated)

**Interfaces:**
- Consumes: everything built in Tasks 1-12.
- Produces: the written record.

- [ ] **Step 1: Document the world state**

In `docs/world-state.md`, extend the `economyEngine` description to list `pools`, `mobilization`, `pendingMobilization` and `upkeepShortfall`, each sparse, and add a `forces` sub-table under the country stat sheet section: `{ manpower, materiel, mobilization }`, engine-written only, with the zero floor stated.

- [ ] **Step 2: Document the AI boundary**

- `docs/ai-overview.md`: the `mobilization` field, the closed posture enum and the one-period lag.
- `docs/ai-schemas.md`: the `mobilization` entry in the jump payload, beside `economicShocks`.
- `docs/runtime-services.md`: `src/engine/forcePools.js`, `buildUpkeepTable`, and that the pool step runs inside the economy clock.
- `docs/architecture.md`: the force pools as the second consumer of the engine contract, after the economy.

- [ ] **Step 3: Regenerate the wiki**

Run: `npm run build:wiki`
Then: `npm run wiki:check`
Expected: `Wiki is current.`, exit 0.

- [ ] **Step 4: Commit**

```bash
git add docs wiki
git commit -m "docs(engine): record the force pools, the posture and the upkeep" -m "Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>"
```

---

### Task 14: Full verification

**Files:**
- No source change. This task is the acceptance gate.

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: 2486 pre-existing tests plus the new ones, 0 failures, 2 todo. Record the exact counts.

- [ ] **Step 2: Run the engine suite with the glob form**

Run: `node --test "src/engine/*.test.js"`
Expected: PASS, including the purity guard.

- [ ] **Step 3: Lint**

Run: `npx eslint .`
Expected: the same four pre-existing error files, no new one.

- [ ] **Step 4: Wiki currency and build**

Run: `npm run wiki:check && npm run build`
Expected: `Wiki is current.` and a successful build.

- [ ] **Step 5: Push**

```bash
git push origin main
```

Expected: pushed to the fork `AbdallahEssam23/open-historia`. Never push to `Open-Historia/open-historia`.

---

## Self-Review

**Spec coverage.** Layers (Task 1-2, 6): the pure core, the adapter, the boundary. Determinism contract (Task 1-3): purity guard unchanged, stable order used in the adapter's posture serialization, single rounding in `stepPolityPools`. Time model (Task 3): the pools ride `advanceEconomy`'s existing loop and `MAX_STEPS`. State model (Task 4): all four fields, sparse. Month step (Task 2): production then upkeep, zero floor, cap. Mobilization (Task 1, 6): closed enum, scoped list, validation, one-period lag, segment merge (Task 10). Upkeep and the zero floor (Task 5, 6): roster read only, shortfall to stability, stored on `upkeepShortfall`. Engine-sourced mark (Task 5): the `forces` merge gate. Visibility (Task 12). Digest (Task 9, 11). Boundary (Task 7, 8, 10, 11). Tests (every task; Task 14). Docs (Task 13).
