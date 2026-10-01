# Production And Construction Queues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every polity one deterministic FIFO production line that spends the manpower and materiel pools on declared unit and structure orders, builds them over months on the existing economy clock, and places the finished item on the map through the same impact path the narrator already uses.

**Architecture:** The engine already has a pure month step (`advanceEconomy`, `src/engine/economyTick.js`) driven by the adapter `advanceWorldEconomy` (`src/runtime/economyEngine.js`) and the force pools. This plan adds one pure module `src/engine/productionQueue.js`, threads a production map and a completion list through the same loop, has the adapter translate completions into `unitOps`/`markerOps`, and has `gameplay.js` apply those ops through `resolvePlacements` then `applyEventImpactsToWorld`.

**Tech Stack:** Vanilla ES modules, Node's built-in test runner (`node --test`), no new dependency. React/JSX only in the Forces panel task.

## Global Constraints

- ASCII only in source and docs. No emoji, no em dash.
- No new dependency in `package.json`.
- `src/engine/**` imports only `src/engine/*.js` and the two import-free runtime helpers `../runtime/gameDates.js` and `../runtime/unitMotion.js`. No `Date.now`, `new Date`, `Math.random`, `localStorage`, `window`, `document`, `navigator`, `fetch`.
- `node --test <dir>` does not work in this environment. Run engine tests with the glob form: `node --test "src/engine/*.test.js"`.
- Every commit uses a conventional-commit prefix. The `prepare-commit-msg` hook appends the trailer `Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>` automatically: never pass the trailer through `-m`, and verify each commit has it exactly once.
- No existing function changes meaning. All additions are additive.
- `public/wiki/**` is generated but committed (`docs/wiki.md`). Any task that touches `docs/` regenerates and commits it with `npm run build:wiki`.
- The model declares ORDERS, never a price and never a duration. The engine owns the cost, the build time and the draw on the reserves.
- Reference range in this plan is the tree at commit `8129930` (the production-queues design spec).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/engine/productionQueue.js` (new) | Closed kind/type enums, `PRODUCTION_TABLE`, the bounds, `markerKindFor`, `priceOf`, `normalizeProductionOrders`, `normalizeProductionQueue`, `enqueueOrders`, `stepLineMonth`. Pure. |
| `src/engine/economyTick.js` (modify) | Thread `production` through `advanceEconomy`: pay and enqueue the opening orders before month one, step each line after its pool step, collect completions. |
| `src/runtime/gameState.js` (modify) | `normalizeEconomyEngine` learns `production`, `pendingProduction`, `rejectedProduction`. |
| `src/runtime/economyEngine.js` (modify) | Read and write the queue, run the declared/pending order lag, translate completions into dated `unitOps`/`markerOps` batches. |
| `src/runtime/economyDigest.js` (modify) | The player production line. |
| `src/Game/AI/gameplaySchemas.js` (modify) | The `productionOrders` field in `JUMP_FORWARD_SCHEMA`. |
| `src/Game/AI/gameplayPrompts.js` (modify) | `buildProductionInstructions`. |
| `src/Game/AI/jumpSegments.js` (modify) | Merge `productionOrders` across segments. |
| `src/Game/AI/gameplay.js` (modify) | Thread the declaration into both `advanceWorldEconomy` calls; inject the production digest; apply the completion batches through the impact path. |
| `src/Game/AI/projectOpSchema.test.js` (modify) | Raise the jump-schema size guard and assert the new field. |
| `src/Game/GameUI/forces.jsx` (modify) | The read-only Production section. |

---

### Task 1: The production-queue core tables and validators

**Files:**
- Create: `src/engine/productionQueue.js`
- Test: `src/engine/productionQueue.test.js`

**Interfaces:**
- Consumes: `roundTo` from `./economyMath.js`.
- Produces: `PRODUCTION_UNIT_TYPES`, `BUILDING_TYPES`, `PRODUCTION_KINDS`, `MAX_PRODUCTION_ORDERS`, `MAX_UNIT_COUNT`, `MAX_PRODUCTION_QUEUE`, `PRODUCTION_TABLE`, `BUILDING_MARKER_KIND`, `markerKindFor(type) -> string`, `priceOf(entry) -> {manpower, materiel, months}`, `normalizeProductionOrders(value, {knownPolities}) -> {valid, rejected}`, `normalizeProductionQueue(value) -> {[polity]: {active?, queue}}`.

An order is `{ polity, kind, type, count?, at?, name? }`. A line item is `{ kind, type, count, monthsTotal, at?, name? }`; an active item adds `monthsDone`.

- [ ] **Step 1: Write the failing test**

```js
// src/engine/productionQueue.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  BUILDING_TYPES,
  MAX_PRODUCTION_ORDERS,
  MAX_PRODUCTION_QUEUE,
  MAX_UNIT_COUNT,
  PRODUCTION_TABLE,
  PRODUCTION_UNIT_TYPES,
  markerKindFor,
  normalizeProductionOrders,
  normalizeProductionQueue,
  priceOf,
} from "./productionQueue.js";

test("the kind enums are closed and every type has a cost row", () => {
  assert.deepEqual(
    [...PRODUCTION_UNIT_TYPES],
    ["infantry", "armor", "air", "naval", "artillery", "garrison"],
  );
  assert.ok(BUILDING_TYPES.includes("fortification"));
  assert.ok(BUILDING_TYPES.includes("research_facility"));
  for (const type of [...PRODUCTION_UNIT_TYPES, ...BUILDING_TYPES]) {
    assert.ok(PRODUCTION_TABLE[type], `${type} has a cost row`);
    assert.ok(PRODUCTION_TABLE[type].months >= 1);
    assert.ok(PRODUCTION_TABLE[type].manpower >= 0);
    assert.ok(PRODUCTION_TABLE[type].materiel >= 0);
  }
});

test("a heavier item costs more and takes longer", () => {
  assert.ok(priceOf({ type: "naval", count: 1 }).materiel > priceOf({ type: "garrison", count: 1 }).materiel);
  assert.ok(priceOf({ type: "naval", count: 1 }).months > priceOf({ type: "garrison", count: 1 }).months);
  assert.ok(priceOf({ type: "industrial_plant", count: 1 }).months > priceOf({ type: "fortification", count: 1 }).months);
});

test("a count multiplies both the price and the build time", () => {
  const one = priceOf({ type: "infantry", count: 1 });
  const three = priceOf({ type: "infantry", count: 3 });
  assert.equal(three.manpower, one.manpower * 3);
  assert.equal(three.materiel, one.materiel * 3);
  assert.equal(three.months, one.months * 3);
});

test("a structure's marker kind reads as words", () => {
  assert.equal(markerKindFor("naval_base"), "naval base");
  assert.equal(markerKindFor("industrial_plant"), "industrial plant");
});

test("an order keeps only a known polity, kind and matching type", () => {
  const { valid, rejected } = normalizeProductionOrders(
    [
      { polity: "France", kind: "unit", type: "infantry", count: 2 },
      { polity: "Atlantis", kind: "unit", type: "infantry" },
      { polity: "France", kind: "vehicle", type: "infantry" },
      { polity: "France", kind: "unit", type: "fortification" },
      { polity: "France", kind: "building", type: "naval_base", at: "Brest" },
    ],
    { knownPolities: ["France", "Germany"] },
  );
  assert.equal(valid.length, 2);
  assert.deepEqual(valid[0], { polity: "France", kind: "unit", type: "infantry", count: 2 });
  assert.deepEqual(valid[1], { polity: "France", kind: "building", type: "naval_base", at: "Brest", count: 1 });
  assert.equal(rejected.length, 3);
  assert.match(rejected[0].reason, /unknown polity/);
  assert.match(rejected[1].reason, /unknown kind/);
  assert.match(rejected[2].reason, /unknown unit type/);
});

test("a count out of range is rejected, not clamped", () => {
  const over = normalizeProductionOrders(
    [{ polity: "France", kind: "unit", type: "infantry", count: MAX_UNIT_COUNT + 1 }],
    { knownPolities: ["France"] },
  );
  assert.equal(over.valid.length, 0);
  assert.match(over.rejected[0].reason, /count out of range/);
  const zero = normalizeProductionOrders(
    [{ polity: "France", kind: "unit", type: "infantry", count: 0 }],
    { knownPolities: ["France"] },
  );
  assert.equal(zero.rejected.length, 1);
});

test("a structure is a series of one", () => {
  const { valid, rejected } = normalizeProductionOrders(
    [{ polity: "France", kind: "building", type: "airfield", count: 2 }],
    { knownPolities: ["France"] },
  );
  assert.equal(valid.length, 0);
  assert.match(rejected[0].reason, /series of one/);
});

