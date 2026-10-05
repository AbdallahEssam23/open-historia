# Tick Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Declare the order in which the deterministic subsystems of a turn run, as a frozen pure value in `src/engine/tickSchedule.js`, and pin the executed order in `applySimulationResult` to it with one whole-order guard.

**Architecture:** A pure, import-free `src/engine/tickSchedule.js` holds `TICK_PHASES` (the sixteen turn phases, each with the exact source literal that identifies its call in `applySimulationResult` and the world facts that make it apply) and `tickPhasePlan(facts)`, which projects the applicable ids in declared order. A source-text guard in `src/Game/AI/` imports `TICK_PHASES`, bounds the `applySimulationResult` region of `gameplay.js`, and asserts every anchor appears exactly once there and in the declared order. No phase call, argument, condition or effect changes; nothing is moved into `src/engine`.

**Tech Stack:** Node.js ESM, `node --test`, no framework, no new dependency.

## Global Constraints

- ASCII only in source and docs. No emoji, no em dash, no middle dot.
- No new `package.json` entry and no new runtime dependency.
- `src/engine/**` must stay free of browser globals and of imports outside the allow list: no `window`, `document`, `localStorage`, `Date.now`, `new Date`, `Math.random`, `fetch`. `src/engine/enginePurity.test.js` enforces this over the whole directory. `src/engine/tickSchedule.js` must import nothing at all.
- `src/runtime/**` must never import a `src/Game/AI/**` module. No `src/runtime` adapter imports `src/engine/tickSchedule.js` in this increment; only the guard in `src/Game/AI` does.
- No behavior change: no phase is moved, added, removed, gated differently or re-implemented; `applySimulationResult` keeps its exact statement sequence and no comment is added to it. The eleven existing wiring guards and their assertions stay untouched.
- No new stored shape, no schema change, no `ENGINE_VERSION` bump and no migration.
- Do not edit an existing test to accommodate a change.
- Tests are run with a glob, never a bare directory: `node --test "src/engine/*.test.js"`, `node --test "src/Game/GameUI/*.test.js"`.
- `src/Game/AI/gameplay.js` imports `./main.jsx`, and `.jsx` cannot be imported under `node --test`, so the turn's wiring is pinned by reading the source as text.
- Commit messages are conventional and do NOT include the `Co-authored-by:` trailer. The `prepare-commit-msg` hook adds it.
- The spec for this plan is `docs/specs/2026-10-05-tick-schedule-design.md`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/engine/tickSchedule.js` (new) | The declared turn-phase order: `TICK_PHASES`, `tickPhasePlan(facts)`. Imports nothing. |
| `src/engine/tickSchedule.test.js` (new) | Pins the order, the frozen shape, the known facts and the fact filtering. |
| `src/Game/AI/tickScheduleWiringArchitecture.test.js` (new) | Pins the executed order in `applySimulationResult` to `TICK_PHASES`. |
| `docs/runtime-services.md` | A paragraph naming the schedule, its module and its guard. |

---

### Task 1: The declared schedule

**Files:**
- Create: `src/engine/tickSchedule.js`
- Test: `src/engine/tickSchedule.test.js`

**Interfaces:**
- Consumes: nothing. This file imports nothing.
- Produces:
  - `TICK_PHASES`: a frozen array of frozen descriptors `{ id, anchors, requires }`, in declared order, where `anchors` is a frozen array of exact source-literal strings and `requires` is a frozen array of known fact names (`[]` means always-on).
  - `tickPhasePlan(facts = {})`: an array of `id` strings, the phases whose every `requires` fact is truthy in `facts`, in declared order.

The sixteen ids, in declared order, are:
`engagements`, `engagementMerge`, `settlements`, `engagementReserve`, `supply`,
`reinforcement`, `reinforcementReserve`, `warLedger`, `treatyBreaches`,
`casusBelli`, `treatyObligations`, `reparations`, `espionage`, `economy`,
`production`, `statsHistory`.

The known facts are:
`battles`, `atWar`, `supply`, `reinforcement`, `treaties`, `casus`,
`settlements`, `espionage`, `production`.

- [ ] **Step 1: Write the failing test**

Create `src/engine/tickSchedule.test.js`:

```js
// Run: node --test src/engine/tickSchedule.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { TICK_PHASES, tickPhasePlan } from "./tickSchedule.js";

const IDS = [
  "engagements",
  "engagementMerge",
  "settlements",
  "engagementReserve",
  "supply",
  "reinforcement",
  "reinforcementReserve",
  "warLedger",
  "treatyBreaches",
  "casusBelli",
  "treatyObligations",
  "reparations",
  "espionage",
  "economy",
  "production",
  "statsHistory",
];

