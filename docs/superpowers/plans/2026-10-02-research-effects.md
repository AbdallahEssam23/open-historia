# Research Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A completed research programme grants its polity a deterministic, engine-owned modifier derived from its closed `domain` and `scale`, applied to the production line, the force pools and the economic step.

**Architecture:** A new pure core `src/engine/researchEffects.js` holds the domain-to-target table, the scale-to-points table, the per-target cap and the three application factors. The economy clock threads the committed totals into the three existing engine functions through optional arguments that default to "no effect"; the runtime adapter reads the committed totals, folds this span's completions into them and writes them back to `economyEngine.researchEffects` for the next span. The model authors nothing: it cannot complete research (the previous increment's guard), so it cannot grant itself an effect.

**Tech Stack:** ES modules, `node --test`, no framework, no new dependency.

## Global Constraints

- ASCII only in source and docs. No emoji, no em dash, no middle dot.
- No new `package.json` entry and no new runtime dependency.
- `src/engine/**` must stay import-free of browser globals: no `window`, `document`, `localStorage`, `Date.now`, `new Date`, `Math.random`, `fetch`. `src/engine/enginePurity.test.js` enforces this over the whole directory.
- Every engine function changed here gains an optional argument whose default reproduces current behavior exactly. Do not edit an existing test to accommodate a change.
- Tests are run with a glob, never a bare directory: `node --test "src/engine/*.test.js"`.
- Commit messages are conventional and do NOT include the `Co-authored-by:` trailer. The `prepare-commit-msg` hook adds it.
- `public/wiki/**` is generated and committed. Its source is `wiki/` (not `docs/wiki/`). Regenerate with `npm run build:wiki`; verify with `npm run wiki:check`, which must print exactly `Wiki is current.`.
- No schema change and no prompt change: `jumpChars` stays under 29500 (`src/Game/AI/projectOpSchema.test.js`).
- The spec for this plan is `docs/specs/2026-10-02-research-effects-design.md`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/engine/researchEffects.js` (new) | The pure modifier model: tables, cap, fold, normalize and the three multipliers. |
| `src/engine/productionQueue.js` | `enqueueOrders` gains a build-time multiplier. |
| `src/engine/forcePools.js` | `stepPolityPools` gains a regeneration multiplier. |
| `src/engine/economyTick.js` | `stepPolityMonth` gains a growth bonus; `advanceEconomy` reads the totals and threads all three. |
| `src/runtime/economyEngine.js` | Reads the committed totals, folds the span's completions, writes the next totals, returns the applied ones. |
| `src/runtime/gameState.js` | `normalizeEconomyEngine` normalizes the new sparse field. |
| `src/runtime/economyDigest.js` | Renders the player-only research-effects line. |
| `src/Game/AI/gameplay.js` | Passes the player's applied totals into the digest. |
| `src/Game/GameUI/forces.jsx` | Shows the player's totals, read-only. |
| `src/Game/GameUI/projects.jsx` | Shows a completed programme's own contribution on its card. |

---

### Task 1: The research-effects core

**Files:**
- Create: `src/engine/researchEffects.js`
- Test: `src/engine/researchEffects.test.js`

**Interfaces:**
- Consumes: `RESEARCH_DOMAINS` from `src/engine/research.js` (test only).
- Produces:
  - `RESEARCH_EFFECT_TARGETS: string[]`
  - `RESEARCH_DOMAIN_EFFECT: { [domain]: "production"|"pools"|"economy" }`
  - `RESEARCH_EFFECT_POINTS: { small: 1, medium: 2, large: 3 }`
  - `MAX_RESEARCH_EFFECT_POINTS: 6`
  - `PRODUCTION_SPEED_PER_POINT: 0.05`, `POOL_REGEN_PER_POINT: 0.05`, `ECONOMY_GROWTH_PER_POINT: 0.1`
  - `effectTargetFor(domain) -> string`
  - `effectPointsFor(domain, scale) -> number`
  - `foldResearchEffect(totals|null, { domain, scale }) -> { production, pools, economy }`
  - `normalizeResearchEffects(value) -> { [polity]: { production, pools, economy } }`
  - `researchEffectTotalsFor(map, polity) -> { production, pools, economy }`
  - `productionTimeMultiplier(points) -> number`
  - `poolRegenMultiplier(points) -> number`
  - `economyGrowthBonus(points) -> number`
  - `researchEffectLabel(domain, scale) -> string`
  - `researchEffectTotalsLabel(totals) -> string`

- [ ] **Step 1: Write the failing test**

Create `src/engine/researchEffects.test.js`:

```js
// Run: node --test src/engine/researchEffects.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { RESEARCH_DOMAINS } from "./research.js";
import {
  ECONOMY_GROWTH_PER_POINT,
  MAX_RESEARCH_EFFECT_POINTS,
  POOL_REGEN_PER_POINT,
  PRODUCTION_SPEED_PER_POINT,
  RESEARCH_EFFECT_POINTS,
  RESEARCH_EFFECT_TARGETS,
  economyGrowthBonus,
  effectPointsFor,
  effectTargetFor,
  foldResearchEffect,
  normalizeResearchEffects,
  poolRegenMultiplier,
  productionTimeMultiplier,
  researchEffectLabel,
  researchEffectTotalsFor,
  researchEffectTotalsLabel,
} from "./researchEffects.js";

test("every domain maps to exactly one known target", () => {
  for (const domain of RESEARCH_DOMAINS) {
    assert.ok(RESEARCH_EFFECT_TARGETS.includes(effectTargetFor(domain)), domain);
  }
});

test("the points a completion is worth follow the scale table", () => {
  assert.equal(effectPointsFor("industrial", "small"), RESEARCH_EFFECT_POINTS.small);
  assert.equal(effectPointsFor("industrial", "medium"), RESEARCH_EFFECT_POINTS.medium);
  assert.equal(effectPointsFor("industrial", "large"), RESEARCH_EFFECT_POINTS.large);
});

test("an unknown domain or scale is worth nothing", () => {
  assert.equal(effectTargetFor("psionics"), "");
  assert.equal(effectPointsFor("psionics", "large"), 0);
  assert.equal(effectPointsFor("industrial", "colossal"), 0);
});

test("folding accumulates into the target and caps there", () => {
  let totals = foldResearchEffect(null, { domain: "industrial", scale: "large" });
  assert.deepEqual(totals, { production: 3, pools: 0, economy: 0 });
  totals = foldResearchEffect(totals, { domain: "electronics", scale: "large" });
  assert.equal(totals.production, MAX_RESEARCH_EFFECT_POINTS);
  totals = foldResearchEffect(totals, { domain: "industrial", scale: "large" });
  assert.equal(totals.production, MAX_RESEARCH_EFFECT_POINTS);
});

