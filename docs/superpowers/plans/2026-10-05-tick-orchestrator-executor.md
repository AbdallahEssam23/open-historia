# Tick Orchestrator Executor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure runtime executor that runs registered phase handlers in the order `TICK_PHASES` declares, and move the first clean run of four phases (`treatyBreaches`, `casusBelli`, `treatyObligations`, `reparations`) behind it byte for byte.

**Architecture:** `src/runtime/simulationTick.js` exports `runSimulationTick({ handlers, phases })`, which derives its plan from `TICK_PHASES` and the registered handler keys and awaits each handler in turn. `applySimulationResult` builds a `tickHandlers` object holding the four phase bodies unchanged and calls the executor. A source-text guard pins the wiring; the twenty-first increment's order guard keeps pinning the whole sequence. No phase is added, removed, gated or re-implemented; the other twelve phases and the interleaved deterministic steps stay where they are.

**Tech Stack:** Node.js ESM, `node --test`, no framework, no new dependency.

## Global Constraints

- ASCII only in source and docs. No emoji, no em dash, no middle dot.
- No new `package.json` entry and no new runtime dependency.
- `src/engine/**` must stay free of browser globals and of imports outside the allow list: no `window`, `document`, `localStorage`, `Date.now`, `new Date`, `Math.random`, `fetch`. `src/engine/enginePurity.test.js` enforces this over the whole directory. This increment does not touch `src/engine`.
- `src/runtime/**` must never import a `src/Game/AI/**` module. `src/runtime/simulationTick.js` imports only `../engine/tickSchedule.js`.
- No behavior change: no phase is added, removed, gated differently or re-implemented. The four pilot phases keep their exact bodies, their `try`/`catch` and their comments; the executed order stays the declared order. The eleven existing wiring guards and their assertions stay untouched.
- No new stored shape, no schema change, no `ENGINE_VERSION` bump and no migration.
- Do not edit an existing test to accommodate a change.
- Tests are run with a glob, never a bare directory: `node --test "src/runtime/*.test.js"`, `node --test "src/Game/AI/*.test.js"`.
- `src/Game/AI/gameplay.js` imports `./main.jsx`, and `.jsx` cannot be imported under `node --test`, so the turn's wiring is pinned by reading the source as text.
- Commit messages are conventional and do NOT include the `Co-authored-by:` trailer. The `prepare-commit-msg` hook adds it.
- The spec for this plan is `docs/specs/2026-10-05-tick-orchestrator-executor-design.md`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/runtime/simulationTick.js` (new) | The executor: `runSimulationTick({ handlers, phases })`. Imports only `../engine/tickSchedule.js`. |
| `src/runtime/simulationTick.test.js` (new) | Pins the sequencing, the plan derivation, the unknown-key rejection and the empty case. |
| `src/Game/AI/gameplay.js` (modify) | Imports the executor; the four pilot phases move into `tickHandlers`; the call replaces the inline block. |
| `src/runtime/simulationTickWiringArchitecture.test.js` (new) | Pins the executor's wiring in the `applySimulationResult` region. |
| `docs/runtime-services.md` | A paragraph naming the executor and the pilot. |

---

### Task 1: The executor

**Files:**
- Create: `src/runtime/simulationTick.js`
- Test: `src/runtime/simulationTick.test.js`

**Interfaces:**
- Consumes: `TICK_PHASES` from `src/engine/tickSchedule.js` (a frozen array of frozen `{ id, anchors, requires }` descriptors, in declared order).
- Produces: `runSimulationTick({ handlers = {}, phases = TICK_PHASES } = {})`, an async function returning a promise of the ordered array of phase ids it ran. `handlers` maps a phase id to a `() => unknown` (sync or async) handler; only keys naming a declared phase are allowed as functions; a function under an unknown key rejects; a non-function value is ignored; missing phases are skipped.

- [ ] **Step 1: Write the failing test**

Create `src/runtime/simulationTick.test.js`:

```js
// Run: node --test src/runtime/simulationTick.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { runSimulationTick } from "./simulationTick.js";
import { TICK_PHASES } from "../engine/tickSchedule.js";

const PILOT = ["treatyBreaches", "casusBelli", "treatyObligations", "reparations"];

test("the plan is the declared order, not the object's key order", async () => {
  const trace = [];
  // Written in reverse; the executor must still run them in TICK_PHASES order.
  const handlers = {
    reparations: () => trace.push("reparations"),
    treatyObligations: () => trace.push("treatyObligations"),
    casusBelli: () => trace.push("casusBelli"),
    treatyBreaches: () => trace.push("treatyBreaches"),
  };
  const plan = await runSimulationTick({ handlers });
  assert.deepEqual(trace, PILOT);
  assert.deepEqual(plan, PILOT);
});