const FACTS = [
  "battles",
  "atWar",
  "supply",
  "reinforcement",
  "treaties",
  "casus",
  "settlements",
  "espionage",
  "production",
];

const ALWAYS_ON = ["warLedger", "economy", "statsHistory"];

test("the schedule is the sixteen phases in declared order", () => {
  assert.deepEqual(TICK_PHASES.map((phase) => phase.id), IDS);
});

test("the schedule and its parts are frozen", () => {
  assert.equal(Object.isFrozen(TICK_PHASES), true);
  for (const phase of TICK_PHASES) {
    assert.equal(Object.isFrozen(phase), true, phase.id);
    assert.equal(Object.isFrozen(phase.anchors), true, phase.id);
    assert.equal(Object.isFrozen(phase.requires), true, phase.id);
  }
});

test("every phase carries at least one anchor and only known facts", () => {
  for (const phase of TICK_PHASES) {
    assert.equal(Array.isArray(phase.anchors), true, phase.id);
    assert.ok(phase.anchors.length >= 1, phase.id);
    for (const anchor of phase.anchors) {
      assert.equal(typeof anchor, "string", phase.id);
      assert.ok(anchor.length > 0, phase.id);
    }
    assert.equal(Array.isArray(phase.requires), true, phase.id);
    for (const fact of phase.requires) {
      assert.ok(FACTS.includes(fact), `${phase.id} requires unknown fact ${fact}`);
    }
  }
});

test("the anchors are unique across the schedule", () => {
  const seen = new Set();
  for (const phase of TICK_PHASES) {
    for (const anchor of phase.anchors) {
      assert.equal(seen.has(anchor), false, `duplicate anchor: ${anchor}`);
      seen.add(anchor);
    }
  }
});

test("the always-on phases are the ones with no requirement", () => {
  assert.deepEqual(
    TICK_PHASES.filter((phase) => phase.requires.length === 0).map((phase) => phase.id),
    ALWAYS_ON,
  );
});

test("no facts plan is the always-on phases in order", () => {
  assert.deepEqual(tickPhasePlan(), ALWAYS_ON);
  assert.deepEqual(tickPhasePlan({}), ALWAYS_ON);
});

test("all facts plan is every phase in order", () => {
  const all = Object.fromEntries(FACTS.map((fact) => [fact, true]));
  assert.deepEqual(tickPhasePlan(all), IDS);
});

test("a partial fact set filters without reordering", () => {
  assert.deepEqual(
    tickPhasePlan({ battles: true, production: true }),
    ["engagements", "engagementMerge", "engagementReserve", "warLedger", "economy", "production", "statsHistory"],
  );
});

