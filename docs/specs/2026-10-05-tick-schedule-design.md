<!-- Open Historia - one declared order for the deterministic turn phases (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# Tick Schedule: One Declared Order for the Deterministic Turn Phases

The twenty-first increment of the deterministic simulation, and the first that
does not change what a turn computes at all. It makes the order in which the
deterministic subsystems run - combat, settlement, supply, reinforcement, the war
ledger, treaties, casus belli, reparations, espionage, the economy, production
and the stats history - **explicit and enforced in one place**, instead of an
implicit property of the statement sequence of `applySimulationResult`.

## Why this increment exists

1. **The turn order is implicit.** Each deterministic subsystem is invoked by a
   statement inside `applySimulationResult`
   (`src/Game/AI/gameplay.js:6527-7861`). The order lives only in the position of
   those statements and in scattered comments; there is no list of phases and no
   file that states the order. A reader must reconstruct it by reading a
   1300-line function.

2. **The order is pinned only in fragments.** Eleven architecture guards each
   pin a pair or a small subset of the order:
   `src/Game/AI/economyWiringArchitecture.test.js`,
   `src/runtime/combatWiringArchitecture.test.js`,
   `src/runtime/supplyAttritionWiringArchitecture.test.js`,
   `src/runtime/reinforcementWiringArchitecture.test.js`,
   `src/runtime/warSettlementWiringArchitecture.test.js`,
   `src/Game/AI/casusBelliWiringArchitecture.test.js`,
   `src/Game/AI/treatyObligationsWiringArchitecture.test.js`,
   `src/Game/AI/peaceOfferWiringArchitecture.test.js`,
   `src/Game/AI/productionWiringArchitecture.test.js`,
   `src/Game/AI/forceWiringArchitecture.test.js` and
   `src/Game/AI/turnOrdering.test.js`. No single test asserts the whole
   sequence. A phase moved across a pair no guard covers - for instance
   `resolveWarSettlements` before `applyWarUpdates`, or the supply read after the
   war ledger - changes the simulation silently.

3. **The constitution already names the clock and the order as the adapter's
   job.** The deterministic-core spec says the pure core advances the trajectory
   and "the adapter owns the clock and the ordering"
   (`docs/superpowers/specs/2026-10-01-deterministic-core-economy-design.md:82`).
   This increment gives that ordering a name, a value and a guard.

4. **It is the safe foundation for a real orchestrator.** A later increment can
   move the phases behind a runtime executor that walks this schedule. That move
   is far cheaper and far safer once the order is declared and pinned. This
   increment does the declaring and the pinning; it does not move any code.

## Scope

1. A pure, import-free `src/engine/tickSchedule.js` exporting:
   - `TICK_PHASES`, a frozen, ordered array of phase descriptors
     `{ id, anchors, requires }`, where `anchors` are the exact source literals
     that identify the phase's invocation in `applySimulationResult` and
     `requires` are the world facts that make the phase applicable.
   - `tickPhasePlan(facts)`, returning the ordered list of phase ids applicable
     to a set of facts.
2. A unit test `src/engine/tickSchedule.test.js` that pins the full order, the
   frozen shape, and the fact filtering.
3. A source-text architecture guard
   `src/Game/AI/tickScheduleWiringArchitecture.test.js` that imports
   `TICK_PHASES`, bounds the `applySimulationResult` region in `gameplay.js`, and
   asserts every phase's anchor appears exactly once in that region and in the
   declared order - turning the implicit sequence into an enforced one.
4. A note in `docs/runtime-services.md` describing the schedule and its source.

## Non-goals

- **No behavior change.** No phase is moved, added, removed, gated differently or
  re-implemented. `applySimulationResult` keeps its exact statement sequence;
  every existing guard and test keeps passing unchanged.
- **No runtime executor.** This increment does not add a `src/runtime` module
  that walks the schedule and calls the phases. That is the next increment; this
  one only declares and pins.
- **No phase is moved into `src/engine`.** The phases read and write the stored
  `world` through `src/runtime` adapters (and some live in `src/Game/AI`, such as
  the war ledger and the diplomatic director). The layering rule forbids the
  runtime layer from importing `Game/AI`, so composition stays in
  `applySimulationResult`. Only the data (the schedule) is pure.
- **No scripted-event change.** The scenario author's beats keep firing on the
  jump path only (`src/Game/AI/worldDirection.js`), exactly as today. They are
  not made part of the every-mode tick here.
- **No new stored shape, no schema change, no `ENGINE_VERSION` bump and no
  migration.** The schedule is a constant; nothing new is written to a save.

## Design

### 1. Layers

| Layer | Location | What lives here |
| --- | --- | --- |
| The schedule | `src/engine/tickSchedule.js` | `TICK_PHASES`, `tickPhasePlan(facts)`; imports nothing |
| The order, as executed | `src/Game/AI/gameplay.js` `applySimulationResult` | the existing phase calls, unchanged |
| The guard | `src/Game/AI/tickScheduleWiringArchitecture.test.js` | pins the executed order to the schedule |
| The prose | `docs/runtime-services.md` | the schedule and where it is defined and enforced |

The dependency direction is the house one: `src/engine` imports nothing, and the
guard (in `src/Game/AI`) imports the engine. No `src/runtime` adapter imports
this module, so the forbidden `runtime -> Game/AI` direction is never created.

### 2. The schedule

`TICK_PHASES` is the source of truth for the order. It is a frozen array; each
entry is frozen. In declared order:

| # | id | anchors (exact source literal) | requires |
| --- | --- | --- | --- |
| 1 | `engagements` | `resolveEventEngagements(freshEvents` | `battles` |
| 2 | `engagementMerge` | `mergeEngagementResults(freshEvents` | `battles` |
| 3 | `settlements` | `resolveWarSettlements({` | `atWar` |
| 4 | `engagementReserve` | `applyCombatReserveCost(impactedWorld, engagementOutcome.reserveCost)` | `battles` |
| 5 | `supply` | `readSupplyAttrition(impactedWorld` | `supply` |
| 6 | `reinforcement` | `readReinforcement(impactedWorld` | `reinforcement` |
| 7 | `reinforcementReserve` | `applyCombatReserveCost(impactedWorld, reinforcement.reserveCost)` | `reinforcement` |
| 8 | `warLedger` | `const warMerge = applyWarUpdates({` | none |
| 9 | `treatyBreaches` | `readTreatyBreaches(worldWithImpacts` | `treaties` |
| 10 | `casusBelli` | `readWarCasus(worldWithImpacts` | `casus` |
| 11 | `treatyObligations` | `readTreatyObligations(worldWithImpacts` | `treaties` |
| 12 | `reparations` | `applyWarReparations(worldWithImpacts` | `settlements` |
| 13 | `espionage` | `resolveEspionage(worldWithImpacts` | `espionage` |
| 14 | `economy` | `advanceWorldEconomy(nextWorld` | none |
| 15 | `production` | `await resolvePlacements(containers, nextWorld, { receipt })` | `production` |
| 16 | `statsHistory` | `nextWorld = captureCountryStatsHistory(nextWorld, {` | none |

Each anchor was chosen to be unique inside the `applySimulationResult` region (it
may repeat elsewhere in the file, as `applyWarUpdates` and
`captureCountryStatsHistory` do on the Game Master and bootstrap paths; the guard
searches only inside the region). The two reserve calls are distinguished by
their full argument text so each anchor matches once.

`requires` reads as a set of facts: an empty list means the phase runs on every
turn, otherwise the phase applies when every named fact is present.

### 3. `tickPhasePlan(facts)`

```js
export const tickPhasePlan = (facts = {}) =>
  TICK_PHASES
    .filter((phase) => phase.requires.every((fact) => Boolean(facts?.[fact])))
    .map((phase) => phase.id);
```

- With no facts, the plan is the always-on phases in order:
  `["warLedger", "economy", "statsHistory"]`.
- With every fact true, the plan is all sixteen ids in declared order.
- It is a projection of the turn's condition, not a second source of truth for
  the order: the order always comes from `TICK_PHASES`.
- It is consumed this increment by the guard (which iterates `TICK_PHASES`) and
  by the documentation; the runtime executor that will consume it in the next
  increment is a non-goal here.

### 4. The guard

`src/Game/AI/tickScheduleWiringArchitecture.test.js` reads
`src/Game/AI/gameplay.js` as text (it cannot be imported, because it imports
`main.jsx`). It:

1. bounds the region from `const applySimulationResult =` to
   `const readSeenGameStateBundle =`;
2. asserts the region exists and the end is after the start;
3. imports `TICK_PHASES` and, for each phase in declared order, asserts the
   phase's anchor occurs exactly once in the region;
4. asserts the anchors' positions strictly increase in the declared order, so a
   swap of any two phases fails the guard.

It must be RED before the schedule exists (the import fails) and RED again if any
phase is moved across another. It does not replace the eleven existing pairwise
guards; it adds the whole-order guarantee they lack.

### 5. What stays the same

- Every phase call, its arguments, its condition and its effects are byte for
  byte unchanged; `applySimulationResult` is edited only if a comment is wanted,
  and the plan adds no comment.
- The eleven existing wiring guards and their assertions are untouched.
- The Game Master apply path, the projection dry run, the bootstrap paths and the
  interactive scene are untouched; they are not in the region and the schedule
  does not claim them.

## Compatibility

The schedule is a constant with no stored form, so a save loads unchanged and no
migration is needed. No `ENGINE_VERSION` bump, no new dependency, no new stored
field. In any context the guard runs (bare `node --test`), the module is
import-free and pure.

## Testing

- `src/engine/tickSchedule.test.js`: `TICK_PHASES` is frozen and its entries are
  frozen; the ids are exactly the sixteen above in that order; every `requires`
  value is an array of known fact names; `tickPhasePlan()` returns the always-on
  phases in order; `tickPhasePlan` with all facts returns all sixteen ids in
  order; a partial set filters correctly; the anchors are unique within the
  schedule array itself.
- `src/Game/AI/tickScheduleWiringArchitecture.test.js`: each anchor appears once
  in the bounded region and the positions increase in declared order; removing a
  phase's call or swapping two phases fails the guard. The guard imports and
  iterates `TICK_PHASES`, so it cannot silently check a stale copy of the order.
- The full gate: `npm test`, the engine purity test, eslint on the changed files,
  `npm run wiki:check`, and `npm run build`. The recorded baseline before this
  increment is `npm test` 3034 (3032 pass, 0 fail, 2 todo); this increment adds
  only its own tests and must lose none.

## Open questions

None block implementation. The following are recorded so the plan does not
silently decide them.

- Whether the runtime executor should be the immediate next increment, walking
  `tickPhasePlan` and calling the adapters, is deferred; this increment is its
  prerequisite.
- Whether the scripted-event beats should become a scheduled phase for every
  turn mode (today jump-only) is deferred; it changes behavior and is out of
  scope here.
- Whether `requires` should grow finer-grained facts (for example per-feature
  flags already consulted inside `applySimulationResult`) is deferred until the
  executor needs them.
