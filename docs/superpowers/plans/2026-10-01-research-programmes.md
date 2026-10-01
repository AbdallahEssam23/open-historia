# Research Programmes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every polity a deterministic monthly research capacity that advances its research programmes one at a time, on the existing economy clock, and completes them through the existing project completion path, with the model declaring programmes and never their progress.

**Architecture:** The engine already has one pure month step (`advanceEconomy`, `src/engine/economyTick.js`) driven by the adapter `advanceWorldEconomy` (`src/runtime/economyEngine.js`). This plan adds one pure module `src/engine/research.js`, threads a `research` map through the same month loop beside the pools and the production line, has the adapter translate the stepped programmes into project operations (progress and completion), and has `gameplay.js` apply those operations through the existing project path with an engine-only flag the model cannot forge.

**Tech Stack:** Vanilla ES modules, Node's built-in test runner (`node --test`), no new dependency. React/JSX only in the Projects panel task.

## Global Constraints

- ASCII only in source and docs. No emoji, no em dash.
- No new dependency in `package.json`.
- `src/engine/**` imports only `src/engine/*.js` and the two import-free runtime helpers `../runtime/gameDates.js` and `../runtime/unitMotion.js`. No `Date.now`, `new Date`, `Math.random`, `localStorage`, `window`, `document`, `navigator`, `fetch`.
- `node --test <dir>` does not work in this environment. Run engine tests with the glob form: `node --test "src/engine/*.test.js"`.
- Every commit uses a conventional-commit prefix. The `prepare-commit-msg` hook appends the trailer `Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>` automatically: never pass the trailer through `-m`, and verify each commit has it exactly once.
- No existing function changes meaning. All additions are additive except the explicit, guarded behaviour changes in Tasks 4 and 5.
- `public/wiki/**` is generated but committed (`docs/wiki.md`). Any task that touches `docs/` regenerates and commits it with `npm run build:wiki` and verifies with `npm run wiki:check` (expected `Wiki is current.`).
- The model declares PROGRAMMES, never progress and never completion. The engine owns the capacity, the rate and the completion.
- Reference range in this plan is the tree at commit `94af849` (the research-programmes design spec) on branch `261001-feat-research-programmes`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/engine/research.js` (new) | Closed domain and scale enums, the cost table, `researchPointsFor`, `normalizeResearchProgrammes`, `researchQueueFor`, `stepResearchMonth`, `resolveResearchDomain`, `resolveResearchScale`. Pure. |
| `src/engine/research.test.js` (new) | The pure core tests, including same-input-same-output over a span. |
| `src/engine/economyTick.js` (modify) | Thread `research` through `advanceEconomy`: step each polity's queue after its line, collect research completions. |
| `src/runtime/gameState.js` (modify) | `kind: "research"` and the `domain`/`scale`/`researchPoints` fields; the model guard in `applyProjectOps` and `releaseProjectCompletionEffects`; the engine flag threaded through `applyEventImpactsToWorld`. |
| `src/runtime/economyEngine.js` (modify) | Extract the research input from projects, markers and country stats; run it in the advance; translate the stepped programmes into project operations. |
| `src/runtime/economyDigest.js` (modify) | The player-only research line. |
| `src/Game/AI/gameplaySchemas.js` (modify) | `research` in the project `kind` enum; `domain` and `scale` on the project and the project op. |
| `src/Game/AI/gameplayPrompts.js` (modify) | The research declaration rule in the jump instructions. |
| `src/Game/AI/gameplay.js` (modify) | Apply the research project operations through the project path with the engine flag. |
| `src/Game/AI/projectOpSchema.test.js` (modify) | Re-assert the jump-schema size guard with the two new fields. |
| `src/runtime/researchWiringArchitecture.test.js` (new) | The source-structure guard beside the production/force/economy wiring guards. |
| `src/Game/GameUI/projects.jsx` (modify) | The research kind badge and the domain/scale line. |

---

### Task 1: The research core tables, cost and capacity

**Files:**
- Create: `src/engine/research.js`
- Test: `src/engine/research.test.js`

**Interfaces:**
- Consumes: nothing (import-free, like `economyShocks.js`).
- Produces: `RESEARCH_DOMAINS`, `RESEARCH_SCALES`, `RESEARCH_DOMAIN_BASE`, `RESEARCH_SCALE_MULTIPLIER`, `RESEARCH_BASE_POINTS`, `RESEARCH_POINTS_PER_FACILITY`, `RESEARCH_POPULATION_PER_POINT`, `RESEARCH_MAX_POINTS`, `DEFAULT_RESEARCH_DOMAIN`, `DEFAULT_RESEARCH_SCALE`, `resolveResearchDomain(value) -> string`, `resolveResearchScale(value) -> string`, `researchCostFor({domain, scale}) -> integer`, `researchPointsFor({facilities, population}) -> integer`.

- [ ] **Step 1: Write the failing test**

```js
// src/engine/research.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RESEARCH_DOMAIN,
  DEFAULT_RESEARCH_SCALE,
  RESEARCH_DOMAINS,
  RESEARCH_MAX_POINTS,
  RESEARCH_SCALES,
  researchCostFor,
  researchPointsFor,
  resolveResearchDomain,
  resolveResearchScale,
} from "./research.js";

test("the domain and scale enums are closed and every domain has a base", () => {
  assert.deepEqual(
    [...RESEARCH_DOMAINS],
    ["military", "naval", "aerospace", "industrial", "electronics", "medical", "nuclear"],
  );
  assert.deepEqual([...RESEARCH_SCALES], ["small", "medium", "large"]);
  for (const domain of RESEARCH_DOMAINS) {
    const cost = researchCostFor({ domain, scale: "small" });
    assert.ok(Number.isInteger(cost) && cost > 0, `${domain} has a positive integer cost`);
  }
});

test("cost is a deterministic function of domain and scale", () => {
  // A large programme costs three times the small one of the same domain.
  assert.equal(
    researchCostFor({ domain: "nuclear", scale: "large" }),
    researchCostFor({ domain: "nuclear", scale: "small" }) * 3,
  );
  // Nuclear is dearer than industrial at the same scale.
  assert.ok(
    researchCostFor({ domain: "nuclear", scale: "medium" })
      > researchCostFor({ domain: "industrial", scale: "medium" }),
  );
});

test("an unknown domain or scale falls back to the default rather than throwing", () => {
  assert.equal(resolveResearchDomain("telepathy"), DEFAULT_RESEARCH_DOMAIN);
  assert.equal(resolveResearchDomain("NUCLEAR"), "nuclear");
  assert.equal(resolveResearchScale("enormous"), DEFAULT_RESEARCH_SCALE);
  assert.equal(resolveResearchScale("Large"), "large");
  // A missing pair still costs the default pair, never zero.
  assert.equal(
    researchCostFor({}),
    researchCostFor({ domain: DEFAULT_RESEARCH_DOMAIN, scale: DEFAULT_RESEARCH_SCALE }),
  );
});