test("folding is pure and order-independent", () => {
  const base = { production: 1, pools: 0, economy: 0 };
  const folded = foldResearchEffect(base, { domain: "industrial", scale: "medium" });
  assert.deepEqual(base, { production: 1, pools: 0, economy: 0 }, "the input is not mutated");
  assert.equal(folded.production, 3);
  const a = foldResearchEffect(
    foldResearchEffect(null, { domain: "industrial", scale: "medium" }),
    { domain: "naval", scale: "small" },
  );
  const b = foldResearchEffect(
    foldResearchEffect(null, { domain: "naval", scale: "small" }),
    { domain: "industrial", scale: "medium" },
  );
  assert.deepEqual(a, b);
});

test("the multipliers are the no-op at zero and the documented value at the cap", () => {
  assert.equal(productionTimeMultiplier(0), 1);
  assert.equal(poolRegenMultiplier(0), 1);
  assert.equal(economyGrowthBonus(0), 0);
  assert.equal(
    productionTimeMultiplier(MAX_RESEARCH_EFFECT_POINTS),
    1 / (1 + PRODUCTION_SPEED_PER_POINT * MAX_RESEARCH_EFFECT_POINTS),
  );
  assert.equal(
    poolRegenMultiplier(MAX_RESEARCH_EFFECT_POINTS),
    1 + POOL_REGEN_PER_POINT * MAX_RESEARCH_EFFECT_POINTS,
  );
  assert.equal(
    economyGrowthBonus(MAX_RESEARCH_EFFECT_POINTS),
    ECONOMY_GROWTH_PER_POINT * MAX_RESEARCH_EFFECT_POINTS,
  );
});

test("normalize floors, caps and omits all-zero rows", () => {
  const map = normalizeResearchEffects({
    France: { production: 99, pools: -3, economy: 0 },
    "": { production: 5 },
    Germany: { production: 0, pools: 0, economy: 0 },
  });
  assert.deepEqual(map, { France: { production: MAX_RESEARCH_EFFECT_POINTS, pools: 0, economy: 0 } });
  assert.deepEqual(researchEffectTotalsFor(map, "Nowhere"), { production: 0, pools: 0, economy: 0 });
});

