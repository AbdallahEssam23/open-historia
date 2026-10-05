<!-- Open Historia - a runtime executor for the declared turn phase order (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# Tick Orchestrator Executor: A Runtime That Walks the Declared Phase Order

The twenty-second increment of the deterministic simulation, and the first that
moves a piece of the turn's ordering out of the statement sequence of
`applySimulationResult` and into a runtime executor. It introduces a pure,
adapter-agnostic module that runs a set of named phase handlers in the order
`TICK_PHASES` declares, and it moves the first clean run of phases behind it as a
pilot. No phase is added, removed, gated or re-implemented, and every phase call
keeps its exact text and position in the turn's control flow.

## Why this increment exists

1. **The order is declared but not executed.** The twenty-first increment
   (`docs/specs/2026-10-05-tick-schedule-design.md`) made the phase order explicit
   in `src/engine/tickSchedule.js` (`TICK_PHASES`) and pinned the executed order to
   it with a source-text guard
   (`src/Game/AI/tickScheduleWiringArchitecture.test.js`). The schedule is data
   with no production consumer: nothing walks it, and the order still lives in the
   position of the statements inside `applySimulationResult`
   (`src/Game/AI/gameplay.js:6527-7861`). The guard proves the two agree today; it
   does not make the schedule the mechanism.

2. **The safe, proven next step is a bounded executor, not a rewrite.** Moving
   all sixteen phases and the deterministic steps between them (the event-impact
   merge, the standing-order advance, the diplomatic merge and the storyline
   merge) behind one executor would re-express ~1200 lines of interleaved state in
   a single increment and would require hoisting many `let` bindings. The
   constitution already fixes the direction
   (`docs/superpowers/specs/2026-10-01-deterministic-core-economy-design.md:82`,
   "the adapter owns the clock and the ordering"): the executor belongs in the
   adapter layer, and the engine keeps only the data. This increment proves the
   executor on the first clean, contiguous run of phases and leaves the rest
   where they are.

3. **Layering forbids the executor from importing the phases.** The phase bodies
   read and write the stored `world` through `src/runtime` adapters and some live
   in `src/Game/AI` (the war ledger, the diplomatic director). A runtime module
   may not import `Game/AI`, so the executor cannot call the phases by name
   itself. It takes them as handlers handed in by the composition root
   (`applySimulationResult`), and it owns only the ordering, the sequencing and
   the plan derivation.

## Scope

1. A pure runtime module `src/runtime/simulationTick.js` exporting:
   - `runSimulationTick({ handlers, phases = TICK_PHASES })`, an async function
     that runs each phase handler in the declared order, awaits each in turn, and
     returns the ordered list of phase ids it ran. It derives the plan from
     `TICK_PHASES` and the registered handler keys, so the object's own key order
     can never change the executed order. It rejects a handler key that does not
     name a declared phase.
2. A unit test `src/runtime/simulationTick.test.js` that pins the sequencing, the
   plan derivation, the unknown-key rejection and the empty case.
3. A pilot extraction inside `applySimulationResult`: the four contiguous phases
   `treatyBreaches`, `casusBelli`, `treatyObligations` and `reparations` move,
   byte for byte, into a `tickHandlers` object, and the turn calls
   `await runSimulationTick({ handlers: tickHandlers })` in their place. The other
   twelve phases and the interleaved deterministic steps are untouched.
4. A source-text architecture guard
   `src/runtime/simulationTickWiringArchitecture.test.js` that bounds the
   `applySimulationResult` region, asserts the executor is imported and called
   once there, and asserts the four pilot phase anchors now live inside the
   handler object ahead of that call rather than inline.
5. A note in `docs/runtime-services.md` describing the executor and the pilot.

## Non-goals

- **No behavior change.** No phase is added, removed, gated differently or
  re-implemented; the four pilot phases keep their exact code, their `try`/`catch`
  wrapping, their comments and their effects. The turn computes exactly what it
  computed before, and every existing guard and test keeps passing unchanged.
- **No full extraction.** The other twelve phases (engagements, settlement,
  supply, reinforcement, the war ledger, espionage, the economy, production and
  the stats history) and the deterministic steps between phases
  (`applyEventImpactsToWorld`, `advanceStandingOrders`, `propagateRenames`,
  `applyDiplomaticUpdates`, `applyWorldStorylineUpdates`) stay where they are.
  They interleave with `let` bindings and with non-deterministic work (curation,
  the board, chats, persistence), and each is a later, separately reviewable move.
- **No `requires` enforcement.** `tickPhasePlan(facts)` and each phase's
  `requires` are not wired to real gates here. Today every phase call runs and
  self-gates internally (for example `isActiveFeatureEnabled("espionage")`), so
  dropping a phase the plan excludes would change behavior. The executor runs
  exactly the handlers it is given, in the schedule order; making `requires`
  authoritative is a behavior change and a later increment.
- **No phase is moved into `src/engine`.** The schedule stays data; the executor
  stays a runtime adapter. Nothing new is added to `src/engine`.
- **No new stored shape, no schema change, no `ENGINE_VERSION` bump and no
  migration.**

## Design

### 1. Layers

| Layer | Location | What lives here |
| --- | --- | --- |
| The schedule | `src/engine/tickSchedule.js` | `TICK_PHASES`, `tickPhasePlan(facts)` (unchanged) |
| The executor | `src/runtime/simulationTick.js` | `runSimulationTick({ handlers, phases })`; imports only `../engine/tickSchedule.js` |
| The composition | `src/Game/AI/gameplay.js` `applySimulationResult` | builds `tickHandlers` from the four pilot phase bodies and calls the executor |
| The guard | `src/runtime/simulationTickWiringArchitecture.test.js` | pins the executor's wiring in the bounded region |
| The prose | `docs/runtime-services.md` | the executor and the pilot |

The dependency direction is the house one: `src/engine` imports nothing; the
executor imports `src/engine`; `src/Game/AI` imports both. The executor imports
no `src/Game/AI` module, so the forbidden `runtime -> Game/AI` direction is never
created.

### 2. The executor

```js
import { TICK_PHASES } from "../engine/tickSchedule.js";

// Run the registered phase handlers in the declared schedule order. The order
// is TICK_PHASES, never the object's key order. A handler may be sync or async;
// each is awaited in turn so a phase sees the world the one before it wrote.
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

- The plan is always a projection of `TICK_PHASES`, so a handler object written
  in any key order runs in the declared order. The unit test passes the handlers
  reversed to prove it.
- A registered key that names no declared phase is a typo that would otherwise
  be a silently skipped phase; it throws instead. A key whose value is not a
  function is ignored (it is not a handler).
- Missing phases are not an error: the executor runs the coverage it is given.
  The pilot gives it four; a later increment gives it more.
- The module is pure in the engine sense: no `Date.now`, no `new Date`, no
  `Math.random`, no browser global, no `fetch`. It imports the schedule and
  nothing else.

### 3. The pilot extraction

The four phases `treatyBreaches` (the breach pre-pass), `casusBelli` (the just-
cause judgement), `treatyObligations` (the joins) and `reparations` are the first
`try`-wrapped run in the region and are contiguous: between them there are only
comments, and each reads and writes `worldWithImpacts` alone. They are extracted
unchanged:

1. The block `gameplay.js:7031-7151` becomes
   `const tickHandlers = { treatyBreaches: () => { ... }, casusBelli: () => { ... },
   treatyObligations: () => { ... }, reparations: () => { ... } };`, each handler
   body the exact original text (the two `try`/`catch` blocks and the reparations
   line), followed by `await runSimulationTick({ handlers: tickHandlers });`.
2. The handlers are closures over the same `let worldWithImpacts` the inline
   statements wrote, so assigning it inside a handler has exactly the effect the
   inline assignment had. Every name they use (`breachUpdates`, `warUpdates`,
   `warMerge`, `dueSettlements`, `nextGame`, `freshEvents`) is defined before the
   object; nothing needs hoisting.
3. The comments above each phase move with it, so the rationale stays beside the
   code it explains.

Because the order in the object matches `TICK_PHASES`, the executed order is
unchanged, and the eleven existing pairwise guards (which compare the global
positions of the phase call literals) stay green: the literals remain in
`gameplay.js`, in the same relative order, now inside the object.

### 4. The guard

`src/runtime/simulationTickWiringArchitecture.test.js` reads
`src/Game/AI/gameplay.js` as text (it cannot be imported, because it imports
`main.jsx`). It:

1. imports `runSimulationTick` and asserts the executor module is import-free
   except for the schedule, mirroring the engine purity check;
2. bounds the region from `const applySimulationResult =` to
   `const readSeenGameStateBundle =`;
3. asserts `runSimulationTick` is imported once and called exactly once in the
   region;
4. asserts each of the four pilot anchors (`readTreatyBreaches(worldWithImpacts`,
   `readWarCasus(worldWithImpacts`, `readTreatyObligations(worldWithImpacts`,
   `applyWarReparations(worldWithImpacts`) appears exactly once in the region and
   before the executor call, so a phase left inline after the call fails.

It complements `tickScheduleWiringArchitecture.test.js`, which still asserts the
whole declared order; the two guards together say the order is declared, is
walked, and starts with the four phases behind the executor.

### 5. What stays the same

- Every phase call not in the pilot, its arguments, its condition and its effects
  are byte for byte unchanged.
- The interleaved deterministic steps and the non-deterministic work (curation,
  the board, the economy, chats, history, persistence) are untouched.
- The Game Master apply path, the projection dry run, the bootstrap paths and the
  interactive scene are untouched.

## Compatibility

The executor is code, not stored shape, so a save loads unchanged and no
migration is needed. No `ENGINE_VERSION` bump, no new dependency, no new stored
field. Under bare `node --test`, the module is import-free except for the
schedule, both of which load without `node_modules`.

## Testing

- `src/runtime/simulationTick.test.js`: the plan is the declared order even when
  the handlers object lists its keys reversed; async handlers are awaited in
  turn (an ordering trace proves it); an unknown handler key throws; a non-
  function value is ignored; no handlers returns an empty plan and runs nothing;
  handlers that are absent from the object are skipped without error.
- `src/runtime/simulationTickWiringArchitecture.test.js`: the region is bounded;
  the executor is imported once and called once there; the four pilot anchors
  appear once and precede the call. Removing the call, moving an anchor after it,
  or leaving a phase inline fails the guard.
- The full gate: `npm test`, the engine purity test, the eleven existing wiring
  guards, eslint on the changed files, `npm run wiki:check`, and `npm run build`.
  The recorded baseline before this increment is `npm test` 3047 (3045 pass, 0
  fail, 2 todo); this increment adds only its own tests and must lose none.

## Open questions

None block implementation. The following are recorded so the plan does not
silently decide them.

- Which phase run is extracted next is deferred; each needs the exact same
  byte-for-byte move and its own guard update, and the interleaved deterministic
  steps need their `let` bindings examined first.
- Whether `requires`/`tickPhasePlan` become authoritative gates on the executor
  is deferred; it changes behavior (a phase that self-gates today would stop
  being called) and belongs to a later increment.
- Whether the executor grows timing or request accounting (the way
  `src/Game/AI/skipPhases.js` reports a phase's time) is deferred; this increment
  only orders and awaits the handlers.