test("unknown facts are ignored and falsy facts exclude", () => {
  assert.deepEqual(tickPhasePlan({ nonsense: true }), ALWAYS_ON);
  assert.deepEqual(tickPhasePlan({ battles: false, production: 0 }), ALWAYS_ON);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/engine/tickSchedule.test.js`
Expected: FAIL, the module `./tickSchedule.js` cannot be found.

- [ ] **Step 3: Write the minimal implementation**

Create `src/engine/tickSchedule.js`:

```js
/*! Open Historia - one declared order for the deterministic turn phases (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/engine/tickSchedule.test.js
//
// applySimulationResult (src/Game/AI/gameplay.js) runs the deterministic
// subsystems of a turn in a fixed order: combat, settlement, supply,
// reinforcement, the war ledger, treaties, casus belli, reparations, espionage,
// the economy, production and the stats history. That order used to live only
// in the position of the function's statements. This module declares it once,
// so a guard can pin the executed order to it. It imports nothing: the schedule
// is data, and the phases themselves stay where they are, because they read and
// write the stored world through src/runtime adapters.

const PHASE = (id, anchors, requires) =>
  Object.freeze({ id, anchors: Object.freeze(anchors), requires: Object.freeze(requires) });

// Each phase names the exact source literals that identify its call in
// applySimulationResult and the world facts that make it apply. An empty
// requires list means the phase runs on every turn.
export const TICK_PHASES = Object.freeze([
  PHASE("engagements", ["resolveEventEngagements(freshEvents"], ["battles"]),
  PHASE("engagementMerge", ["mergeEngagementResults(freshEvents"], ["battles"]),
  PHASE("settlements", ["resolveWarSettlements({"], ["atWar"]),
  PHASE("engagementReserve", ["applyCombatReserveCost(impactedWorld, engagementOutcome.reserveCost)"], ["battles"]),
  PHASE("supply", ["readSupplyAttrition(impactedWorld"], ["supply"]),
  PHASE("reinforcement", ["readReinforcement(impactedWorld"], ["reinforcement"]),
  PHASE("reinforcementReserve", ["applyCombatReserveCost(impactedWorld, reinforcement.reserveCost)"], ["reinforcement"]),
  PHASE("warLedger", ["const warMerge = applyWarUpdates({"], []),
  PHASE("treatyBreaches", ["readTreatyBreaches(worldWithImpacts"], ["treaties"]),
  PHASE("casusBelli", ["readWarCasus(worldWithImpacts"], ["casus"]),
  PHASE("treatyObligations", ["readTreatyObligations(worldWithImpacts"], ["treaties"]),
  PHASE("reparations", ["applyWarReparations(worldWithImpacts"], ["settlements"]),
  PHASE("espionage", ["resolveEspionage(worldWithImpacts"], ["espionage"]),
  PHASE("economy", ["advanceWorldEconomy(nextWorld"], []),
  PHASE("production", ["await resolvePlacements(containers, nextWorld, { receipt })"], ["production"]),
  PHASE("statsHistory", ["nextWorld = captureCountryStatsHistory(nextWorld, {"], []),
]);

// The phases applicable to a set of facts, in declared order. The order always
// comes from TICK_PHASES; this only filters.
export const tickPhasePlan = (facts = {}) =>
  TICK_PHASES
    .filter((phase) => phase.requires.every((fact) => Boolean(facts?.[fact])))
    .map((phase) => phase.id);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/engine/tickSchedule.test.js`
Expected: PASS, 9 tests.

Also run the engine purity guard, which scans this new file:

Run: `node --test src/engine/enginePurity.test.js`
Expected: PASS (the module imports nothing and touches no forbidden global).

- [ ] **Step 5: Commit**

```bash
git add src/engine/tickSchedule.js src/engine/tickSchedule.test.js
git commit -m "feat(engine): declare the deterministic turn phase order"
```

---

### Task 2: Pin the executed order

**Files:**
- Add: `src/Game/AI/tickScheduleWiringArchitecture.test.js`

**Interfaces:**
- Consumes: `TICK_PHASES` from Task 1.
- Produces: no new export. A source-text guard that fails if any phase is moved across another in `applySimulationResult`.

The guard bounds the region of `src/Game/AI/gameplay.js` from the literal
`const applySimulationResult =` (line 6527) to the literal
`const readSeenGameStateBundle =` (line 7867). Every anchor from Task 1 occurs
exactly once inside that region; some also occur elsewhere in the file (the war
ledger and stats history appear on the Game Master and bootstrap paths), which is
why the region bound is required.

- [ ] **Step 1: Write the failing guard test**

Create `src/Game/AI/tickScheduleWiringArchitecture.test.js`:

```js
// Run: node --test "src/Game/AI/tickScheduleWiringArchitecture.test.js"
//
// gameplay.js imports main.jsx and cannot be imported by node --test, so its
// wiring is pinned by reading the source. This is the house pattern for the
// other wiring architecture guards. It asserts the whole phase order at once,
// which no pairwise guard does.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { TICK_PHASES } from "../../engine/tickSchedule.js";

const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");

const REGION_START = "const applySimulationResult =";
const REGION_END = "const readSeenGameStateBundle =";
const start = gameplay.indexOf(REGION_START);
const end = gameplay.indexOf(REGION_END);
const region = gameplay.slice(start, end);

const countOf = (text, anchor) => text.split(anchor).length - 1;

const anchorPositions = (text) =>
  TICK_PHASES.flatMap((phase) => phase.anchors.map((anchor) => text.indexOf(anchor)));

const orderOk = (text) => {
  let previous = -1;
  for (const at of anchorPositions(text)) {
    if (at < 0 || at <= previous) return false;
    previous = at;
  }
  return true;
};

test("the applySimulationResult region is bounded", () => {
  assert.ok(start > 0, "applySimulationResult is missing");
  assert.ok(end > start, "the region end must follow its start");
});

test("every phase anchor appears exactly once in the apply region", () => {
  for (const phase of TICK_PHASES) {
    for (const anchor of phase.anchors) {
      assert.equal(countOf(region, anchor), 1, `${phase.id} anchor must appear once in applySimulationResult: ${anchor}`);
    }
  }
});

test("the phases run in the declared order", () => {
  assert.equal(orderOk(region), true, "the executed order must match TICK_PHASES");
  assert.ok(region.length > 0, "the region must not be empty");
});

test("the order check rejects a swapped pair and a missing anchor", () => {
  const swapped = region
    .replace("readSupplyAttrition(impactedWorld", "__SUPPLY__")
    .replace("readReinforcement(impactedWorld", "readSupplyAttrition(impactedWorld")
    .replace("__SUPPLY__", "readReinforcement(impactedWorld");
  assert.equal(orderOk(swapped), false, "a swapped supply/reinforcement pair must fail");
  assert.equal(orderOk(region.replace("resolveEventEngagements(freshEvents", "")), false, "a missing anchor must fail");
});
```

- [ ] **Step 2: Run the test to verify it fails, then passes on the shipped order**

Run: `node --test "src/Game/AI/tickScheduleWiringArchitecture.test.js"`
Expected: PASS, 4 tests, because the shipped order already matches the schedule.
The guard is not expected to be RED at this point: it exists to fail a future
edit, and the fourth test proves it bites by feeding the same checker a mutated
region (a swapped pair and a missing anchor) and asserting it returns false. The
identical checker passes on the real region, so the guard cannot be vacuous.

Also confirm the region bound: `region` must be non-empty and must not include
the Game Master path's own `const warMerge = applyWarUpdates({`. The count test
already proves this, because that literal would then appear twice.

Run: `node --check src/Game/AI/tickScheduleWiringArchitecture.test.js`
Expected: no output (syntax OK).

- [ ] **Step 3: Commit**

```bash
git add src/Game/AI/tickScheduleWiringArchitecture.test.js
git commit -m "test(ai): pin the turn phase order to the declared schedule"
```

---

### Task 3: Document the schedule

**Files:**
- Modify: `docs/runtime-services.md` (a paragraph after the paragraph that ends with the words "stays the enforcement point" at line 86, before the `---` at line 88)

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing.

- [ ] **Step 1: Add the paragraph**

After the paragraph whose last sentence is "Nothing is enforced at preview time;
`applyWarUpdates` stays the enforcement point." (line 86), before the `---`
separator, insert:

```markdown
The deterministic phases a turn runs have one declared order.
`src/engine/tickSchedule.js` exports `TICK_PHASES`, the frozen list of the
sixteen phases `applySimulationResult` runs, each with the source literal that
identifies its call and the world facts that make it apply, and
`tickPhasePlan(facts)`, which returns the phases applicable to a set of facts in
declared order. The schedule is data and imports nothing; the phases themselves
stay where they are, because they read and write the stored world through
`src/runtime` adapters and some live in `src/Game/AI`, and the runtime layer may
not import `Game/AI`. A guard
(`src/Game/AI/tickScheduleWiringArchitecture.test.js`) bounds the
`applySimulationResult` region in `gameplay.js` and asserts every phase's anchor
appears once there and in the declared order, so moving a phase across another
fails the build. The order used to be an implicit property of the function's
statement sequence, pinned only by pairwise guards; this names it once.
```

Leave a blank line between the new paragraph and the `---` at line 88, so the
separator stays a horizontal rule instead of a setext heading underline.

- [ ] **Step 2: Check the wiki freshness and commit**

Run: `npm run wiki:check`
Expected: `Wiki is current.`

```bash
git add docs/runtime-services.md
git commit -m "docs(runtime): name the declared turn phase order"
```

---

### Task 4: Whole-suite gate

**Files:**
- None (verification only).

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: 0 failures. The baseline before this increment was 3034 tests (3032
pass, 0 fail, 2 todo); this increment adds the new tests and must not lose any.
If a network-based test flakes (`server/appUpdate.test.js` is a known flake),
re-run once and record it.

- [ ] **Step 2: Engine purity and the new engine test**

Run: `node --test "src/engine/*.test.js"`
Expected: all pass, including `tickSchedule.test.js` and `enginePurity.test.js`.

- [ ] **Step 3: The wiring guard**

Run: `node --test "src/Game/AI/tickScheduleWiringArchitecture.test.js"`
Expected: 4 tests pass.

- [ ] **Step 4: Lint the changed files**

Run: `npx eslint src/engine/tickSchedule.js src/engine/tickSchedule.test.js src/Game/AI/tickScheduleWiringArchitecture.test.js`
Expected: 0 errors.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 6: Record the gate**

Write the exact counts and any flake to `.superpowers/sdd/progress.md`. No
commit for this step unless a change was needed.