test("the pilot ids are declared phases", () => {
  const ids = TICK_PHASES.map((phase) => phase.id);
  for (const id of PILOT) assert.ok(ids.includes(id), `${id} must be a declared phase`);
});

test("an async handler is awaited before the next one runs", async () => {
  const trace = [];
  const handlers = {
    treatyBreaches: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      trace.push("treatyBreaches");
    },
    casusBelli: () => trace.push("casusBelli"),
  };
  await runSimulationTick({ handlers });
  assert.deepEqual(trace, ["treatyBreaches", "casusBelli"]);
});

test("a function under an unknown key is rejected", async () => {
  await assert.rejects(
    () => runSimulationTick({ handlers: { nonsense: () => {} } }),
    /unknown phase handler "nonsense"/,
  );
});

test("a non-function value is not a handler", async () => {
  assert.deepEqual(await runSimulationTick({ handlers: { treatyBreaches: 42 } }), []);
});

test("no handlers runs nothing and returns an empty plan", async () => {
  assert.deepEqual(await runSimulationTick(), []);
  assert.deepEqual(await runSimulationTick({ handlers: {} }), []);
});

test("a custom phase list sets the order", async () => {
  const trace = [];
  const phases = [{ id: "b" }, { id: "a" }];
  const handlers = { a: () => trace.push("a"), b: () => trace.push("b") };
  const plan = await runSimulationTick({ phases, handlers });
  assert.deepEqual(trace, ["b", "a"]);
  assert.deepEqual(plan, ["b", "a"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/runtime/simulationTick.test.js"`
Expected: FAIL, the module `./simulationTick.js` does not exist.

- [ ] **Step 3: Write the minimal implementation**

Create `src/runtime/simulationTick.js`:

```js
/*! Open Historia - the runtime executor for the declared turn phase order (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/runtime/simulationTick.test.js
//
// A turn's deterministic phases run in one declared order (src/engine/
// tickSchedule.js). This executor walks that order and calls the handler each
// phase is given, so the order lives in the schedule and not in the object's
// key order or in the position of a statement. It imports only the schedule:
// the phase bodies read and write the stored world through src/runtime
// adapters, and a runtime module may not import src/Game/AI, so the bodies are
// handed in as handlers by the composition root (applySimulationResult).

import { TICK_PHASES } from "../engine/tickSchedule.js";

// Run the registered phase handlers in the declared schedule order. A handler
// may be sync or async; each is awaited in turn, so a phase sees the world the
// one before it wrote. Returns the ordered list of phase ids it ran.
export const runSimulationTick = async ({ handlers = {}, phases = TICK_PHASES } = {}) => {
  const known = new Set(phases.map((phase) => phase.id));
  for (const id of Object.keys(handlers)) {
    if (typeof handlers[id] === "function" && !known.has(id)) {
      throw new Error(`runSimulationTick: unknown phase handler "${id}"`);
    }
  }
  const plan = phases
    .filter((phase) => typeof handlers[phase.id] === "function")
    .map((phase) => phase.id);
  for (const id of plan) await handlers[id]();
  return plan;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/runtime/simulationTick.test.js"`
Expected: PASS, 7 tests.

Also run: `node --check src/runtime/simulationTick.js`
Expected: no output (syntax OK).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/simulationTick.js src/runtime/simulationTick.test.js
git commit -m "feat(runtime): add the tick orchestrator executor"
```

---

### Task 2: The pilot extraction and its guard

**Files:**
- Modify: `src/Game/AI/gameplay.js` (add the import after line 32; replace the block at lines 7031-7151)
- Test: `src/runtime/simulationTickWiringArchitecture.test.js` (new)

**Interfaces:**
- Consumes: `runSimulationTick({ handlers })` from Task 1.
- Produces: nothing later tasks consume; the guard is the deliverable.

The four pilot phases are the block `src/Game/AI/gameplay.js:7031-7151`: the
breach pre-pass, the casus-belli judgement, the treaty obligations and the
reparations line. They are contiguous (only comments between them) and each
reads and writes `worldWithImpacts` alone. Every name they use
(`breachUpdates`, `warUpdates`, `warMerge`, `dueSettlements`, `nextGame`,
`freshEvents`) is defined before the block.

- [ ] **Step 1: Write the failing guard**

Create `src/runtime/simulationTickWiringArchitecture.test.js`:

```js
// Run: node --test src/runtime/simulationTickWiringArchitecture.test.js
//
// gameplay.js imports main.jsx and cannot be imported by node --test, so its
// wiring is pinned by reading the source. The executor module is read too, to
// keep it import-free except for the schedule.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
const executor = readFileSync(new URL("./simulationTick.js", import.meta.url), "utf8");

const REGION_START = "const applySimulationResult =";
const REGION_END = "const readSeenGameStateBundle =";
const start = gameplay.indexOf(REGION_START);
const end = gameplay.indexOf(REGION_END);
const region = gameplay.slice(start, end);

const CALL = "await runSimulationTick({ handlers: tickHandlers });";
const HANDLERS = "const tickHandlers = {";
const PILOT_ANCHORS = [
  "readTreatyBreaches(worldWithImpacts",
  "readWarCasus(worldWithImpacts",
  "readTreatyObligations(worldWithImpacts",
  "applyWarReparations(worldWithImpacts",
];

const countOf = (text, anchor) => text.split(anchor).length - 1;

test("the executor imports only the schedule", () => {
  const specifiers = [...executor.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(specifiers, ["../engine/tickSchedule.js"]);
});

test("the applySimulationResult region is bounded", () => {
  assert.ok(start > 0, "applySimulationResult is missing");
  assert.ok(end > start, "the region end must follow its start");
});

test("the executor is imported and called exactly once", () => {
  assert.ok(gameplay.includes('from "../../runtime/simulationTick.js"'), "the turn must import the executor");
  assert.equal(countOf(region, CALL), 1, "the executor is called once in the region");
});

test("the four pilot phases live inside the handler object before the call", () => {
  const callAt = region.indexOf(CALL);
  const handlersAt = region.indexOf(HANDLERS);
  assert.ok(handlersAt > 0 && handlersAt < callAt, "the handler object must precede the call");
  for (const anchor of PILOT_ANCHORS) {
    assert.equal(countOf(region, anchor), 1, `the pilot anchor must appear once in the region: ${anchor}`);
    const at = region.indexOf(anchor);
    assert.ok(at > handlersAt && at < callAt, `the pilot anchor must be inside the handler object: ${anchor}`);
  }
});
```

- [ ] **Step 2: Run the guard to verify it fails**

Run: `node --test "src/runtime/simulationTickWiringArchitecture.test.js"`
Expected: FAIL, the turn does not import or call the executor yet.

- [ ] **Step 3: Add the import to `gameplay.js`**

After the import block that ends at line 32
(`} from "../../runtime/warSettlement.js";`), before
`import { applyPeaceOffer } from "./peaceOffer.js";` at line 33, insert:

```js
import { runSimulationTick } from "../../runtime/simulationTick.js";
```

- [ ] **Step 4: Replace the pilot block with the handler object and the call**

Replace `src/Game/AI/gameplay.js:7031-7151` (the four phases and their
comments) with the following. The four phase bodies are the original code
unchanged; only the surrounding nesting and the leading comments' position
change. The comments are kept at the top of the handler they explain.

```js
  // The four phases below are run by one executor that walks the declared
  // schedule (runtime/simulationTick.js). Each handler holds the phase's code
  // unchanged, so the executed order is TICK_PHASES, not this object's key order.
  const tickHandlers = {
    treatyBreaches: () => {
      try {
        const breachOutcome = readTreatyBreaches(worldWithImpacts, {
          breaches: breachUpdates
            .map((update) => ({ agreementId: update?.id, polity: normalizeString(update?.parties?.[0]) }))
            .filter((entry) => entry.agreementId && entry.polity),
        });
        if (breachOutcome.breaches.length) {
          // The breaker is matched through the same owner resolver the breach reader
          // used, so a declaration written with an alias still maps to the party the
          // engine accepted. Matching the agreement id alone would let a rejected
          // non-party overwrite breachedBy on the record the engine did accept.
          const resolveBreaker = createOwnerResolver(buildOwnerAliasMap(worldWithImpacts?.polityOverrides));
          const readBreaker = (value) => resolveBreaker(value) || toCountryName(value) || normalizeString(value);
          const acceptedUpdates = breachUpdates.filter((update) => {
            const breaker = readBreaker(normalizeString(update?.parties?.[0])).toLowerCase();
            return breachOutcome.breaches.some((breach) =>
              breach.agreementId === update.id && breach.polity.toLowerCase() === breaker);
          });
          if (acceptedUpdates.length) {
            const breachMerge = applyDiplomaticUpdates({
              world: worldWithImpacts,
              relationUpdates: [],
              agreementUpdates: acceptedUpdates,
              events: freshEvents,
              stopDate: nextGame.gameDate,
              round: nextGame.round,
            });
            // Charge only the breaches whose agreement record actually landed. One the
            // merge dropped as unbound (no causal event) must not cost reputation while
            // the pact stays active and still draws its allies into the war.
            const landed = new Set(breachMerge.appliedAgreementIds);
            const charged = breachOutcome.breaches.filter((breach) => landed.has(breach.agreementId));
            worldWithImpacts = applyTreatyBreaches(breachMerge.world, charged, {
              date: nextGame.gameDate,
              round: nextGame.round,
            });
          }
        }
        // Log even when every declaration was rejected, so a silently dropped
        // breach leaves a trace in the debug trail rather than vanishing.
        if (breachOutcome.summary.declared) {
          logDebugEvent("turn", `Treaty breaches resolved: ${breachOutcome.summary.accepted} accepted, ${breachOutcome.summary.rejected} rejected.`, {
            accepted: breachOutcome.summary.accepted,
            rejected: breachOutcome.summary.rejected,
          });
        }
      } catch (error) {
        console.warn("[engine] the treaty breach step failed; the completed turn is preserved.", error);
      }
    },
    casusBelli: () => {
      // A war begun this turn is judged for a recorded warrant: a claim on land a
      // defender holds, or a breach by a defender against the aggressor. It runs
      // after the breach pre-pass, so a promise broken this turn justifies a war
      // begun this turn, and before the obligation step. Reading the start records,
      // not the war records, is what keeps a later joiner from being judged an
      // aggressor. Only the starts the ledger actually applied are judged, and each
      // war once, so a re-issued or duplicated start cannot charge twice. A failure
      // here must never lose a completed turn.
      try {
        const appliedWarIds = new Set(normalizeArray(warMerge.appliedIds));
        const judgedWarIds = new Set();
        const casusStarts = warUpdates
          .filter((update) => normalizeString(update?.op).toLowerCase() === "start")
          .filter((update) => appliedWarIds.has(normalizeString(update?.id)))
          .map((update) => ({
            warId: normalizeString(update?.id),
            aggressors: normalizeArray(update?.actors),
            defenders: normalizeArray(update?.opponents),
          }))
          .filter((start) => {
            if (!start.warId || judgedWarIds.has(start.warId)) return false;
            judgedWarIds.add(start.warId);
            return true;
          });
        if (casusStarts.length) {
          const casusOutcome = readWarCasus(worldWithImpacts, {
            starts: casusStarts,
            catalog: getPrimedScenarioRegionCatalog() ?? [],
          });
          if (casusOutcome.wars.length) {
            worldWithImpacts = applyWarCasus(worldWithImpacts, casusOutcome.wars, {
              date: nextGame.gameDate,
              round: nextGame.round,
            });
          }
          // Log even when every aggressor held a warrant, so the judgement is on the
          // trail whether or not a cost fell.
          if (casusOutcome.summary.judged) {
            logDebugEvent("turn", `Wars judged for just cause: ${casusOutcome.summary.unjust} unjust of ${casusOutcome.summary.judged}.`, {
              unjust: casusOutcome.summary.unjust,
              justified: casusOutcome.summary.justified,
            });
          }
        }
      } catch (error) {
        console.warn("[engine] the casus belli step failed; the completed turn is preserved.", error);
      }
    },
    treatyObligations: () => {
      // Treaty obligations: an active alliance, mutual defense or guarantee draws a
      // non-player party into a war the engine already tracks. It runs on the world
      // this turn's warUpdates just produced, so a war opened now drags its allies
      // now, and before the reparations so the join is visible to everything later
      // in the turn. A failure here must never lose a completed turn.
      try {
        const obligationOutcome = readTreatyObligations(worldWithImpacts, {
          playerPolity: normalizeString(baseGame.country),
        });
        if (obligationOutcome.joins.length) {
          worldWithImpacts = applyTreatyJoins(worldWithImpacts, obligationOutcome.joins, {
            date: nextGame.gameDate,
            round: nextGame.round,
          });
          logDebugEvent("turn", `Treaty obligations drew ${obligationOutcome.summary.joined} polity(ies) into active war(s).`, {
            joined: obligationOutcome.summary.joined,
            rejected: obligationOutcome.summary.rejected,
          });
        }
      } catch (error) {
        console.warn("[engine] the treaty obligation step failed; the completed turn is preserved.", error);
      }
    },
    reparations: () => {
      // Reparations move real reserves, so they are paid once the war is closed and
      // the peace event's transfers have already landed.
      worldWithImpacts = applyWarReparations(worldWithImpacts, dueSettlements);
    },
  };
  await runSimulationTick({ handlers: tickHandlers });
```

- [ ] **Step 5: Run the guard and the order guards**

Run: `node --test "src/runtime/simulationTickWiringArchitecture.test.js"`
Expected: PASS, 4 tests.

Run: `node --test "src/Game/AI/tickScheduleWiringArchitecture.test.js"`
Expected: PASS, 4 tests (the whole declared order still holds; the four pilot
anchors still appear once, now inside the object).

Run: `node --test "src/Game/AI/treatyObligationsWiringArchitecture.test.js"`
Expected: PASS (its anchor positions still increase).

Run: `node --test "src/Game/AI/casusBelliWiringArchitecture.test.js"`
Expected: PASS (its anchor positions still increase).

Run: `node --check src/Game/AI/gameplay.js`
Expected: no output (syntax OK).

- [ ] **Step 6: Commit**

```bash
git add src/Game/AI/gameplay.js src/runtime/simulationTickWiringArchitecture.test.js
git commit -m "refactor(ai): run the four treaty phases through the executor"
```

---

### Task 3: Document the executor

**Files:**
- Modify: `docs/runtime-services.md` (a paragraph after the paragraph that ends with "this names it once.", which ends at line 101, before the `---` at line 103)

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing.

- [ ] **Step 1: Add the paragraph**

After the paragraph whose last sentence is "The order used to be an implicit
property of the function's statement sequence, pinned only by pairwise guards;
this names it once." (line 101), before the `---` separator, insert:

```markdown
The declared order now has a runtime executor. `src/runtime/simulationTick.js`
exports `runSimulationTick({ handlers })`: it derives its plan from
`TICK_PHASES` and the registered handler keys, so the order is always the
declared one and never the object's key order, and it awaits each handler in
turn so a phase sees the world the one before it wrote. It imports only the
schedule: the phase bodies read and write the stored world through `src/runtime`
adapters and some live in `src/Game/AI`, and a runtime module may not import
`Game/AI`, so `applySimulationResult` hands the bodies in as handlers. The
first four phases to run behind it are the contiguous treaty run -
`treatyBreaches`, `casusBelli`, `treatyObligations`, `reparations` - moved
unchanged into a `tickHandlers` object in `gameplay.js`; the other twelve
phases and the deterministic steps between them stay inline for later, smaller
moves. A guard (`src/runtime/simulationTickWiringArchitecture.test.js`) bounds
the `applySimulationResult` region, asserts the executor is imported and called
once there, and asserts the four pilot anchors live inside the handler object
before the call.
```

Leave a blank line between the new paragraph and the `---` at line 103, so the
separator stays a horizontal rule instead of a setext heading underline.

- [ ] **Step 2: Check the wiki freshness and commit**

Run: `npm run wiki:check`
Expected: `Wiki is current.`

```bash
git add docs/runtime-services.md
git commit -m "docs(runtime): describe the tick orchestrator executor"
```

---

### Task 4: Whole-suite gate

**Files:**
- None (verification only).

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: 0 failures. The baseline before this increment was 3047 tests (3045
pass, 0 fail, 2 todo); this increment adds its own tests and must lose none.

Run: `node --test "src/engine/*.test.js"`
Expected: PASS, 234 tests (the engine is untouched; `tickSchedule` and
`enginePurity` included).

Run: `node --test "src/runtime/simulationTick.test.js" "src/runtime/simulationTickWiringArchitecture.test.js"`
Expected: PASS, 11 tests.

- [ ] **Step 2: Lint and build**

Run: `npx eslint src/runtime/simulationTick.js src/runtime/simulationTick.test.js src/runtime/simulationTickWiringArchitecture.test.js src/Game/AI/gameplay.js`
Expected: no errors.

Run: `npm run wiki:check`
Expected: `Wiki is current.`

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 3: Confirm the diff is the intended one**

Run: `git diff HEAD~3 --stat`
Expected: the new executor, its two tests, the `gameplay.js` edit (import plus
the handler object) and the docs paragraph only. No `src/engine` file and no
`.test.js` outside the two new ones changed.

No commit is made in this task. If any gate fails, fix the cause and re-run the
whole gate; do not mark the task complete on partial output.

---

## Self-review

- **Spec coverage:** Scope 1 (executor) is Task 1; scope 3 (pilot extraction) and
  scope 4 (guard) are Task 2; scope 5 (docs) is Task 3; the full-gate requirement
  in Testing is Task 4. Scope 2 (unit test) is Task 1.
- **No behavior change:** the four phase bodies are copied verbatim; the only
  change is nesting and the position of the leading comments. No phase outside
  the pilot is touched.
- **Name consistency:** `runSimulationTick`, `tickHandlers` and the `CALL` /
  `HANDLERS` literals are identical in the executor, the tests and the guard.