test("the period accepts at most MAX_PRODUCTION_ORDERS orders", () => {
  const orders = Array.from({ length: MAX_PRODUCTION_ORDERS + 1 }, () => ({
    polity: "France",
    kind: "unit",
    type: "infantry",
  }));
  const { valid, rejected } = normalizeProductionOrders(orders, { knownPolities: ["France"] });
  assert.equal(valid.length, MAX_PRODUCTION_ORDERS);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /orders in one period/);
});

test("the committed line round-trips and drops a half-written item", () => {
  const queue = normalizeProductionQueue({
    France: {
      active: { kind: "unit", type: "infantry", count: 1, monthsTotal: 2, monthsDone: 1 },
      queue: [
        { kind: "building", type: "fortification", count: 1, monthsTotal: 4, at: "Metz" },
        { kind: "unit", type: "infantry" },
        { kind: "unit", type: "unicorn", count: 1, monthsTotal: 2 },
      ],
    },
    Ghost: null,
  });
  assert.deepEqual(queue.France.active, { kind: "unit", type: "infantry", count: 1, monthsTotal: 2, monthsDone: 1 });
  assert.equal(queue.France.queue.length, 1);
  assert.equal(queue.France.queue[0].at, "Metz");
  assert.equal(queue.Ghost, undefined);
});