test("the labels name the target and the amount", () => {
  assert.equal(researchEffectLabel("industrial", "medium"), "+10% production");
  assert.equal(researchEffectLabel("medical", "small"), "+0.1pp growth");
  assert.equal(researchEffectLabel("psionics", "large"), "");
  assert.equal(
    researchEffectTotalsLabel({ production: 6, pools: 2, economy: 0 }),
    "production +30%, pools +10%",
  );
  assert.equal(researchEffectTotalsLabel(null), "");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/engine/researchEffects.test.js"`
Expected: FAIL, the module `./researchEffects.js` cannot be found.

- [ ] **Step 3: Write the implementation**

Create `src/engine/researchEffects.js`:

```js
/*! Open Historia - deterministic economy: research effects (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What completing a research programme does to the simulation: a modifier
// derived from the closed domain/scale pair the research increment already
// stores, applied to the production line, the force pools and the economic step.
// Like every core file this is pure and IMPORT-FREE.

// The three consumers, one per target.
export const RESEARCH_EFFECT_TARGETS = Object.freeze(["production", "pools", "economy"]);

// Total over RESEARCH_DOMAINS: every programme the engine can price can be
// applied, and each domain feeds exactly one target.
export const RESEARCH_DOMAIN_EFFECT = Object.freeze({
  military: "pools",
  naval: "pools",
  aerospace: "pools",
  industrial: "production",
  electronics: "production",
  medical: "economy",
  nuclear: "economy",
});

// What one completion is worth, by scale. The same scale is worth the same
// everywhere, so a large programme always moves its target three times as much
// as a small one.
export const RESEARCH_EFFECT_POINTS = Object.freeze({ small: 1, medium: 2, large: 3 });
// A per-target ceiling, so a long campaign cannot turn one target unbounded.
export const MAX_RESEARCH_EFFECT_POINTS = 6;

// First-draft calibration, expected to be tuned against campaigns. The tests
// assert bounds and determinism, never a magnitude.
export const PRODUCTION_SPEED_PER_POINT = 0.05;
export const POOL_REGEN_PER_POINT = 0.05;
export const ECONOMY_GROWTH_PER_POINT = 0.1;

const text = (value) => String(value ?? "").trim().toLowerCase();
const round1 = (value) => Math.round(value * 10) / 10;
const whole = (value) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const clampPoints = (value) => Math.min(MAX_RESEARCH_EFFECT_POINTS, whole(value));

const totalsShape = (value) => ({
  production: clampPoints(value?.production),
  pools: clampPoints(value?.pools),
  economy: clampPoints(value?.economy),
});

// The target a domain feeds, or "" for a domain the table does not know.
export const effectTargetFor = (domain) => RESEARCH_DOMAIN_EFFECT[text(domain)] ?? "";

// The points a completion is worth, or 0 when either half is unknown. A zero is
// the "no effect" the fold and the multipliers already handle.
export const effectPointsFor = (domain, scale) =>
  (effectTargetFor(domain) ? (RESEARCH_EFFECT_POINTS[text(scale)] ?? 0) : 0);

// Pure: the input totals are never mutated, so a caller can fold over a shared
// baseline without copying it first.
export const foldResearchEffect = (totals, { domain, scale } = {}) => {
  const target = effectTargetFor(domain);
  const points = effectPointsFor(domain, scale);
  const current = totalsShape(totals);
  if (!target || points <= 0) return current;
  return { ...current, [target]: Math.min(MAX_RESEARCH_EFFECT_POINTS, current[target] + points) };
};

// Mirrors normalizePools: floor and cap every row, drop an unknown polity, and
// omit a row that ends up all-zero so a campaign with no research keeps the
// economyEngine record byte-identical to the previous increment's.
export const normalizeResearchEffects = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [polity, row] of Object.entries(value)) {
    const name = String(polity ?? "").trim();
    if (!name) continue;
    const totals = totalsShape(row);
    if (totals.production || totals.pools || totals.economy) out[name] = totals;
  }
  return out;
};

export const researchEffectTotalsFor = (map, polity) =>
  totalsShape(map?.[String(polity ?? "")]);

export const productionTimeMultiplier = (points) =>
  1 / (1 + PRODUCTION_SPEED_PER_POINT * clampPoints(points));
export const poolRegenMultiplier = (points) =>
  1 + POOL_REGEN_PER_POINT * clampPoints(points);
export const economyGrowthBonus = (points) =>
  ECONOMY_GROWTH_PER_POINT * clampPoints(points);

// One programme's own contribution ("+10% production"), or "" when it is worth
// nothing. Used by the research card so the board explains where a modifier came
// from, from the same table the engine applies.
export const researchEffectLabel = (domain, scale) => {
  const target = effectTargetFor(domain);
  const points = effectPointsFor(domain, scale);
  if (!target || points <= 0) return "";
  if (target === "economy") return `+${round1(ECONOMY_GROWTH_PER_POINT * points)}pp growth`;
  const perPoint = target === "production" ? PRODUCTION_SPEED_PER_POINT : POOL_REGEN_PER_POINT;
  return `+${round1(100 * perPoint * points)}% ${target}`;
};

// A polity's totals as one phrase ("production +30%, pools +10%"), or "" when
// all three are zero. The digest and the panel both render this, so the two
// cannot disagree about what a total means.
export const researchEffectTotalsLabel = (totals) => {
  const row = totalsShape(totals);
  const parts = [];
  if (row.production) parts.push(`production +${round1(100 * PRODUCTION_SPEED_PER_POINT * row.production)}%`);
  if (row.pools) parts.push(`pools +${round1(100 * POOL_REGEN_PER_POINT * row.pools)}%`);
  if (row.economy) parts.push(`growth +${round1(ECONOMY_GROWTH_PER_POINT * row.economy)}pp`);
  return parts.join(", ");
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/engine/researchEffects.test.js"`
Expected: PASS, 8 tests, 0 fail.

- [ ] **Step 5: Run the whole engine suite and the purity guard**

Run: `node --test "src/engine/*.test.js"`
Expected: PASS, 0 fail. `enginePurity.test.js` is green because the new core imports nothing.

- [ ] **Step 6: Commit**

```bash
git add src/engine/researchEffects.js src/engine/researchEffects.test.js
git commit -m "feat(engine): add the research-effects core"
```

---

### Task 2: The production-time seam

**Files:**
- Modify: `src/engine/productionQueue.js:193-250`
- Test: `src/engine/productionQueue.test.js`

**Interfaces:**
- Consumes: nothing from Task 1 (the multiplier is passed in as a number).
- Produces: `enqueueOrders({ pools, line, orders, timeMultiplier = 1 })` stamps `monthsTotal` as `max(1, ceil(price.months * timeMultiplier))`.

- [ ] **Step 1: Write the failing test**

Add to `src/engine/productionQueue.test.js` (import `enqueueOrders` from `./productionQueue.js` if it is not already imported):

```js
test("a build-time multiplier shortens the stamped duration", () => {
  const order = { type: "naval", count: 1 };
  const base = enqueueOrders({ pools: { manpower: 100000, materiel: 1000 }, orders: [order] });
  const sped = enqueueOrders({
    pools: { manpower: 100000, materiel: 1000 },
    orders: [order],
    timeMultiplier: 1 / 1.3,
  });
  assert.equal(base.line.queue[0].monthsTotal, 6);
  assert.equal(sped.line.queue[0].monthsTotal, 5);
});

test("a non-finite or non-positive build-time multiplier is a no-op", () => {
  for (const bad of [0, -1, Number.NaN, "x"]) {
    const result = enqueueOrders({
      pools: { manpower: 100000, materiel: 1000 },
      orders: [{ type: "naval", count: 1 }],
      timeMultiplier: bad,
    });
    assert.equal(result.line.queue[0].monthsTotal, 6, String(bad));
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/engine/productionQueue.test.js"`
Expected: FAIL, `sped.line.queue[0].monthsTotal` is 6, not 5.

- [ ] **Step 3: Write the implementation**

In `src/engine/productionQueue.js`, change `itemShape` to accept the multiplier:

```js
const itemShape = (order, timeMultiplier = 1) => ({
  kind: order.kind,
  type: order.type,
  count: Math.max(1, countFor(order.count)),
  monthsTotal: Math.max(1, Math.ceil(priceOf(order).months * timeMultiplier)),
  ...(name(order.at) ? { at: name(order.at) } : {}),
  ...(name(order.name) ? { name: name(order.name) } : {}),
});
```

Change `enqueueOrders` to take and sanitize the multiplier:

```js
export const enqueueOrders = ({ pools = null, line = null, orders = [], timeMultiplier = 1 } = {}) => {
  let manpower = Math.max(0, Number(pools?.manpower) || 0);
  let materiel = Math.max(0, Number(pools?.materiel) || 0);
  const active = line?.active ? { ...line.active } : undefined;
  const queue = Array.isArray(line?.queue) ? line.queue.map((item) => ({ ...item })) : [];
  const rejected = [];
  // A research effect can only shorten a build. A missing, zero, negative or
  // non-finite multiplier is the no-op, so a caller that forgets the argument
  // gets today's behavior rather than an immortal or instant order.
  const rate = Number(timeMultiplier);
  const buildTime = Number.isFinite(rate) && rate > 0 ? rate : 1;

  for (const order of Array.isArray(orders) ? orders : []) {
    if (queue.length >= MAX_PRODUCTION_QUEUE) {
      rejected.push({ ...order, reason: "line full" });
      continue;
    }
    const price = priceOf(order);
    if (manpower < price.manpower || materiel < price.materiel) {
      rejected.push({ ...order, reason: "cannot afford" });
      continue;
    }
    manpower -= price.manpower;
    materiel -= price.materiel;
    queue.push(itemShape(order, buildTime));
  }

  return {
    pools: {
      manpower: Math.max(0, Math.round(manpower)),
      materiel: Math.max(0, roundTo(materiel, 2)),
    },
    line: active || queue.length ? { ...(active ? { active } : {}), queue } : null,
    rejected,
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/engine/productionQueue.test.js"`
Expected: PASS, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/engine/productionQueue.js src/engine/productionQueue.test.js
git commit -m "feat(engine): let research shorten the production build time"
```

---

### Task 3: The pools-regeneration seam

**Files:**
- Modify: `src/engine/forcePools.js:166-198`
- Test: `src/engine/forcePools.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `stepPolityPools(polity, { pools, posture, upkeep, regenMultiplier = 1 })` multiplies both regeneration terms before the cap.

- [ ] **Step 1: Write the failing test**

Add to `src/engine/forcePools.test.js` (import `stepPolityPools` from `./forcePools.js` if it is not already imported):

```js
test("a regeneration multiplier raises the monthly gain", () => {
  const polity = { population: 10_000_000, gdp: 1e11, gdpBreakdown: { industry: 30 } };
  const base = stepPolityPools(polity, { pools: { manpower: 0, materiel: 0 }, posture: "peacetime" });
  const boosted = stepPolityPools(polity, {
    pools: { manpower: 0, materiel: 0 },
    posture: "peacetime",
    regenMultiplier: 1.3,
  });
  assert.ok(boosted.pools.manpower > base.pools.manpower);
  assert.ok(boosted.pools.materiel > base.pools.materiel);
});

test("a missing or non-positive regeneration multiplier is a no-op", () => {
  const polity = { population: 10_000_000, gdp: 1e11, gdpBreakdown: { industry: 30 } };
  const base = stepPolityPools(polity, { pools: { manpower: 0, materiel: 0 }, posture: "peacetime" });
  for (const bad of [undefined, 0, -1, Number.NaN]) {
    const same = stepPolityPools(polity, {
      pools: { manpower: 0, materiel: 0 },
      posture: "peacetime",
      regenMultiplier: bad,
    });
    assert.deepEqual(same.pools, base.pools);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/engine/forcePools.test.js"`
Expected: FAIL, the boosted gain equals the base gain.

- [ ] **Step 3: Write the implementation**

In `src/engine/forcePools.js`, change the signature and the two regeneration terms:

```js
export const stepPolityPools = (polity, { pools = null, posture: postureName = DEFAULT_POSTURE, upkeep: cost = null, regenMultiplier = 1 } = {}) => {
  const effects = MOBILIZATION_EFFECTS[postureName] ?? MOBILIZATION_EFFECTS[DEFAULT_POSTURE];
  const base = pools ?? initialPoolsFor(polity);
  const population = Math.max(0, Number(polity?.population) || 0);
  const gdp = Math.max(0, Number(polity?.gdp) || 0);
  const industryShare = clamp(Number(polity?.gdpBreakdown?.industry) || 0, 0, 100) / 100;
  // A research effect can only speed regeneration; a missing or invalid
  // multiplier is the no-op, so every existing caller computes what it did.
  const regen = Number.isFinite(Number(regenMultiplier)) && Number(regenMultiplier) > 0
    ? Number(regenMultiplier)
    : 1;

  let manpower = Math.max(0, Number(base.manpower) || 0)
    + population * FORCE_POOLS.MANPOWER_PER_CAPITA_MONTHLY * effects.extraction * regen;
  manpower = Math.min(manpower, population * FORCE_POOLS.MANPOWER_CAP_SHARE);

  let materiel = Math.max(0, Number(base.materiel) || 0)
    + gdp * industryShare * FORCE_POOLS.MATERIEL_PER_OUTPUT_MONTHLY * effects.allocation * regen;
  materiel = Math.min(materiel, gdp * FORCE_POOLS.MATERIEL_CAP_SHARE);
```

Leave the rest of the function (the upkeep draw and the return) unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/engine/forcePools.test.js"`
Expected: PASS, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/engine/forcePools.js src/engine/forcePools.test.js
git commit -m "feat(engine): let research speed the force-pool regeneration"
```

---

### Task 4: The economic-growth seam

**Files:**
- Modify: `src/engine/economyTick.js:56-107`
- Test: `src/engine/economyTick.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `stepPolityMonth(polity, { year, multipliers, growthBonus = 0 })` adds `growthBonus` percentage points to `annualGrowth`.

- [ ] **Step 1: Write the failing test**

Add to `src/engine/economyTick.test.js` (the file already imports `stepPolityMonth` and defines `polityFixture` and `noShock`):

```js
test("a growth bonus raises the reported annual growth", () => {
  const before = polityFixture();
  const plain = stepPolityMonth(before, { year: 2026, multipliers: noShock });
  const boosted = stepPolityMonth(before, { year: 2026, multipliers: noShock, growthBonus: 0.5 });
  assert.ok(boosted.gdpGrowth > plain.gdpGrowth, "the bonus lifts growth");
  assert.ok(
    Math.abs((boosted.gdpGrowth - plain.gdpGrowth) - 0.5) < 0.001,
    "the bonus is applied as percentage points",
  );
  assert.equal(
    stepPolityMonth(before, { year: 2026, multipliers: noShock, growthBonus: 0 }).gdpGrowth,
    plain.gdpGrowth,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/engine/economyTick.test.js"`
Expected: FAIL, `boosted.gdpGrowth` equals `plain.gdpGrowth`.

- [ ] **Step 3: Write the implementation**

In `src/engine/economyTick.js`, change the signature of `stepPolityMonth` and the `annualGrowth` line:

```js
export const stepPolityMonth = (polity, { year, multipliers, growthBonus = 0 }) => {
```

Then, where `annualGrowth` is computed (currently line 107):

```js
  // A research effect adds percentage points of annual growth before the
  // stability equilibrium is derived, so an expansion research bought also
  // carries the stability that growth implies. A missing or invalid bonus is the
  // no-op, so every existing caller computes what it did.
  const bonus = Number.isFinite(Number(growthBonus)) ? Number(growthBonus) : 0;
  const annualGrowth = gpcGrowth * 12 * 100 + bonus;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/engine/economyTick.test.js"`
Expected: PASS, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/engine/economyTick.js src/engine/economyTick.test.js
git commit -m "feat(engine): let research lift the annual growth"
```

---

### Task 5: Thread the committed totals through the clock

**Files:**
- Modify: `src/engine/economyTick.js:187-295`
- Test: `src/engine/economyTick.test.js`

**Interfaces:**
- Consumes: `economyGrowthBonus`, `poolRegenMultiplier`, `productionTimeMultiplier`, `researchEffectTotalsFor` from Task 1.
- Produces: `advanceEconomy(state, { ..., researchEffects = {} })`, where `researchEffects` is `{ [polity]: { production, pools, economy } }` and is applied to the span being advanced.

- [ ] **Step 1: Write the failing test**

Add to `src/engine/economyTick.test.js`:

```js
test("research effects reach the line, the pools and the growth", () => {
  const state = {
    month: 0,
    polities: { France: polityFixture() },
    pools: { France: { manpower: 100000, materiel: 1000 } },
  };
  const orders = [{ polity: "France", type: "naval", count: 1 }];
  const plain = advanceEconomy(state, { startDate: "2026-01-01", months: 1, seed: "s", orders });
  const boosted = advanceEconomy(state, {
    startDate: "2026-01-01",
    months: 1,
    seed: "s",
    orders,
    researchEffects: { France: { production: 6, pools: 6, economy: 6 } },
  });
  assert.equal(plain.state.production.France.active.monthsTotal, 6);
  assert.equal(boosted.state.production.France.active.monthsTotal, 5);
  assert.ok(boosted.state.pools.France.manpower > plain.state.pools.France.manpower);
  assert.ok(boosted.state.polities.France.gdpGrowth > plain.state.polities.France.gdpGrowth);
});

test("no research effects leaves the advance unchanged", () => {
  const state = { month: 0, polities: { France: polityFixture() } };
  const absent = advanceEconomy(state, { startDate: "2026-01-01", months: 3, seed: "s" });
  const empty = advanceEconomy(state, { startDate: "2026-01-01", months: 3, seed: "s", researchEffects: {} });
  assert.deepEqual(absent.state, empty.state);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/engine/economyTick.test.js"`
Expected: FAIL, `monthsTotal` is 6 in both, so the first assertion fails.

- [ ] **Step 3: Write the implementation**

In `src/engine/economyTick.js`, add the import beside the existing research import:

```js
import {
  economyGrowthBonus,
  poolRegenMultiplier,
  productionTimeMultiplier,
  researchEffectTotalsFor,
} from "./researchEffects.js";
```

Add the option to `advanceEconomy`:

```js
export const advanceEconomy = (
  state,
  { startDate, months, shocks = [], seed = "", upkeep = {}, posture = {}, orders = [], researchEffects = {} } = {},
) => {
```

In the opening-orders loop, pass the production multiplier:

```js
  for (const polity of stableOrder(Object.keys(ordersByPolity))) {
    const base = pools[polity] ?? initialPoolsFor(polities[polity]);
    const effects = researchEffectTotalsFor(researchEffects, polity);
    const paid = enqueueOrders({
      pools: base,
      line: production[polity] ?? null,
      orders: ordersByPolity[polity],
      timeMultiplier: productionTimeMultiplier(effects.production),
    });
    pools[polity] = paid.pools;
    if (paid.line) production[polity] = paid.line;
    else delete production[polity];
    rejectedProduction.push(...paid.rejected.map((entry) => ({ polity, ...entry })));
  }
```

In the month loop, look the totals up once per polity and pass them to the pools and the growth step:

```js
    for (const name of stableOrder(Object.keys(polities))) {
      const own = running.filter((shock) => shockAppliesTo(shock, name));
      const postureName = posture?.[name] ?? DEFAULT_POSTURE;
      const effects = researchEffectTotalsFor(researchEffects, name);
      // The shortfall from LAST month is what drags stability now, so this
      // month's multipliers are a function of committed state, not of the pool
      // step that has not run yet.
      const multipliers = applyMobilization(activeMultipliers(own, month), postureName, {
        shortfallPressure: shortfallPressureFor(shortfall?.[name], upkeep?.[name]),
      });
      const steppedPolity = stepPolityMonth(polities[name], {
        year,
        multipliers,
        growthBonus: economyGrowthBonus(effects.economy),
      });
      const steppedPools = stepPolityPools(steppedPolity, {
        pools: pools?.[name] ?? null,
        posture: postureName,
        upkeep: upkeep?.[name] ?? null,
        regenMultiplier: poolRegenMultiplier(effects.pools),
      });
```

Leave the rest of the loop unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/engine/economyTick.test.js"`
Expected: PASS, 0 fail.

- [ ] **Step 5: Run the whole engine suite**

Run: `node --test "src/engine/*.test.js"`
Expected: PASS, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add src/engine/economyTick.js src/engine/economyTick.test.js
git commit -m "feat(engine): apply the research effects in the economy clock"
```

---

### Task 6: Read, fold and write the totals in the adapter

**Files:**
- Modify: `src/runtime/economyEngine.js:225-472`
- Test: `src/runtime/economyEngine.research.test.js`

**Interfaces:**
- Consumes: `foldResearchEffect`, `normalizeResearchEffects` from Task 1; `advanceEconomy` accepting `researchEffects` from Task 5.
- Produces: `advanceWorldEconomy` reads `world.economyEngine.researchEffects`, applies it, folds this span's ``researchCompletions``, writes the next totals to `nextWorld.economyEngine.researchEffects` (sparse), and returns `researchEffects` = the totals applied this span.

- [ ] **Step 1: Write the failing test**

Add to `src/runtime/economyEngine.research.test.js`:

```js
test("a completion folds its modifier once, applied from the next span", () => {
  const world = {
    countryStats: {
      Egypt: {
        stability: 60,
        economy: { gdp: 1e12, gdpPerCapita: 10_000 },
        population: { total: 100_000_000 },
        territorialComponents: [
          { geography: "core", group: "core", population: 100_000_000, gdpPerCapita: 10_000 },
        ],
      },
    },
    projects: [
      {
        id: "rx",
        name: "Programme",
        kind: "research",
        ownerCode: "Egypt",
        domain: "military",
        scale: "small",
        researchPoints: 29,
        status: "active",
      },
    ],
  };
  const first = advanceWorldEconomy(world, {
    fromDate: "2026-01-01",
    toDate: "2026-02-01",
    playerPolity: "Egypt",
  });
  assert.ok(first.researchOps.some((op) => op.op === "close"), "the programme completes");
  assert.equal(first.researchEffects.Egypt.pools, 0, "the effect is not applied in the span that produced it");
  assert.deepEqual(
    first.world.economyEngine.researchEffects,
    { Egypt: { production: 0, pools: 1, economy: 0 } },
  );

  const second = advanceWorldEconomy(first.world, {
    fromDate: "2026-02-01",
    toDate: "2026-03-01",
    playerPolity: "Egypt",
  });
  assert.equal(second.researchEffects.Egypt.pools, 1, "the effect is applied from the next span");
  assert.deepEqual(
    second.world.economyEngine.researchEffects,
    { Egypt: { production: 0, pools: 1, economy: 0 } },
    "and is not folded twice",
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/runtime/economyEngine.research.test.js"`
Expected: FAIL, `first.world.economyEngine.researchEffects` is `undefined`.

- [ ] **Step 3: Write the implementation**

In `src/runtime/economyEngine.js`, extend the research import:

```js
import { foldResearchEffect, normalizeResearchEffects } from "../engine/researchEffects.js";
```

Read the committed totals beside `researchInput`, and pass them to the advance:

```js
  const upkeepTable = upkeep ?? buildUpkeepTable(world);
  const researchInput = buildResearchInput(world, { playerPolity });
  // The totals in force THIS span. The fold below produces next span's, so a
  // programme completed here takes effect from the next span on - the same
  // one-period lag the shocks, the posture and the facilities already have.
  const appliedResearchEffects = normalizeResearchEffects(world?.economyEngine?.researchEffects);
  const { state, journal, completions, rejectedProduction, researchCompletions } = advanceEconomy(
    { ...committed, research: researchInput },
    {
      startDate: fromDate,
      months,
      shocks: applied,
      seed,
      upkeep: upkeepTable,
      posture,
      orders: appliedOrders,
      researchEffects: appliedResearchEffects,
    },
  );
```

Add the early-return field so every caller sees the shape (in the `months <= 0` return):

```js
      researchOps: [],
      research: {},
      researchEffects: appliedResearchEffects,
    };
```

(Move `const appliedResearchEffects = normalizeResearchEffects(world?.economyEngine?.researchEffects);`
to before the early return, beside the `seed`/`committed` lines. The early return
then names it.)

After `const shortfall = normalizeUpkeepShortfall(state.shortfall);`, fold this
span's completions:

```js
  // Fold this span's completions into the committed totals, using the pair the
  // input still carries (normalizeResearchProgrammes has already shed domain and
  // scale). normalizeResearchEffects drops a row that ends up all-zero, so a
  // campaign with no research keeps the record byte-identical.
  const foldedResearchEffects = { ...appliedResearchEffects };
  for (const completion of researchCompletions) {
    const programme = researchInput[completion.polity]?.programmes
      .find((entry) => entry.id === completion.id);
    if (!programme) continue;
    foldedResearchEffects[completion.polity] = foldResearchEffect(
      foldedResearchEffects[completion.polity],
      programme,
    );
  }
  const researchEffectsNext = normalizeResearchEffects(foldedResearchEffects);
```

Add the sparse field to the new engine record:

```js
      ...(Object.keys(shortfall).length ? { upkeepShortfall: shortfall } : {}),
      ...(Object.keys(researchEffectsNext).length ? { researchEffects: researchEffectsNext } : {}),
    },
  };
```

Add `researchEffects: appliedResearchEffects` to the main return object, beside
`researchOps`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/runtime/economyEngine.research.test.js"`
Expected: PASS, 0 fail.

- [ ] **Step 5: Run the runtime suite**

Run: `node --test "src/runtime/*.test.js"`
Expected: PASS, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/economyEngine.js src/runtime/economyEngine.research.test.js
git commit -m "feat(runtime): fold completed research into engine-owned effects"
```

---

### Task 7: Persist and normalize the totals

**Files:**
- Modify: `src/runtime/gameState.js:3547-3584`
- Test: `src/runtime/gameState.economyEngine.test.js`

**Interfaces:**
- Consumes: `normalizeResearchEffects` from Task 1.
- Produces: `normalizeEconomyEngine` keeps a sparse `researchEffects` field.

- [ ] **Step 1: Write the failing test**

Add to `src/runtime/gameState.economyEngine.test.js`:

```js
test("the research-effects field round-trips, clamps and stays sparse", () => {
  const normalized = normalizeWorldState({
    economyEngine: {
      version: 1,
      seed: "abcdef0123456789",
      lastDate: "2026-04-01",
      lastMonth: 3,
      researchEffects: {
        Egypt: { production: 99, pools: -2, economy: 1 },
        "": { production: 3 },
        Mali: { production: 0, pools: 0, economy: 0 },
      },
    },
  });
  assert.deepEqual(normalized.economyEngine.researchEffects, {
    Egypt: { production: 6, pools: 0, economy: 1 },
  });
  assert.deepEqual(
    normalizeWorldState(normalized).economyEngine.researchEffects,
    normalized.economyEngine.researchEffects,
  );
  const without = normalizeWorldState({
    economyEngine: { version: 1, seed: "abcdef0123456789", lastDate: "2026-04-01", lastMonth: 3 },
  });
  assert.equal("researchEffects" in without.economyEngine, false, "an empty field is omitted");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/runtime/gameState.economyEngine.test.js"`
Expected: FAIL, `researchEffects` is `undefined` on the round-tripped world.

- [ ] **Step 3: Write the implementation**

In `src/runtime/gameState.js`, import the normalizer beside the other engine
imports at the top of the file:

```js
import { normalizeResearchEffects } from "../engine/researchEffects.js";
```

In `normalizeEconomyEngine`, after the production fields and before `return out;`:

```js
  // The completed-research totals. Sparse, like the pools and the line: an empty
  // map is omitted, so a campaign with no research keeps the record
  // byte-identical to the research increment's.
  const researchEffects = normalizeResearchEffects(value.researchEffects);
  if (Object.keys(researchEffects).length) out.researchEffects = researchEffects;
  return out;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/runtime/gameState.economyEngine.test.js"`
Expected: PASS, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/gameState.js src/runtime/gameState.economyEngine.test.js
git commit -m "feat(runtime): persist the research effects on the engine record"
```

---

### Task 8: The digest line

**Files:**
- Modify: `src/runtime/economyDigest.js:70-135`
- Modify: `src/Game/AI/gameplay.js:12870-12875`
- Test: `src/runtime/economyDigest.test.js`

**Interfaces:**
- Consumes: `researchEffectTotalsLabel` from Task 1; `researchEffects` from the adapter result (Task 6).
- Produces: `buildEconomyDigest({ ..., playerResearchEffects = null })` adds a player-only reserve-block line.

- [ ] **Step 1: Write the failing test**

Add to `src/runtime/economyDigest.test.js`:

```js
test("the research effects line names only the non-zero targets", () => {
  const digest = buildEconomyDigest({
    deltas: [],
    playerPolity: "France",
    playerResearchEffects: { production: 6, pools: 2, economy: 0 },
  });
  assert.match(digest, /Research effects: production \+30%, pools \+10%/);
  assert.doesNotMatch(digest, /growth/);
});

test("the research effects line is omitted when there are no effects", () => {
  const digest = buildEconomyDigest({
    deltas: [],
    playerPolity: "France",
    playerResearchEffects: { production: 0, pools: 0, economy: 0 },
  });
  assert.doesNotMatch(digest, /Research effects/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/runtime/economyDigest.test.js"`
Expected: FAIL, the digest carries no `Research effects:` text.

- [ ] **Step 3: Write the implementation**

In `src/runtime/economyDigest.js`, import the label helper at the top:

```js
import { researchEffectTotalsLabel } from "../engine/researchEffects.js";
```

Add the clause beside `researchClauseFor`:

```js
// The player's completed-research totals, rendered as one line. Only the targets
// a polity actually holds appear, so a country that has finished no programme
// pays nothing for the feature. Player-only, like the research line.
const researchEffectsClauseFor = (totals) => {
  const summary = researchEffectTotalsLabel(totals);
  return summary ? `Research effects: ${summary}` : "";
};
```

Add the parameter and thread it into the reserve block:

```js
export const buildEconomyDigest = ({
  deltas,
  playerPolity = "",
  tracked = [],
  shocks = [],
  playerPools = null,
  playerPosture = "",
  postureChanged = false,
  playerShortfall = null,
  playerProduction = null,
  research = null,
  playerResearchEffects = null,
} = {}) => {
  const list = (Array.isArray(deltas) ? deltas : []).filter((d) => d && typeof d === "object" && d.polity);
  const player = String(playerPolity ?? "");
  const poolLine = poolLineFor({ playerPolity: player, playerPools, playerPosture, postureChanged, playerShortfall });
  const productionLine = productionClauseFor(playerProduction);
  const researchLine = researchClauseFor(research);
  const researchEffectsLine = researchEffectsClauseFor(playerResearchEffects);
  const reserveBlock = [poolLine, productionLine, researchLine, researchEffectsLine].filter(Boolean).join("\n");
```

In `src/Game/AI/gameplay.js`, pass the applied totals into the same call that
already carries the research queue (around line 12870, inside the
`projected.months > 0` block where `playerPolity` is in scope):

```js
      variables.productionDigest = buildEconomyDigest({
        deltas: [],
        playerPolity,
        playerProduction: projected.production?.[playerPolity] ?? null,
        research: playerResearch,
        playerResearchEffects: projected.researchEffects?.[playerPolity] ?? null,
      });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/runtime/economyDigest.test.js"`
Expected: PASS, 0 fail.

- [ ] **Step 5: Run the AI suite to confirm the wiring parses**

Run: `node --test "src/Game/AI/*.test.js"`
Expected: PASS, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/economyDigest.js src/runtime/economyDigest.test.js src/Game/AI/gameplay.js
git commit -m "feat(runtime): report the research effects in the digest"
```

---

### Task 9: Show the effects to the player

**Files:**
- Modify: `src/Game/GameUI/forces.jsx:110-153, 325-342`
- Modify: `src/Game/GameUI/projects.jsx:485-492`
- Test: `src/Game/GameUI/researchEffectsUi.test.js`

**Interfaces:**
- Consumes: `researchEffectTotalsLabel` and `researchEffectLabel` from Task 1.
- Produces: the Forces panel shows the player's totals; a completed research card shows its own contribution.

- [ ] **Step 1: Write the failing test**

Create `src/Game/GameUI/researchEffectsUi.test.js`:

```js
// Run: node --test src/Game/GameUI/researchEffectsUi.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("the forces panel reads and renders the player's research effects", () => {
  const src = read("./forces.jsx");
  assert.match(src, /researchEffects/);
  assert.match(src, /researchEffectTotalsLabel/);
});

test("the research card shows a completed programme's own contribution", () => {
  const src = read("./projects.jsx");
  assert.match(src, /researchEffectLabel/);
  assert.match(src, /project\.status === "complete"/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/Game/GameUI/researchEffectsUi.test.js"`
Expected: FAIL, `researchEffectTotalsLabel` is not in `forces.jsx`.

- [ ] **Step 3: Write the implementation**

In `src/Game/GameUI/forces.jsx`, add the imports beside the existing imports:

```js
import { researchEffectTotalsLabel } from "../../../engine/researchEffects.js";
import { toCountryName } from "../../../runtime/ownerNames.js";
```

Add the state beside `productionLine` (line 112):

```js
  const [productionLine, setProductionLine] = useState(null);
  const [researchEffects, setResearchEffects] = useState(null);
```

Extend the read effect (lines 142-153). The player token can be a bare GADM
code while the engine keys its records by the country name, so canonicalise
once and use it for both lookups:

```js
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    readWorldStateView({ force: false })
      .then((world) => {
        if (cancelled) return;
        const code = getPlayerCode();
        const player = toCountryName(code) || code;
        setProductionLine(world?.economyEngine?.production?.[player] ?? null);
        setResearchEffects(world?.economyEngine?.researchEffects?.[player] ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, units.length]);
```

Render the line immediately after the production block (after line 342, before
`Your units`):

```jsx
            {researchEffects && researchEffectTotalsLabel(researchEffects) && (
              <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: "8px", padding: "8px", marginBottom: "10px" }}>
                <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", marginBottom: "5px" }}>Research effects</div>
                <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)" }}>
                  {researchEffectTotalsLabel(researchEffects)}
                </div>
              </div>
            )}
```

In `src/Game/GameUI/projects.jsx`, add the import:

```js
import { researchEffectLabel } from "../../../engine/researchEffects.js";
```

In the card component, compute the contribution once, beside the other derived
values (before the `return (`):

```js
  // A completed research programme shows what it actually granted, derived from
  // the same table the engine applies, so the board explains the modifier.
  const researchContribution = project.kind === "research"
    ? researchEffectLabel(project.domain, project.scale)
    : "";
```

Render it after the domain/scale caption (after the block that ends around line
492):

```jsx
      {researchContribution && project.status === "complete" && (
        <div style={{ color: "#c4b5fd", fontSize: "0.65rem", marginTop: "0.2rem" }}>
          {researchContribution}
        </div>
      )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/Game/GameUI/researchEffectsUi.test.js"`
Expected: PASS, 2 tests, 0 fail.

- [ ] **Step 5: Run the whole GameUI suite**

Run: `node --test "src/Game/GameUI/*.test.js"`
Expected: PASS, 0 fail.

- [ ] **Step 6: Lint the changed UI files**

Run: `npx eslint src/Game/GameUI/forces.jsx src/Game/GameUI/projects.jsx`
Expected: 0 errors. (Pre-existing warnings on untouched lines are fine.)

- [ ] **Step 7: Commit**

```bash
git add src/Game/GameUI/forces.jsx src/Game/GameUI/projects.jsx src/Game/GameUI/researchEffectsUi.test.js
git commit -m "feat(ui): show the research effects on the forces panel and the board"
```

---

### Task 10: The wiring guard

**Files:**
- Modify: `src/runtime/researchWiringArchitecture.test.js`
- Test: `src/runtime/researchWiringArchitecture.test.js`

**Interfaces:**
- Consumes: the shipped source of the six files.
- Produces: a source-structure guard pinning the research-effects wiring.

- [ ] **Step 1: Write the failing test**

Add to `src/runtime/researchWiringArchitecture.test.js` (it already defines
`read`):

```js
test("the clock threads the research effects into all three seams", () => {
  const tick = read("./../engine/economyTick.js");
  assert.match(tick, /researchEffectTotalsFor/);
  assert.match(tick, /productionTimeMultiplier\(effects\.production\)/);
  assert.match(tick, /poolRegenMultiplier\(effects\.pools\)/);
  assert.match(tick, /economyGrowthBonus\(effects\.economy\)/);
});

test("the engine functions carry the multiplier seams", () => {
  assert.match(read("./../engine/productionQueue.js"), /timeMultiplier/);
  assert.match(read("./../engine/forcePools.js"), /regenMultiplier/);
  assert.match(read("./../engine/economyTick.js"), /growthBonus/);
});

test("the adapter folds the completions and writes the totals", () => {
  const source = read("./economyEngine.js");
  assert.match(source, /foldResearchEffect/);
  assert.match(source, /normalizeResearchEffects/);
  assert.match(source, /researchEffects: researchEffectsNext/);
  assert.match(source, /researchEffects: appliedResearchEffects/);
});

test("the engine record keeps the field and the digest renders it", () => {
  assert.match(read("./gameState.js"), /normalizeResearchEffects/);
  assert.match(read("./economyDigest.js"), /researchEffectTotalsLabel/);
});
```

- [ ] **Step 2: Run the test to verify it fails or passes**

Run: `node --test "src/runtime/researchWiringArchitecture.test.js"`
Expected: PASS if Tasks 1-8 are done; it fails earlier if any seam is missing.
If an assertion does not match the shipped text, adjust the assertion to the
real identifier - the guard pins what shipped, never the reverse.

- [ ] **Step 3: Run the runtime suite**

Run: `node --test "src/runtime/*.test.js"`
Expected: PASS, 0 fail.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/researchWiringArchitecture.test.js
git commit -m "test(runtime): guard the research-effects wiring"
```

---

### Task 11: Document the rule

**Files:**
- Modify: `docs/world-state.md`
- Modify: `docs/runtime-services.md`
- Modify: `docs/ai-overview.md`
- Modify: `wiki/systems/projects.md`
- Regenerate: `public/wiki/**`

**Interfaces:**
- Consumes: everything shipped above.
- Produces: the reference and player-facing documentation of the rule.

- [ ] **Step 1: Update `docs/world-state.md`**

In the section that documents `economyEngine` fields, add `researchEffects` with
its shape `{ [polity]: { production, pools, economy } }`, its sparse storage, and
the fact that it is engine-owned and absent from every schema. State the
domain-to-target table, the scale-to-points table, the per-target cap of 6, and
the three application factors (`production` shortens build time by 5% per point,
`pools` raises regeneration by 5% per point, `economy` adds 0.1 percentage
points of annual growth per point). State that the field is folded from the
programme's `domain` and `scale` on completion and applies from the next period.

- [ ] **Step 2: Update `docs/runtime-services.md`**

Beside the research-core paragraph, add a paragraph on
`src/engine/researchEffects.js`: the fourth consumer sits on the economy clock
with the same one-period lag; the adapter folds completions into
`economyEngine.researchEffects`; the totals reach `enqueueOrders` (build time),
`stepPolityPools` (regeneration) and `stepPolityMonth` (growth); the digest
renders the player line.

- [ ] **Step 3: Update `docs/ai-overview.md`**

In the research paragraph, add that a completed programme grants a lasting
modifier the model did not author, that the model is told the totals in the
digest so it narrates the cause, and that it cannot write the totals: it cannot
complete research, and `researchEffects` is in no schema.

- [ ] **Step 4: Update `wiki/systems/projects.md`**

In the research paragraph, replace the forward-looking "when it finishes,
whatever the programme was for is released" with the shipped rule: a completed
programme grants the country a lasting modifier - faster building, faster
regeneration of its forces, or faster growth - depending on its field and size,
shown on the Forces panel and on the programme's card.

- [ ] **Step 5: Regenerate and verify the wiki**

Run: `npm run build:wiki`
Run: `npm run wiki:check`
Expected: `Wiki is current.`

- [ ] **Step 6: Commit**

```bash
git add docs/world-state.md docs/runtime-services.md docs/ai-overview.md wiki/systems/projects.md public/wiki
git commit -m "docs(engine): document the deterministic research effects"
```

---

## Self-Review

**Spec coverage.**

| Spec section | Task |
|---|---|
| The modifier model (tables, cap, factors) | Task 1 |
| The production seam | Task 2 |
| The pools seam | Task 3 |
| The economy seam | Task 4 |
| The clock threading | Task 5 |
| The fold and the one-period lag | Task 6 |
| Persistence and normalization | Task 7 |
| Digest visibility | Task 8 |
| Forces panel and research card | Task 9 |
| Guards (model cannot write the totals) | Tasks 1, 6, 7, 10; the research guard is the previous increment's `holdResearchInvariant` |
| Interaction with the earlier increments | Tasks 2-6 (defaults reproduce current behavior) |
| Compatibility | Tasks 2-7 |
| Testing | Each task's steps |

Every numbered design section maps to a task. The model-guard section needs no
new code: `researchEffects` is written only by the adapter, is in no schema, no
`PROJECT_PATCHABLE_FIELDS` and no field aliases, and a model cannot complete a
research programme, so it cannot fold. Task 10 pins that the field is written in
the adapter and normalized in `gameState.js`.

**Placeholder scan.** No `TBD`, `TODO` or "handle edge cases" remains. Every code
step carries the code.

**Type consistency.** `researchEffects` is `{ [polity]: { production, pools, economy } }`
everywhere: the core's `normalizeResearchEffects`, the adapter's
`appliedResearchEffects`/`researchEffectsNext`, the engine record, and the
digest's `playerResearchEffects`. `foldResearchEffect(totals, { domain, scale })`
is called with the `buildResearchInput` programme, which carries `domain` and
`scale`. `researchEffectTotalsFor(map, polity)` is the only reader in the clock.
The three multipliers take an integer and return a number.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-02-research-effects.md`.