test("capacity is the documented formula including the cap", () => {
  // Base of one, so a polity with nothing still researches.
  assert.equal(researchPointsFor({ facilities: 0, population: 0 }), 1);
  // Two points per facility.
  assert.equal(researchPointsFor({ facilities: 1, population: 0 }), 3);
  // One extra point per 50 million people, floored.
  assert.equal(researchPointsFor({ facilities: 0, population: 49999999 }), 1);
  assert.equal(researchPointsFor({ facilities: 0, population: 50000000 }), 2);
  assert.equal(researchPointsFor({ facilities: 0, population: 250000000 }), 6);
  // The cap holds however large the inputs.
  assert.equal(researchPointsFor({ facilities: 100, population: 10000000000 }), RESEARCH_MAX_POINTS);
  // Negative or malformed inputs do not go below the base.
  assert.equal(researchPointsFor({ facilities: -5, population: -100 }), 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "src/engine/research.test.js"`
Expected: FAIL, `Cannot find module './research.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
/*! Open Historia - deterministic economy: research capacity and programmes (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What a polity can research and how fast, out of the facilities it has actually
// built and the population behind them. Like the production line this is a pure
// function of the state: the model declares a PROGRAMME (a domain and a scale),
// never a cost and never a rate, and the engine owns both. IMPORT-FREE.

// Closed, because the engine switches on the value: the pair determines the
// cost, so a value the engine cannot price must not reach it.
export const RESEARCH_DOMAINS = Object.freeze([
  "military", "naval", "aerospace", "industrial",
  "electronics", "medical", "nuclear",
]);
export const RESEARCH_SCALES = Object.freeze(["small", "medium", "large"]);

export const DEFAULT_RESEARCH_DOMAIN = "industrial";
export const DEFAULT_RESEARCH_SCALE = "small";

const DOMAIN_BASE = Object.freeze({
  military: 30, naval: 36, aerospace: 48, industrial: 24,
  electronics: 36, medical: 30, nuclear: 60,
});
const SCALE_MULTIPLIER = Object.freeze({ small: 1, medium: 2, large: 3 });

export const RESEARCH_DOMAIN_BASE = DOMAIN_BASE;
export const RESEARCH_SCALE_MULTIPLIER = SCALE_MULTIPLIER;

export const RESEARCH_BASE_POINTS = 1;
export const RESEARCH_POINTS_PER_FACILITY = 2;
export const RESEARCH_POPULATION_PER_POINT = 50000000;
export const RESEARCH_MAX_POINTS = 12;

const name = (value) => String(value ?? "").trim().toLowerCase();
const whole = (value) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export const resolveResearchDomain = (value) => {
  const raw = name(value);
  return Object.prototype.hasOwnProperty.call(DOMAIN_BASE, raw) ? raw : DEFAULT_RESEARCH_DOMAIN;
};

export const resolveResearchScale = (value) => {
  const raw = name(value);
  return Object.prototype.hasOwnProperty.call(SCALE_MULTIPLIER, raw) ? raw : DEFAULT_RESEARCH_SCALE;
};

// Derived, never stored, so a programme's price cannot drift from the domain and
// scale on the entry.
export const researchCostFor = (entry = {}) =>
  DOMAIN_BASE[resolveResearchDomain(entry?.domain)] * SCALE_MULTIPLIER[resolveResearchScale(entry?.scale)];

// A property of a polity, not of a programme: the base of one means a polity
// with no laboratory still researches, slowly, and cannot be permanently locked
// out of the board's own promise. The cap keeps one month from finishing an
// end-game programme by arithmetic accident.
export const researchPointsFor = ({ facilities = 0, population = 0 } = {}) =>
  Math.min(
    RESEARCH_MAX_POINTS,
    RESEARCH_BASE_POINTS
      + RESEARCH_POINTS_PER_FACILITY * whole(facilities)
      + Math.floor(Math.max(0, Number(population) || 0) / RESEARCH_POPULATION_PER_POINT),
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "src/engine/research.test.js"`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the purity guard**

Run: `node --test "src/engine/enginePurity.test.js"`
Expected: PASS. `research.js` has no browser import and no forbidden global.

- [ ] **Step 6: Commit**

```bash
git add src/engine/research.js src/engine/research.test.js
git commit -m "feat(engine): add the research cost and capacity core"
```

---

### Task 2: The sequential allocation step

**Files:**
- Modify: `src/engine/research.js`
- Test: `src/engine/research.test.js`

**Interfaces:**
- Consumes: `researchCostFor` and `resolveResearchDomain`/`resolveResearchScale` from Task 1.
- Produces:
  - `normalizeResearchProgrammes(value) -> [{ id, cost, accumulated, priority, startedAt, status }]`. `value` is the raw list the adapter builds: `[{ id, domain, scale, points, priority, startedAt, status }]`. `cost` is derived through `researchCostFor`; `accumulated` is `points` clamped to `>= 0`; `priority` is `"high" | "normal" | "low"`; `startedAt` and `status` are strings; an entry without a usable `id` is dropped.
  - `researchQueueFor(programmes) -> [programme]`. The `active` programmes only, ordered by priority rank then `startedAt` ascending (empty after set) then `id` ascending.
  - `stepResearchMonth({ points, programmes }, { monthOffset }) -> { programmes, completions }`. `points` is a non-negative integer; `completions` is `[{ id, monthOffset }]`. `programmes` is the same length as the input, with `accumulated` updated.

- [ ] **Step 1: Write the failing test**

```js
// append to src/engine/research.test.js
import {
  normalizeResearchProgrammes,
  researchQueueFor,
  stepResearchMonth,
} from "./research.js";

const programme = (over = {}) => ({
  id: "p1", domain: "industrial", scale: "small", points: 0,
  priority: "normal", startedAt: "2000-01-01", status: "active", ...over,
});

test("normalize derives the cost and drops anything without an id", () => {
  const cost = researchCostFor({ domain: "nuclear", scale: "large" });
  const [entry] = normalizeResearchProgrammes([
    programme({ id: "n1", domain: "nuclear", scale: "large", points: 5 }),
    { domain: "naval", scale: "small" },
  ]);
  assert.equal(entry.id, "n1");
  assert.equal(entry.cost, cost);
  assert.equal(entry.accumulated, 5);
  assert.equal(normalizeResearchProgrammes([{ domain: "naval" }]).length, 0);
});

test("the queue is priority, then start date, then id, and only active programmes", () => {
  const queue = researchQueueFor(normalizeResearchProgrammes([
    programme({ id: "b", priority: "normal", startedAt: "2001-01-01" }),
    programme({ id: "a", priority: "high", startedAt: "2010-01-01" }),
    programme({ id: "c", priority: "high", startedAt: "2000-01-01" }),
    programme({ id: "z", priority: "high", startedAt: "2000-01-01" }),
    programme({ id: "p", status: "paused" }),
    programme({ id: "s", status: "proposed" }),
  ]));
  assert.deepEqual(queue.map((entry) => entry.id), ["c", "z", "a", "b"]);
});

test("one programme takes the whole rate and the rest wait", () => {
  const input = normalizeResearchProgrammes([
    programme({ id: "head", domain: "industrial", scale: "small" }), // cost 24
    programme({ id: "tail", domain: "industrial", scale: "small" }),
  ]);
  const { programmes, completions } = stepResearchMonth({ points: 10, programmes: input }, { monthOffset: 1 });
  assert.equal(programmes.find((p) => p.id === "head").accumulated, 10);
  assert.equal(programmes.find((p) => p.id === "tail").accumulated, 0);
  assert.deepEqual(completions, []);
});

test("overflow carries to the next programme in the same month", () => {
  // Each small industrial programme costs 24. 60 points finishes two and leaves 12.
  const input = normalizeResearchProgrammes([
    programme({ id: "a", priority: "high" }),
    programme({ id: "b", priority: "normal" }),
    programme({ id: "c", priority: "low" }),
  ]);
  const { programmes, completions } = stepResearchMonth({ points: 60, programmes: input }, { monthOffset: 3 });
  assert.deepEqual(completions, [{ id: "a", monthOffset: 3 }, { id: "b", monthOffset: 3 }]);
  assert.equal(programmes.find((p) => p.id === "c").accumulated, 12);
});

test("points left when the queue is exhausted are discarded, not banked", () => {
  const input = normalizeResearchProgrammes([programme({ id: "a" })]); // cost 24
  const { completions } = stepResearchMonth({ points: 100, programmes: input }, { monthOffset: 1 });
  assert.deepEqual(completions, [{ id: "a", monthOffset: 1 }]);
  // A second step with a fresh month and the same list reports nothing to give.
  const after = stepResearchMonth({ points: 100, programmes: [] }, { monthOffset: 2 });
  assert.deepEqual(after.completions, []);
});

test("the same input and span always produce the same output", () => {
  const build = () => normalizeResearchProgrammes([
    programme({ id: "a", priority: "high", points: 5 }),
    programme({ id: "b" }),
  ]);
  const first = stepResearchMonth({ points: 7, programmes: build() }, { monthOffset: 4 });
  const second = stepResearchMonth({ points: 7, programmes: build() }, { monthOffset: 4 });
  assert.deepEqual(first, second);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "src/engine/research.test.js"`
Expected: FAIL, `normalizeResearchProgrammes is not a function` (and the same for the other two).

- [ ] **Step 3: Write minimal implementation**

```js
// append to src/engine/research.js

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };
const priorityRank = (value) => {
  const raw = name(value);
  return Object.prototype.hasOwnProperty.call(PRIORITY_RANK, raw) ? PRIORITY_RANK[raw] : PRIORITY_RANK.normal;
};

export const normalizeResearchProgrammes = (value) => {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const id = String(entry.id ?? "").trim();
    if (!id) continue;
    const points = Math.max(0, Math.trunc(Number(entry.points)) || 0);
    out.push({
      id,
      cost: researchCostFor(entry),
      accumulated: points,
      priority: ["high", "normal", "low"].includes(name(entry.priority)) ? name(entry.priority) : "normal",
      startedAt: String(entry.startedAt ?? ""),
      status: name(entry.status) || "active",
    });
  }
  return out;
};

// A total order, so the same board always produces the same queue. `active` is
// the only status that draws points: paused and stalled programmes are simply
// not in the queue, which is what makes pausing a real way to redirect research.
export const researchQueueFor = (programmes) =>
  (Array.isArray(programmes) ? programmes : [])
    .filter((entry) => entry && entry.status === "active")
    .slice()
    .sort((a, b) => {
      const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
      if (byPriority !== 0) return byPriority;
      const aDate = a.startedAt || "\uffff"; // an undated start sorts after a dated one
      const bDate = b.startedAt || "\uffff";
      if (aDate < bDate) return -1;
      if (aDate > bDate) return 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

// Sequential allocation, one month: the whole rate goes to the head, the
// overflow of a completion carries to the next programme in the SAME step, and
// what is left when the queue is empty is discarded. There is no bank.
export const stepResearchMonth = ({ points = 0, programmes = [] } = {}, { monthOffset = 1 } = {}) => {
  const list = (Array.isArray(programmes) ? programmes : []).map((entry) => ({ ...entry }));
  const byId = new Map(list.map((entry) => [entry.id, entry]));
  const completions = [];
  let remaining = Math.max(0, Math.trunc(Number(points)) || 0);

  for (const head of researchQueueFor(list)) {
    const entry = byId.get(head.id);
    if (!entry) continue;
    const need = Math.max(0, entry.cost - entry.accumulated);
    const take = Math.min(remaining, need);
    entry.accumulated += take;
    remaining -= take;
    if (entry.accumulated >= entry.cost) {
      completions.push({ id: entry.id, monthOffset: Math.max(1, Math.trunc(Number(monthOffset)) || 1) });
      continue;
    }
    break;
  }

  return { programmes: list, completions };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "src/engine/research.test.js"`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/research.js src/engine/research.test.js
git commit -m "feat(engine): allocate research points sequentially"
```

---

### Task 3: Thread research through the clock

**Files:**
- Modify: `src/engine/economyTick.js`
- Test: `src/engine/economyTick.test.js` (append)

**Interfaces:**
- Consumes: `normalizeResearchProgrammes`, `stepResearchMonth` from Task 2.
- Produces: `advanceEconomy(state, { ..., research = {} })` now accepts `state.research` as `{ [polity]: { points, programmes } }`, steps it once per month beside the production line, returns `state.research` (the stepped map, keyed by the same polities) and a flat `researchCompletions` list `[{ polity, id, monthOffset }]`.

- [ ] **Step 1: Write the failing test**

```js
// append to src/engine/economyTick.test.js
import { advanceEconomy, makePolityEconomy } from "./economyTick.js";

test("research advances the same number of months as the economy", () => {
  const state = {
    month: 0,
    polities: { France: makePolityEconomy({ population: 50000000, gdp: 1000, gdpPerCapita: 20 }) },
    pools: {},
    shortfall: {},
    research: {
      France: {
        points: 12,
        programmes: [{ id: "r1", domain: "industrial", scale: "small", points: 0, priority: "high", startedAt: "", status: "active" }],
      },
    },
  };
  const out = advanceEconomy(state, { startDate: "2000-01-01", months: 3, seed: "s" });
  // 12 points a month for 3 months is 36; a small industrial programme costs 24,
  // so it completes, and the run is exactly 3 months for both.
  assert.equal(out.journal.steps, 3);
  assert.equal(out.state.research.France.programmes[0].accumulated, 24);
  assert.equal(out.researchCompletions.length, 1);
  assert.equal(out.researchCompletions[0].id, "r1");
  assert.equal(out.researchCompletions[0].polity, "France");
});

test("a polity with no research state is untouched and collects nothing", () => {
  const state = {
    month: 0,
    polities: { France: makePolityEconomy({ population: 1000000, gdp: 10, gdpPerCapita: 10 }) },
    pools: {}, shortfall: {},
  };
  const out = advanceEconomy(state, { startDate: "2000-01-01", months: 2, seed: "s" });
  assert.deepEqual(out.researchCompletions, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "src/engine/economyTick.test.js"`
Expected: FAIL, `out.state.research` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/engine/economyTick.js`, import the core:

```js
import { normalizeResearchProgrammes, stepResearchMonth } from "./research.js";
```

`advanceEconomy` reads the research input off `state.research` (the adapter puts
it there). Beside the `production` initialization:

```js
  let research = {};
  for (const [name, entry] of Object.entries(state?.research ?? {})) {
    research[name] = {
      points: Math.max(0, Math.trunc(Number(entry?.points)) || 0),
      programmes: normalizeResearchProgrammes(entry?.programmes),
    };
  }
  const researchCompletions = [];
```

Inside the month loop's per-polity body, after the production-line step and its
completion collection:

```js
      const steppedResearch = stepResearchMonth(research[name] ?? { points: 0, programmes: [] }, {
        monthOffset: step,
      });
      if (steppedResearch.programmes.length) {
        nextResearch[name] = {
          points: research[name]?.points ?? 0,
          programmes: steppedResearch.programmes,
        };
      }
      for (const completion of steppedResearch.completions) {
        researchCompletions.push({ polity: name, ...completion });
      }
```

Declare `const nextResearch = {};` beside `nextProduction`, assign
`research = nextResearch;` beside `production = nextProduction;` at the end of
the loop, and add `research` to the returned `state` and `researchCompletions`
to the returned object. Update the early-return branch (months <= 0 or no
polities) to include `research: state?.research ?? {}` and
`researchCompletions: []`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "src/engine/economyTick.test.js"`
Expected: PASS.

- [ ] **Step 5: Run the whole engine suite**

Run: `node --test "src/engine/*.test.js"`
Expected: PASS, including `enginePurity`.

- [ ] **Step 6: Commit**

```bash
git add src/engine/economyTick.js src/engine/economyTick.test.js
git commit -m "feat(engine): step research on the economy clock"
```

---

### Task 4: The research project fields

**Files:**
- Modify: `src/runtime/gameState.js`
- Test: `src/runtime/gameState.research.test.js` (new)

**Interfaces:**
- Consumes: `resolveResearchDomain`, `resolveResearchScale` from `../engine/research.js`.
- Produces: `normalizeProjectEntry` (and therefore `normalizeProjects`) now accepts `kind: "research"` and, for it, `domain` and `scale` (closed, defaulted through the core resolvers) and the engine-owned integer `researchPoints`. A non-research project normalises `domain`/`scale` to `""` and `researchPoints` to `0`. `PROJECT_KIND_SET` gains `"research"`.

- [ ] **Step 1: Write the failing test**

```js
// src/runtime/gameState.research.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeProjects } from "../runtime/gameState.js";

test("a research project keeps its closed domain and scale and its points", () => {
  const [entry] = normalizeProjects([
    { name: "Reactor", kind: "research", domain: "nuclear", scale: "large", researchPoints: 7 },
  ]);
  assert.equal(entry.kind, "research");
  assert.equal(entry.domain, "nuclear");
  assert.equal(entry.scale, "large");
  assert.equal(entry.researchPoints, 7);
});

test("unknown domain and scale fall back, and missing ones too", () => {
  const [entry] = normalizeProjects([{ name: "X", kind: "research", domain: "psionics", scale: "colossal" }]);
  assert.equal(entry.domain, "industrial");
  assert.equal(entry.scale, "small");
  assert.equal(entry.researchPoints, 0);
});

test("a non-research project carries no research fields", () => {
  const [entry] = normalizeProjects([{ name: "Dam", kind: "project", domain: "nuclear", scale: "large", researchPoints: 9 }]);
  assert.equal(entry.kind, "project");
  assert.equal(entry.domain, "");
  assert.equal(entry.scale, "");
  assert.equal(entry.researchPoints, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "src/runtime/gameState.research.test.js"`
Expected: FAIL, `kind` is `"project"` for the first case.

- [ ] **Step 3: Write minimal implementation**

At the top of `src/runtime/gameState.js`, import the resolvers:

```js
import { resolveResearchDomain, resolveResearchScale } from "../engine/research.js";
```

Change the kind set:

```js
const PROJECT_KIND_SET = new Set(["project", "operation", "research"]);
```

In `normalizeProjectEntry`, compute the research fields after `kind`:

```js
  const isResearch = kind === "research";
```

(where `kind` is the already-normalised local `PROJECT_KIND_SET.has(kind) ? kind : "project"`).
Then in the returned object, beside `kind`:

```js
    // Closed and derived, only meaningful for a research programme: the pair is
    // what the engine prices. Anywhere else they are empty rather than left to
    // look like a value some other code should read.
    domain: isResearch ? resolveResearchDomain(entry.domain) : "",
    scale: isResearch ? resolveResearchScale(entry.scale) : "",
    // ENGINE-ONLY, and deliberately absent from PROJECT_FIELD_ALIASES,
    // PROJECT_PATCHABLE_FIELDS and projectSchema, so no model can read, set or
    // forge it. It is the accumulated research points the engine has spent; the
    // percent the board shows is derived from it.
    researchPoints: isResearch
      ? Math.max(0, Math.trunc(Number(entry.researchPoints)) || 0)
      : 0,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "src/runtime/gameState.research.test.js"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/gameState.js src/runtime/gameState.research.test.js
git commit -m "feat(runtime): persist research programme fields"
```

---

### Task 5: The model guard on research progress and completion

**Files:**
- Modify: `src/runtime/gameState.js`
- Test: `src/runtime/gameState.research.test.js` (append)

**Interfaces:**
- Consumes: Task 4's fields, `applyProjectOps`, `releaseProjectCompletionEffects`.
- Produces:
  - `applyProjectOps(projects, ops, ctx)` accepts `ctx.engineSourced = false`. When the target's `kind === "research"` and `engineSourced` is false, a `progress` patch is ignored and a `close`/`status:"complete"` is ignored; a `researchPoints` value is copied only when `engineSourced` is true.
  - `releaseProjectCompletionEffects(projects, ops, { engineSourced = false } = {})` requires `engineSourced` before it treats a research-kind project as completing.

- [ ] **Step 1: Write the failing test**

```js
// append to src/runtime/gameState.research.test.js
import { applyProjectOps, releaseProjectCompletionEffects } from "../runtime/gameState.js";

const researchBoard = () => normalizeProjects([
  {
    id: "rx", name: "Reactor", kind: "research", domain: "nuclear", scale: "large", status: "active",
    onComplete: { polityChanges: [{ polity: "France", field: "stability", delta: 5 }] },
  },
]);

test("the model cannot set progress on a research programme", () => {
  const next = applyProjectOps(researchBoard(), [{ op: "update", projectId: "rx", patch: { progress: 90 } }], {});
  assert.equal(next[0].progress, 0);
});

test("the model cannot complete a research programme or release its effects", () => {
  const ops = [{ op: "close", projectId: "rx", status: "complete" }];
  const released = releaseProjectCompletionEffects(researchBoard(), ops, {});
  assert.equal(released.projectIds.length, 0);
  const next = applyProjectOps(researchBoard(), ops, {});
  assert.equal(next[0].status, "active");
});

test("the engine path may write progress, points and completion", () => {
  const ops = [
    { op: "update", projectId: "rx", patch: { progress: 50, researchPoints: 480 } },
    { op: "close", projectId: "rx", status: "complete" },
  ];
  const released = releaseProjectCompletionEffects(researchBoard(), ops, { engineSourced: true });
  assert.deepEqual(released.projectIds, ["rx"]);
  const next = applyProjectOps(researchBoard(), ops, { engineSourced: true });
  assert.equal(next[0].progress, 100);
  assert.equal(next[0].status, "complete");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "src/runtime/gameState.research.test.js"`
Expected: FAIL, the model progress patch lands (90).

- [ ] **Step 3: Write minimal implementation**

In `releaseProjectCompletionEffects`, change the signature to accept the flag
and gate a research completion on it, immediately after `completing` is computed:

```js
export const releaseProjectCompletionEffects = (projects, ops, { engineSourced = false } = {}) => {
```

```js
    // A research programme's completion is the engine's to give. A model op that
    // closes one is ignored here exactly as it is ignored in applyProjectOps, so
    // its onComplete effects can never be granted by narration.
    const target0 = list[findProjectIndexForOp(list, op)];
    if (completing && target0?.kind === "research" && !engineSourced) continue;
```

In `applyProjectOps`, thread the flag off `ctx`:

```js
export const applyProjectOps = (projects, ops, ctx = {}) => {
  const { date = "", eventId = "", round = 0, engineSourced = false } = ctx;
```

In the `op.op === "update"` branch, guard the progress field and permit the
engine-only field:

```js
      for (const field of PROJECT_PATCHABLE_FIELDS) {
        // The engine owns a research programme's progress; a model patch against
        // one is dropped rather than applied.
        if (field === "progress" && current.kind === "research" && !engineSourced) continue;
        const alias = patchedAlias(patch, field);
        if (alias) merged[field] = patch[alias];
      }
      // researchPoints is not patchable by any model, but the engine writes it.
      if (engineSourced && patch.researchPoints !== undefined) {
        merged.researchPoints = patch.researchPoints;
      }
```

In the `op.op === "close"` branch, guard a research completion:

```js
    if (op.op === "close") {
      // A model may fail or cancel a research programme, but only the engine may
      // complete one.
      if (current.kind === "research" && op.status === "complete" && !engineSourced) continue;
      const succeeded = op.status === "complete";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "src/runtime/gameState.research.test.js"`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the project suites to prove nothing else moved**

Run: `node --test "src/runtime/gameState.test.js" "src/runtime/gameState.economyEngine.test.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/gameState.js src/runtime/gameState.research.test.js
git commit -m "feat(runtime): guard research progress and completion from the model"
```

---

### Task 6: The adapter: extract, advance, translate

**Files:**
- Modify: `src/runtime/economyEngine.js`
- Test: `src/runtime/economyEngine.research.test.js` (new)

**Interfaces:**
- Consumes: `researchPointsFor` (Task 1), `advanceEconomy`'s `research`/`researchCompletions` (Task 3), `researchCostFor` (Task 1).
- Produces:
  - `buildResearchInput(world) -> { [polity]: { points, programmes } }`. For every polity in `world.countryStats`, `points` is `researchPointsFor({ facilities, population })` where `facilities` is the count of `world.markers` with `ownerCode === polity` and `kind === "research facility"`, and `population` is the polity's `countryStats[polity].population.total`. `programmes` is the polity's `world.projects` entries with `kind === "research"` and `ownerCode === polity` (blank owner means the player polity), mapped to `{ id, domain, scale, points: researchPoints, priority, startedAt, status }`.
  - `advanceWorldEconomy` returns `researchOps: [{ op, projectId, patch?, status? }]` and `research: state.research`. A programme whose accumulated points changed yields `{ op: "update", projectId, patch: { progress, researchPoints } }` with `progress = Math.min(100, Math.floor(100 * accumulated / cost))`. A completion yields that update AND `{ op: "close", projectId, status: "complete" }`.

- [ ] **Step 1: Write the failing test**

```js
// src/runtime/economyEngine.research.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { buildResearchInput } from "./economyEngine.js";

test("capacity counts the polity's research facilities and population", () => {
  const world = {
    countryStats: {
      France: { population: { total: 100000000 }, capital: "Paris" },
    },
    markers: [
      { ownerCode: "France", kind: "research facility" },
      { ownerCode: "France", kind: "research facility" },
      { ownerCode: "France", kind: "naval base" },
      { ownerCode: "Germany", kind: "research facility" },
    ],
    projects: [
      { id: "rx", kind: "research", ownerCode: "France", domain: "nuclear", scale: "large", status: "active" },
    ],
  };
  const input = buildResearchInput(world);
  // 1 base + 2*2 facilities + floor(100m/50m)=2 -> 7
  assert.equal(input.France.points, 7);
  assert.deepEqual(input.France.programmes.map((p) => p.id), ["rx"]);
});

test("a polity with no programmes is present so the advance can skip it cleanly", () => {
  const world = { countryStats: { France: { population: { total: 0 } } }, markers: [], projects: [] };
  const input = buildResearchInput(world);
  assert.equal(input.France.points, 1);
  assert.deepEqual(input.France.programmes, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "src/runtime/economyEngine.research.test.js"`
Expected: FAIL, `buildResearchInput is not a function`.

- [ ] **Step 3: Write minimal implementation**

At the top of `src/runtime/economyEngine.js`:

```js
import { normalizeProjects, UNIT_TYPES } from "./gameState.js";
import { researchCostFor, researchPointsFor } from "../engine/research.js";
```

(`normalizeProjects` and `UNIT_TYPES` are already exported from `gameState.js`;
only add what is not already imported. Keep the existing `applyCountryStatPatchToWorld`
import.)

```js
// The research input the pure core needs, derived once from the opening world:
// the facilities a polity has actually built and the population behind them.
// A facility finished by the production line inside this same span is applied to
// world.markers only after the advance returns, so it raises capacity next
// period - the same deliberate one-period lag upkeep already has.
export const buildResearchInput = (world) => {
  const input = {};
  const stats = world?.countryStats ?? {};
  const projects = normalizeProjects(world?.projects);
  for (const [polity, sheet] of Object.entries(stats)) {
    const facilities = (Array.isArray(world?.markers) ? world.markers : []).filter(
      (marker) => String(marker?.ownerCode ?? "").trim() === polity
        && String(marker?.kind ?? "").toLowerCase() === "research facility",
    ).length;
    const population = Number(sheet?.population?.total) || 0;
    const programmes = projects
      .filter((project) => project.kind === "research"
        && (project.ownerCode === polity || (project.ownerCode === "" && polity === (world?.playerCountry ?? ""))))
      .map((project) => ({
        id: project.id,
        domain: project.domain,
        scale: project.scale,
        points: project.researchPoints,
        priority: project.priority,
        startedAt: project.startedAt,
        status: project.status,
      }));
    input[polity] = { points: researchPointsFor({ facilities, population }), programmes };
  }
  return input;
};
```

In `advanceWorldEconomy`, build the input and thread it:

```js
  const researchInput = buildResearchInput(world);
  const { state, journal, completions, rejectedProduction, researchCompletions } = advanceEconomy(
    { ...committed, research: researchInput },
    {
      startDate: fromDate, months, shocks: applied, seed,
      upkeep: upkeepTable, posture, orders: appliedOrders,
    },
  );
```

After the existing `completionBatches` line, build the ops. `progress` is derived
from the exact accumulated points, so a long programme never loses a month to
rounding; the pre-change value is read from `researchInput`:

```js
  const researchOps = [];
  for (const [polity, before] of Object.entries(researchInput)) {
    const after = state.research?.[polity];
    if (!after) continue;
    const priorById = new Map(before.programmes.map((p) => [p.id, p.points]));
    for (const programme of after.programmes) {
      if (programme.accumulated === priorById.get(programme.id)) continue;
      // The stored cost: normalizeResearchProgrammes already priced the programme
      // and dropped domain/scale, so researchCostFor would fall back to the default.
      const cost = Number(programme.cost) || researchCostFor(programme);
      researchOps.push({
        op: "update",
        projectId: programme.id,
        patch: {
          progress: Math.min(100, Math.floor((100 * programme.accumulated) / cost)),
          researchPoints: programme.accumulated,
        },
      });
    }
  }
  for (const completion of researchCompletions) {
    researchOps.push({ op: "close", projectId: completion.id, status: "complete" });
  }
```

Add `researchOps` to the returned object.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "src/runtime/economyEngine.research.test.js"`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the adapter suites**

Run: `node --test "src/runtime/economyEngine.test.js"`
Expected: PASS. The production path is unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/economyEngine.js src/runtime/economyEngine.research.test.js
git commit -m "feat(runtime): derive research capacity and emit progress ops"
```

---

### Task 7: Apply research ops on the jump, engine-sourced

**Files:**
- Modify: `src/runtime/gameState.js` (add the flag to `applyProjectOpsToWorld`)
- Modify: `src/Game/AI/gameplay.js`
- Test: `src/Game/AI/researchWiring.test.js` (new)

**Interfaces:**
- Consumes: `researchOps` from Task 6; the guard from Task 5.
- Produces: `applyProjectOpsToWorld({ ..., engineSourced = false })` threads an engine-only flag to its release predicate and its `applyProjectOps` call; `gameplay.js` applies the advance's `researchOps` through `applyProjectOpsToWorld` with `engineSourced: true` immediately after the production completion batches are applied.

`applyEventImpactsToWorld` is deliberately NOT changed. Research ops are applied
through `applyProjectOpsToWorld` directly, never as event impacts, so threading a
flag it would never receive is dead surface. The model's event path keeps the
default `engineSourced = false` and is therefore guarded, which is the point.

- [ ] **Step 1: Write the failing test**

```js
// src/Game/AI/researchWiring.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");

test("the jump applies the engine's research ops with the engine flag", () => {
  assert.match(gameplay, /researchOps/);
  assert.match(gameplay, /engineSourced:\s*true/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "src/Game/AI/researchWiring.test.js"`
Expected: FAIL, `researchOps` absent from `gameplay.js`.

- [ ] **Step 3: Write minimal implementation**

In `src/runtime/gameState.js`, add `engineSourced = false` to
`applyProjectOpsToWorld`'s parameters, pass it to its
`releaseProjectCompletionEffects(nextWorld.projects, resolved, { engineSourced })`
predicate call, and pass it as `{ date, eventId, round, engineSourced }` to the
final `applyProjectOps(...)`.

In `src/Game/AI/gameplay.js`, find where the advance result's `completionBatches`
are applied (the production wiring added this), and immediately beside it apply
the research ops:

```js
    // Research progress and completion are the engine's writes, so they go through
    // the project door with the engine flag: it is what lets the model guard in
    // applyProjectOps tell an engine completion from a narrated one.
    if (Array.isArray(advanced?.researchOps) && advanced.researchOps.length) {
      const applied = applyProjectOpsToWorld({
        world: nextWorld,
        ops: advanced.researchOps,
        date: toDate,
        round,
        engineSourced: true,
      });
      nextWorld = applied.world;
    }
```

Use the existing local names for the world, the round and the destination date
in that scope; the point is the call and its `engineSourced: true`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "src/Game/AI/researchWiring.test.js"`
Expected: PASS.

- [ ] **Step 5: Run the AI wiring suites**

Run: `node --test "src/Game/AI/productionWiringArchitecture.test.js" "src/Game/AI/forceWiringArchitecture.test.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/gameState.js src/Game/AI/gameplay.js src/Game/AI/researchWiring.test.js
git commit -m "feat(ai): apply the engine's research progress on the jump"
```

---

### Task 8: The schema and the prompt rule

**Files:**
- Modify: `src/Game/AI/gameplaySchemas.js`
- Modify: `src/Game/AI/gameplayPrompts.js`
- Modify: `src/Game/AI/projectsDirective.js` (the declaration rule, appended at call time)
- Test: `src/Game/AI/researchPrompt.test.js` (new)
- Test: `src/Game/AI/projectOpSchema.test.js` (re-verify the size guard)

**Interfaces:**
- Consumes: the `research` kind and the `domain`/`scale` values (Task 4).
- Produces: `projectSchema.properties.kind` enum includes `"research"`; `projectSchema.properties` and `projectOpSchema.properties` gain `domain` and `scale` (closed enums from `RESEARCH_DOMAINS`/`RESEARCH_SCALES`). The declare-never-progress rule does NOT go in the jump contract: a jump no longer emits project ops, so the model that DECLARES a programme is the separate `projects` task. The rule is delivered to it as a call-time directive, `buildResearchBoardDirective` in `projectsDirective.js`, appended in `gameplay.js` for `taskKey === "projects"` (the frozen `defaultPrompts.json` template cannot carry it to existing campaigns). `buildProductionInstructions` keeps only the jump-narration paragraph: the jump must not state research progress in what it narrates.

- [ ] **Step 1: Write the failing test**

```js
// src/Game/AI/researchPrompt.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { buildProductionInstructions } from "./gameplayPrompts.js";
import { JUMP_FORWARD_SCHEMA } from "./gameplaySchemas.js";

test("the jump schema accepts a research programme with domain and scale", () => {
  const json = JSON.stringify(JUMP_FORWARD_SCHEMA);
  assert.match(json, /"research"/);
  assert.match(json, /"domain"/);
  assert.match(json, /"scale"/);
  assert.match(json, /"nuclear"/);
});

test("the instruction tells the model to declare research, never progress it", () => {
  const text = buildProductionInstructions({ digest: "" });
  assert.match(text, /research/i);
  assert.match(text, /do not state its progress/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "src/Game/AI/researchPrompt.test.js"`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

In `src/Game/AI/gameplaySchemas.js`, import the enums (the file is runtime-free,
so import the pure core directly):

```js
import { RESEARCH_DOMAINS, RESEARCH_SCALES } from "../../engine/research.js";
```

Add `"research"` to the `kind` enum in `projectSchema.properties.kind`, and add
two properties to `projectSchema.properties`:

```js
    domain: { type: "string", enum: [...RESEARCH_DOMAINS], description: "For kind research only: what field the programme is in. Omit otherwise." },
    scale: { type: "string", enum: [...RESEARCH_SCALES], description: "For kind research only: how large the programme is. Omit otherwise." },
```

Reference the same two properties from `projectOpSchema.properties` beside the
existing `projectSchema.properties.kind` line:

```js
    domain: projectSchema.properties.domain,
    scale: projectSchema.properties.scale,
```

In `src/Game/AI/projectsDirective.js`, add the declaration rule as a call-time
directive (`buildResearchBoardDirective`), following the `buildBoardPassDirective`
pattern: a jump no longer emits project ops, so the declaring model is the
separate `projects` task, and every campaign keeps a frozen copy of that task's
template.

```js
// src/Game/AI/projectsDirective.js
export const buildResearchBoardDirective = () => [
  "[Research Programmes]",
  "A research programme is recorded as kind \"research\" with a domain and a scale. Open one with op create when an event "
    + "starts it. The ENGINE funds and advances it out of the country's research capacity, so never write its progress "
    + "and never mark it complete - that is the engine's. You may still fail or cancel one when the events end it that way.",
].join("\n");
```

Import it in `src/Game/AI/gameplay.js` beside `buildBoardPassDirective` and append
it unconditionally for `taskKey === "projects"`. Also keep the jump-narration
paragraph in `buildProductionInstructions` (`src/Game/AI/gameplayPrompts.js`): the
jump still must not invent research progress in its narration.

```js
// appended to the instructions returned by buildProductionInstructions
"A research programme is a project with kind \"research\" and a domain and scale; "
+ "the engine advances it by the country's research points and completes it, so "
+ "do not state its progress and do not mark it complete. Narrate the queue the "
"digest reports.",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "src/Game/AI/researchPrompt.test.js"`
Expected: PASS.

- [ ] **Step 5: Verify the schema size budget**

Run: `node --test "src/Game/AI/projectOpSchema.test.js"`
Expected: PASS. If the two fields push `jumpChars` at or over `29500`, shorten
their descriptions (do not raise the budget); re-run.

- [ ] **Step 6: Commit**

```bash
git add src/Game/AI/gameplaySchemas.js src/Game/AI/gameplayPrompts.js src/Game/AI/researchPrompt.test.js
git commit -m "feat(ai): declare research programmes in the jump schema"
```

---

### Task 9: The digest research line

**Files:**
- Modify: `src/runtime/economyDigest.js`
- Modify: `src/Game/AI/gameplay.js` (inject the player's research input into the digest call)
- Test: `src/runtime/economyDigest.test.js` (append)

**Interfaces:**
- Consumes: `researchQueueFor`/`researchCostFor` (Task 1/2) and `buildResearchInput` (Task 6).
- Produces: `buildEconomyDigest({ ..., research = null })` gains an optional player research summary `{ points, programmes: [{ id, name, accumulated, cost }] }` and emits one player-only line: the monthly points, the head programme and its percent, and how many are queued behind it. Absent or empty research emits nothing.

- [ ] **Step 1: Write the failing test**

```js
// append to src/runtime/economyDigest.test.js
import { buildEconomyDigest } from "./economyDigest.js";

test("the research line reports the rate, the head and the queue depth", () => {
  const digest = buildEconomyDigest({
    playerPolity: "France",
    deltas: [],
    research: {
      points: 5,
      programmes: [{ id: "a", name: "Reactor", accumulated: 30, cost: 60 }],
    },
  });
  assert.match(digest, /Research: 5\/month/);
  assert.match(digest, /Reactor 50%/);
});

test("there is no research line when the player has no programmes", () => {
  const digest = buildEconomyDigest({ playerPolity: "France", deltas: [], research: { points: 3, programmes: [] } });
  assert.doesNotMatch(digest, /Research:/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "src/runtime/economyDigest.test.js"`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

In `src/runtime/economyDigest.js`, add a clause helper beside
`productionClauseFor`:

```js
// What the country is researching: the rate, the programme at the head of the
// queue and how far it has got, and how many wait behind it. Player-only, like
// the production line: an enemy's research rate is intelligence, not a digest.
const researchClauseFor = (research) => {
  if (!research || !Array.isArray(research.programmes) || !research.programmes.length) return "";
  const head = research.programmes[0];
  const pct = head.cost > 0 ? Math.min(100, Math.floor((100 * head.accumulated) / head.cost)) : 0;
  const behind = research.programmes.length - 1;
  const queue = behind > 0 ? `, ${behind} queued` : "";
  return `Research: ${research.points}/month on ${head.name} (${pct}%${queue}).`;
};
```

Accept `research = null` in the destructured parameters, compute
`const researchLine = researchClauseFor(research);`, and fold it into the
reserve block beside `productionLine`:

```js
  const reserveBlock = [poolLine, productionLine, researchLine].filter(Boolean).join("\n");
```

In `src/Game/AI/gameplay.js`, wherever the economy digest is built for the jump,
pass the player's research summary built from `buildResearchInput` mapped to
`{ points, programmes: [{ id, name, accumulated, cost }] }` (join the programme
ids to their project names and the core cost). Only the player's polity is
passed.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "src/runtime/economyDigest.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/economyDigest.js src/runtime/economyDigest.test.js src/Game/AI/gameplay.js
git commit -m "feat(runtime): report the research queue in the digest"
```

---

### Task 10: The Projects panel

**Files:**
- Modify: `src/Game/GameUI/projects.jsx`
- Test: `src/Game/GameUI/projectsResearch.test.js` (new, source-structure)

**Interfaces:**
- Consumes: the `domain`, `scale` and `kind: "research"` fields (Task 4).
- Produces: a research-kind badge and a `domain / scale` line on the card.

- [ ] **Step 1: Write the failing test**

```js
// src/Game/GameUI/projectsResearch.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./projects.jsx", import.meta.url), "utf8");

test("the projects panel renders research programmes distinctly", () => {
  assert.match(src, /research/);
  assert.match(src, /\.domain/);
  assert.match(src, /\.scale/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "src/Game/GameUI/projectsResearch.test.js"`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

In `src/Game/GameUI/projects.jsx`, in the card header where the kind is already
shown, render a research badge when `project.kind === "research"` and a line
`{project.domain} / {project.scale}` beneath it. Follow the existing class
conventions in that file; do not add a new panel or a new control. The progress
bar stays as it is: it was never a player control, and for research the engine
now writes it.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "src/Game/GameUI/projectsResearch.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Game/GameUI/projects.jsx src/Game/GameUI/projectsResearch.test.js
git commit -m "feat(ui): show research programmes on the projects board"
```

---

### Task 11: Wiring architecture guard

**Files:**
- Create: `src/runtime/researchWiringArchitecture.test.js`

**Interfaces:**
- Consumes: the source of `gameplay.js`, `economyEngine.js` and `gameState.js`.
- Produces: a source-structure guard, in the style of the existing
  `productionWiringArchitecture.test.js`, asserting the research path is wired
  and the guard is present.

- [ ] **Step 1: Write the failing test**

```js
// src/runtime/researchWiringArchitecture.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("the engine derives research and emits engine-sourced ops", () => {
  assert.match(read("./economyEngine.js"), /buildResearchInput/);
  assert.match(read("./economyEngine.js"), /researchOps/);
});

test("the model guard is present on the research kind", () => {
  const gameState = read("./gameState.js");
  assert.match(gameState, /engineSourced/);
  assert.match(gameState, /kind === "research"/);
});

test("the jump applies the research ops with the engine flag", () => {
  const gameplay = read("../Game/AI/gameplay.js");
  assert.match(gameplay, /researchOps/);
  assert.match(gameplay, /engineSourced:\s*true/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "src/runtime/researchWiringArchitecture.test.js"`
Expected: PASS only if Tasks 5-7 are done; run it after them. (If run now, it
fails on the missing `buildResearchInput`.)

- [ ] **Step 3: Adjust the assertions to the exact identifiers used**

If a name in the implementation differs from the sketch above, change the
assertion to the real identifier rather than the implementation - the guard's
job is to pin the structure that shipped. Keep it a source-structure guard; do
not assert runtime behaviour here.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "src/runtime/researchWiringArchitecture.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/researchWiringArchitecture.test.js
git commit -m "test(runtime): guard the research wiring architecture"
```

---

### Task 12: Documentation and the wiki

**Files:**
- Modify: `docs/world-state.md`
- Modify: `docs/ai-overview.md`
- Modify: `docs/ai-schemas.md`
- Modify: `docs/runtime-services.md`
- Modify: `wiki/systems/projects.md`
- Regenerate: `public/wiki/**`

**Interfaces:**
- Consumes: everything shipped above.
- Produces: the player-facing and contributor-facing documentation of the rule.

- [ ] **Step 1: Update `docs/world-state.md`**

Add the research programme fields to the projects section: `kind: "research"`
with closed `domain` and `scale` and the engine-owned integer `researchPoints`.
State explicitly that capacity is derived from `world.markers` research
facilities and population and is never stored, and that a research programme's
`progress` is derived by the engine (not a model field).

- [ ] **Step 2: Update `docs/ai-overview.md` and `docs/ai-schemas.md`**

State the declare-never-progress rule and the `domain`/`scale` enums in the
project op. Mirror the existing production-orders wording.

- [ ] **Step 3: Update `docs/runtime-services.md`**

Add the research capacity consumer beside the production line: the same month
loop, the sequential allocation, the one-period facility lag.

- [ ] **Step 4: Update `wiki/systems/projects.md`**

Replace the forward-looking note ("There is no tech tree; there is a research
programme with milestones that either progresses or stalls.") with the shipped
rule: a research programme is declared with a domain and a scale, the engine
advances it by the country's monthly research points (one programme at a time,
in priority order), and the player steers it with priority and by keeping it
running. Say plainly that completing the programme releases its effects and that
the country's facilities set the rate.

- [ ] **Step 5: Regenerate and verify the wiki**

Run: `npm run build:wiki`
Run: `npm run wiki:check`
Expected: `Wiki is current.`

- [ ] **Step 6: Commit**

```bash
git add docs/world-state.md docs/ai-overview.md docs/ai-schemas.md docs/runtime-services.md wiki/systems/projects.md public/wiki
git commit -m "docs(engine): document deterministic research programmes"
```

---

## Self-Review

**Spec coverage.** Every numbered design section maps to a task: layers and one
clock (Tasks 1-3, 6), a research programme is a project (Tasks 4-5), capacity and
the sequential rule (Tasks 1-2), progress and completion (Tasks 4-6), the model
guard (Task 5), persistence (Task 4), digest and prompt (Tasks 8-9), UI (Task
10), interaction with earlier increments (Tasks 3, 6 - the facility is read from
markers the production line writes), documentation (Task 12). The two implicit
decisions the user approved (queue order; the constant table) are implemented in
Tasks 1-2 with tests.

**Placeholder scan.** No `TBD`, `TODO` or "handle edge cases" remains. The
duplicated-object-shape checks are concrete. The one place a name may differ
(Task 11's assertions, and Task 7/9's existing local scope names) is called out
with the rule to follow.

**Type consistency.** `stepResearchMonth` takes `{ points, programmes }` and
returns `{ programmes, completions }` in every task that names it.
`normalizeResearchProgrammes` produces `{ id, cost, accumulated, priority,
startedAt, status }` and `researchQueueFor` consumes exactly that. The adapter's
`research` input `{ points, programmes: [{ id, domain, scale, points, priority,
startedAt, status }] }` matches what `normalizeResearchProgrammes` expects.
`researchOps` is `{ op, projectId, patch?, status? }`, which is what
`applyProjectOps` consumes. `engineSourced` is one name everywhere.

**Known risk to watch during execution.** The jump-schema size budget
(`jumpChars < 29500`) is tight; Task 8 Step 5 pins it. If it fails, shorten the
two new property descriptions rather than raising the budget.