test("the committed tail is capped", () => {
  const items = Array.from({ length: MAX_PRODUCTION_QUEUE + 5 }, () => ({
    kind: "unit", type: "infantry", count: 1, monthsTotal: 2,
  }));
  const queue = normalizeProductionQueue({ France: { queue: items } });
  assert.equal(queue.France.queue.length, MAX_PRODUCTION_QUEUE);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/engine/productionQueue.test.js`
Expected: FAIL with `Cannot find module './productionQueue.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/engine/productionQueue.js
/*! Open Historia - deterministic economy: the production line (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What a polity builds out of the reserves the pools hold. Like the pools this
// is a pure function of the state: the model declares an ORDER (what and how
// many), never a price or a duration, and the engine owns both. IMPORT-FREE
// apart from the shared math.

import { roundTo } from "./economyMath.js";

// The unit types are the roster's own six (UNIT_TYPES, gameState.js). They are
// re-declared here because the engine may not import the runtime; a runtime test
// asserts the two lists are equal so they cannot drift.
export const PRODUCTION_UNIT_TYPES = Object.freeze([
  "infantry", "armor", "air", "naval", "artillery", "garrison",
]);
export const BUILDING_TYPES = Object.freeze([
  "fortification", "airfield", "naval_base", "military_base",
  "industrial_plant", "logistics_hub", "research_facility",
]);
export const PRODUCTION_KINDS = Object.freeze(["unit", "building"]);

export const MAX_PRODUCTION_ORDERS = 20;
export const MAX_UNIT_COUNT = 20;
export const MAX_PRODUCTION_QUEUE = 12;

const UNIT_TYPE_SET = new Set(PRODUCTION_UNIT_TYPES);
const BUILDING_TYPE_SET = new Set(BUILDING_TYPES);
const KIND_SET = new Set(PRODUCTION_KINDS);

// Monthly build time is a series: a count of three is one item built three times
// over, so both the price and the duration scale with it.
const cost = (manpower, materiel, months) => Object.freeze({ manpower, materiel, months });

export const PRODUCTION_TABLE = Object.freeze({
  infantry: cost(8000, 6, 2),
  armor: cost(6000, 24, 3),
  artillery: cost(5000, 16, 3),
  air: cost(2000, 40, 4),
  garrison: cost(3000, 3, 1),
  naval: cost(12000, 90, 6),
  fortification: cost(4000, 30, 4),
  airfield: cost(3000, 45, 5),
  logistics_hub: cost(4000, 35, 4),
  military_base: cost(5000, 50, 6),
  naval_base: cost(6000, 70, 7),
  industrial_plant: cost(9000, 60, 8),
  research_facility: cost(7000, 55, 9),
});

// The marker `kind` a completed structure is built as, in the same words the
// narrator and the game master already use for map features.
export const BUILDING_MARKER_KIND = Object.freeze({
  fortification: "fortification",
  airfield: "airfield",
  naval_base: "naval base",
  military_base: "military base",
  industrial_plant: "industrial plant",
  logistics_hub: "logistics hub",
  research_facility: "research facility",
});

export const markerKindFor = (type) => BUILDING_MARKER_KIND[type] ?? String(type ?? "").trim();

const name = (value) => String(value ?? "").trim();

const countFor = (value) => {
  if (value === undefined || value === null || value === "") return 1;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MAX_UNIT_COUNT, n);
};

// The whole price of an order, in one place: the pool draw at enqueue and the
// build time the line is stamped with are the same function of the order.
export const priceOf = (entry) => {
  const row = PRODUCTION_TABLE[name(entry?.type).toLowerCase()] ?? { manpower: 0, materiel: 0, months: 0 };
  const count = Math.max(1, countFor(entry?.count));
  return { manpower: count * row.manpower, materiel: count * row.materiel, months: count * row.months };
};

// Like normalizeMobilization: an entry that fails is dropped, never fatal to the
// turn, and returned so the caller can log it. The per-period cap counts
// ACCEPTED orders; a rejected entry does not consume a slot.
export const normalizeProductionOrders = (value, { knownPolities = [] } = {}) => {
  const list = Array.isArray(value) ? value : [];
  const known = new Set((Array.isArray(knownPolities) ? knownPolities : []).map(name));
  const valid = [];
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
    const kind = name(entry.kind).toLowerCase();
    if (!KIND_SET.has(kind)) {
      rejected.push({ index, reason: `unknown kind "${entry.kind}"` });
      continue;
    }
    const type = name(entry.type).toLowerCase();
    const allowed = kind === "unit" ? UNIT_TYPE_SET : BUILDING_TYPE_SET;
    if (!allowed.has(type)) {
      rejected.push({ index, reason: `unknown ${kind} type "${entry.type}"` });
      continue;
    }
    if (entry.count !== undefined && entry.count !== null && entry.count !== "") {
      const raw = Number(entry.count);
      if (!Number.isFinite(raw) || Math.trunc(raw) !== raw || raw < 1 || raw > MAX_UNIT_COUNT) {
        rejected.push({ index, reason: `count out of range (1-${MAX_UNIT_COUNT})` });
        continue;
      }
    }
    const count = countFor(entry.count);
    if (kind === "building" && count > 1) {
      rejected.push({ index, reason: "a structure is a series of one" });
      continue;
    }
    if (valid.length >= MAX_PRODUCTION_ORDERS) {
      rejected.push({ index, reason: `more than ${MAX_PRODUCTION_ORDERS} orders in one period` });
      continue;
    }
    valid.push({
      polity,
      kind,
      type,
      count,
      ...(name(entry.at) ? { at: name(entry.at) } : {}),
      ...(name(entry.name) ? { name: name(entry.name) } : {}),
    });
  }

  return { valid, rejected };
};

// The committed line, validated without a world: a corrupted save costs the
// entry, never the world. A half-written item is dropped rather than defaulted,
// the same discipline normalizePools uses.
const normalizeQueuedItem = (item) => {
  if (!item || typeof item !== "object") return null;
  const kind = name(item.kind).toLowerCase();
  if (!KIND_SET.has(kind)) return null;
  const type = name(item.type).toLowerCase();
  const allowed = kind === "unit" ? UNIT_TYPE_SET : BUILDING_TYPE_SET;
  if (!allowed.has(type)) return null;
  const rawMonths = Number(item.monthsTotal);
  if (!Number.isFinite(rawMonths) || rawMonths < 1) return null;
  const monthsTotal = Math.trunc(rawMonths);
  const count = kind === "building" ? 1 : countFor(item.count);
  return {
    kind,
    type,
    count,
    monthsTotal,
    ...(name(item.at) ? { at: name(item.at) } : {}),
    ...(name(item.name) ? { name: name(item.name) } : {}),
  };
};

const normalizeActiveItem = (item) => {
  const base = normalizeQueuedItem(item);
  if (!base) return null;
  const monthsDone = Math.max(0, Math.trunc(Number(item.monthsDone)) || 0);
  return { ...base, monthsDone: Math.min(monthsDone, base.monthsTotal) };
};

export const normalizeProductionQueue = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [rawKey, entry] of Object.entries(value)) {
    const key = name(rawKey);
    if (!key || !entry || typeof entry !== "object") continue;
    const active = normalizeActiveItem(entry.active);
    const queue = (Array.isArray(entry.queue) ? entry.queue : [])
      .map(normalizeQueuedItem)
      .filter(Boolean)
      .slice(0, MAX_PRODUCTION_QUEUE);
    if (!active && !queue.length) continue;
    out[key] = { ...(active ? { active } : {}), queue };
  }
  return out;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/engine/productionQueue.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Run the purity guard**

Run: `node --test "src/engine/*.test.js"`
Expected: PASS, including `enginePurity.test.js`, which now scans `productionQueue.js` too.

- [ ] **Step 6: Commit**

```bash
git add src/engine/productionQueue.js src/engine/productionQueue.test.js
git commit -m "feat(engine): add the production-queue tables and validators"
```

---

### Task 2: Payment, the FIFO line step and completions

**Files:**
- Modify: `src/engine/productionQueue.js`
- Test: `src/engine/productionQueue.test.js`

**Interfaces:**
- Consumes: everything Task 1 produced.
- Produces: `enqueueOrders({pools, line, orders}) -> {pools, line, rejected}`, `stepLineMonth(line, {monthOffset}) -> {line, completions}`. A completion is `{kind, type, count, at?, name?, monthOffset}` and carries **no** `polity`: the caller attaches the polity it already knows.

- [ ] **Step 1: Write the failing test**

```js
// append to src/engine/productionQueue.test.js
import { enqueueOrders, stepLineMonth } from "./productionQueue.js";

test("an unaffordable order is rejected and the pool is untouched", () => {
  const result = enqueueOrders({
    pools: { manpower: 100, materiel: 100 },
    line: null,
    orders: [{ polity: "France", kind: "unit", type: "naval", count: 1 }],
  });
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /cannot afford/);
  assert.deepEqual(result.pools, { manpower: 100, materiel: 100 });
  assert.equal(result.line, null);
});

test("an affordable order is paid in full and enqueued with its build time", () => {
  const result = enqueueOrders({
    pools: { manpower: 1_000_000, materiel: 1000 },
    line: null,
    orders: [{ polity: "France", kind: "unit", type: "infantry", count: 2 }],
  });
  assert.equal(result.rejected.length, 0);
  assert.equal(result.pools.manpower, 1_000_000 - 16_000);
  assert.equal(result.pools.materiel, 1000 - 12);
  assert.equal(result.line.queue.length, 1);
  assert.equal(result.line.queue[0].monthsTotal, 4);
});

test("a full tail is rejected before it can take any money", () => {
  const full = { kind: "unit", type: "infantry", count: 1, monthsTotal: 2 };
  const line = { queue: Array.from({ length: MAX_PRODUCTION_QUEUE }, () => ({ ...full })) };
  const result = enqueueOrders({
    pools: { manpower: 1_000_000, materiel: 1000 },
    line,
    orders: [{ polity: "France", kind: "unit", type: "infantry", count: 1 }],
  });
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /line full/);
  assert.equal(result.pools.manpower, 1_000_000, "a full line never takes money");
});

test("the line builds one item at a time, in order, and stamps each completion", () => {
  let line = { queue: [
    { kind: "unit", type: "garrison", count: 1, monthsTotal: 1 },
    { kind: "unit", type: "infantry", count: 1, monthsTotal: 2 },
  ] };
  const first = stepLineMonth(line, { monthOffset: 1 });
  assert.equal(first.completions.length, 1);
  assert.equal(first.completions[0].type, "garrison");
  assert.equal(first.completions[0].monthOffset, 1);
  // The successor was promoted but NOT advanced this month.
  assert.equal(first.line.active.type, "infantry");
  assert.equal(first.line.active.monthsDone, 0);
  const second = stepLineMonth(first.line, { monthOffset: 2 });
  assert.equal(second.completions.length, 0);
  assert.equal(second.line.active.monthsDone, 1);
  const third = stepLineMonth(second.line, { monthOffset: 3 });
  assert.equal(third.completions.length, 1);
  assert.equal(third.completions[0].type, "infantry");
  assert.equal(third.completions[0].monthOffset, 3);
  assert.equal(third.line, null);
});

test("a null line steps to nothing", () => {
  assert.deepEqual(stepLineMonth(null, { monthOffset: 1 }), { line: null, completions: [] });
});

test("the same commit-step sequence always produces the same completions", () => {
  const line = { queue: [{ kind: "building", type: "fortification", count: 1, monthsTotal: 4, at: "Metz" }] };
  const run = () => {
    let current = line;
    const out = [];
    for (let month = 1; month <= 5; month += 1) {
      const stepped = stepLineMonth(current, { monthOffset: month });
      current = stepped.line;
      out.push(...stepped.completions);
    }
    return out;
  };
  assert.deepEqual(run(), run());
  assert.equal(run().length, 1);
  assert.equal(run()[0].at, "Metz");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/engine/productionQueue.test.js`
Expected: FAIL with `enqueueOrders is not a function` (or an import error).

- [ ] **Step 3: Write minimal implementation**

```js
// append to src/engine/productionQueue.js

// What is stored when an order is accepted. `monthsTotal` is stamped here, at
// the moment the price is paid, so the digest and the panel can state a queued
// item's duration without importing the table.
const itemShape = (order) => ({
  kind: order.kind,
  type: order.type,
  count: Math.max(1, countFor(order.count)),
  monthsTotal: priceOf(order).months,
  ...(name(order.at) ? { at: name(order.at) } : {}),
  ...(name(order.name) ? { name: name(order.name) } : {}),
});

// Pay and enqueue one span's orders. Capacity is checked BEFORE the price, so a
// full line never takes money for an order it will not hold; the zero floor is
// absolute because the whole price must be present before anything is drawn.
export const enqueueOrders = ({ pools = null, line = null, orders = [] } = {}) => {
  let manpower = Math.max(0, Number(pools?.manpower) || 0);
  let materiel = Math.max(0, Number(pools?.materiel) || 0);
  const active = line?.active ? { ...line.active } : undefined;
  const queue = Array.isArray(line?.queue) ? line.queue.map((item) => ({ ...item })) : [];
  const rejected = [];

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
    queue.push(itemShape(order));
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

const completionFor = (item, monthOffset) => ({
  kind: item.kind,
  type: item.type,
  count: Math.max(1, countFor(item.count)),
  ...(name(item.at) ? { at: name(item.at) } : {}),
  ...(name(item.name) ? { name: name(item.name) } : {}),
  monthOffset: Math.max(1, Math.trunc(Number(monthOffset)) || 1),
});

// One month of one line. The head advances; a finished item is reported and the
// line does NOT start its successor in the same month, because the month was
// spent on the item it finished.
export const stepLineMonth = (line, { monthOffset = 1 } = {}) => {
  if (!line || typeof line !== "object") return { line: null, completions: [] };
  let active = line.active ? { ...line.active } : undefined;
  const queue = Array.isArray(line.queue) ? line.queue.map((item) => ({ ...item })) : [];
  const completions = [];

  if (!active && queue.length) active = { ...queue.shift(), monthsDone: 0 };
  if (active) {
    active.monthsDone = Math.max(0, Number(active.monthsDone) || 0) + 1;
    const total = Math.max(1, Number(active.monthsTotal) || 1);
    if (active.monthsDone >= total) {
      completions.push(completionFor(active, monthOffset));
      active = queue.length ? { ...queue.shift(), monthsDone: 0 } : undefined;
    }
  }

  return {
    line: active || queue.length ? { ...(active ? { active } : {}), queue } : null,
    completions,
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/engine/productionQueue.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/productionQueue.js src/engine/productionQueue.test.js
git commit -m "feat(engine): pay for orders and step the serial production line"
```

---

### Task 3: Drive the line from the economy clock

**Files:**
- Modify: `src/engine/economyTick.js`
- Test: `src/engine/economyTick.test.js`

**Interfaces:**
- Consumes: `normalizeProductionQueue`, `enqueueOrders`, `stepLineMonth` from `./productionQueue.js`; `initialPoolsFor` from `./forcePools.js`.
- Produces: `advanceEconomy(state, {..., orders})` returns `state.production`, `completions` and `rejectedProduction` in addition to today's fields. `state.production` is the committed line map; `completions` are `{polity, kind, type, count, at?, name?, monthOffset}`.

- [ ] **Step 1: Write the failing test**

```js
// append to src/engine/economyTick.test.js
import { advanceEconomy } from "./economyTick.js";

const clockState = () => ({
  month: 0,
  polities: {
    France: {
      population: 60_000_000,
      gdp: 2e12,
      gdpPerCapita: 33_000,
      gdpGrowth: 0,
      inflation: 2,
      unemployment: 8,
      publicDebt: 90,
      budgetBalance: 0,
      stability: 60,
      gdpBreakdown: { agriculture: 5, industry: 40, services: 55 },
      components: [],
      jitter: 0,
    },
  },
  pools: { France: { manpower: 5_000_000, materiel: 50_000 } },
  shortfall: {},
});

test("no orders leaves the economy advance additive", () => {
  const withField = advanceEconomy(clockState(), { startDate: "2026-01-01", months: 3 });
  assert.deepEqual(withField.state.production, {});
  assert.deepEqual(withField.completions, []);
  assert.deepEqual(withField.rejectedProduction, []);
});

test("an order is paid before the first month and completes on its month step", () => {
  const result = advanceEconomy(clockState(), {
    startDate: "2026-01-01",
    months: 3,
    orders: [{ polity: "France", kind: "unit", type: "garrison", count: 1 }],
  });
  // 3000 manpower and 3 materiel were drawn from the opening pool.
  assert.ok(result.completions.length === 1);
  assert.equal(result.completions[0].polity, "France");
  assert.equal(result.completions[0].type, "garrison");
  assert.equal(result.completions[0].monthOffset, 1);
  assert.deepEqual(result.state.production, {});
});

test("a line that cannot finish in the span is persisted for the next span", () => {
  const first = advanceEconomy(clockState(), {
    startDate: "2026-01-01",
    months: 1,
    orders: [{ polity: "France", kind: "building", type: "industrial_plant", count: 1, at: "Lyon" }],
  });
  assert.equal(first.completions.length, 0);
  assert.equal(first.state.production.France.active.monthsDone, 1);
  assert.equal(first.state.production.France.active.monthsTotal, 8);

  const second = advanceEconomy(
    { ...clockState(), production: first.state.production, pools: first.state.pools },
    { startDate: "2026-02-01", months: 7 },
  );
  assert.equal(second.completions.length, 1);
  assert.equal(second.completions[0].type, "industrial_plant");
  assert.equal(second.completions[0].at, "Lyon");
});

test("an order the pool cannot pay is rejected and never enters the line", () => {
  const result = advanceEconomy(clockState(), {
    startDate: "2026-01-01",
    months: 3,
    orders: [{ polity: "France", kind: "unit", type: "naval", count: 20 }],
  });
  assert.equal(result.completions.length, 0);
  assert.equal(result.rejectedProduction.length, 1);
  assert.match(result.rejectedProduction[0].reason, /cannot afford/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/engine/economyTick.test.js`
Expected: FAIL: `result.completions` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

Change the import block at the top of `src/engine/economyTick.js`:

```js
import { DEFAULT_POSTURE, applyMobilization, initialPoolsFor, shortfallPressureFor, stepPolityPools } from "./forcePools.js";
import { enqueueOrders, normalizeProductionQueue, stepLineMonth } from "./productionQueue.js";
```

Change the `advanceEconomy` signature and body. The new signature:

```js
export const advanceEconomy = (
  state,
  { startDate, months, shocks = [], seed = "", upkeep = {}, posture = {}, orders = [] } = {},
) => {
```

Replace the local-state block (the lines that declare `polities`, `pools`,
`shortfall`, `shockedMonths`) with:

```js
  let polities = { ...(state?.polities ?? {}) };
  let pools = { ...(state?.pools ?? {}) };
  let shortfall = { ...(state?.shortfall ?? {}) };
  let production = normalizeProductionQueue(state?.production);
  const completions = [];
  const rejectedProduction = [];

  // Pay and enqueue this span's opening orders BEFORE the first month, so the
  // reserves a polity opens the period with are the ones it spends. The pool
  // base is the same base the month step reads, so the two cannot disagree.
  const ordersByPolity = {};
  for (const order of Array.isArray(orders) ? orders : []) {
    const polity = String(order?.polity ?? "").trim();
    if (!polity) continue;
    (ordersByPolity[polity] ??= []).push(order);
  }
  for (const polity of stableOrder(Object.keys(ordersByPolity))) {
    const base = pools[polity] ?? initialPoolsFor(polities[polity]);
    const paid = enqueueOrders({ pools: base, line: production[polity] ?? null, orders: ordersByPolity[polity] });
    pools[polity] = paid.pools;
    if (paid.line) production[polity] = paid.line;
    else delete production[polity];
    rejectedProduction.push(...paid.rejected.map((entry) => ({ polity, ...entry })));
  }
```

Inside the month loop, add the line step. The per-polity block already ends with
`nextShortfall[name] = steppedPools.shortfall;`. Add after it, still inside the
per-polity loop, and declare `nextProduction` beside the other `next*` maps:

```js
      const steppedLine = stepLineMonth(production[name] ?? null, { monthOffset: step });
      if (steppedLine.line) nextProduction[name] = steppedLine.line;
      for (const completion of steppedLine.completions) {
        completions.push({ polity: name, ...completion });
      }
```

and add `const nextProduction = {};` next to `const nextPools = {};`. After
`shortfall = nextShortfall;`, add `production = nextProduction;`.

Change the return:

```js
  return {
    state: { month: origin + steps, polities, pools, shortfall, production },
    completions,
    rejectedProduction,
    journal: { steps, capped, shockedMonths, seed },
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/engine/economyTick.test.js`
Expected: PASS (all tests, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/engine/economyTick.js src/engine/economyTick.test.js
git commit -m "feat(engine): step production lines inside the economy clock"
```

---

### Task 4: Persist the new engine fields

**Files:**
- Modify: `src/runtime/gameState.js` (the import block at `:23` and `normalizeEconomyEngine` at `:3423`)
- Test: `src/runtime/gameState.economyEngine.test.js`

**Interfaces:**
- Consumes: `normalizeProductionQueue` from `../engine/productionQueue.js`.
- Produces: `normalizeEconomyEngine` keeps `production`, `pendingProduction`, `rejectedProduction` through a world normalize; a half-written one is dropped.

- [ ] **Step 1: Write the failing test**

```js
// append to src/runtime/gameState.economyEngine.test.js
test("the production engine fields round-trip through a world normalize", () => {
  const world = normalizeWorldState({
    economyEngine: {
      version: 1,
      seed: "abc",
      lastDate: "2026-04-01",
      lastMonth: 3,
      production: {
        France: {
          active: { kind: "unit", type: "infantry", count: 2, monthsTotal: 4, monthsDone: 1 },
          queue: [{ kind: "building", type: "fortification", count: 1, monthsTotal: 4, at: "Metz" }],
        },
      },
      pendingProduction: [{ polity: "Germany", kind: "unit", type: "armor", count: 1 }],
      rejectedProduction: [{ polity: "France", kind: "unit", type: "naval", count: 1, reason: "cannot afford" }],
    },
  });
  assert.deepEqual(world.economyEngine.production.France.active, {
    kind: "unit", type: "infantry", count: 2, monthsTotal: 4, monthsDone: 1,
  });
  assert.equal(world.economyEngine.production.France.queue.length, 1);
  assert.deepEqual(world.economyEngine.pendingProduction, [{ polity: "Germany", kind: "unit", type: "armor", count: 1 }]);
  assert.equal(world.economyEngine.rejectedProduction.length, 1);
});

test("an empty production line is omitted, so an old save keeps its shape", () => {
  const world = normalizeWorldState({
    economyEngine: { version: 1, seed: "abc", production: { France: { queue: [] } } },
  });
  assert.equal(world.economyEngine.production, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/runtime/gameState.economyEngine.test.js`
Expected: FAIL: `world.economyEngine.production` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In the import block from `../engine/forcePools.js` (around `:23`), keep it as is,
and add a new import beside it:

```js
import { normalizeProductionQueue } from "../engine/productionQueue.js";
```

In `normalizeEconomyEngine`, after the `upkeepShortfall` block (`:3449`) and
before `return out;`, add:

```js
  // The production line, the orders declared last turn and the orders the last
  // advance refused. All three sparse: an empty one is omitted, so a campaign
  // that never builds keeps a record byte-identical to the force-pool save.
  const production = normalizeProductionQueue(value.production);
  if (Object.keys(production).length) out.production = production;
  const pendingProduction = normalizeProductionOrdersForStorage(value.pendingProduction);
  if (pendingProduction.length) out.pendingProduction = pendingProduction;
  const rejectedProduction = normalizeProductionRejections(value.rejectedProduction);
  if (rejectedProduction.length) out.rejectedProduction = rejectedProduction;
```

Add the two storage normalizers above `normalizeEconomyEngine` (a plain
shape-preserving pass, no world needed, so a corrupted save costs an entry):

```js
// The order list as it sits in a save: what the model declared. Validated
// without a world (the world changes between the declaration and the advance),
// so this only enforces the shape, never polity membership.
const normalizeProductionOrdersForStorage = (value) => {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const polity = normalizeOptionalString(entry.polity);
    const kind = normalizeOptionalString(entry.kind).toLowerCase();
    const type = normalizeOptionalString(entry.type).toLowerCase();
    if (!polity || (kind !== "unit" && kind !== "building") || !type) continue;
    const count = Number(entry.count);
    out.push({
      polity,
      kind,
      type,
      count: Number.isFinite(count) && count >= 1 ? Math.trunc(count) : 1,
      ...(normalizeOptionalString(entry.at) ? { at: normalizeOptionalString(entry.at) } : {}),
      ...(normalizeOptionalString(entry.name) ? { name: normalizeOptionalString(entry.name) } : {}),
    });
  }
  return out;
};

const normalizeProductionRejections = (value) =>
  normalizeArray(value)
    .filter((entry) => entry && typeof entry === "object" && normalizeOptionalString(entry.reason))
    .map((entry) => ({
      ...(normalizeOptionalString(entry.polity) ? { polity: normalizeOptionalString(entry.polity) } : {}),
      ...(normalizeOptionalString(entry.kind) ? { kind: normalizeOptionalString(entry.kind) } : {}),
      ...(normalizeOptionalString(entry.type) ? { type: normalizeOptionalString(entry.type) } : {}),
      reason: normalizeOptionalString(entry.reason),
    }));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/runtime/gameState.economyEngine.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/gameState.js src/runtime/gameState.economyEngine.test.js
git commit -m "feat(runtime): persist the production engine fields"
```

---

### Task 5: The adapter reads and writes the queue and translates completions

**Files:**
- Modify: `src/runtime/economyEngine.js`
- Test: `src/runtime/economyEngine.test.js`

**Interfaces:**
- Consumes: `normalizeProductionOrders`, `normalizeProductionQueue`, `markerKindFor` from `../engine/productionQueue.js`; `addGameMonths` from `./gameDates.js`; `UNIT_TYPES` is not needed (labels are local).
- Produces: `advanceWorldEconomy(world, {..., declaredProduction})` returns `completionBatches` (an array of `{date, unitOps, markerOps}`), `production`, and writes `production`/`pendingProduction`/`rejectedProduction`. `extractEconomyState` returns `production`. Also exports `UNIT_LABEL` and `completionBatchesFor(completions, {world, fromDate})`.

- [ ] **Step 1: Write the failing test**

```js
// append to src/runtime/economyEngine.test.js
import { completionBatchesFor } from "./economyEngine.js";

test("a completed unit becomes a spawn op dated at its month step", () => {
  const batches = completionBatchesFor(
    [{ polity: "Egypt", kind: "unit", type: "infantry", count: 2, monthOffset: 2 }],
    { world: { ...world(), countryStats: { Egypt: { ...sheet(), capital: "Cairo" } } }, fromDate: "2026-01-01" },
  );
  assert.equal(batches.length, 1);
  assert.equal(batches[0].date, "2026-03-01");
  assert.equal(batches[0].unitOps.length, 2);
  assert.equal(batches[0].unitOps[0].unit.ownerCode, "Egypt");
  assert.equal(batches[0].unitOps[0].unit.at, "Cairo");
});

test("a completed structure becomes a build op with a worded kind", () => {
  const batches = completionBatchesFor(
    [{ polity: "Egypt", kind: "building", type: "naval_base", count: 1, at: "Alexandria", monthOffset: 1 }],
    { world: world(), fromDate: "2026-01-01" },
  );
  assert.equal(batches[0].markerOps[0].marker.kind, "naval base");
  assert.equal(batches[0].markerOps[0].marker.status, "active");
  assert.equal(batches[0].markerOps[0].marker.at, "Alexandria");
});

test("a unit site falls back from the order to the capital to the first component", () => {
  const noCapital = {
    countryStats: {
      Egypt: { ...sheet(), capital: "", territorialComponents: [{ geography: "Nile Delta" }] },
    },
  };
  const batches = completionBatchesFor(
    [{ polity: "Egypt", kind: "unit", type: "infantry", count: 1, monthOffset: 1 }],
    { world: noCapital, fromDate: "2026-01-01" },
  );
  assert.equal(batches[0].unitOps[0].unit.at, "Nile Delta");
});

test("a unit with no resolvable site is dropped rather than placed at 0,0", () => {
  const batches = completionBatchesFor(
    [{ polity: "Nowhere", kind: "unit", type: "infantry", count: 1, monthOffset: 1 }],
    { world: world(), fromDate: "2026-01-01" },
  );
  assert.equal(batches.length, 0);
});

test("a declared production order is stored and runs in the NEXT advance", () => {
  const first = advance(world(), {
    fromDate: "2026-01-01",
    toDate: "2026-04-01",
    declaredProduction: [{ polity: "Egypt", kind: "unit", type: "infantry", count: 1 }],
  });
  assert.equal(first.production.Egypt, undefined, "nothing entered the line this period");
  assert.equal(first.world.economyEngine.pendingProduction.length, 1);
  const second = advance(first.world, { fromDate: "2026-04-01", toDate: "2026-07-01" });
  assert.ok(second.production.Egypt, "the declared order entered the line next period");
});

test("an unaffordable order is recorded as a rejection", () => {
  const result = advance(world(), {
    fromDate: "2026-01-01",
    toDate: "2026-07-01",
    declaredProduction: [{ polity: "Egypt", kind: "unit", type: "naval", count: 20 }],
  });
  // Runs next period; drive it through, then check the rejection.
  assert.equal(result.world.economyEngine.pendingProduction.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/runtime/economyEngine.test.js`
Expected: FAIL with `completionBatchesFor is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to the imports in `src/runtime/economyEngine.js`:

```js
import { addGameMonths } from "./gameDates.js";
import {
  markerKindFor,
  normalizeProductionOrders,
  normalizeProductionQueue,
} from "../engine/productionQueue.js";
```

Add `production: normalizeProductionQueue(world?.economyEngine?.production),` to
the object `extractEconomyState` returns.

Add the label table and the completion translator near `buildUpkeepTable`:

```js
// The words a completed unit is named with when the order gave no name. The
// engine never invents a display name; this is the boundary's own fallback so a
// spawned unit is readable on the map.
export const UNIT_LABEL = Object.freeze({
  infantry: "Infantry", armor: "Armor", air: "Air",
  naval: "Naval", artillery: "Artillery", garrison: "Garrison",
});

const unitSiteFor = (world, polity, at) => {
  if (at) return at;
  const sheet = world?.countryStats?.[polity];
  const capital = String(sheet?.capital ?? "").trim();
  if (capital) return capital;
  const component = Array.isArray(sheet?.territorialComponents) ? sheet.territorialComponents[0] : null;
  return String(component?.geography ?? "").trim();
};

const existingUnitCount = (world, polity, type) =>
  (Array.isArray(world?.units) ? world.units : []).filter(
    (unit) => String(unit?.ownerCode ?? "").trim() === polity
      && String(unit?.type ?? "").toLowerCase() === type,
  ).length;

// A completion is the engine's statement that an item is done. This turns those
// statements into the operations the narrator already emits, grouped by the date
// each item landed, so the event path can resolve and apply them.
export const completionBatchesFor = (completions, { world = {}, fromDate = "" } = {}) => {
  const byDate = new Map();
  const running = new Map();
  for (const completion of Array.isArray(completions) ? completions : []) {
    const offset = Math.max(1, Math.trunc(Number(completion?.monthOffset)) || 1);
    const date = addGameMonths(fromDate, offset);
    const batch = byDate.get(date) ?? { date, unitOps: [], markerOps: [] };
    if (completion.kind === "unit") {
      const site = unitSiteFor(world, completion.polity, completion.at);
      if (!site) continue;
      const count = Math.max(1, Math.trunc(Number(completion.count)) || 1);
      for (let index = 0; index < count; index += 1) {
        const key = `${completion.polity}|${completion.type}`;
        const seen = running.get(key) ?? existingUnitCount(world, completion.polity, completion.type);
        running.set(key, seen + 1);
        const label = UNIT_LABEL[completion.type] ?? completion.type;
        batch.unitOps.push({
          op: "spawn",
          unit: {
            type: completion.type,
            ownerCode: completion.polity,
            strength: 100,
            at: site,
            name: completion.name || `${label} ${seen + 1}`,
          },
        });
      }
    } else if (completion.at) {
      const kind = markerKindFor(completion.type);
      batch.markerOps.push({
        op: "build",
        marker: {
          name: completion.name || kind,
          kind,
          ownerCode: completion.polity,
          status: "active",
          at: completion.at,
        },
      });
    }
    byDate.set(date, batch);
  }
  return [...byDate.values()];
};
```

In `advanceWorldEconomy`:

1. Add `declaredProduction = []` to the options.
2. Change the early-return object to include:

```js
      production: committed.production,
      completionBatches: [],
```

3. After the `declaredMobilization` validation block, add:

```js
  const { valid: appliedOrders, rejected: pendingProductionRejected } =
    normalizeProductionOrders(world?.economyEngine?.pendingProduction, { knownPolities });
  const { valid: declaredProductionNow, rejected: declaredProductionRejected } =
    normalizeProductionOrders(declaredProduction, { knownPolities });
```

4. Pass the orders into the advance and destructure the new returns:

```js
  const { state, journal, completions, rejectedProduction } = advanceEconomy(committed, {
    startDate: fromDate,
    months,
    shocks: applied,
    seed,
    upkeep: upkeepTable,
    posture,
    orders: appliedOrders,
  });
```

5. Add the new sparse fields to the `economyEngine` object built for `nextWorld`
(beside `pools`):

```js
      ...(Object.keys(state.production).length ? { production: state.production } : {}),
      ...(declaredProductionNow.length ? { pendingProduction: declaredProductionNow } : {}),
```

6. After the `rejectedAll` line, keep it as is, and add a separate production
rejection channel (the payment refusals are production's own, not shocks):

```js
  const rejectedProductionAll = [
    ...declaredProductionRejected,
    ...pendingProductionRejected,
    ...(Array.isArray(rejectedProduction) ? rejectedProduction : []),
  ];
  if (rejectedProductionAll.length) nextWorld.economyEngine.rejectedProduction = rejectedProductionAll;
```

7. Compute the batches and return them:

```js
  const completionBatches = completionBatchesFor(completions, { world: nextWorld, fromDate });
```
and add to the returned object (beside `pools`):

```js
    production: state.production,
    completionBatches,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/runtime/economyEngine.test.js`
Expected: PASS (all tests, including the pre-existing pool and shock tests).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/economyEngine.js src/runtime/economyEngine.test.js
git commit -m "feat(runtime): run the production line and translate its completions"
```

---

### Task 6: The `productionOrders` field and the size guard

**Files:**
- Modify: `src/Game/AI/gameplaySchemas.js`
- Modify: `src/Game/AI/projectOpSchema.test.js`
- Test: `src/Game/AI/projectOpSchema.test.js`, `src/Game/AI/gameplaySchemas.test.js`

**Interfaces:**
- Consumes: `PRODUCTION_UNIT_TYPES`, `BUILDING_TYPES`, `MAX_PRODUCTION_ORDERS`, `MAX_UNIT_COUNT` from `../../engine/productionQueue.js`.
- Produces: `JUMP_FORWARD_SCHEMA.properties.productionOrders`.

- [ ] **Step 1: Write the failing test**

```js
// append to src/Game/AI/projectOpSchema.test.js
import { GAMEPLAY_TOOLS as TOOLS } from "./gameplaySchemas.js";

test("the jump carries a closed production-orders field", () => {
  const impacts = null; // the field is top level, beside mobilization
  const schema = TOOLS.jumpForward.schema;
  const field = schema.properties.productionOrders;
  assert.ok(field, "productionOrders is on the jump contract");
  assert.equal(field.items.additionalProperties, false);
  assert.equal(field.items.properties.kind.enum.includes("building"), true);
  assert.equal(field.items.properties.type.enum.includes("infantry"), true);
  assert.equal(field.items.properties.type.enum.includes("naval_base"), true);
  assert.equal(field.items.properties.count.maximum >= 1, true);
  assert.equal(impacts === null, true);
});
```

In the existing `"the board no longer costs the jump anything"` test, change the
guard line and its comment:

```js
  // 28,000 -> 29,000: the production queue joined the jump contract. The engine
  // owns the price and the build time, so the model declares an order and never a
  // number; the field is a closed-list array with a union type enum, ~800 chars.
  assert.ok(jumpChars < 29000, `the jump schema grew back to ${jumpChars} chars`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/Game/AI/projectOpSchema.test.js`
Expected: FAIL: `productionOrders` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/Game/AI/gameplaySchemas.js`, add to the imports (beside the forcePools
import at `:3`):

```js
import {
  BUILDING_TYPES,
  MAX_PRODUCTION_ORDERS,
  MAX_UNIT_COUNT,
  PRODUCTION_UNIT_TYPES,
} from "../../engine/productionQueue.js";
```

Add the item schema just below `mobilizationEntrySchema` (`:1033`):

```js
// The model's production and construction orders: a polity, a closed kind and a
// closed type. Like a shock it carries no number the model could invent; the
// engine owns the price, the build time and the draw on the reserves.
const productionOrderSchema = {
  type: "object",
  properties: {
    polity: { type: "string", description: "Country the order belongs to." },
    kind: { type: "string", enum: ["unit", "building"], description: "Closed list." },
    type: {
      type: "string",
      enum: [...PRODUCTION_UNIT_TYPES, ...BUILDING_TYPES],
      description: "A unit type for kind unit, a structure type for kind building.",
    },
    count: { type: "integer", minimum: 1, maximum: MAX_UNIT_COUNT, description: "How many; one line builds them in series." },
    at: { type: "string", description: "Where a structure is built, or a unit's site; optional." },
    name: { type: "string", description: "What a completed unit or structure is called; optional." },
  },
  required: ["polity", "kind", "type"],
  additionalProperties: false,
};
```

Add the field to `JUMP_FORWARD_SCHEMA.properties`, immediately after the
`mobilization` entry (`:1096`):

```js
    productionOrders: {
      type: "array",
      maxItems: MAX_PRODUCTION_ORDERS,
      description:
        "Production and construction orders for next period: a closed kind and type, effective next period. "
        + "State no cost and no build time; the engine computes both from the reserves.",
      items: productionOrderSchema,
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/Game/AI/projectOpSchema.test.js src/Game/AI/gameplaySchemas.test.js`
Expected: PASS. If the size guard still fails, record the measured `jumpChars`
and raise the bound once more in the same style, keeping the reason in the comment.

- [ ] **Step 5: Commit**

```bash
git add src/Game/AI/gameplaySchemas.js src/Game/AI/projectOpSchema.test.js
git commit -m "feat(ai): add the production-orders field to the jump contract"
```

---

### Task 7: The prompt instruction block

**Files:**
- Modify: `src/Game/AI/gameplayPrompts.js`
- Test: `src/Game/AI/productionPrompt.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildProductionInstructions({digest}) -> string`.

- [ ] **Step 1: Write the failing test**

```js
// src/Game/AI/productionPrompt.test.js
// Run: node --test src/Game/AI/productionPrompt.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { buildProductionInstructions } from "./gameplayPrompts.js";

test("the instructions forbid stating a cost and name the closed kinds", () => {
  const text = buildProductionInstructions();
  assert.match(text, /\[National Production\]/);
  assert.match(text, /unit/);
  assert.match(text, /building/);
  assert.match(text, /NEXT period/i);
  assert.match(text, /never state/i);
});

test("the queue is not to be duplicated through the event impacts", () => {
  const text = buildProductionInstructions();
  assert.match(text, /unitOps/);
  assert.match(text, /markerOps/);
});

test("a digest is appended as given facts", () => {
  const text = buildProductionInstructions({ digest: "Production line: 2x infantry (1 month left)." });
  assert.match(text, /Production line: 2x infantry \(1 month left\)\./);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/Game/AI/productionPrompt.test.js`
Expected: FAIL: `buildProductionInstructions` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/Game/AI/gameplayPrompts.js`, after
`buildForcePoolsInstructions`:

```js
// The production block: the rule and the facts. The rule exists because the
// narrator would otherwise spawn the same formation it just queued, or build the
// same structure twice; the digest exists so the model can see what the line
// already holds before it adds to it.
export const buildProductionInstructions = ({ digest = "" } = {}) => {
  const rules = [
    "[National Production]",
    "Each polity builds from its reserves through one production line, computed locally by the same "
    + "deterministic simulation that runs the economy. The price of an order, its build time and the "
    + "draw on manpower and materiel are not yours to invent: never state a cost or a duration in prose "
    + "or in an event.",
    "What you control is the order. When the period's events genuinely start building a formation or a "
    + "structure - a ship laid down, a division raised, a factory or airfield begun - declare it in "
    + "productionOrders: a polity, a kind (unit or building), a type from the closed list, and optionally "
    + "a count, a site and a name. An order takes effect from the NEXT period.",
    "The line is the building authority for what it lists: when an event raises or opens something already "
    + "in the queue, narrate it and emit NO unitOps spawn or markerOps build for it. unitOps and markerOps "
    + "remain for moving, reinforcing, renaming and removing, and for anything the queue does not own. "
    + "Most periods have no order at all.",
  ].join("\n\n");
  const facts = String(digest ?? "").trim();
  return facts ? `${rules}\n\n[The Period's Production, as simulated]\n${facts}` : rules;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/Game/AI/productionPrompt.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Game/AI/gameplayPrompts.js src/Game/AI/productionPrompt.test.js
git commit -m "feat(ai): tell the model how to declare production orders"
```

---

### Task 8: The digest production line

**Files:**
- Modify: `src/runtime/economyDigest.js`
- Test: `src/runtime/economyDigest.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildEconomyDigest({..., playerProduction})` appends a production line to the reserve block; empty or absent produces no line.

- [ ] **Step 1: Write the failing test**

```js
// append to src/runtime/economyDigest.test.js
test("the production line names the active item and the waiting ones in order", () => {
  const text = buildEconomyDigest({
    deltas: [],
    playerPolity: "Egypt",
    playerPools: { manpower: 10, materiel: 1 },
    playerPosture: "peacetime",
    playerProduction: {
      active: { kind: "unit", type: "infantry", count: 2, monthsTotal: 4, monthsDone: 3 },
      queue: [{ kind: "building", type: "fortification", count: 1, monthsTotal: 4 }],
    },
  });
  assert.match(text, /Production line: 2x infantry \(1 month left\), then 1x fortification \(4 months\)\./);
});

test("an empty line adds nothing, so the digest is byte-identical", () => {
  const withLine = buildEconomyDigest({
    deltas: [], playerPolity: "Egypt",
    playerPools: { manpower: 10, materiel: 1 }, playerPosture: "peacetime",
    playerProduction: { queue: [] },
  });
  const without = buildEconomyDigest({
    deltas: [], playerPolity: "Egypt",
    playerPools: { manpower: 10, materiel: 1 }, playerPosture: "peacetime",
  });
  assert.equal(withLine, without);
  assert.doesNotMatch(withLine, /Production/);
});

test("the production line survives even when there is no economy line", () => {
  const text = buildEconomyDigest({
    deltas: [], playerPolity: "Egypt", playerProduction: {
      queue: [{ kind: "unit", type: "garrison", count: 1, monthsTotal: 1 }],
    },
  });
  assert.equal(text, "Production line: 1x garrison (1 month).");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/runtime/economyDigest.test.js`
Expected: FAIL: the production line is not rendered.

- [ ] **Step 3: Write minimal implementation**

In `src/runtime/economyDigest.js`, add a helper above `buildEconomyDigest`:

```js
// What the line is building: the active item with its remaining months, then the
// waiting ones in order. Every number is the engine's own, read off the line it
// persisted, so the digest imports nothing to state a duration.
const productionClauseFor = (line) => {
  if (!line || typeof line !== "object") return "";
  const parts = [];
  if (active) {
    const left = Math.max(0, number(active.monthsTotal) - number(active.monthsDone));
    parts.push(`${number(active.count, 1)}x ${String(active.type ?? "").trim()} (${left} month${left === 1 ? "" : "s"} left)`);
  }
  for (const item of Array.isArray(line.queue) ? line.queue : []) {
    const months = Math.max(0, number(item.monthsTotal));
    parts.push(`${number(item.count, 1)}x ${String(item.type ?? "").trim()} (${months} month${months === 1 ? "" : "s"})`);
  }
  return parts.length ? `Production line: ${parts.join(", then ")}.` : "";
};
```

(The `const active` lines above are one statement; keep the indentation inside
the function correct.)

Change `buildEconomyDigest`'s options to accept `playerProduction = null`, and
replace every use of `poolLine` with a combined block:

```js
  const poolLine = poolLineFor({ playerPolity: player, playerPools, playerPosture, postureChanged, playerShortfall });
  const productionLine = productionClauseFor(playerProduction);
  const reserveBlock = [poolLine, productionLine].filter(Boolean).join("\n");
```

Then use `reserveBlock` where `poolLine` was used: the reservation
`let used = header.length + (reserveBlock ? reserveBlock.length + 1 : 0);`, the
`if (!lines.length) return reserveBlock;` return, and the final
`[header, reserveBlock, ...lines, ...shockLines]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/runtime/economyDigest.test.js`
Expected: PASS (all tests, including the byte-identical ones).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/economyDigest.js src/runtime/economyDigest.test.js
git commit -m "feat(runtime): report the player production line in the digest"
```

---

### Task 9: Merge production orders across jump segments

**Files:**
- Modify: `src/Game/AI/jumpSegments.js`
- Test: `src/Game/AI/jumpSegments.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `mergeSegmentPayloads(...)` returns `productionOrders`, the concatenation of every segment's list.

- [ ] **Step 1: Write the failing test**

```js
// append to src/Game/AI/jumpSegments.test.js (create it if absent)
import test from "node:test";
import assert from "node:assert/strict";

import { mergeSegmentPayloads } from "./jumpSegments.js";

test("production orders concatenate across segments", () => {
  const merged = mergeSegmentPayloads([
    { events: [], productionOrders: [{ polity: "France", kind: "unit", type: "infantry" }] },
    { events: [], productionOrders: [{ polity: "Germany", kind: "building", type: "airfield", at: "Bonn" }] },
  ]);
  assert.equal(merged.productionOrders.length, 2);
  assert.equal(merged.productionOrders[1].polity, "Germany");
});

test("a segment with no orders contributes an empty list", () => {
  const merged = mergeSegmentPayloads([{ events: [] }]);
  assert.deepEqual(merged.productionOrders, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/Game/AI/jumpSegments.test.js`
Expected: FAIL: `merged.productionOrders` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `mergeSegmentPayloads`, declare `const productionOrders = [];` beside
`const mobilization = [];`, push in the loop with
`productionOrders.push(...asArray(payload.productionOrders));`, and add
`productionOrders,` to the returned object. Unlike shock spans, orders are not
deduplicated by identity: two identical orders are two genuine items, so the
list concatenates.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/Game/AI/jumpSegments.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Game/AI/jumpSegments.js src/Game/AI/jumpSegments.test.js
git commit -m "feat(ai): merge production orders across jump segments"
```

---

### Task 10: Wire the declaration, the digest and the completions into the turn

**Files:**
- Modify: `src/Game/AI/gameplay.js`
- Test: `src/Game/AI/productionWiringArchitecture.test.js`

**Interfaces:**
- Consumes: `buildProductionInstructions` from `./gameplayPrompts.js`; `applyEventImpactsToWorld` (already imported at `:166`); the in-file `resolvePlacements` and `normalizeArray`.
- Produces: the projection injects `variables.productionDigest`; the turn result carries `productionOrders`; the authoritative advance receives `declaredProduction`; the completion batches are applied after the advance and before the write.

- [ ] **Step 1: Write the failing test**

```js
// src/Game/AI/productionWiringArchitecture.test.js
/*! Open Historia - portions (production queue wiring guard) (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
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

test("the projection builds the production digest before the model is asked", () => {
  const body = bodyOf("export const simulateTimelineJump = async (");
  assert.match(body, /variables\.productionDigest = buildEconomyDigest\(/);
  assert.match(body, /playerProduction: projected\.production/);
});

test("the real advance is handed the declared production", () => {
  const body = bodyOf("const applySimulationResult = async ({");
  const advance = body.indexOf("advanceWorldEconomy(nextWorld");
  assert.notEqual(advance, -1);
  assert.match(body.slice(advance, advance + 1000), /declaredProduction:/);
});

test("the turn result carries the merged production orders", () => {
  const finish = bodyOf("const finishTimelineJump = async ({");
  assert.match(finish, /productionOrders: merged\.productionOrders/);
});

test("completions are applied after the advance and before the write", () => {
  const body = bodyOf("const applySimulationResult = async ({");
  const advance = body.indexOf("nextWorld = economy.world");
  const apply = body.indexOf("completionBatches");
  const write = body.indexOf("writeWorldState(nextWorld)");
  assert.notEqual(advance, -1);
  assert.notEqual(apply, -1);
  assert.notEqual(write, -1);
  assert.ok(advance < apply && apply < write, "the completion ops must land after the engine and before the write");
  assert.match(body, /applyEventImpactsToWorld\(/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/Game/AI/productionWiringArchitecture.test.js`
Expected: FAIL: `variables.productionDigest` is absent.

- [ ] **Step 3: Write minimal implementation**

In the imports (beside `buildForcePoolsInstructions` at `:7`), add:

```js
  buildProductionInstructions,
```

Below the force-pools prompt block (`:2619`), add:

```js
  // The deterministic production line: the rule, then what the engine already has
  // under construction, so the model does not duplicate work in progress.
  if (jumpTask) {
    const productionBlock = buildProductionInstructions({ digest: variables?.productionDigest });
    if (productionBlock) systemPrompt = `${systemPrompt}\n\n${productionBlock}`;
  }
```

In `finishTimelineJump`'s `result` object (beside `mobilization:`, `:12613`), add:

```js
    // Same lag as the shocks and the posture: the merged orders must reach
    // applySimulationResult or the declaration is silently dropped.
    productionOrders: merged.productionOrders,
```

In the projection (`:12739`, inside the `if (projected.months > 0)` block),
after `variables.forcePoolsDigest = ...`, add:

```js
      variables.productionDigest = buildEconomyDigest({
        deltas: [],
        playerPolity,
        playerProduction: projected.production?.[playerPolity] ?? null,
      });
```

In the authoritative advance options (`:7219`), add:

```js
      declaredProduction: normalizeArray(result.productionOrders),
```

Then, immediately after `nextWorld = economy.world;` (`:7233`) inside the same
`try`, apply the completion batches. Add this block right after the existing
`logDebugEvent("turn", \`Economy advanced ...\`)` call:

```js
    // The engine's completed items become real units and markers through the SAME
    // path every narrated op takes: place them, then apply them. The core never
    // touches the map, and the boundary reuses the resolver and the applier that
    // already handle an unresolvable place or a sea placement.
    const batches = normalizeArray(economy.completionBatches);
    if (batches.length) {
      const containers = batches.map((batch) => {
        const impacts = { unitOps: batch.unitOps, markerOps: batch.markerOps };
        return {
          event: { date: batch.date, title: "", description: "", impacts },
          impacts,
          path: "$.production",
        };
      });
      await resolvePlacements(containers, nextWorld, { receipt: null });
      const applied = applyEventImpactsToWorld({
        colors: {},
        events: containers.map((container) => container.event),
        world: nextWorld,
      });
      nextWorld = applied.world;
      for (const rename of normalizeArray(applied.renamedPolities)) {
        renamedPolities.push(rename);
      }
    }
```

`renamedPolities` is already declared earlier in `applySimulationResult`; reuse
it. If it is not in scope at this point, drop the rename-carrying loop and rely
on the same-turn rename path above, but confirm before committing.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/Game/AI/productionWiringArchitecture.test.js`
Expected: PASS.

- [ ] **Step 5: Run the two existing wiring guards**

Run: `node --test src/Game/AI/forceWiringArchitecture.test.js src/Game/AI/economyWiringArchitecture.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/Game/AI/gameplay.js src/Game/AI/productionWiringArchitecture.test.js
git commit -m "feat(ai): apply the production queue's completions through the event path"
```

---

### Task 11: The Production section in the Forces panel

**Files:**
- Modify: `src/Game/GameUI/forces.jsx`

**Interfaces:**
- Consumes: `readWorldStateView` from `../../runtime/gameState.js`.
- Produces: a read-only "Production" section in the panel, reading `world.economyEngine.production[playerCode]`.

- [ ] **Step 1: Add the world read and state**

Add the import beside the other runtime imports:

```js
import { readWorldStateView } from "../../runtime/gameState.js";
```

Inside `ForcesPanel`, near the other `useState` calls:

```js
  const [productionLine, setProductionLine] = useState(null);
```

and load it when the panel opens or the unit list changes (beside the existing
`ensurePolityNames` effect):

```js
  // The production line is engine state on the world, read on open and when the
  // roster changes; it is not mirrored onto the country stat sheet.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    readWorldStateView({ force: false })
      .then((world) => {
        if (cancelled) return;
        const code = getPlayerCode();
        setProductionLine(world?.economyEngine?.production?.[code] ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, units.length]);
```

- [ ] **Step 2: Render the section**

Insert the section inside the scroll region, before the "Your units" heading
(`forces.jsx:310`):

```jsx
            {productionLine && (productionLine.active || productionLine.queue?.length > 0) && (
              <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: "8px", padding: "8px", marginBottom: "10px" }}>
                <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", marginBottom: "5px" }}>Production</div>
                {productionLine.active && (
                  <div style={{ fontSize: "12px", marginBottom: "3px" }}>
                    {(productionLine.active.count ?? 1)}x {productionLine.active.type}
                    {" · "}
                    {Math.max(0, (productionLine.active.monthsTotal ?? 0) - (productionLine.active.monthsDone ?? 0))} month(s) left
                  </div>
                )}
                {(productionLine.queue ?? []).map((item, index) => (
                  <div key={`${item.type}-${index}`} style={{ fontSize: "11px", color: "rgba(255,255,255,0.55)", marginBottom: "2px" }}>
                    Waiting: {(item.count ?? 1)}x {item.type} ({item.monthsTotal ?? 0} months)
                  </div>
                ))}
              </div>
            )}
```

- [ ] **Step 3: Verify the file parses**

Run: `npx eslint src/Game/GameUI/forces.jsx`
Expected: no error.

- [ ] **Step 4: Commit**

```bash
git add src/Game/GameUI/forces.jsx
git commit -m "feat(ui): show the production line in the Forces panel"
```

---

### Task 12: Documentation and the regenerated wiki

**Files:**
- Modify: `docs/world-state.md`, `docs/ai-overview.md`, `docs/ai-schemas.md`, `docs/runtime-services.md`, `docs/architecture.md`, `docs/wiki/systems/projects.md`
- Regenerate: `public/wiki/**`

**Interfaces:**
- Consumes: everything above.
- Produces: documentation that matches the shipped behaviour.

- [ ] **Step 1: Update the docs**

- `docs/world-state.md`: add the `production`, `pendingProduction` and
  `rejectedProduction` fields to the `economyEngine` section, with the line item
  shape and the "paid in full, then built" rule and the zero floor for payment.
- `docs/ai-overview.md`: describe `productionOrders`, the closed kinds and types,
  and the one-period lag.
- `docs/ai-schemas.md`: add the `productionOrders` entry to `JUMP_FORWARD_SCHEMA`.
- `docs/runtime-services.md`: describe `productionQueue.js`, the line step inside
  the existing clock, and the completion path through `resolvePlacements` then
  `applyEventImpactsToWorld`.
- `docs/architecture.md`: record the production queue as the third consumer of the
  engine contract and the "no second authority" rule (the queue owns what it
  lists, so the narrator and game master do not duplicate it).
- `docs/wiki/systems/projects.md`: note that research stays inside the projects
  board while physical production is the engine's queue.

- [ ] **Step 2: Regenerate and verify the wiki**

```bash
npm run build:wiki
npm run wiki:check
```

Expected: `Wiki is current.`

- [ ] **Step 3: Commit**

```bash
git add docs public/wiki
git commit -m "docs(engine): document the production and construction queues"
```

---

### Task 13: Full verification

**Files:**
- None (verification only).

- [ ] **Step 1: Engine tests**

Run: `node --test "src/engine/*.test.js"`
Expected: PASS, including `enginePurity.test.js`.

- [ ] **Step 2: The full suite**

Run: `npm test`
Expected: PASS with no new failures (compare against the pre-plan baseline of 2548 tests, 2546 pass, 2 todo).

- [ ] **Step 3: Lint**

Run: `npx eslint .`
Expected: no new error on any touched file.

- [ ] **Step 4: Wiki**

Run: `npm run wiki:check`
Expected: `Wiki is current.`

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 6: Trailer audit**

```bash
git log --format=%H%x20%s -n 12
git log --format=%b -n 12 | grep -c "Co-authored-by: monkeycode-ai"
```

Expected: one trailer on each commit of this branch, none doubled.

- [ ] **Step 7: Push the branch**

```bash
git push -u origin 261001-feat-production-queues
```

Expected: pushed to `origin` (the user's fork only; never the upstream repo).

---

## Self-Review

**1. Spec coverage.**

| Spec section | Task |
|---|---|
| 1 Layers, the new pure file | 1, 2 |
| 2 Determinism contract | 1, 2, 3 |
| 3 Time model | 3 |
| 4 State model and order shape | 1, 4 |
| 5 Enums and tables | 1 |
| 6 Validation, price, line, completions | 1, 2, 3 |
| 7 From completion to world | 5, 10 |
| 8 Turn ordering | 10 |
| 9 Schema and size guard | 6 |
| 10 Period digest | 8, 10 |
| 11 Forces panel | 11 |
| 12 No second authority | 7 |
| 13 Tests | every task |
| 14 Docs | 12 |

**2. Placeholder scan.** No step says "handle edge cases" or "similar to Task
N". Every code step carries its code. The one conditional instruction (Task 10
Step 3, the `renamedPolities` scope) names exactly what to check and what to do
if the check fails.

**3. Type consistency.** `normalizeProductionOrders -> {valid, rejected}` is
consistent across Tasks 1, 5. `enqueueOrders -> {pools, line, rejected}` and
`stepLineMonth -> {line, completions}` are consistent across Tasks 2, 3. The
completion shape `{kind, type, count, at?, name?, monthOffset}` is consistent
across Tasks 2, 3, 5. `priceOf -> {manpower, materiel, months}` is consistent
across Tasks 1, 2. The engine field names `production` / `pendingProduction` /
`rejectedProduction` are consistent across Tasks 3, 4, 5. The adapter output
`completionBatches` is consistent across Tasks 5, 10.
