# Every deterministic phase runs behind the tick executor

Date: 2026-10-06
Status: approved for implementation

## Problem

The twenty-first increment declared the turn's phase order in `TICK_PHASES`
(`src/engine/tickSchedule.js`) and the twenty-second built the runtime executor
(`src/runtime/simulationTick.js`) that walks it. But only four of the sixteen
phases run behind the executor: `treatyBreaches`, `casusBelli`,
`treatyObligations` and `reparations` (`src/Game/AI/gameplay.js:7076-7188`). The
other twelve still run as bare statements whose order is the position of the
statement: `engagements`, `engagementMerge`, `settlements`, `engagementReserve`,
`supply`, `reinforcement`, `reinforcementReserve`, `warLedger`, `espionage`,
`economy`, `production` and `statsHistory`.

So the schedule is still half-declared. A phase can be moved across another in
`applySimulationResult` and only the source-text guards, not the executor, would
notice. Slice 22 named this the deferred half
(`docs/specs/2026-10-05-tick-orchestrator-executor-design.md`, "No full
extraction" and "Open questions").

## Goals

- Every one of the sixteen phase bodies in `applySimulationResult` becomes a
  handler on one `tickHandlers` object, invoked by `runSimulationTick`, so the
  executed order of every phase is the declared `TICK_PHASES` order.
- The deterministic steps that are not phases (`applyEventImpactsToWorld`,
  `propagateRenames`, `advanceStandingOrders`, the settlement bookkeeping, the
  casus derivation, the espionage derivation, the diplomatic and storyline
  merges, the board and chat work, the compaction, the research application)
  stay in their exact source positions between seven executor calls.
- Byte-for-byte behavior: no phase added, removed, re-implemented or gated
  differently; every `try`/`catch`, comment and effect preserved.
- No change to `src/engine/tickSchedule.js` and no change to
  `src/runtime/simulationTick.js`.

## Non-goals

- **No `requires` change.** The declared facts (`battles`, `atWar`, `supply`,
  `reinforcement`, `espionage`, `production`) stay declarations, not gates: the
  six calls without a fact set run every handler they are given, exactly as
  every call runs today, and only the treaty call passes `tickFacts`. Making
  `requires` authoritative would skip phases that self-gate today and is a
  behavior change; it stays deferred exactly as slice 22 recorded.
- **No executor change.** The subset call is already supported: with a handler
  subset and no fact set the executor runs exactly that subset in `TICK_PHASES`
  order, and with `facts` it gates the subset through the same `tickPhasePlan`.
- **No new phase, no engine module, no schema, no `ENGINE_VERSION` bump, no
  migration, no dependency.**
- **No UI.** There is no browser in the build environment; this increment is
  provable entirely under `node --test`.

## Design

### 1. Layers

| Layer | Location | What changes |
| --- | --- | --- |
| The schedule | `src/engine/tickSchedule.js` | unchanged (sixteen phases, `requires` as declared) |
| The executor | `src/runtime/simulationTick.js` | unchanged |
| The composition | `src/Game/AI/gameplay.js` `applySimulationResult` | one `tickHandlers` object; seven executor calls |
| The guards | `src/Game/AI/tickScheduleWiringArchitecture.test.js`, `src/runtime/simulationTickWiringArchitecture.test.js` | updated to the seven-call shape |
| The prose | `docs/runtime-services.md` | the full extraction |

### 2. The seven calls

A phase body may only be invoked at the point its inline statement stood,
because a non-phase deterministic step sits between groups. Seven calls cover
all sixteen phases with the non-phase steps left between them:

```text
1. [engagements, engagementMerge, settlements]                        no facts
2. [engagementReserve, supply, reinforcement, reinforcementReserve]   no facts
3. [warLedger]                                                        no facts
4. [treatyBreaches, casusBelli, treatyObligations, reparations]       tickFacts
5. [espionage]                                                        no facts
6. [economy, production]                                              no facts
7. [statsHistory]                                                     no facts
```

- Call 1 stands where `resolveEventEngagements` stood, before
  `applyEventImpactsToWorld`.
- Call 2 stands where `applyCombatReserveCost(impactedWorld,
  engagementOutcome.reserveCost)` stood, after the impacts.
- Call 3 stands where `const warMerge = applyWarUpdates({` stood, after
  `advanceStandingOrders`; the withheld-war notice follows it.
- Call 4 is the existing pilot call. Its gate facts are derived after call 3,
  because `casusStarts` reads `warMerge.appliedIds`.
- Call 5 is separate on purpose: `espionage` is declared
  `requires: ["espionage"]`, a fact the turn does not compute, and the body
  self-gates on `isActiveFeatureEnabled("espionage")`. A no-fact call keeps its
  exact behavior; folding it into call 4 would gate it out.
- Call 6 stands where the economy `try` stood; call 7 where
  `captureCountryStatsHistory` stood.

### 3. One object, bodies in place

`const tickHandlers = {};` is declared once, early in the region, and each phase
body is assigned where its inline statement stood, keeping the body's text and
position:

```js
tickHandlers.engagements = () => {
  /* the resolveEventEngagements statements, unchanged */
};
```

A local helper runs a named group:

```js
const runTick = (ids, facts = null) =>
  runSimulationTick({
    handlers: Object.fromEntries(ids.map((id) => [id, tickHandlers[id]])),
    ...(facts ? { facts } : {}),
  });
```

so each call is `await runTick([...])` (call 4: `await runTick([...], tickFacts)`).
The handler subset decides the coverage; the executor still decides the order,
so the group array's own order does not matter and the schedule stays the single
source of order.

The four phases already behind the executor keep their bodies byte for byte:
they stay in the object literal that was already there, now assigned with
`Object.assign(tickHandlers, { ... })` so no line of those four bodies is
touched.

Because the assignments are written in `TICK_PHASES` order, the existing
source-text guard (`orderOk`) keeps passing unchanged: the sixteen anchors remain
in `gameplay.js` once each, in declared order.

### 4. Error-path fidelity

Two phase groups share one `try`/`catch` today; splitting them must not change
what runs when the first fails.

- `reinforcement` and `reinforcementReserve` share one `try`
  (`src/Game/AI/gameplay.js:6913-6943`). The `reinforcement` handler keeps that
  `try` and assigns its outcome only on full success; the `reinforcementReserve`
  handler begins `if (!reinforcementOutcome) return;` and then applies the
  reserve cost and logs. A failure in `reinforcement` therefore still skips both,
  as today.
- `economy` and `production` share one `try` (`src/Game/AI/gameplay.js:7682-7779`).
  The `economy` handler keeps it and assigns its outcome only on success; the
  `production` handler begins `if (!economyOutcome) return;` and then applies the
  completion batches and the research ops. A failure in `economy` therefore still
  skips production and research, as today.

No other phase group shares control flow. `supply` keeps its own `try`/`catch`
and message; `engagementReserve`, `settlements`, `engagements`,
`engagementMerge`, `warLedger` and `statsHistory` are bare today and stay bare.

### 5. Receipt order

The engagement receipt notes (`src/Game/AI/gameplay.js:6760-6779`) stand between
`mergeEngagementResults` and `resolveWarSettlements`. To keep the receipt's note
order, those notes become the trailing statements of the `engagementMerge`
handler, so they still run after the merge and before `settlements`. No note
text, threshold or ordering changes.

### 6. What stays

- Every comment moves with its body.
- Every non-phase deterministic step stays in place: the impacts merge, the
  settlement bookkeeping, `propagateRenames`, `advanceStandingOrders`, the
  withheld-war notice, the `casusStarts` and `tickFacts` derivation, the
  espionage derivation, `applyDiplomaticUpdates`, `applyWorldStorylineUpdates`,
  the board, spy and chat work, the compaction, and the research application.
- The interactive, projection and bootstrap paths are untouched.

## Compatibility

Handlers are code, not stored shape: a save loads unchanged, no migration, no
`ENGINE_VERSION` bump, no new dependency. Under bare `node --test` nothing in
this increment adds an import.

## Testing

- `src/Game/AI/tickScheduleWiringArchitecture.test.js`: unchanged, and it keeps
  passing (each anchor still appears once, in `TICK_PHASES` order, now inside
  the handlers).
- `src/runtime/simulationTickWiringArchitecture.test.js`: updated from "called
  exactly once" to "called once per group"; it asserts the seven call groups
  partition `TICK_PHASES` (exact union, no phase invoked twice), that every
  phase id has a handler in the region, that only the treaty call passes
  `tickFacts`, and that the facts are derived before it. The
  executor-imports-only-the-schedule assertion is unchanged. This guard is
  updated because slice 22 pinned the pilot-only shape this increment is
  designed to supersede; the replacement is stronger (it pins all sixteen
  phases, not four), not weaker.
- `src/engine/tickSchedule.test.js` and `src/runtime/simulationTick.test.js`:
  unchanged, and both keep passing (the schedule and the executor are unchanged).
- Inert-case equivalence: a turn with no battles, no wars, no agreements, no
  espionage and no production writes the same world and the same receipt as
  before; the full gate (`npm test`, eslint on the changed files,
  `npm run wiki:check`, `npm run build`) runs at the recorded baseline and must
  lose no test.

## Open questions

- Making `requires` authoritative stays deferred (slice 22).
- Whether the seven calls become one call once the non-phase deterministic steps
  themselves become handlers is deferred; this increment keeps them explicit.
- Timing or accounting per phase (`src/Game/AI/skipPhases.js`) is out of scope.
