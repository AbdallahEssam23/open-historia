# Combat Engagements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a narrated battle belongs to an active canonical war and names its region, the engine deterministically computes the casualties, spends the reserves and decides whether the province changes hands.

**Architecture:** A new import-free pure core `src/engine/combat.js` turns a neutral engagement description (two sides of units, their postures, the controller) into casualties, a winner and a control decision. A new runtime adapter `src/runtime/combatEngagements.js` gathers the two sides from `world.units` on the declared region, calls the core, converts the result into the existing `unitOps`/`regionControlOps` vocabulary and a reserve cost. The turn applies those ops through the same doors every narrated op uses and charges the reserve record afterwards. The model declares the WHAT; the engine owns every number.

**Tech Stack:** ES modules, `node --test`, no framework, no new dependency.

## Global Constraints

- ASCII only in source and docs. No emoji, no em dash, no middle dot.
- No new `package.json` entry and no new runtime dependency.
- `src/engine/**` must stay free of browser globals and of imports outside the allow list: no `window`, `document`, `localStorage`, `Date.now`, `new Date`, `Math.random`, `fetch`. `src/engine/enginePurity.test.js` enforces this over the whole directory. `src/engine/combat.js` must import nothing at all.
- Every engine function changed here gains an optional argument whose default reproduces current behavior exactly. Do not edit an existing test to accommodate a change.
- Tests are run with a glob, never a bare directory: `node --test "src/engine/*.test.js"`.
- Commit messages are conventional and do NOT include the `Co-authored-by:` trailer. The `prepare-commit-msg` hook adds it.
- `public/wiki/**` is generated and committed. Its source is `wiki/` (not `docs/wiki/`). Regenerate with `npm run build:wiki`; verify with `npm run wiki:check`, which must print exactly `Wiki is current.`.
- The jump schema/prompt character budget stays under 29500 (`src/Game/AI/projectOpSchema.test.js`). The measured value before this increment is 29154, so the new field and rule together must add fewer than about 340 characters; trim redundant wording if the guard fails.
- The spec for this plan is `docs/specs/2026-10-02-combat-engagements-design.md`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/engine/combat.js` (new) | The pure engagement model: weights, multipliers, jitter, losses, destruction, control threshold. |
| `src/runtime/combatEngagements.js` (new) | Gather the two sides, call the core, map the result to ops and a reserve cost, charge the reserves. |
| `src/Game/AI/combatRegionResolution.js` (new) | Canonicalize a declared region name or id to a region id present in the compact catalog. |
| `src/runtime/gameState.js` | `normalizeEventEntry` learns `combatRegion`. |
| `src/Game/AI/gameplaySchemas.js` | The event schema offers `combatRegion`. |
| `src/Game/AI/gameplayPrompts.js` | The jump prompt asks for `combatRegion` on a battle. |
| `src/Game/AI/gameplay.js` | Canonicalize `combatRegion`; run the adapter over the turn; merge its ops; drop the model's numeric and territory claims; charge the reserves; write the receipt line. |
| `docs/world-state.md`, `docs/runtime-services.md`, `wiki/systems/projects.md` | Document the new event field and the resolution rule. |

---

### Task 1: The engagement core

**Files:**
- Create: `src/engine/combat.js`
- Test: `src/engine/combat.test.js`

**Interfaces:**
- Consumes: nothing. This file imports nothing.
- Produces:
  - `UNIT_COMBAT_WEIGHT: { garrison, infantry, artillery, armor, air, naval }`
  - `MOBILIZATION_COMBAT_MULTIPLIER: { demobilized, peacetime, partial, total }`
  - `COMBAT_LOSS_BASE = 0.35`, `COMBAT_LOSS_MIN = 0.03`, `COMBAT_LOSS_MAX = 0.45`
  - `COMBAT_JITTER_MIN = 0.85`, `COMBAT_JITTER_SPAN = 0.3`
  - `UNIT_DESTRUCTION_THRESHOLD = 15`, `CONTROL_THRESHOLD = 0.4`
  - `engagementRoll(key) -> number` in `[0, 1)`
  - `unitCombatPower(unit) -> number`
  - `mobilizationCombatMultiplier(posture) -> number`
  - `combatLossFraction(shareOpponent) -> number`
  - `engagementWinner(adjustedA, adjustedB, defenderSide) -> "a" | "b"`
  - `resolveEngagement({ warId, regionId, date, round, sideA, sideB, controllerPolity }) -> result`

  A side is `[{ polity, posture, units: [{ id, type, strength }] }]`. The result
  is:

  ```
  {
    key,
    winner: "a" | "b",
    defenderSide: "a" | "b" | "",
    controlChange: { toCode } | null,
    sideA: { power, adjustedPower, lossFraction, units: [unitResult] },
    sideB: { power, adjustedPower, lossFraction, units: [unitResult] },
    casualties: [{ unitId, polity, type, lostPoints, destroyed }],
  }
  ```

  A `unitResult` is `{ id, polity, type, strength, nextStrength, lostPoints,
  destroyed }`. `casualties` is the flat list of every `unitResult` with
  `lostPoints > 0`, annotated with `unitId` instead of `id`.

- [ ] **Step 1: Write the failing test**

Create `src/engine/combat.test.js`:

```js
// Run: node --test src/engine/combat.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  COMBAT_LOSS_MAX,
  COMBAT_LOSS_MIN,
  CONTROL_THRESHOLD,
  MOBILIZATION_COMBAT_MULTIPLIER,
  UNIT_COMBAT_WEIGHT,
  UNIT_DESTRUCTION_THRESHOLD,
  combatLossFraction,
  engagementRoll,
  engagementWinner,
  mobilizationCombatMultiplier,
  resolveEngagement,
  unitCombatPower,
} from "./combat.js";

const side = (polity, posture, units) => ({ polity, posture, units });
const unit = (id, type, strength) => ({ id, type, strength });

test("every unit type has a weight and heavier types weigh more", () => {
  const order = ["garrison", "infantry", "artillery", "armor", "air", "naval"];
  for (const type of order) assert.equal(typeof UNIT_COMBAT_WEIGHT[type], "number", type);
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(UNIT_COMBAT_WEIGHT[order[i]] >= UNIT_COMBAT_WEIGHT[order[i - 1]], order[i]);
  }
});

