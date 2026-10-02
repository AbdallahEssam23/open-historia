# Reinforcement and Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic reinforcement and rotation layer (part three of the operational war layer): a pure core that turns a declared reinforcement policy, a polity's reserves, the supply states part two already derives and the declared rotation and merge orders into reserve draws and unit ops, plus an adapter, the turn wiring, a short declaration surface and the docs.

**Architecture:** Three layers, the same direction every increment uses. A pure core in `src/engine/reinforcement.js` (`deriveReinforcement` plus the declaration normalizers) is read by the adapter `src/runtime/reinforcement.js` (`readReinforcement`), which is called by one guarded step in `src/Game/AI/gameplay.js` (`applySimulationResult`). The effective policy is committed and lagged on `world.economyEngine` exactly as mobilization is. Rotation and merge orders apply in the same turn as three ordinary unit ops through the existing board-only synthetic-event seam.

**Tech Stack:** Node.js ESM, `node:test` + `node:assert/strict`, no new dependency.

## Global Constraints

- **ASCII only** in source and docs. No emoji, no em dash, no middle dot.
- **Pure core purity.** `src/engine/**` must import only `./<name>.js`, `../runtime/gameDates.js`, `../runtime/unitMotion.js`; no browser global, no `Date.now`, no `new Date`, no `Math.random`; sort with `a < b`, never `localeCompare`; fold with `toLowerCase`, never `toLocaleLowerCase`.
- **Direction of dependency.** `src/runtime/**` must not import `src/Game/AI/**`; the runtime is the exclusive executor.
- **No new dependency** in `package.json`, **no `ENGINE_VERSION` bump**, **no migration**. The only new stored state is `world.economyEngine.reinforcement` (the committed policy) and `world.economyEngine.pendingReinforcement` (last turn's declaration).
- **Commits.** Every commit carries a conventional prefix; the `prepare-commit-msg` hook adds the `Co-authored-by` trailer, so never pass the trailer via `-m`.
- **Test invocation.** `node --test <dir>` does not work. Use a glob: `node --test "src/engine/*.test.js"`, `node --test "src/runtime/*.test.js"`.
- **Wiki.** `public/wiki/**` is generated from `wiki/**` only; `docs/**` never affects it. `npm run wiki:check` must report `Wiki is current.` after docs change.
- **Minimal change.** Do not edit an existing test to make a change pass. A new optional argument on an existing engine function must default to today's behavior.

## File Structure

| File | Responsibility |
|---|---|
| `src/engine/reinforcement.js` (new) | The pure core: policy constants, the declaration normalizers, the per-point price, the recovery arithmetic and the rotation and merge folds. |
| `src/engine/reinforcement.test.js` (new) | The core's pure tests plus the normalizer tests. |
| `src/runtime/reinforcement.js` (new) | The adapter: reads the effective policy, reserves, roster, supply states and declared orders into the core's plain inputs; maps the result to ops and a reserve draw. Read-only. |
| `src/runtime/reinforcement.test.js` (new) | The adapter seam test and the pool-factor pin. |
| `src/runtime/reinforcementWiringArchitecture.test.js` (new) | The source-text guard on the wiring and the layer boundaries. |
| `src/runtime/reinforcementLag.test.js` (new) | The committed/pending policy lag and the world round-trip. |
| `src/Game/AI/gameplaySchemas.reinforcement.test.js` (new) | The declaration-schema test. |
| `src/Game/AI/reinforcementPrompt.test.js` (new) | The prompt-paragraph test. |
| `src/runtime/economyEngine.js` (modify) | Accept `declaredReinforcement`, fold the effective policy, store committed and pending. |
| `src/runtime/gameState.js` (modify) | `normalizeEconomyEngine` round-trips the two new fields. |
| `src/Game/AI/gameplay.js` (modify) | The guarded reinforcement step, the event id and the `declaredReinforcement` handoff. |
| `src/Game/AI/gameplaySchemas.js` (modify) | The reinforcement, rotations and merges fields. |
| `src/Game/AI/gameplayPrompts.js` (modify) | One paragraph in the `[National Forces]` block. |
| `docs/runtime-services.md` (modify) | The service documentation section. |

---

### Task 1: The pure core

**Files:**
- Create: `src/engine/reinforcement.js`
- Create: `src/engine/reinforcement.test.js`

**Interfaces:**
- Consumes: `UNIT_UPKEEP` from `./forcePools.js`; `roundTo` from `./economyMath.js`.
- Produces:
  - `REINFORCEMENT_POOL_FACTOR = 10`, `REINFORCEMENT_RATE_PER_MONTH = 5`
  - `REINFORCEMENT_POLICIES = ["none", "replacements", "belligerent"]`, `DEFAULT_REINFORCEMENT_POLICY = "replacements"`
  - `MAX_REINFORCEMENT = 20`, `MAX_ROTATIONS = 8`, `MAX_MERGES = 8`
  - `normalizeReinforcement(value, { knownPolities }) -> { valid: [{ polity, policy }], rejected: [{ index, reason }] }`
  - `normalizePendingReinforcement(value) -> [{ polity, policy }]`
  - `normalizeReinforcementMap(value) -> { [polity]: policy }` (non-default only)
  - `deriveReinforcement({ policies, pools, units, supply, wars, rotations, merges, months }) -> { ops, draws, summary, rejections }` where `ops` are `{ op: "strength", unitId, strength }`, `{ op: "move", unitId, toLng, toLat, regionId }` or `{ op: "remove", unitId }`; `draws` is `{ [polity]: { manpower, materiel } }`; `summary` is `{ reinforced, pointsRestored, rotations, merges, rejected, opCount }`.

- [ ] **Step 1: Write the failing test**

Create `src/engine/reinforcement.test.js`:

```js
// Run: node --test src/engine/reinforcement.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_REINFORCEMENT_POLICY,
  MAX_REINFORCEMENT,
  REINFORCEMENT_POLICIES,
  deriveReinforcement,
  normalizePendingReinforcement,
  normalizeReinforcement,
  normalizeReinforcementMap,
} from "./reinforcement.js";

const BASE = {
  policies: { France: "replacements" },
  pools: { France: { manpower: 100000, materiel: 1000 } },
  units: [
    { id: "u1", ownerCode: "France", type: "infantry", regionId: "r1", strength: 40, lng: 1, lat: 1 },
    { id: "u2", ownerCode: "France", type: "infantry", regionId: "r2", strength: 100, lng: 2, lat: 2 },
  ],
  supply: [
    { unitId: "u1", reachable: true },
    { unitId: "u2", reachable: true },
  ],
  months: 1,
};

test("an in-supply formation recovers the monthly rate and draws the cost", () => {
  const result = deriveReinforcement(BASE);
  assert.deepEqual(result.ops, [{ op: "strength", unitId: "u1", strength: 45 }]);
  assert.deepEqual(result.draws, { France: { manpower: 600, materiel: 0.25 } });
  assert.equal(result.summary.reinforced, 1);
  assert.equal(result.summary.pointsRestored, 5);
});

test("a cut-off formation recovers nothing and draws nothing", () => {
  const supply = [{ unitId: "u1", reachable: false }, { unitId: "u2", reachable: false }];
  const result = deriveReinforcement({ ...BASE, supply });
  assert.deepEqual(result.ops, []);
  assert.deepEqual(result.draws, {});
});

test("none reinforces nobody; belligerent only a polity on an active war", () => {
  assert.deepEqual(deriveReinforcement({ ...BASE, policies: { France: "none" } }).ops, []);
  const atWar = deriveReinforcement({
    ...BASE,
    policies: { France: "belligerent" },
    wars: [{ status: "active", sideA: ["France"], sideB: ["Germany"] }],
  });
  assert.equal(atWar.summary.reinforced, 1);
  const peace = deriveReinforcement({ ...BASE, policies: { France: "belligerent" } });
  assert.deepEqual(peace.ops, []);
});

test("the draw is bounded by the pool and never goes negative", () => {
  const poor = deriveReinforcement({ ...BASE, pools: { France: { manpower: 600, materiel: 0.25 } } });
  assert.deepEqual(poor.ops, [{ op: "strength", unitId: "u1", strength: 45 }]);
  assert.deepEqual(poor.draws, { France: { manpower: 600, materiel: 0.25 } });
  const broke = deriveReinforcement({ ...BASE, pools: { France: { manpower: 1, materiel: 0 } } });
  assert.deepEqual(broke.ops, []);
  assert.deepEqual(broke.draws, {});
});

test("a zero-month period restores nothing but a rotation still applies", () => {
  const result = deriveReinforcement({
    ...BASE,
    months: 0,
    units: [
      { id: "u1", ownerCode: "France", type: "infantry", regionId: "r1", strength: 40, lng: 1, lat: 1 },
      { id: "u2", ownerCode: "France", type: "infantry", regionId: "r2", strength: 90, lng: 2, lat: 2 },
    ],
    rotations: [{ out: "u1", in: "u2" }],
  });
  assert.deepEqual(result.ops.filter((op) => op.op === "strength"), []);
  assert.equal(result.summary.rotations, 1);
});

test("weakest first, and reordering the roster does not change the result", () => {
  const pools = { France: { manpower: 600, materiel: 0.25 } };
  const forward = deriveReinforcement({ ...BASE, pools });
  const reversed = deriveReinforcement({ ...BASE, pools, units: [...BASE.units].reverse() });
  assert.deepEqual(forward, reversed);
  assert.equal(forward.ops[0].unitId, "u1");
});

test("a rotation of two valid, reachable, same-type formations swaps their stations", () => {
  const result = deriveReinforcement({
    ...BASE,
    units: [
      { id: "u1", ownerCode: "France", type: "infantry", regionId: "r1", strength: 40, lng: 1, lat: 1 },
      { id: "u2", ownerCode: "France", type: "infantry", regionId: "r2", strength: 90, lng: 2, lat: 2 },
    ],
    rotations: [{ out: "u1", in: "u2" }],
  });
  assert.deepEqual(result.ops, [
    { op: "move", unitId: "u1", toLng: 2, toLat: 2, regionId: "r2" },
    { op: "move", unitId: "u2", toLng: 1, toLat: 1, regionId: "r1" },
  ]);
  // Neither formation is reinforced the turn it is committed.
  assert.deepEqual(result.draws, {});
  assert.equal(result.summary.rotations, 1);
});

test("a rotation naming an unreachable or mismatched formation is rejected", () => {
  const unreachable = deriveReinforcement({
    ...BASE,
    supply: [{ unitId: "u2", reachable: true }],
    rotations: [{ out: "u1", in: "u2" }],
  });
  assert.deepEqual(unreachable.ops.filter((op) => op.op === "move"), []);
  assert.equal(unreachable.summary.rejected, 1);
  const mismatched = deriveReinforcement({
    ...BASE,
    units: [BASE.units[0], { ...BASE.units[1], type: "armor" }],
    rotations: [{ out: "u1", in: "u2" }],
  });
  assert.deepEqual(mismatched.ops.filter((op) => op.op === "move"), []);
});

test("a merge yields a strength op capped at full and a remove op, keeping the survivor", () => {
  const units = [{ ...BASE.units[0], regionId: "r1" }, { ...BASE.units[1], strength: 30, regionId: "r1" }];
  const result = deriveReinforcement({ ...BASE, units, merges: [{ survivor: "u1", absorbed: "u2" }] });
  assert.deepEqual(result.ops, [
    { op: "strength", unitId: "u1", strength: 70 },
    { op: "remove", unitId: "u2" },
  ]);
  assert.equal(result.summary.merges, 1);
});

test("an isolated pair may merge, because a merge is not a movement", () => {
  const units = [{ ...BASE.units[0], regionId: "r1" }, { ...BASE.units[1], strength: 30, regionId: "r1" }];
  const supply = [{ unitId: "u1", reachable: false }, { unitId: "u2", reachable: false }];
  const result = deriveReinforcement({ ...BASE, units, supply, merges: [{ survivor: "u1", absorbed: "u2" }] });
  assert.equal(result.summary.merges, 1);
});

test("duplicate orders fold by key, first one winning", () => {
  const units = [
    { id: "u1", ownerCode: "France", type: "infantry", regionId: "r1", strength: 40, lng: 1, lat: 1 },
    { id: "u2", ownerCode: "France", type: "infantry", regionId: "r2", strength: 90, lng: 2, lat: 2 },
  ];
  const result = deriveReinforcement({
    ...BASE,
    units,
    rotations: [{ out: "u1", in: "u2" }, { out: "u1", in: "u2" }],
  });
  assert.equal(result.summary.rotations, 1);
  assert.equal(result.summary.rejected, 1);
});

test("empty inputs yield the empty shape, not a throw", () => {
  const result = deriveReinforcement();
  assert.deepEqual(result.ops, []);
  assert.deepEqual(result.draws, {});
  assert.deepEqual(result.rejections, []);
  assert.equal(result.summary.reinforced, 0);
});

test("the declaration normalizer validates the closed policy and the cap", () => {
  assert.deepEqual(
    normalizeReinforcement([{ polity: "France", policy: "none" }], { knownPolities: ["France"] }),
    { valid: [{ polity: "France", policy: "none" }], rejected: [] },
  );
  const bad = normalizeReinforcement(
    [{ polity: "Atlantis", policy: "total" }, { polity: "France", policy: "total" }],
    { knownPolities: ["France"] },
  );
  assert.deepEqual(bad.valid, []);
  assert.equal(bad.rejected.length, 2);
});

test("the committed map stores only a valid non-default policy", () => {
  assert.deepEqual(
    normalizeReinforcementMap({ France: DEFAULT_REINFORCEMENT_POLICY, Germany: "none", Italy: "junk" }),
    { Germany: "none" },
  );
});

test("the pending shape round-trips a valid declaration", () => {
  assert.deepEqual(
    normalizePendingReinforcement([{ polity: "France", policy: "belligerent" }]),
    [{ polity: "France", policy: "belligerent" }],
  );
  assert.equal(REINFORCEMENT_POLICIES.includes("replacements"), true);
  assert.equal(MAX_REINFORCEMENT, 20);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/engine/reinforcement.test.js`
Expected: FAIL (the module does not exist).

- [ ] **Step 3: Create the core**

Create `src/engine/reinforcement.js`:

```js
// Open Historia - the reinforcement and rotation core (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// A pure function of a declared policy, the reserves, the roster, the supply
// states part two derives and the declared rotation and merge orders. It
// restores strength from the same pools a battle charges and folds two
// formations together, without touching the world. It writes nothing and stores
// nothing; the turn applies its ops through the existing unit seam.

import { UNIT_UPKEEP } from "./forcePools.js";
import { roundTo } from "./economyMath.js";

const name = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
// Locale-independent, matching supplyAttrition.js: the derivation must be
// byte-identical across machines.
const foldKey = (value) => name(value).toLowerCase();
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// One strength point is this many months of the formation's upkeep, the same
// price a battle's reserve charge uses. A runtime test pins this to the
// runtime's COMBAT_POOL_FACTOR, so a lost point and a bought point cannot drift.
export const REINFORCEMENT_POOL_FACTOR = 10;
// Strength points a formation may buy back per whole month. First-draft
// calibration: the tests assert ordering and the period multiplier, never a
// magnitude.
export const REINFORCEMENT_RATE_PER_MONTH = 5;

export const REINFORCEMENT_POLICIES = Object.freeze(["none", "replacements", "belligerent"]);
export const DEFAULT_REINFORCEMENT_POLICY = "replacements";
export const MAX_REINFORCEMENT = 20;
export const MAX_ROTATIONS = 8;
export const MAX_MERGES = 8;

const POLICIES = new Set(REINFORCEMENT_POLICIES);

const clampStrength = (value) => {
  const raw = value === null || value === undefined || value === "" ? NaN : Number(value);
  return Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 100;
};

const hasStation = (unit) =>
  Number.isFinite(unit?.lng) && Number.isFinite(unit?.lat) && !(unit.lng === 0 && unit.lat === 0);

// The per-point price of one strength point, read from the same UNIT_UPKEEP row
// a battle's reserve charge reads. An unknown type prices as infantry, matching
// the combat charge.
const perPointCost = (type) => {
  const row = UNIT_UPKEEP[name(type)] ?? UNIT_UPKEEP.infantry;
  return {
    manpower: (row.manpower * REINFORCEMENT_POOL_FACTOR) / 100,
    materiel: (row.materiel * REINFORCEMENT_POOL_FACTOR) / 100,
  };
};

const costFor = (perPoint, points) => ({
  manpower: Math.round(perPoint.manpower * points),
  materiel: roundTo(perPoint.materiel * points, 2),
});

const poolFor = (pools, polity) => {
  const row = pools?.[polity] ?? {};
  return {
    manpower: Math.max(0, Math.floor(Number(row?.manpower) || 0)),
    materiel: Math.max(0, roundTo(Number(row?.materiel) || 0, 2)),
  };
};

// A polity on a side of at least one active war, the same rule the supply core
// uses. A degenerate war listing one polity on both sides makes none.
const belligerentsFor = (wars) => {
  const set = new Set();
  for (const war of list(wars)) {
    if (!war || foldKey(war?.status) !== "active") continue;
    const sideA = list(war?.sideA).map(foldKey).filter(Boolean);
    const sideB = list(war?.sideB).map(foldKey).filter(Boolean);
    if (sideA.some((key) => sideB.includes(key))) continue;
    for (const key of [...sideA, ...sideB]) set.add(key);
  }
  return set;
};

// The model's reinforcement declaration. Like normalizeMobilization: an entry
// that fails is dropped, never fatal, and returned so the caller can log it.
// Duplicates fold by polity, last one winning, because a policy is one value.
export const normalizeReinforcement = (value, { knownPolities = [] } = {}) => {
  const rows = Array.isArray(value) ? value : [];
  const known = new Set(list(knownPolities).map(name));
  const byPolity = new Map();
  const rejected = [];

  for (let index = 0; index < rows.length; index += 1) {
    const entry = rows[index];
    if (!entry || typeof entry !== "object") {
      rejected.push({ index, reason: "not an object" });
      continue;
    }
    const polity = name(entry.polity ?? entry.country);
    if (!polity || !known.has(polity)) {
      rejected.push({ index, reason: `unknown polity "${polity}"` });
      continue;
    }
    const policy = name(entry.policy).toLowerCase();
    if (!POLICIES.has(policy)) {
      rejected.push({ index, reason: `unknown policy "${entry.policy}"` });
      continue;
    }
    if (!byPolity.has(polity) && byPolity.size >= MAX_REINFORCEMENT) {
      rejected.push({ index, reason: `more than ${MAX_REINFORCEMENT} polities in one period` });
      continue;
    }
    byPolity.set(polity, { polity, policy });
  }

  return { valid: [...byPolity.values()], rejected };
};

// The storage shape: what the model declared, validated without a world. A
// corrupted save costs the entry, never the world.
export const normalizePendingReinforcement = (value) => {
  const rows = Array.isArray(value) ? value : [];
  const byPolity = new Map();
  for (const entry of rows) {
    if (!entry || typeof entry !== "object") continue;
    const polity = name(entry.polity ?? entry.country);
    if (byPolity.size >= MAX_REINFORCEMENT && !byPolity.has(polity)) continue;
    const policy = name(entry.policy).toLowerCase();
    if (!polity || !POLICIES.has(policy)) continue;
    byPolity.set(polity, { polity, policy });
  }
  return [...byPolity.values()];
};

// The committed policy. Sparse: only non-default entries are stored, so an
// absent name reads as replacements and a save that never used this increment
// keeps the record byte-identical.
export const normalizeReinforcementMap = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = name(rawKey);
    if (!key) continue;
    const policy = name(rawValue).toLowerCase();
    if (policy && policy !== DEFAULT_REINFORCEMENT_POLICY && POLICIES.has(policy)) out[key] = policy;
  }
  return out;
};

export const deriveReinforcement = ({
  policies = {},
  pools = {},
  units = [],
  supply = [],
  wars = [],
  rotations = [],
  merges = [],
  months = 0,
} = {}) => {
  const period = Math.max(0, Math.trunc(Number(months)) || 0);
  const rejections = [];

  // First occurrence of an id wins, so a duplicate row cannot double a
  // formation.
  const roster = new Map();
  for (const raw of list(units)) {
    const id = name(raw?.id);
    if (!id || roster.has(id)) continue;
    roster.set(id, {
      id,
      ownerCode: name(raw?.ownerCode),
      type: name(raw?.type) || "infantry",
      regionId: name(raw?.regionId),
      strength: clampStrength(raw?.strength),
      lng: raw?.lng,
      lat: raw?.lat,
    });
  }

  const supplyById = new Map();
  for (const row of list(supply)) {
    const unitId = name(row?.unitId);
    if (!unitId || supplyById.has(unitId)) continue;
    supplyById.set(unitId, row?.reachable === true);
  }
  const reachableOf = (unit) => supplyById.get(unit.id) === true;

  // A rotation or a merge claims both of its formations, so no formation is
  // touched by two orders, and a claimed formation is not reinforced the same
  // turn: rotate the worn formation out now, let it rebuild in the rear next.
  const claimed = new Set();

  const rotationRejection = (order) => {
    if (order.out === order.in) return "a rotation needs two different formations";
    const out = roster.get(order.out);
    const into = roster.get(order.in);
    if (!out || !into) return "unknown formation";
    if (claimed.has(out.id) || claimed.has(into.id)) return "a formation is already committed this turn";
    if (foldKey(out.ownerCode) !== foldKey(into.ownerCode)) return "different polities";
    if (out.type !== into.type) return "different types";
    if (out.regionId === into.regionId) return "the two formations stand on one region";
    if (!reachableOf(out) || !reachableOf(into)) return "a formation is out of supply";
    if (!hasStation(out) || !hasStation(into)) return "a formation has no usable station";
    return "";
  };

  const mergeRejection = (order) => {
    if (order.survivor === order.absorbed) return "a merge needs two different formations";
    const survivor = roster.get(order.survivor);
    const absorbed = roster.get(order.absorbed);
    if (!survivor || !absorbed) return "unknown formation";
    if (claimed.has(survivor.id) || claimed.has(absorbed.id)) return "a formation is already committed this turn";
    if (foldKey(survivor.ownerCode) !== foldKey(absorbed.ownerCode)) return "different polities";
    if (survivor.type !== absorbed.type) return "different types";
    if (!survivor.regionId || survivor.regionId !== absorbed.regionId) return "the two formations stand on different regions";
    return "";
  };

  // Rotations run before merges, so a formation named by both is rotated and the
  // merge is rejected: the two halves of one decision cannot disagree.
  const moveOps = [];
  const rotationOrders = list(rotations)
    .map((order, index) => ({ out: name(order?.out), in: name(order?.in), index }))
    .filter((order) => order.out && order.in)
    .sort((a, b) => compare(a.out, b.out) || compare(a.in, b.in) || a.index - b.index);
  let rotationCount = 0;
  for (const order of rotationOrders) {
    const reason = rotationRejection(order);
    if (reason) {
      rejections.push({ kind: "rotation", index: order.index, reason });
      continue;
    }
    const out = roster.get(order.out);
    const into = roster.get(order.in);
    claimed.add(out.id);
    claimed.add(into.id);
    // Swap station and the region that reads supply, so the supply layer and
    // the map never disagree about which station a formation now holds.
    moveOps.push({ op: "move", unitId: out.id, toLng: into.lng, toLat: into.lat, regionId: into.regionId });
    moveOps.push({ op: "move", unitId: into.id, toLng: out.lng, toLat: out.lat, regionId: out.regionId });
    rotationCount += 1;
  }

  const mergeOps = [];
  const mergeOrders = list(merges)
    .map((order, index) => ({ survivor: name(order?.survivor), absorbed: name(order?.absorbed), index }))
    .filter((order) => order.survivor && order.absorbed)
    .sort((a, b) => compare(a.survivor, b.survivor) || compare(a.absorbed, b.absorbed) || a.index - b.index);
  let mergeCount = 0;
  for (const order of mergeOrders) {
    const reason = mergeRejection(order);
    if (reason) {
      rejections.push({ kind: "merge", index: order.index, reason });
      continue;
    }
    const survivor = roster.get(order.survivor);
    const absorbed = roster.get(order.absorbed);
    claimed.add(survivor.id);
    claimed.add(absorbed.id);
    const strength = Math.min(100, survivor.strength + absorbed.strength);
    mergeOps.push({ op: "strength", unitId: survivor.id, strength });
    mergeOps.push({ op: "remove", unitId: absorbed.id });
    mergeCount += 1;
  }

  const belligerents = belligerentsFor(wars);
  const draws = {};
  const reinforceOps = [];
  let reinforcedCount = 0;
  let pointsRestored = 0;

  const policyFor = (polity) => {
    const declared = name(policies?.[polity]).toLowerCase();
    return POLICIES.has(declared) ? declared : DEFAULT_REINFORCEMENT_POLICY;
  };

  // Polities in stable name order, each against its own pool, so one polity's
  // draw cannot change another's.
  const polityNames = [...new Set([...roster.values()].map((unit) => unit.ownerCode).filter(Boolean))];
  polityNames.sort(compare);

  for (const polity of polityNames) {
    const policy = policyFor(polity);
    if (policy === "none") continue;
    if (policy === "belligerent" && !belligerents.has(foldKey(polity))) continue;
    const pool = poolFor(pools, polity);
    const running = { ...pool };
    const eligible = [...roster.values()]
      .filter((unit) => unit.ownerCode === polity && !claimed.has(unit.id) && reachableOf(unit) && unit.strength < 100)
      .sort((a, b) => a.strength - b.strength || compare(a.id, b.id));
    for (const unit of eligible) {
      const perPoint = perPointCost(unit.type);
      const cap = Math.trunc(Math.min(100 - unit.strength, period * REINFORCEMENT_RATE_PER_MONTH));
      let points = Math.max(0, cap);
      // The largest whole number of points both pools can afford at this
      // moment. A poor polity reinforces slowly rather than not at all.
      while (points > 0) {
        const candidate = costFor(perPoint, points);
        if (candidate.manpower <= running.manpower && candidate.materiel <= running.materiel) break;
        points -= 1;
      }
      if (points <= 0) continue;
      const cost = costFor(perPoint, points);
      running.manpower -= cost.manpower;
      running.materiel = Math.max(0, roundTo(running.materiel - cost.materiel, 2));
      reinforceOps.push({ op: "strength", unitId: unit.id, strength: unit.strength + points });
      reinforcedCount += 1;
      pointsRestored += points;
    }
    const spentManpower = pool.manpower - running.manpower;
    const spentMateriel = roundTo(pool.materiel - running.materiel, 2);
    if (spentManpower > 0 || spentMateriel > 0) {
      draws[polity] = { manpower: spentManpower, materiel: spentMateriel };
    }
  }

  // A fixed order: reinforcement, then rotations, then merges.
  const ops = [...reinforceOps, ...moveOps, ...mergeOps];
  return {
    ops,
    draws,
    summary: {
      reinforced: reinforcedCount,
      pointsRestored,
      rotations: rotationCount,
      merges: mergeCount,
      rejected: rejections.length,
      opCount: ops.length,
    },
    rejections,
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/engine/reinforcement.test.js`
Expected: PASS, every test green.

Run: `node --test "src/engine/*.test.js"`
Expected: PASS, including `enginePurity.test.js` with the new file present.

- [ ] **Step 5: Commit**

```bash
git add src/engine/reinforcement.js src/engine/reinforcement.test.js
git commit -m "feat(engine): derive reinforcement, rotation and merge from the roster"
```

---

### Task 2: The adapter

**Files:**
- Create: `src/runtime/reinforcement.js`
- Create: `src/runtime/reinforcement.test.js`

**Interfaces:**
- Consumes: `deriveReinforcement` and `REINFORCEMENT_POOL_FACTOR` from `../engine/reinforcement.js`; `monthsBetweenDates` from `../engine/economyMath.js`; `readSupplyAttrition` from `./supplyAttrition.js`; `buildOwnerAliasMap`, `createOwnerResolver` from `./ownerNames.js`; `COMBAT_POOL_FACTOR` from `./combatEngagements.js` (test only).
- Produces: `readReinforcement(world, catalog, { fromDate, toDate, rotations, merges }) -> { ops, reserveCost, summary, rejections }`, where `reserveCost` is the `{ [polity]: { manpower, materiel } }` shape `applyCombatReserveCost` already takes.

- [ ] **Step 1: Write the failing test**

Create `src/runtime/reinforcement.test.js`:

```js
// Run: node --test src/runtime/reinforcement.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { readReinforcement } from "./reinforcement.js";
import { REINFORCEMENT_POOL_FACTOR } from "../engine/reinforcement.js";
import { COMBAT_POOL_FACTOR } from "./combatEngagements.js";

const CATALOG = [
  { id: "r1", name: "Ile-de-France", country: "France", countryCode: "FRA", adjacencies: ["r2", "r3"] },
  { id: "r2", name: "Rheinland", country: "Germany", countryCode: "DEU", adjacencies: ["r1"] },
  { id: "r3", name: "Normandie", country: "France", countryCode: "FRA", adjacencies: ["r1"] },
];

const WORLD = {
  wars: [{ id: "w1", status: "active", sideA: ["France"], sideB: ["Germany"] }],
  economyEngine: {
    reinforcement: { France: "replacements" },
    pools: { France: { manpower: 100000, materiel: 1000 } },
  },
  units: [
    { id: "a", ownerCode: "France", type: "infantry", regionId: "r1", strength: 40, lng: 1, lat: 1 },
    { id: "b", ownerCode: "France", type: "infantry", regionId: "r3", strength: 90, lng: 3, lat: 3 },
    { id: "c", ownerCode: "France", type: "armor", regionId: "r3", strength: 50, lng: 3.1, lat: 3.1 },
    { id: "d", ownerCode: "France", type: "armor", regionId: "r3", strength: 30, lng: 3.2, lat: 3.2 },
    { id: "f", ownerCode: "France", type: "infantry", regionId: "r3", strength: 40, lng: 3.3, lat: 3.3 },
    { id: "e", ownerCode: "France", type: "infantry", regionId: "r9", strength: 40, lng: 9, lat: 9 },
  ],
};

test("the pool factor is pinned to the combat factor", () => {
  assert.equal(REINFORCEMENT_POOL_FACTOR, COMBAT_POOL_FACTOR);
});

test("a composite world yields the expected ops, reserve draw and summary", () => {
  const result = readReinforcement(WORLD, CATALOG, {
    fromDate: "2000-01-01",
    toDate: "2000-01-31",
    rotations: [{ out: "a", in: "b" }],
    merges: [{ survivor: "c", absorbed: "d" }],
  });
  assert.deepEqual(result.ops, [
    { op: "strength", unitId: "f", strength: 45 },
    { op: "move", unitId: "a", toLng: 3, toLat: 3, regionId: "r3" },
    { op: "move", unitId: "b", toLng: 1, toLat: 1, regionId: "r1" },
    { op: "strength", unitId: "c", strength: 80 },
    { op: "remove", unitId: "d" },
  ]);
  assert.deepEqual(result.reserveCost, { France: { manpower: 600, materiel: 0.25 } });
  assert.equal(result.summary.reinforced, 1);
  assert.equal(result.summary.rotations, 1);
  assert.equal(result.summary.merges, 1);
  assert.equal(result.summary.opCount, 5);
});

test("an empty catalog leaves every formation unreachable", () => {
  const result = readReinforcement(WORLD, [], { fromDate: "2000-01-01", toDate: "2000-01-31" });
  assert.deepEqual(result.ops, []);
  assert.deepEqual(result.reserveCost, {});
});

test("the adapter leaves the world and the catalog unmodified", () => {
  const world = structuredClone(WORLD);
  const catalog = structuredClone(CATALOG);
  readReinforcement(world, catalog, { fromDate: "2000-01-01", toDate: "2000-03-31" });
  assert.deepEqual(world, WORLD);
  assert.deepEqual(catalog, CATALOG);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/runtime/reinforcement.test.js`
Expected: FAIL (the module does not exist).

- [ ] **Step 3: Create the adapter**

Create `src/runtime/reinforcement.js`:

```js
// Open Historia - the reinforcement and rotation adapter (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// Reads the world and the catalog into the pure core's plain inputs and maps the
// result to the unit ops and the reserve draw the turn already applies.
// Read-only: it writes nothing and imports no Game/AI module.

import { deriveReinforcement } from "../engine/reinforcement.js";
import { monthsBetweenDates } from "../engine/economyMath.js";
import { readSupplyAttrition } from "./supplyAttrition.js";
import { buildOwnerAliasMap, createOwnerResolver } from "./ownerNames.js";

const name = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);

export const readReinforcement = (world, catalog, { fromDate = "", toDate = "", rotations = [], merges = [] } = {}) => {
  const resolveOwner = createOwnerResolver(buildOwnerAliasMap(world?.polityOverrides));

  // The policy in force this span: committed, overridden by last turn's pending
  // declaration. This turn's declaration is not read here; the economy commit
  // stores it for next period, exactly as mobilization lags.
  const committed = world?.economyEngine?.reinforcement;
  const pending = list(world?.economyEngine?.pendingReinforcement);
  const policies = {};
  for (const [rawKey, rawValue] of Object.entries(committed ?? {})) {
    const polity = resolveOwner(name(rawKey));
    const policy = name(rawValue).toLowerCase();
    if (polity && policy) policies[polity] = policy;
  }
  for (const entry of pending) {
    const polity = resolveOwner(name(entry?.polity ?? entry?.country));
    const policy = name(entry?.policy).toLowerCase();
    if (polity && policy) policies[polity] = policy;
  }

  const pools = {};
  for (const [rawKey, row] of Object.entries(world?.economyEngine?.pools ?? {})) {
    const polity = resolveOwner(name(rawKey));
    if (!polity || !row || typeof row !== "object") continue;
    pools[polity] = { manpower: row.manpower, materiel: row.materiel };
  }

  const units = list(world?.units).map((unit) => ({
    id: name(unit?.id),
    ownerCode: resolveOwner(name(unit?.ownerCode)),
    type: name(unit?.type),
    regionId: name(unit?.regionId),
    // Passed through raw: the core owns the 0-100 clamp and the full-strength
    // default, so a blank or missing value is not read as zero here.
    strength: unit?.strength,
    lng: unit?.lng,
    lat: unit?.lat,
  }));
  const wars = list(world?.wars).map((war) => ({
    status: name(war?.status),
    sideA: list(war?.sideA).map((row) => resolveOwner(name(row))).filter(Boolean),
    sideB: list(war?.sideB).map((row) => resolveOwner(name(row))).filter(Boolean),
  }));

  // The supply states part two already derives, read through its own adapter so
  // "in supply" has one definition. Only reachable is read; the attrition loss
  // is ignored.
  const supply = readSupplyAttrition(world, catalog, { fromDate, toDate }).units.map((row) => ({
    unitId: row.unitId,
    reachable: row.reachable,
  }));

  const result = deriveReinforcement({
    policies,
    pools,
    units,
    supply,
    wars,
    rotations,
    merges,
    // The same whole-month step the economy uses: a one-day turn is a zero-month
    // turn, so it restores nothing but still rotates or merges.
    months: Math.max(0, monthsBetweenDates(fromDate, toDate)),
  });

  return {
    ops: result.ops,
    reserveCost: result.draws,
    summary: result.summary,
    rejections: result.rejections,
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/runtime/reinforcement.test.js`
Expected: PASS, every test green.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/reinforcement.js src/runtime/reinforcement.test.js
git commit -m "feat(runtime): read reinforcement and consolidation from the world"
```

---

### Task 3: The lagged policy storage

**Files:**
- Modify: `src/runtime/economyEngine.js` (import block near line 27; `advanceWorldEconomy` params near line 272; the early return near line 300; the mobilization fold near line 314; the committed map near line 367; the `nextWorld` write near line 402; the rejected list near line 437; the return near line 490)
- Modify: `src/runtime/gameState.js` (import block near line 27; `normalizeEconomyEngine` near line 3577)
- Create: `src/runtime/reinforcementLag.test.js`

**Interfaces:**
- Consumes: `DEFAULT_REINFORCEMENT_POLICY`, `normalizePendingReinforcement`, `normalizeReinforcement`, `normalizeReinforcementMap` from `../engine/reinforcement.js` (Task 1).
- Produces: `advanceWorldEconomy(world, { declaredReinforcement })`; `world.economyEngine.reinforcement` and `world.economyEngine.pendingReinforcement` round-trip through `normalizeWorldState`.

- [ ] **Step 1: Write the failing test**

Create `src/runtime/reinforcementLag.test.js`:

```js
// Run: node --test src/runtime/reinforcementLag.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { advanceWorldEconomy } from "./economyEngine.js";
import { normalizeWorldState } from "./gameState.js";

const sheet = () => ({
  statsSchemaVersion: 1,
  stability: 60,
  economy: {
    gdp: 1e12,
    gdpPerCapita: 10_000,
    gdpGrowth: 2,
    inflation: 4,
    unemployment: 8,
    publicDebt: 90,
    budgetBalance: -4,
    currency: "EGP",
  },
  population: { total: 100_000_000, coreIntegrated: 100_000_000, otherTerritories: 0 },
  gdpBreakdown: { agriculture: 10, industry: 35, services: 55 },
  territorialComponents: [{ geography: "core", group: "core", population: 100_000_000, gdpPerCapita: 10_000 }],
});

const world = () => ({
  countryStats: { Egypt: sheet() },
  economyEngine: { version: 1, seed: "s", lastDate: "2026-01-01", lastMonth: 0 },
});

test("a declared policy is pending this period, not in force", () => {
  const result = advanceWorldEconomy(world(), {
    fromDate: "2026-01-01",
    toDate: "2026-04-01",
    declaredReinforcement: [{ polity: "Egypt", policy: "none" }],
  });
  assert.equal(result.world.economyEngine.reinforcement, undefined);
  assert.deepEqual(result.world.economyEngine.pendingReinforcement, [{ polity: "Egypt", policy: "none" }]);
});

test("the declared policy is in force in the next advance", () => {
  const first = advanceWorldEconomy(world(), {
    fromDate: "2026-01-01",
    toDate: "2026-04-01",
    declaredReinforcement: [{ polity: "Egypt", policy: "none" }],
  });
  const second = advanceWorldEconomy(first.world, { fromDate: "2026-04-01", toDate: "2026-07-01" });
  assert.deepEqual(second.world.economyEngine.reinforcement, { Egypt: "none" });
  assert.equal(second.world.economyEngine.pendingReinforcement, undefined);
});

test("an unknown polity declared for reinforcement is rejected, not thrown", () => {
  const result = advanceWorldEconomy(world(), {
    fromDate: "2026-01-01",
    toDate: "2026-04-01",
    declaredReinforcement: [{ polity: "Atlantis", policy: "none" }],
  });
  assert.equal(result.world.economyEngine.pendingReinforcement, undefined);
});

test("the policy fields round-trip through a world normalize", () => {
  const normalized = normalizeWorldState({
    economyEngine: {
      version: 1,
      seed: "abc",
      lastDate: "2026-04-01",
      lastMonth: 3,
      reinforcement: { France: "belligerent" },
      pendingReinforcement: [{ polity: "Germany", policy: "none" }],
    },
  });
  assert.deepEqual(normalized.economyEngine.reinforcement, { France: "belligerent" });
  assert.deepEqual(normalized.economyEngine.pendingReinforcement, [{ polity: "Germany", policy: "none" }]);
});

test("an engine block with no reinforcement keeps its old shape", () => {
  const normalized = normalizeWorldState({
    economyEngine: { version: 1, seed: "abc", lastDate: "2026-04-01", lastMonth: 3 },
  });
  assert.deepEqual(Object.keys(normalized.economyEngine).sort(), ["lastDate", "lastMonth", "seed", "version"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/runtime/reinforcementLag.test.js`
Expected: FAIL (the fields do not exist).

- [ ] **Step 3: Accept and fold the declaration in the economy advance**

In `src/runtime/economyEngine.js`, add the import after the `forcePools.js` import block:

```js
import {
  DEFAULT_REINFORCEMENT_POLICY,
  normalizeReinforcement,
  normalizeReinforcementMap,
} from "../engine/reinforcement.js";
```

Add the parameter after `declaredProduction = [],`:

```js
    declaredReinforcement = [],
```

In the early return (the `months <= 0 || knownPolities.length === 0` branch), add beside `declaredMobilization: []`:

```js
      declaredReinforcement: [],
```

After the mobilization fold (after the `declaredMobilizationRejected` assignment), add:

```js
  // The reinforcement policy in force this period, on the same one-period lag as
  // the posture: committed, overridden by last turn's pending declaration. This
  // turn's declaration is stored for next period.
  const reinforcement = { ...normalizeReinforcementMap(world?.economyEngine?.reinforcement) };
  const { valid: pendingReinforcementNow } = normalizeReinforcement(world?.economyEngine?.pendingReinforcement, { knownPolities });
  for (const entry of pendingReinforcementNow) reinforcement[entry.polity] = entry.policy;
  const { valid: declaredReinforcementNow, rejected: declaredReinforcementRejected } =
    normalizeReinforcement(declaredReinforcement, { knownPolities });
```

After the `committedMobilization` block, add:

```js
  // Only non-default policies are stored, so an absent name reads as
  // replacements.
  const committedReinforcement = Object.fromEntries(
    stableOrder(Object.keys(reinforcement))
      .filter((name) => reinforcement[name] && reinforcement[name] !== DEFAULT_REINFORCEMENT_POLICY)
      .map((name) => [name, reinforcement[name]]),
  );
```

In the `nextWorld.economyEngine` object, after the `pendingMobilization` line, add:

```js
      ...(Object.keys(committedReinforcement).length ? { reinforcement: committedReinforcement } : {}),
      ...(declaredReinforcementNow.length ? { pendingReinforcement: declaredReinforcementNow } : {}),
```

Change the rejected fold to include the new rejections:

```js
  const rejectedAll = [...rejected, ...declaredRejected, ...declaredMobilizationRejected, ...declaredReinforcementRejected];
```

In the returned object, after `declaredMobilization: declaredNow,`, add:

```js
    declaredReinforcement: declaredReinforcementNow,
```

- [ ] **Step 4: Round-trip the fields in the world normalizer**

In `src/runtime/gameState.js`, add the import beside the `forcePools.js` import:

```js
import { normalizePendingReinforcement, normalizeReinforcementMap } from "../engine/reinforcement.js";
```

In `normalizeEconomyEngine`, after the `pendingMobilization` block, add:

```js
  // The reinforcement policy the same two sparse fields carry.
  const reinforcement = normalizeReinforcementMap(value.reinforcement);
  if (Object.keys(reinforcement).length) out.reinforcement = reinforcement;
  const pendingReinforcement = normalizePendingReinforcement(value.pendingReinforcement);
  if (pendingReinforcement.length) out.pendingReinforcement = pendingReinforcement;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test src/runtime/reinforcementLag.test.js`
Expected: PASS, every test green.

Run: `node --test "src/runtime/*.test.js"`
Expected: PASS, including the existing economy tests.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/economyEngine.js src/runtime/gameState.js src/runtime/reinforcementLag.test.js
git commit -m "feat(runtime): lag and store the reinforcement policy"
```

---

### Task 4: Wire the reinforcement step into the turn

**Files:**
- Modify: `src/Game/AI/gameplay.js` (adapter import near line 33; event id near line 1421; the step after the attrition `catch` at line 6821; `declaredReinforcement` at line 7388)
- Create: `src/runtime/reinforcementWiringArchitecture.test.js`

**Interfaces:**
- Consumes: `readReinforcement(world, catalog, { fromDate, toDate, rotations, merges })` from Task 2; `advanceWorldEconomy(world, { declaredReinforcement })` from Task 3; the existing `applyEventImpactsToWorld`, `applyCombatReserveCost`, `logDebugEvent`, `getPrimedScenarioRegionCatalog` and `normalizeArray` already imported by `gameplay.js`.
- Produces: no exported symbol; the turn now reinforces, rotates and merges, and hands the declared policy to the economy advance.

- [ ] **Step 1: Write the failing wiring test**

Create `src/runtime/reinforcementWiringArchitecture.test.js`:

```js
// Run: node --test src/runtime/reinforcementWiringArchitecture.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
const adapter = readFileSync(new URL("./reinforcement.js", import.meta.url), "utf8");
const core = readFileSync(new URL("../engine/reinforcement.js", import.meta.url), "utf8");

test("the reinforcement core imports only the force-pool and math siblings", () => {
  const specifiers = [...core.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(specifiers, ["./forcePools.js", "./economyMath.js"]);
});

test("the adapter imports no Game/AI module", () => {
  const specifiers = [...adapter.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(specifiers.some((specifier) => specifier.includes("Game/AI")), false);
});

test("the turn reinforces after attrition and before the economy", () => {
  const attritionAt = gameplay.indexOf("readSupplyAttrition(impactedWorld");
  const reinforceAt = gameplay.indexOf("readReinforcement(impactedWorld");
  const economyAt = gameplay.indexOf("advanceWorldEconomy(nextWorld");
  assert.ok(attritionAt > 0 && reinforceAt > 0 && economyAt > 0, "a reinforcement seam is missing");
  assert.ok(attritionAt < reinforceAt, "reinforcement must run after attrition");
  assert.ok(reinforceAt < economyAt, "reinforcement must run before the economy advances");
});

test("the turn applies the reinforcement ops as a board-only synthetic event", () => {
  assert.ok(gameplay.indexOf("REINFORCEMENT_EVENT_ID") > 0, "the event id is missing");
  assert.match(gameplay, /boardOnlyEventIds: \[REINFORCEMENT_EVENT_ID\]/);
  assert.match(gameplay, /impacts: \{ unitOps: reinforcement\.ops \}/);
});

test("the declared policy is handed to the economy advance", () => {
  assert.match(gameplay, /declaredReinforcement: normalizeArray\(result\.reinforcement\)/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/runtime/reinforcementWiringArchitecture.test.js`
Expected: FAIL (the wiring is not present).

- [ ] **Step 3: Add the adapter import**

In `src/Game/AI/gameplay.js`, immediately after `import { readSupplyAttrition } from "../../runtime/supplyAttrition.js";` (line 33), add:

```js
import { readReinforcement } from "../../runtime/reinforcement.js";
```

- [ ] **Step 4: Add the event id constant**

Next to `const SUPPLY_ATTRITION_EVENT_ID = "engine-supply-attrition";` (line 1421), add:

```js
// The board-only carrier for reinforcement and consolidation, beside the
// supply and research carriers.
const REINFORCEMENT_EVENT_ID = "engine-reinforcement";
```

- [ ] **Step 5: Insert the reinforcement step**

In `src/Game/AI/gameplay.js`, find the end of the supply-attrition `try/catch` (the line `  } catch (error) {` whose next line is `    console.warn("[engine] the supply attrition step failed; the completed turn is preserved.", error);` and the closing `  }` at line 6821). Insert the block below immediately after that closing `  }`:

```js
  // Reinforcement and consolidation: a formation in supply buys its strength
  // back from its polity's reserves, a worn formation rotates out for a fresh
  // one, and two weak formations of a type fold into one. It runs on the world
  // the battles and attrition have just reshaped and BEFORE the war settlements
  // and the economy, so the draw competes with the reparations and the
  // production queue for the same reserves. The ops travel the one unit path as
  // a board-only synthetic event, exactly as the attrition and the production
  // completions do. A failure here must never lose a completed turn; a skipped
  // period is lost, not repaired later.
  try {
    const reinforcement = readReinforcement(impactedWorld, getPrimedScenarioRegionCatalog() ?? [], {
      fromDate: baseGame.gameDate || "",
      toDate: nextGame.gameDate || "",
      rotations: normalizeArray(result.rotations),
      merges: normalizeArray(result.merges),
    });
    if (reinforcement.ops.length) {
      const applied = applyEventImpactsToWorld({
        colors: nextColors,
        events: [{
          id: REINFORCEMENT_EVENT_ID,
          date: nextGame.gameDate || "",
          title: "Reinforcement and rotation",
          description: "",
          impacts: { unitOps: reinforcement.ops },
        }],
        world: impactedWorld,
        engineSourced: true,
        boardOnlyEventIds: [REINFORCEMENT_EVENT_ID],
      });
      impactedWorld = applied.world;
      nextColors = applied.colors;
    }
    impactedWorld = applyCombatReserveCost(impactedWorld, reinforcement.reserveCost);
    logDebugEvent("turn", `Reinforcement restored ${reinforcement.summary.pointsRestored} point(s) to ${reinforcement.summary.reinforced} formation(s); ${reinforcement.summary.rotations} rotation(s), ${reinforcement.summary.merges} merge(s).`, {
      rejected: reinforcement.summary.rejected,
    });
  } catch (error) {
    console.warn("[engine] the reinforcement step failed; the completed turn is preserved.", error);
  }
```

- [ ] **Step 6: Hand the declared policy to the economy advance**

In `src/Game/AI/gameplay.js`, in the `advanceWorldEconomy(nextWorld, { ... })` call, after `declaredMobilization: normalizeArray(result.mobilization),` (line 7388), add:

```js
      // Declared reinforcement policies run NEXT period, exactly like the
      // posture and the shocks.
      declaredReinforcement: normalizeArray(result.reinforcement),
```

- [ ] **Step 7: Run the wiring test and prove the module still parses**

Run: `node --test src/runtime/reinforcementWiringArchitecture.test.js`
Expected: PASS, all five tests green.

Run: `node --check src/Game/AI/gameplay.js`
Expected: no output (it parses).

Run: `node --test "src/runtime/*.test.js"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/Game/AI/gameplay.js src/runtime/reinforcementWiringArchitecture.test.js
git commit -m "feat(runtime): apply reinforcement and consolidation in the turn"
```

---

### Task 5: The declaration surface

**Files:**
- Modify: `src/Game/AI/gameplaySchemas.js` (import near line 4; the new entry schemas after `productionOrderSchema` near line 1052; the three properties after `productionOrders` near line 1138)
- Modify: `src/Game/AI/gameplayPrompts.js` (`buildForcePoolsInstructions`, the `rules` array near line 492)
- Modify: `src/Game/AI/projectOpSchema.test.js` (the jump-schema size guard near line 157)
- Create: `src/Game/AI/gameplaySchemas.reinforcement.test.js`
- Create: `src/Game/AI/reinforcementPrompt.test.js`

**Interfaces:**
- Consumes: `MAX_MERGES`, `MAX_REINFORCEMENT`, `MAX_ROTATIONS`, `REINFORCEMENT_POLICIES` from `../../engine/reinforcement.js` (Task 1).
- Produces: `JUMP_FORWARD_SCHEMA.properties.{reinforcement, rotations, merges}`; one more paragraph in the `[National Forces]` block.

- [ ] **Step 1: Write the failing schema test**

Create `src/Game/AI/gameplaySchemas.reinforcement.test.js`:

```js
// Run: node --test src/Game/AI/gameplaySchemas.reinforcement.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { JUMP_FORWARD_SCHEMA } from "./gameplaySchemas.js";
import {
  MAX_MERGES,
  MAX_REINFORCEMENT,
  MAX_ROTATIONS,
  REINFORCEMENT_POLICIES,
} from "../../engine/reinforcement.js";

test("the jump schema carries the reinforcement policy enum and cap", () => {
  const field = JUMP_FORWARD_SCHEMA.properties.reinforcement;
  assert.equal(field.type, "array");
  assert.equal(field.maxItems, MAX_REINFORCEMENT);
  assert.deepEqual(field.items.properties.policy.enum, [...REINFORCEMENT_POLICIES]);
  assert.deepEqual(field.items.required, ["polity", "policy"]);
});

test("the rotation and merge orders are capped and name two unit ids", () => {
  const rotations = JUMP_FORWARD_SCHEMA.properties.rotations;
  assert.equal(rotations.maxItems, MAX_ROTATIONS);
  assert.deepEqual(rotations.items.required, ["out", "in"]);
  const merges = JUMP_FORWARD_SCHEMA.properties.merges;
  assert.equal(merges.maxItems, MAX_MERGES);
  assert.deepEqual(merges.items.required, ["survivor", "absorbed"]);
});

test("the new declarations are optional, so a turn that omits them validates", () => {
  for (const key of ["reinforcement", "rotations", "merges"]) {
    assert.equal(JUMP_FORWARD_SCHEMA.required.includes(key), false);
  }
});
```

- [ ] **Step 2: Write the failing prompt test**

Create `src/Game/AI/reinforcementPrompt.test.js`:

```js
// Run: node --test src/Game/AI/reinforcementPrompt.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { buildForcePoolsInstructions } from "./gameplayPrompts.js";

test("the force-pool rules teach reinforcement, rotation and merging", () => {
  const text = buildForcePoolsInstructions();
  assert.match(text, /\[National Forces\]/);
  assert.match(text, /reinforcement/i);
  assert.match(text, /rotation/i);
  assert.match(text, /merge/i);
  assert.match(text, /NEXT period/i);
  assert.match(text, /state no .*number/i);
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `node --test src/Game/AI/gameplaySchemas.reinforcement.test.js`
Expected: FAIL (the fields do not exist).

Run: `node --test src/Game/AI/reinforcementPrompt.test.js`
Expected: FAIL (the paragraph is missing).

- [ ] **Step 4: Add the schema fields**

In `src/Game/AI/gameplaySchemas.js`, add the import after the `productionQueue.js` import block:

```js
import {
  MAX_MERGES,
  MAX_REINFORCEMENT,
  MAX_ROTATIONS,
  REINFORCEMENT_POLICIES,
} from "../../engine/reinforcement.js";
```

After `productionOrderSchema`, add:

```js
// The model's reinforcement declaration: a scoped policy, one per polity, from a
// closed list. Like mobilization it carries no number the model could invent and
// takes effect in the NEXT period.
const reinforcementEntrySchema = {
  type: "object",
  properties: {
    polity: { type: "string", description: "Country it applies to." },
    policy: { type: "string", enum: [...REINFORCEMENT_POLICIES], description: "Closed list; replacements default." },
  },
  required: ["polity", "policy"],
  additionalProperties: false,
};

// A rotation order names two unit ids of one polity and type: the worn one in
// the line and the fresh one that relieves it. It applies this period.
const rotationOrderSchema = {
  type: "object",
  properties: {
    out: { type: "string", description: "Unit id rotating out of the line." },
    in: { type: "string", description: "Unit id rotating forward in its place." },
  },
  required: ["out", "in"],
  additionalProperties: false,
};

// A merge order names two unit ids of one polity and type standing together: the
// survivor and the absorbed one. It applies this period.
const mergeOrderSchema = {
  type: "object",
  properties: {
    survivor: { type: "string", description: "Unit id that keeps its identity." },
    absorbed: { type: "string", description: "Unit id folded into the survivor and removed." },
  },
  required: ["survivor", "absorbed"],
  additionalProperties: false,
};
```

In `JUMP_FORWARD_SCHEMA.properties`, after the `productionOrders` entry, add:

```js
    reinforcement: {
      type: "array",
      maxItems: MAX_REINFORCEMENT,
      description:
        "Reinforcement policies for polities: a closed list, effective next period. "
        + "State no manpower/materiel numbers; the engine computes them.",
      items: reinforcementEntrySchema,
    },
    rotations: {
      type: "array",
      maxItems: MAX_ROTATIONS,
      description:
        "Rotations of two formations of one polity and type, effective this period. "
        + "Name unit ids only; the engine moves both or neither.",
      items: rotationOrderSchema,
    },
    merges: {
      type: "array",
      maxItems: MAX_MERGES,
      description:
        "Merges of two formations of one polity and type standing together, effective this period. "
        + "Name unit ids only; the engine adds the strength and removes the absorbed one.",
      items: mergeOrderSchema,
    },
```

- [ ] **Step 5: Add the prompt paragraph**

In `src/Game/AI/gameplayPrompts.js`, in `buildForcePoolsInstructions`, add this element to the `rules` array after the mobilization paragraph (the one ending `raises production at the cost of output and stability.`):

```js
    "Reserves can also rebuild a formation: under a reinforcement policy you may declare for a polity, one of "
    + "none, replacements or belligerent, every formation in supply tops itself up automatically. A policy takes "
    + "effect from the NEXT period. You may also relieve a worn formation in place by naming its id and a fresh "
    + "formation of the same type in rotations, or fold two weak formations of one type standing together into one "
    + "in merges, naming the survivor and the absorbed id. The engine owns every cost and result; state no "
    + "manpower or materiel number.",
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test src/Game/AI/gameplaySchemas.reinforcement.test.js`
Expected: PASS.

Run: `node --test src/Game/AI/reinforcementPrompt.test.js`
Expected: PASS.

Run: `node --test src/Game/AI/forcePoolsPrompt.test.js`
Expected: PASS (the earlier rules are untouched).

- [ ] **Step 7: Raise the jump-schema size guard**

The three new declarations grow the serialized jump schema past the 29,500-char
guard in `projectOpSchema.test.js`, which is a deliberate prompt-size tripwire,
not a provider limit (its comment already records each raise: the production
queue was the last). Measured in pre-flight at 30,758 chars. Raise the bound to
31,000 and extend the comment so the next reader knows what cost it:

```js
  // 29,500 -> 31,000: the reinforcement and consolidation declarations joined the
  // jump contract (the policy closed list, the rotation pair and the merge pair),
  // ~1,600 chars for three short arrays that save a second call for every turn a
  // war is being fought. Measured at 30,758; the guard is a prompt-size guard, not
  // a provider limit.
  assert.ok(jumpChars < 31000, `the jump schema grew back to ${jumpChars} chars`);
```

Run: `node --test src/Game/AI/projectOpSchema.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/Game/AI/gameplaySchemas.js src/Game/AI/gameplayPrompts.js src/Game/AI/gameplaySchemas.reinforcement.test.js src/Game/AI/reinforcementPrompt.test.js src/Game/AI/projectOpSchema.test.js
git commit -m "feat(ai): declare reinforcement policies, rotations and merges"
```

---

### Task 6: Document the layer

**Files:**
- Modify: `docs/runtime-services.md` (add a section after the `## Supply and attrition` section)

**Interfaces:**
- Consumes: nothing at runtime; written from the shipped code of Tasks 1-5.
- Produces: prose only.

- [ ] **Step 1: Add the section**

Insert the block below after the supply-and-attrition section (after the paragraph ending "no normalizer and no migration."). Keep it ASCII and match the surrounding prose style:

```markdown
## Reinforcement and rotation - `src/runtime/reinforcement.js`

`readReinforcement(world, catalog, { fromDate, toDate, rotations, merges })`
derives which in-supply formations buy their strength back this period and how a
declared rotation or merge reshapes the roster, as a pure read applied through
the turn's existing unit-op seam. It reads the supply states of part two
(`src/runtime/supplyAttrition.js`) so a formation can never be reinforced in one
layer and cut off in the other. The pure core is `src/engine/reinforcement.js`.

- **The policy** is declared per polity and takes effect from the next period,
  exactly as the mobilization posture does: the policy in force is the committed
  one (`economyEngine.reinforcement`) overridden by last turn's pending
  declaration (`economyEngine.pendingReinforcement`). `none` reinforces nobody,
  `replacements` (the default) tops up every in-supply formation weakest first,
  and `belligerent` only the formations of a polity on a side of an active war.
- **The reserve draw** buys strength at the same per-point price a battle charges
  (`UNIT_UPKEEP` times `REINFORCEMENT_POOL_FACTOR`, which a test pins to the
  combat factor). It is bounded by the period, at
  `REINFORCEMENT_RATE_PER_MONTH` points per whole month; by full strength; and by
  what the pools can afford, with the same absolute zero floor. A cut-off
  formation cannot be reinforced.
- **Rotation** moves a fresh formation into an exhausted same-type formation's
  station and the exhausted one back, as two ordinary move ops emitted from one
  validated order. Both must be in supply and on different regions; both moves
  arrive in the same turn. **Merging** folds two friend formations of one type on
  one region into one, capped at full strength, and removes the absorbed one; it
  needs no supply predicate, so an isolated pair may merge.
- **The turn** applies the ops in `applySimulationResult`, immediately after the
  supply attrition step and before the war settlements and the economy, as a
  board-only synthetic event, and charges the reserve draw through the same
  reserve-charge path the combat cost uses. A formation named by a rotation or a
  merge is not reinforced that turn.
```

- [ ] **Step 2: Verify the wiki is still current**

`public/wiki/**` is generated from `wiki/**` only, so this docs change adds no
wiki page.

Run: `npm run build:wiki`
Expected: completes; no `public/wiki/**` diff (a verified no-op).

Run: `npm run wiki:check`
Expected: `Wiki is current.`

- [ ] **Step 3: Commit**

```bash
git add docs/runtime-services.md
git commit -m "docs(runtime): record the reinforcement and rotation layer"
```

---

### Task 7: Acceptance gate

**Files:**
- No source change. This task verifies Tasks 1-6 as a whole and reports.

**Interfaces:**
- Consumes: the whole slice.
- Produces: a pass/fail report; no commit unless a gate fails and needs a fix.

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: zero failures. There are two known `todo` entries; that is expected.

- [ ] **Step 2: Run the focused groups**

Run: `node --test "src/engine/*.test.js"`
Expected: PASS, including `enginePurity.test.js`.

Run: `node --test "src/runtime/*.test.js"`
Expected: PASS, including the adapter, wiring, lag and guard tests.

- [ ] **Step 3: Lint the changed files**

Run: `npx eslint src/engine/reinforcement.js src/engine/reinforcement.test.js src/runtime/reinforcement.js src/runtime/reinforcement.test.js src/runtime/reinforcementWiringArchitecture.test.js src/runtime/reinforcementLag.test.js src/runtime/economyEngine.js src/runtime/gameState.js src/Game/AI/gameplay.js src/Game/AI/gameplaySchemas.js src/Game/AI/gameplayPrompts.js src/Game/AI/gameplaySchemas.reinforcement.test.js src/Game/AI/reinforcementPrompt.test.js`
Expected: 0 errors. Pre-existing warnings in `gameplay.js` unrelated to this change are acceptable; report them if present.

- [ ] **Step 4: Build and wiki currency**

Run: `npm run build`
Expected: exit 0.

Run: `npm run wiki:check`
Expected: `Wiki is current.`

- [ ] **Step 5: Verify the slice**

Confirm each of the following and report the evidence:

- The task commits are present in order: `feat(engine): derive reinforcement, rotation and merge from the roster`, `feat(runtime): read reinforcement and consolidation from the world`, `feat(runtime): lag and store the reinforcement policy`, `feat(runtime): apply reinforcement and consolidation in the turn`, `feat(ai): declare reinforcement policies, rotations and merges`, `docs(runtime): record the reinforcement and rotation layer`.
- Every slice commit carries the `Co-authored-by: monkeycode-ai` trailer added by the hook.
- No `ENGINE_VERSION` bump and no `package.json` change: `git diff <base>..HEAD -- src/runtime/economyEngine.js package.json` shows no `ENGINE_VERSION` line change and no `package.json` entry.
- `src/engine/reinforcement.js` imports exactly `./forcePools.js` and `./economyMath.js`.
- `src/runtime/reinforcement.js` contains no `Game/AI` reference.
- The only new `world.economyEngine` fields are `reinforcement` and `pendingReinforcement`.

- [ ] **Step 6: Report**

Write a short pass/fail report to `.superpowers/sdd/slice-7c-gate.md` (the ignored SDD directory, so the gate adds no slice commit) with the exact commands, counts and any pre-existing warnings. Do not commit this report.