test("every posture has a multiplier and peacetime is the identity", () => {
  for (const posture of ["demobilized", "peacetime", "partial", "total"]) {
    assert.equal(typeof MOBILIZATION_COMBAT_MULTIPLIER[posture], "number", posture);
  }
  assert.equal(mobilizationCombatMultiplier("peacetime"), 1);
  assert.equal(mobilizationCombatMultiplier("unknown"), 1);
});

test("unit power is the type weight scaled by strength", () => {
  assert.equal(unitCombatPower(unit("u1", "infantry", 100)), 1);
  assert.equal(unitCombatPower(unit("u2", "armor", 50)), UNIT_COMBAT_WEIGHT.armor * 0.5);
  assert.equal(unitCombatPower(unit("u3", "psionics", 100)), UNIT_COMBAT_WEIGHT.infantry);
});

test("the roll is stable for a key and differs across keys", () => {
  const a = engagementRoll("war-x|alsace|1870-07-19|12");
  assert.equal(a, engagementRoll("war-x|alsace|1870-07-19|12"));
  assert.notEqual(a, engagementRoll("war-x|alsace|1870-07-19|13"));
  assert.ok(a >= 0 && a < 1);
});

test("the same engagement key always yields the same adjusted powers", () => {
  const input = {
    warId: "war-a-b", regionId: "alsace", date: "1870-07-19", round: 3,
    controllerPolity: "France",
    sideA: [side("France", "peacetime", [unit("f1", "infantry", 80)])],
    sideB: [side("Prussia", "partial", [unit("p1", "infantry", 80)])],
  };
  const first = resolveEngagement(input);
  const second = resolveEngagement(input);
  assert.deepEqual(first, second);
});

test("a tie is held by the defender, and by the first side with none", () => {
  assert.equal(engagementWinner(2, 1, "b"), "a");
  assert.equal(engagementWinner(1, 2, "a"), "b");
  assert.equal(engagementWinner(1, 1, "b"), "b");
  assert.equal(engagementWinner(1, 1, ""), "a");
});

test("the loss fraction is bounded and larger for the weaker side", () => {
  assert.equal(combatLossFraction(0), COMBAT_LOSS_MIN);
  assert.equal(combatLossFraction(1), COMBAT_LOSS_MAX);
  assert.ok(combatLossFraction(0.9) > combatLossFraction(0.1));
});

test("a broken loser is destroyed and a winner at the same strength is not", () => {
  const result = resolveEngagement({
    warId: "war-a-b", regionId: "alsace", date: "1870-07-19", round: 0,
    controllerPolity: "France",
    // An overwhelming attacker makes the defender's loss fraction hit the cap.
    sideA: [side("Prussia", "total", [unit("p1", "armor", 100), unit("p2", "armor", 100)])],
    sideB: [side("France", "demobilized", [unit("f1", "garrison", 20)])],
  });
  const defender = result.sideB.units[0];
  assert.ok(defender.nextStrength < UNIT_DESTRUCTION_THRESHOLD);
  assert.equal(defender.destroyed, true);
  const winner = result.sideA.units[0];
  assert.ok(winner.nextStrength >= 1);
  assert.equal(winner.destroyed, false);
});

test("control changes only when the attacker wins and the defender breaks", () => {
  const result = resolveEngagement({
    warId: "war-a-b", regionId: "alsace", date: "1870-07-19", round: 0,
    controllerPolity: "France",
    sideA: [side("Prussia", "total", [unit("p1", "armor", 100), unit("p2", "armor", 100)])],
    sideB: [side("France", "demobilized", [unit("f1", "garrison", 20)])],
  });
  assert.equal(result.winner, "a");
  assert.equal(result.defenderSide, "b");
  assert.ok(result.sideB.adjustedPower / (result.sideA.adjustedPower + result.sideB.adjustedPower) < CONTROL_THRESHOLD);
  assert.deepEqual(result.controlChange, { toCode: "Prussia" });
});

test("a controller that is not a belligerent forbids a control change", () => {
  const result = resolveEngagement({
    warId: "war-a-b", regionId: "alsace", date: "1870-07-19", round: 0,
    controllerPolity: "Switzerland",
    sideA: [side("Prussia", "total", [unit("p1", "armor", 100), unit("p2", "armor", 100)])],
    sideB: [side("France", "demobilized", [unit("f1", "garrison", 20)])],
  });
  assert.equal(result.defenderSide, "");
  assert.equal(result.controlChange, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/engine/combat.test.js`
Expected: FAIL with "Cannot find module" or "resolveEngagement is not defined".

- [ ] **Step 3: Write the implementation**

Create `src/engine/combat.js`:

```js
// Open Historia - the deterministic engagement core (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// One declared battle, resolved. The model says who fights, where and why; this
// module is the only place that turns that into numbers. It imports nothing:
// the force-pool table it is calibrated against lives in forcePools.js, but the
// casualty-to-reserve mapping is the adapter's job, so this core stays
// importable by a bare node --test.

// How much a formation of this type is worth per point of strength. Ordered so
// heavier formations weigh more; first-draft calibration, and the tests assert
// the ordering, never a magnitude.
export const UNIT_COMBAT_WEIGHT = Object.freeze({
  garrison: 0.4,
  infantry: 1.0,
  artillery: 1.2,
  armor: 1.6,
  air: 2.0,
  naval: 2.2,
});

// A mobilized economy also fights better, but this is a separate table from
// forcePools' extraction effects: the two are different quantities.
export const MOBILIZATION_COMBAT_MULTIPLIER = Object.freeze({
  demobilized: 0.75,
  peacetime: 1.0,
  partial: 1.25,
  total: 1.5,
});

export const COMBAT_LOSS_BASE = 0.35;
export const COMBAT_LOSS_MIN = 0.03;
export const COMBAT_LOSS_MAX = 0.45;
export const COMBAT_JITTER_MIN = 0.85;
export const COMBAT_JITTER_SPAN = 0.3;
export const UNIT_DESTRUCTION_THRESHOLD = 15;
export const CONTROL_THRESHOLD = 0.4;

const name = (value) => String(value ?? "").trim();
const foldKey = (value) => name(value).toLocaleLowerCase();

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// FNV-1a over a string, mapped to [0, 1). The same algorithm runtime/spycraft.js
// uses, so a replay is consistent across the two systems; the engine may not
// import a runtime module, so the hash is repeated here on purpose.
export const engagementRoll = (key) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0) / 0x100000000;
};

export const unitCombatPower = (unit) => {
  const weight = UNIT_COMBAT_WEIGHT[name(unit?.type)] ?? UNIT_COMBAT_WEIGHT.infantry;
  const strength = clamp(Number(unit?.strength) || 0, 0, 100);
  return weight * (strength / 100);
};

export const mobilizationCombatMultiplier = (posture) =>
  MOBILIZATION_COMBAT_MULTIPLIER[name(posture)] ?? MOBILIZATION_COMBAT_MULTIPLIER.peacetime;

// How much of its strength a side loses, as a function of the OPPONENT's share
// of the adjusted power. The weaker side pays more; both pay something.
export const combatLossFraction = (shareOpponent) =>
  clamp(COMBAT_LOSS_BASE * (Number(shareOpponent) || 0), COMBAT_LOSS_MIN, COMBAT_LOSS_MAX);

// The side with the larger adjusted power wins; an exact tie is held by the
// defender, or by side A when no defender could be identified.
export const engagementWinner = (adjustedA, adjustedB, defenderSide = "") => {
  if (adjustedA > adjustedB) return "a";
  if (adjustedB > adjustedA) return "b";
  return defenderSide || "a";
};

const sideHasPolity = (side, polity) =>
  Boolean(polity) && side.some((entry) => foldKey(entry?.polity) === foldKey(polity));

// The first polity of a side that actually has units on the field, in the side's
// declared order, so the new controller is deterministic.
const leadingPolity = (side) => {
  for (const entry of side) {
    if (Array.isArray(entry?.units) && entry.units.length > 0) return name(entry.polity);
  }
  return "";
};

const scoreSide = (side) => {
  let power = 0;
  for (const entry of side) {
    const multiplier = mobilizationCombatMultiplier(entry?.posture);
    for (const unit of entry?.units ?? []) power += unitCombatPower(unit) * multiplier;
  }
  return power;
};

const applyLosses = ({ side, lossFraction, destroyed }) => {
  const units = [];
  const casualties = [];
  for (const entry of side) {
    for (const unit of entry?.units ?? []) {
      const strength = clamp(Number(unit?.strength) || 0, 0, 100);
      let nextStrength = clamp(Math.round(strength * (1 - lossFraction)), 1, 100);
      let isDestroyed = false;
      if (destroyed && nextStrength < UNIT_DESTRUCTION_THRESHOLD) {
        isDestroyed = true;
        nextStrength = 0;
      }
      const lostPoints = strength - nextStrength;
      const result = {
        id: name(unit?.id),
        polity: name(entry?.polity),
        type: name(unit?.type) || "infantry",
        strength,
        nextStrength,
        lostPoints,
        destroyed: isDestroyed,
      };
      units.push(result);
      if (lostPoints > 0) casualties.push({ ...result, unitId: result.id });
    }
  }
  return { units, casualties };
};

export const resolveEngagement = ({
  warId = "",
  regionId = "",
  date = "",
  round = 0,
  sideA = [],
  sideB = [],
  controllerPolity = "",
} = {}) => {
  const key = `${name(warId)}|${name(regionId)}|${name(date)}|${Number(round) || 0}`;
  const powerA = scoreSide(sideA);
  const powerB = scoreSide(sideB);
  const adjustedA = powerA * (COMBAT_JITTER_MIN + COMBAT_JITTER_SPAN * engagementRoll(`${key}|a`));
  const adjustedB = powerB * (COMBAT_JITTER_MIN + COMBAT_JITTER_SPAN * engagementRoll(`${key}|b`));
  const total = adjustedA + adjustedB;

  const defenderSide = sideHasPolity(sideA, controllerPolity)
    ? "a"
    : sideHasPolity(sideB, controllerPolity) ? "b" : "";
  const attackerSide = defenderSide === "a" ? "b" : defenderSide === "b" ? "a" : "";

  const winner = engagementWinner(adjustedA, adjustedB, defenderSide);

  const shareA = total > 0 ? adjustedA / total : 0.5;
  const shareB = total > 0 ? adjustedB / total : 0.5;
  const lossA = combatLossFraction(shareB);
  const lossB = combatLossFraction(shareA);

  const a = applyLosses({ side: sideA, lossFraction: lossA, destroyed: winner !== "a" });
  const b = applyLosses({ side: sideB, lossFraction: lossB, destroyed: winner !== "b" });

  let controlChange = null;
  if (defenderSide && attackerSide && winner === attackerSide) {
    const defenderShare = defenderSide === "a" ? shareA : shareB;
    if (defenderShare < CONTROL_THRESHOLD) {
      const toCode = leadingPolity(winner === "a" ? sideA : sideB);
      if (toCode) controlChange = { toCode };
    }
  }

  return {
    key,
    winner,
    defenderSide,
    controlChange,
    sideA: { power: powerA, adjustedPower: adjustedA, lossFraction: lossA, units: a.units },
    sideB: { power: powerB, adjustedPower: adjustedB, lossFraction: lossB, units: b.units },
    casualties: [...a.casualties, ...b.casualties],
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/engine/combat.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Run the whole engine suite and the purity guard**

Run: `node --test "src/engine/*.test.js"`
Expected: PASS, including `enginePurity.test.js`, which now also scans `combat.js`.

- [ ] **Step 6: Commit**

```bash
git add src/engine/combat.js src/engine/combat.test.js
git commit -m "feat(engine): add the deterministic engagement core"
```

---

### Task 2: The engagement adapter

**Files:**
- Create: `src/runtime/combatEngagements.js`
- Test: `src/runtime/combatEngagements.test.js`

**Interfaces:**
- Consumes: `resolveEngagement` from `../engine/combat.js`; `UNIT_UPKEEP`, `normalizePools` from `../engine/forcePools.js`; `roundTo` from `../engine/economyMath.js`; `normalizeWorldState`, `applyCountryStatPatchToWorld` from `./gameState.js`; `toCountryName` from `./ownerNames.js`.
- Produces:
  - `COMBAT_POOL_FACTOR = 10`
  - `buildEngagement(event, world, { round }) -> input | null`
  - `resolveEventEngagements(events, world, { round }) -> { results, reserveCost, unresolved }`
  - `mergeEngagementResults(events, results) -> number` (the count of events whose claims were replaced)
  - `applyCombatReserveCost(world, reserveCost) -> world`

  `results` is `[{ eventIndex, unitOps, regionControlOps, controlRegionId,
  controlToCode, casualtyCount, destroyedCount, winner }, ...]` for the events
  that resolved. `reserveCost` is `{ [polity]: { manpower, materiel } }`.
  `unresolved` is `[{ eventIndex, reason }]`.

- [ ] **Step 1: Write the failing test**

Create `src/runtime/combatEngagements.test.js`:

```js
// Run: node --test src/runtime/combatEngagements.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  COMBAT_POOL_FACTOR,
  applyCombatReserveCost,
  mergeEngagementResults,
  resolveEventEngagements,
} from "./combatEngagements.js";

const world = () => ({
  wars: [{
    id: "war-prussia-france-18700719",
    status: "active",
    sideA: ["Prussia"],
    sideB: ["France"],
  }],
  units: [
    { id: "p1", ownerCode: "Prussia", type: "armor", strength: 100, regionId: "ALSACE" },
    { id: "p2", ownerCode: "Prussia", type: "armor", strength: 100, regionId: "ALSACE" },
    { id: "f1", ownerCode: "France", type: "garrison", strength: 20, regionId: "ALSACE" },
    { id: "f2", ownerCode: "France", type: "infantry", strength: 100, regionId: "LORRAINE" },
  ],
  economyEngine: { mobilization: { Prussia: "total", France: "demobilized" } },
  regionOwnershipOverrides: { ALSACE: "France" },
  countryStats: { France: { forces: { manpower: 500, materiel: 20, mobilization: "demobilized" } } },
});

const battle = () => ({
  id: "e1",
  warId: "war-prussia-france-18700719",
  combatants: ["Prussia", "France"],
  combatRegion: "ALSACE",
  date: "1870-07-19",
});

test("a battle resolves into unit ops and a control op", () => {
  const out = resolveEventEngagements([battle()], world(), { round: 7 });
  assert.equal(out.unresolved.length, 0);
  assert.equal(out.results.length, 1);
  const result = out.results[0];
  assert.equal(result.eventIndex, 0);
  assert.ok(result.unitOps.some((op) => op.unitId === "f1"));
  assert.equal(result.controlRegionId, "ALSACE");
  assert.equal(result.controlToCode, "Prussia");
  assert.deepEqual(result.regionControlOps, [{
    op: "control",
    regionId: "ALSACE",
    fromCode: "France",
    toCode: "Prussia",
    note: "engine-resolved engagement",
  }]);
});

test("a unit outside the region never fights", () => {
  const out = resolveEventEngagements([battle()], world(), { round: 7 });
  const ids = out.results[0].unitOps.map((op) => op.unitId);
  assert.equal(ids.includes("f2"), false);
});

test("a side with no unit in the region resolves nothing", () => {
  const w = world();
  w.units = w.units.filter((unit) => unit.ownerCode !== "France");
  const out = resolveEventEngagements([battle()], w, { round: 7 });
  assert.equal(out.results.length, 0);
  assert.equal(out.unresolved.length, 1);
  assert.match(out.unresolved[0].reason, /France/);
});

test("the reserve cost is charged to the owner and is floored at zero", () => {
  const w = world();
  w.countryStats.France.forces.manpower = 0;
  const out = resolveEventEngagements([battle()], w, { round: 7 });
  assert.ok(out.reserveCost.Prussia.manpower > 0);
  assert.ok(out.reserveCost.France.materiel > 0);
  assert.equal(COMBAT_POOL_FACTOR, 10);
  const charged = applyCombatReserveCost(w, out.reserveCost);
  assert.equal(charged.economyEngine.pools.France.manpower, 0);
  assert.equal(charged.countryStats.France.forces.manpower, 0);
});

test("the same battle key resolves byte for byte the same twice", () => {
  const a = resolveEventEngagements([battle()], world(), { round: 7 });
  const b = resolveEventEngagements([battle()], world(), { round: 7 });
  assert.deepEqual(a.results, b.results);
  assert.deepEqual(a.reserveCost, b.reserveCost);
});

test("merging replaces the model's numbers and its claim on the region", () => {
  const event = {
    ...battle(),
    impacts: {
      unitOps: [
        { op: "move", unitId: "p1", toLng: 1, toLat: 1 },
        { op: "strength", unitId: "f1", strength: 99 },
      ],
      regionControlOps: [{ op: "control", regionId: "ALSACE", fromCode: "France", toCode: "France" }],
      regionTransfers: [{ regionId: "ALSACE", toCode: "France" }],
    },
  };
  const out = resolveEventEngagements([event], world(), { round: 7 });
  const merged = mergeEngagementResults([event], out.results);
  assert.equal(merged, 1);
  assert.ok(event.impacts.unitOps.some((op) => op.op === "move" && op.unitId === "p1"), "the move is kept");
  assert.equal(event.impacts.unitOps.some((op) => op.op === "strength" && op.unitId === "f1"), false, "the model's strength op is dropped");
  assert.equal(event.impacts.regionTransfers.length, 0, "the model's claim on the region is dropped");
  assert.deepEqual(event.impacts.regionControlOps, out.results[0].regionControlOps);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/runtime/combatEngagements.test.js`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

Create `src/runtime/combatEngagements.js`:

```js
// Open Historia - the engagement adapter (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// Gathers the two sides of a declared battle from the roster, calls the pure
// core, and translates the result into the ops the turn already knows how to
// apply plus the reserve cost of the losses. Never touches the map.

import { resolveEngagement } from "../engine/combat.js";
import { UNIT_UPKEEP, normalizePools } from "../engine/forcePools.js";
import { roundTo } from "../engine/economyMath.js";
import { applyCountryStatPatchToWorld, normalizeWorldState } from "./gameState.js";
import { toCountryName } from "./ownerNames.js";

// One strength point is this many months of the formation's upkeep, as a
// one-shot battle cost. First-draft calibration.
export const COMBAT_POOL_FACTOR = 10;

const name = (value) => String(value ?? "").trim();
const foldKey = (value) => name(value).toLocaleLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

const ownerOf = (unit) => toCountryName(name(unit?.ownerCode)) || name(unit?.ownerCode);

// Build the neutral engagement description, or null when the event is not a
// resolvable declaration (no war, no active war, no region, or a side absent
// from the field is left to the caller as an unresolved note).
export const buildEngagement = (event, world, { round = 0 } = {}) => {
  const warId = name(event?.warId);
  const regionId = name(event?.combatRegion);
  if (!warId || !regionId) return null;
  const war = list(world?.wars).find(
    (entry) => name(entry?.id) === warId && name(entry?.status).toLowerCase() === "active",
  );
  if (!war) return null;

  const sideAKeys = new Set(list(war.sideA).map(foldKey));
  const sideBKeys = new Set(list(war.sideB).map(foldKey));
  const posture = {};
  for (const [polity, value] of Object.entries(world?.economyEngine?.mobilization ?? {})) {
    posture[toCountryName(name(polity)) || name(polity)] = name(value) || "peacetime";
  }

  const bucketA = new Map();
  const bucketB = new Map();
  for (const unit of list(world?.units)) {
    if (name(unit?.regionId) !== regionId) continue;
    const owner = ownerOf(unit);
    const bucket = sideAKeys.has(foldKey(owner)) ? bucketA : sideBKeys.has(foldKey(owner)) ? bucketB : null;
    if (!bucket) continue;
    if (!bucket.has(owner)) bucket.set(owner, []);
    bucket.get(owner).push({
      id: name(unit?.id),
      type: name(unit?.type) || "infantry",
      strength: Number(unit?.strength) || 0,
    });
  }

  const toSide = (bucket) =>
    [...bucket.entries()].map(([polity, units]) => ({ polity, posture: posture[polity] || "peacetime", units }));

  // The caller passes an already-normalized world (the turn's baseWorldNormalized),
  // so the override reads directly rather than re-normalizing per event.
  const override = world?.regionOwnershipOverrides?.[regionId];
  const controllerPolity = toCountryName(name(override)) || name(override);

  return {
    warId,
    regionId,
    date: name(event?.date),
    round: Number(round) || 0,
    controllerPolity,
    sideA: toSide(bucketA),
    sideB: toSide(bucketB),
  };
};

const casualtyOps = (casualties) => casualties.map((entry) => (
  entry.destroyed
    ? { op: "remove", unitId: entry.unitId }
    : { op: "strength", unitId: entry.unitId, strength: entry.nextStrength }
));

const addCost = (reserveCost, polity, type, lostPoints) => {
  const upkeep = UNIT_UPKEEP[type] ?? UNIT_UPKEEP.infantry;
  const row = reserveCost[polity] ?? { manpower: 0, materiel: 0 };
  row.manpower += upkeep.manpower * (lostPoints / 100) * COMBAT_POOL_FACTOR;
  row.materiel += upkeep.materiel * (lostPoints / 100) * COMBAT_POOL_FACTOR;
  reserveCost[polity] = row;
};

// Resolve every declared battle in a turn. Reads the world it is given and
// returns ops and a cost; it never mutates the world.
export const resolveEventEngagements = (events, world, { round = 0 } = {}) => {
  const results = [];
  const unresolved = [];
  const reserveCost = {};

  list(events).forEach((event, eventIndex) => {
    const input = buildEngagement(event, world, { round });
    if (!input) return;
    if (input.sideA.length === 0 || input.sideB.length === 0) {
      const absent = input.sideA.length === 0 ? input.sideB : input.sideA;
      unresolved.push({
        eventIndex,
        reason: `no units in ${input.regionId} for ${absent.map((entry) => entry.polity).join(", ")}`,
      });
      return;
    }

    const outcome = resolveEngagement(input);
    for (const casualty of outcome.casualties) {
      addCost(reserveCost, casualty.polity, casualty.type, casualty.lostPoints);
    }
    const controlOps = outcome.controlChange
      ? [{
        op: "control",
        regionId: input.regionId,
        fromCode: input.controllerPolity,
        toCode: outcome.controlChange.toCode,
        note: "engine-resolved engagement",
      }]
      : [];
    results.push({
      eventIndex,
      unitOps: casualtyOps(outcome.casualties),
      regionControlOps: controlOps,
      controlRegionId: input.regionId,
      controlToCode: outcome.controlChange?.toCode ?? "",
      casualtyCount: outcome.casualties.length,
      destroyedCount: outcome.casualties.filter((entry) => entry.destroyed).length,
      winner: outcome.winner,
    });
  });

  const rounded = {};
  for (const [polity, row] of Object.entries(reserveCost)) {
    rounded[polity] = {
      manpower: Math.round(row.manpower),
      materiel: roundTo(row.materiel, 2),
    };
  }
  return { results, reserveCost: rounded, unresolved };
};

// Replace the model's own numbers and its claim on the contested region with the
// engine's result, in place. The model keeps its moves and spawns. Returns how
// many events were rewritten so the caller can report it.
export const mergeEngagementResults = (events, results) => {
  let merged = 0;
  for (const result of list(results)) {
    const event = events?.[result.eventIndex];
    if (!event || typeof event !== "object") continue;
    const impacts = event.impacts && typeof event.impacts === "object"
      ? event.impacts
      : (event.impacts = {});
    impacts.unitOps = list(impacts.unitOps).filter(
      (op) => !["strength", "remove"].includes(name(op?.op).toLowerCase()),
    );
    impacts.regionControlOps = list(impacts.regionControlOps).filter(
      (op) => name(op?.regionId) !== result.controlRegionId,
    );
    impacts.regionTransfers = list(impacts.regionTransfers).filter(
      (op) => name(op?.regionId) !== result.controlRegionId,
    );
    impacts.unitOps.push(...result.unitOps);
    impacts.regionControlOps.push(...result.regionControlOps);
    merged += 1;
  }
  return merged;
};

// Charge a battle's losses to the reserves with the absolute zero floor, and
// refresh the forces mirror so the panel shows the post-battle reserve now.
export const applyCombatReserveCost = (world, reserveCost) => {
  if (!reserveCost || Object.keys(reserveCost).length === 0) return world;
  const next = normalizeWorldState(world);
  const pools = normalizePools(next.economyEngine?.pools);
  for (const [polity, cost] of Object.entries(reserveCost)) {
    const prior = pools[polity] ?? { manpower: 0, materiel: 0 };
    pools[polity] = {
      manpower: Math.max(0, Math.round((prior.manpower ?? 0) - (cost.manpower ?? 0))),
      materiel: Math.max(0, roundTo((prior.materiel ?? 0) - (cost.materiel ?? 0), 2)),
    };
  }
  const withPools = {
    ...next,
    economyEngine: { ...(next.economyEngine ?? {}), pools },
  };
  for (const polity of Object.keys(reserveCost)) {
    // next is already normalized; each polity's sheet is independent, so read it
    // once instead of re-normalizing the whole world per polity.
    const sheet = next.countryStats?.[polity]?.forces ?? {};
    applyCountryStatPatchToWorld(withPools, polity, {
      forces: {
        manpower: pools[polity].manpower,
        materiel: pools[polity].materiel,
        mobilization: sheet.mobilization ?? "peacetime",
        ...(sheet.shortfall ? { shortfall: sheet.shortfall } : {}),
      },
    }, { replaceComponents: true, engineSourced: true });
  }
  return withPools;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/runtime/combatEngagements.test.js`
Expected: PASS.

- [ ] **Step 5: Run the runtime suite**

Run: `node --test "src/runtime/*.test.js"`
Expected: PASS, no regression.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/combatEngagements.js src/runtime/combatEngagements.test.js
git commit -m "feat(runtime): add the engagement adapter and reserve cost"
```

---

### Task 3: Persist `combatRegion` on the event

**Files:**
- Modify: `src/runtime/gameState.js` (`normalizeEventEntry`, near line 3097)
- Modify: `src/Game/AI/gameplaySchemas.js` (event schema, near line 946)
- Test: `src/runtime/gameState.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: an event whose `combatRegion` is a trimmed string, default `""`, surviving `normalizeEventEntry` and `normalizeEvents`.

- [ ] **Step 1: Write the failing test**

Add to `src/runtime/gameState.test.js`:

```js
test("an event keeps its combatRegion and defaults it to empty", () => {
  const withRegion = normalizeEventEntry({
    title: "Battle of Alsace",
    date: "1870-07-19",
    warId: "war-x",
    combatants: ["Prussia", "France"],
    combatRegion: "  ALSACE  ",
  }, 0);
  assert.equal(withRegion.combatRegion, "ALSACE");

  const without = normalizeEventEntry({ title: "A quiet year", date: "1870-01-01" }, 0);
  assert.equal(without.combatRegion, "");
});
```

Confirm the test file already imports `normalizeEventEntry`; if not, add it to
the import list at the top.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/runtime/gameState.test.js`
Expected: FAIL, `combatRegion` is `undefined`.

- [ ] **Step 3: Write the implementation**

In `src/runtime/gameState.js`, in `normalizeEventEntry`, immediately after the
`combatants` block (around line 3102), add:

```js
    // The region a declared battle is fought in. Optional on every event, but
    // required for the engine to resolve an engagement; absent means the event
    // stays narrative (runtime/combatEngagements.js).
    combatRegion: normalizeOptionalString(entry.combatRegion),
```

Also add the empty-event branch (around line 3062, beside `warId`/`combatants`):

```js
      combatRegion: "",
```

In `src/Game/AI/gameplaySchemas.js`, in the event schema properties, after the
`combatants` block (around line 952), add:

```js
    combatRegion: textSchema(
      "For actual battlefield combat, the region (name or id) where the battle is fought. Required for the engine to resolve the engagement.",
    ),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/runtime/gameState.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/gameState.js src/Game/AI/gameplaySchemas.js src/runtime/gameState.test.js
git commit -m "feat(runtime): persist the combat region on an event"
```

---

### Task 4: Canonicalize `combatRegion` to a region id

**Files:**
- Create: `src/Game/AI/combatRegionResolution.js`
- Create: `src/Game/AI/combatRegionResolution.test.js`
- Modify: `src/Game/AI/gameplay.js` (import the helper and call it in the validation pass after line 5794)

**Interfaces:**
- Consumes: `foldRegionKey` from `./regionMatch.js`.
- Produces: `resolveCombatRegionIds(containers, catalog) -> { resolved: number, dropped: number }`, and a payload whose every event `combatRegion` is either a canonical region id present in the catalog or `""`.

The helper lives in its own browser-free module because `src/Game/AI/gameplay.js`
imports `./main.jsx` at module load, so no `node --test` file can import
gameplay.js directly. The catalog is passed in; `gameplay.js` supplies the
compact scenario catalog that `resolveRegionTransfers` /
`resolveRegionControlOps` prime in the same validation pass (see
`primeCustomRegionCatalog` at gameplay.js:4395).

- [ ] **Step 1: Write the failing test**

Create `src/Game/AI/combatRegionResolution.test.js`:

```js
// Run: node --test src/Game/AI/combatRegionResolution.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { resolveCombatRegionIds } from "./combatRegionResolution.js";

const catalog = () => [{ id: "ALSACE", name: "Alsace" }];

test("a combatRegion that is already a known id is kept", () => {
  const containers = [{ impacts: null, events: [{ combatRegion: "ALSACE" }] }];
  const out = resolveCombatRegionIds(containers, catalog());
  assert.equal(containers[0].events[0].combatRegion, "ALSACE");
  assert.equal(out.resolved, 1);
  assert.equal(out.dropped, 0);
});

test("a combatRegion that matches a name resolves to its id", () => {
  const containers = [{ impacts: null, events: [{ combatRegion: "alsace" }] }];
  const out = resolveCombatRegionIds(containers, catalog());
  assert.equal(containers[0].events[0].combatRegion, "ALSACE");
  assert.equal(out.resolved, 1);
});

test("a combatRegion that matches nothing is dropped to an empty string", () => {
  const containers = [{ impacts: null, events: [{ combatRegion: "Atlantis" }] }];
  const out = resolveCombatRegionIds(containers, catalog());
  assert.equal(containers[0].events[0].combatRegion, "");
  assert.equal(out.dropped, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/Game/AI/combatRegionResolution.test.js`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

Create `src/Game/AI/combatRegionResolution.js`:

```js
// Open Historia - canonicalize a declared combat region (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// Kept out of gameplay.js so a bare `node --test` can import it: gameplay.js
// pulls in ./main.jsx at module load, which node cannot parse. Pure: the catalog
// is passed in.

import { foldRegionKey } from "./regionMatch.js";

const name = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);

// Canonicalize each event's combatRegion from a friendly name to a region id
// that the adapter can match against unit.regionId. The catalog is an array of
// {id,name} rows: an id keeps itself, a name folds to its id, and a value that
// matches nothing is cleared so an unresolvable declaration stays narrative
// rather than guessing.
export const resolveCombatRegionIds = (containers, catalog) => {
  const byId = new Set();
  const byName = new Map();
  for (const row of list(catalog)) {
    const id = name(row?.id);
    if (!id) continue;
    byId.add(id);
    const nameKey = foldRegionKey(name(row?.name));
    if (nameKey) byName.set(nameKey, id);
  }
  let resolved = 0;
  let dropped = 0;
  const events = list(containers).flatMap((container) => list(container?.events));
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const value = name(event.combatRegion);
    if (!value) continue;
    if (byId.has(value)) { resolved += 1; continue; }
    const match = byName.get(foldRegionKey(value));
    if (match) { event.combatRegion = match; resolved += 1; continue; }
    event.combatRegion = "";
    dropped += 1;
  }
  return { resolved, dropped };
};
```

Then in `src/Game/AI/gameplay.js`, add the import beside the `./regionMatch.js`
import (around line 90):

```js
import { resolveCombatRegionIds } from "./combatRegionResolution.js";
```

and call it in the validation pass, immediately after the control-op salvage
loop that ends at line 5794:

```js
  const combatRegionResolution = resolveCombatRegionIds(containers, getPrimedScenarioRegionCatalog() ?? []);
  if (combatRegionResolution.dropped) {
    console.info(`[ai] cleared ${combatRegionResolution.dropped} unresolvable combatRegion value(s).`);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/Game/AI/combatRegionResolution.test.js`
Expected: PASS.

- [ ] **Step 5: Lint the changed files**

Run: `npx eslint src/Game/AI/combatRegionResolution.js src/Game/AI/gameplay.js`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/Game/AI/combatRegionResolution.js src/Game/AI/combatRegionResolution.test.js src/Game/AI/gameplay.js
git commit -m "feat(ai): canonicalize the declared combat region"
```

---

### Task 5: Ask the model for the region

**Files:**
- Modify: `src/Game/AI/gameplayPrompts.js` (the jump guidance near line 53 and the output template near line 68)
- Test: `src/Game/AI/projectOpSchema.test.js` (the existing char-budget guard)

**Interfaces:**
- Consumes: nothing new.
- Produces: a jump prompt that names `combatRegion` on a battle, within the schema character budget.

- [ ] **Step 1: Add the rule and the field**

In `src/Game/AI/gameplayPrompts.js`, in rule 10 (near line 53) append one
sentence:

```
A battle event must also carry combatRegion, the region name or id where it is fought; the engine resolves the engagement from the forces actually present there.
```

In the JSON template (near line 68), add `"combatRegion":""` immediately after
`"combatants":[]`:

```
{"date":"YYYY-MM-DD","title":"","description":"","importance":"minor|major","kind":"world|player|diplomacy|military","tags":["Military|Diplomacy|Economy|Politics|Culture|Disaster"],"notable":false,"playerRelated":false,"warId":"","combatants":[],"combatRegion":"","impacts":{"regionTransfers":[],"regionControlOps":[],"regionClaims":[],"polityChanges":[],"unitOps":[],"markerOps":[],"createdChats":[],"projectOps":[]}}
```

- [ ] **Step 2: Run the char-budget guard**

Run: `node --test src/Game/AI/projectOpSchema.test.js`
Expected: PASS with the measured jump-schema length still under 29500.

If it fails, trim the longest redundant sentence in the same prompt block
before adding more. Do not raise the limit and do not edit the guard.

- [ ] **Step 3: Commit**

```bash
git add src/Game/AI/gameplayPrompts.js
git commit -m "feat(ai): ask the model to name the combat region"
```

---

### Task 6: Resolve engagements inside the turn

**Files:**
- Modify: `src/Game/AI/gameplay.js` (`applySimulationResult`, before `applyEventImpactsToWorld` at line 6655 and after `impactMerge` at line 6701)
- Test: `src/runtime/combatEngagements.test.js` (extend) and an integration assertion in the same file

**Interfaces:**
- Consumes: `resolveEventEngagements`, `applyCombatReserveCost` from `../../runtime/combatEngagements.js`.
- Produces: a turn whose declared battles reduce `world.units` strength, emit control ops, drop the model's numeric and region claims for that event, and charge `economyEngine.pools`.

- [ ] **Step 1: Add the import**

At the top of `src/Game/AI/gameplay.js`, near the other runtime imports:

```js
import {
  applyCombatReserveCost,
  mergeEngagementResults,
  resolveEventEngagements,
} from "../../runtime/combatEngagements.js";
```

- [ ] **Step 2: Resolve before applying impacts**

Immediately above the `applyEventImpactsToWorld` call at line 6655, insert:

```js
  // Resolve every declared battle against the pre-turn roster, then fold the
  // engine's ops into the very events the model wrote. The engine owns the
  // numbers and the ownership outcome; the model keeps the moves that put
  // forces on the map.
  // baseWorldNormalized is the pre-turn world normalized just above; passing it
  // avoids re-normalizing the whole world per event inside the adapter.
  const engagementOutcome = resolveEventEngagements(freshEvents, baseWorldNormalized, { round: nextGame.round });
  mergeEngagementResults(freshEvents, engagementOutcome.results);
  for (const result of engagementOutcome.results) {
    const event = freshEvents[result.eventIndex];
    if (receipt && event) {
      noteReceipt(receipt, "adjusted",
        `"${normalizeString(event.title)}": the engine resolved the engagement in ${result.controlRegionId}`
        + ` (${result.casualtyCount} formation(s) damaged, ${result.destroyedCount} destroyed)`
        + (result.controlToCode ? `; the region fell to ${result.controlToCode}.` : "; the defender held."));
    }
  }
  for (const entry of engagementOutcome.unresolved) {
    const event = freshEvents[entry.eventIndex];
    if (receipt && event) {
      noteReceipt(receipt, "adjusted",
        `"${normalizeString(event.title)}": left as narrative; ${entry.reason}.`);
    }
  }
```

- [ ] **Step 3: Charge the reserves after the impacts land**

Immediately after `let impactedWorld = impactMerge.world;` (line 6701), insert:

```js
  impactedWorld = applyCombatReserveCost(impactedWorld, engagementOutcome.reserveCost);
```

- [ ] **Step 4: Run the tests**

No new test is added here: the adapter-plus-merge composition is already covered
by Task 2's "merging replaces the model's numbers and its claim on the region"
test, and the turn wiring is guarded by Task 7. This step only re-runs the
existing suites.

Run: `node --test src/runtime/combatEngagements.test.js`
Expected: PASS.

- [ ] **Step 5: Run the Game/AI and runtime suites**

Run: `node --test "src/runtime/*.test.js"` and `node --test "src/Game/AI/*.test.js"`
Expected: PASS, no regression.

- [ ] **Step 6: Commit**

```bash
git add src/Game/AI/gameplay.js
git commit -m "feat(ai): resolve declared battles in the turn"
```

---

### Task 7: The wiring guard

**Files:**
- Create: `src/runtime/combatWiringArchitecture.test.js`

**Interfaces:**
- Consumes: the source text of `src/Game/AI/gameplay.js` and `src/runtime/combatEngagements.js`.
- Produces: a guard that fails if the seams are unwired, in the style of `researchWiringArchitecture.test.js`.

- [ ] **Step 1: Write the guard test**

Create `src/runtime/combatWiringArchitecture.test.js`:

```js
// Run: node --test src/runtime/combatWiringArchitecture.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
const adapter = readFileSync(new URL("./combatEngagements.js", import.meta.url), "utf8");
const core = readFileSync(new URL("../engine/combat.js", import.meta.url), "utf8");

test("the core imports nothing", () => {
  assert.equal(/from\s+"/.test(core), false, "combat.js must be import-free");
});

test("the adapter resolves against the ledger and the roster", () => {
  assert.match(adapter, /world\?\.wars/);
  assert.match(adapter, /world\?\.units/);
  assert.match(adapter, /economyEngine\?\.mobilization/);
});

test("the turn runs the adapter before applying impacts", () => {
  const resolveAt = gameplay.indexOf("resolveEventEngagements(freshEvents");
  const applyAt = gameplay.indexOf("const impactMerge = applyEventImpactsToWorld(");
  assert.ok(resolveAt > 0, "the adapter is not called");
  assert.ok(applyAt > 0, "the impact applier is not found");
  assert.ok(resolveAt < applyAt, "the adapter must run before applyEventImpactsToWorld");
});

test("the turn charges the reserves after the impacts land", () => {
  const chargeAt = gameplay.indexOf("applyCombatReserveCost(impactedWorld");
  const impactAt = gameplay.indexOf("let impactedWorld = impactMerge.world;");
  assert.ok(chargeAt > 0, "the reserve cost is not applied");
  assert.ok(chargeAt > impactAt, "the reserve cost must follow the impact merge");
});

test("the turn merges the adapter's result into the model's events", () => {
  assert.match(gameplay, /mergeEngagementResults\(freshEvents, engagementOutcome\.results\)/);
});

test("the merge drops the model's numbers and its region claim, in the adapter", () => {
  assert.match(adapter, /\[\"strength\", \"remove\"\]\.includes/);
  assert.match(adapter, /impacts\.regionTransfers = list\(impacts\.regionTransfers\)\.filter/);
  assert.match(adapter, /impacts\.regionControlOps = list\(impacts\.regionControlOps\)\.filter/);
});
```

- [ ] **Step 2: Run the guard**

Run: `node --test src/runtime/combatWiringArchitecture.test.js`
Expected: PASS. If a pattern does not match, fix the wiring in Task 6 rather than the guard, unless the guard itself names a variable that was intentionally renamed.

- [ ] **Step 3: Run the runtime suite**

Run: `node --test "src/runtime/*.test.js"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/combatWiringArchitecture.test.js
git commit -m "test(runtime): guard the combat-engagement wiring"
```

---

### Task 8: Document the rule

**Files:**
- Modify: `docs/world-state.md` (the Unit/2e section and the impacts table for `combatRegion`)
- Modify: `docs/runtime-services.md` (the deterministic simulation list)
- Modify: `wiki/systems/projects.md` (the "no tech tree / what a battle does" note)

**Interfaces:**
- Consumes: nothing.
- Produces: the player-facing and model-facing documentation of the new field and the resolution rule.

- [ ] **Step 1: Update `docs/world-state.md`**

In the `Unit` enums paragraph (section 2e), add one sentence: a battle event
carries `combatRegion`, and the engine resolves the engagement from the
formations present in that region, reducing `strength`, destroying broken
formations, spending `manpower`/`materiel` and changing de-facto control
through `regionControlOps` when the defender breaks. Reference
`runtime/combatEngagements.js` and `engine/combat.js`.

- [ ] **Step 2: Update `docs/runtime-services.md`**

Add the fifth deterministic system beside the economy, the pools, the
production line and research: the engagement core and the adapter, with the
one-authority rule (the engine owns the numbers; the model's own
`strength`/`remove` and its region claim for a resolved event are dropped).

- [ ] **Step 3: Update `wiki/systems/projects.md`**

State that a battle has a deterministic result: the side that is present and
stronger, weighted by type and mobilization, inflicts more casualties, a broken
formation is destroyed, and a province changes hands only when its defender
breaks.

- [ ] **Step 4: Regenerate and verify the wiki**

Run: `npm run build:wiki`
Then: `npm run wiki:check`
Expected: exactly `Wiki is current.`

- [ ] **Step 5: Commit**

```bash
git add docs/world-state.md docs/runtime-services.md wiki/systems/projects.md public/wiki
git commit -m "docs(engine): document deterministic combat engagements"
```

---

### Task 9: The acceptance pass

**Files:**
- No source change; this is the gate.

**Interfaces:**
- Consumes: everything above.
- Produces: the evidence that the increment is done.

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: 0 failures, 2 todo (the known todo count), including the engine,
runtime, Game/AI and GameUI suites.

- [ ] **Step 2: Lint every changed source file**

Run: `npx eslint src/engine/combat.js src/runtime/combatEngagements.js src/runtime/gameState.js src/Game/AI/gameplay.js src/Game/AI/gameplaySchemas.js src/Game/AI/gameplayPrompts.js`
Expected: 0 errors.

- [ ] **Step 3: Verify the wiki and the build**

Run: `npm run wiki:check`
Expected: `Wiki is current.`
Run: `npm run build`
Expected: success.

- [ ] **Step 4: Audit the trailers**

Run: `git log --format='%H %(trailers:key=Co-authored-by,valueonly)' -10`
Expected: each of this branch's commits carries exactly one trailer.

- [ ] **Step 5: Push the branch to the fork only**

```bash
git push -u origin 261001-feat-combat-engagements
```

Do not open a pull request and do not touch the upstream repository.
