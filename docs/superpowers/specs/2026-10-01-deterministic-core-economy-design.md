# Deterministic core: the economy tick

Date: 2026-10-01
Status: approved for implementation

## Problem

Open Historia has no simulation engine. The state of the world is advanced by a
language model: every turn asks a provider for a narrative, the narrative carries
structured impacts, and the client applies them (`applySimulationResult`,
`src/Game/AI/gameplay.js:6391`). The containers are excellent and versioned
(`countryStats.js` sheets with a component ledger, `countryStatsHistory`
sampling, `WORLD_DEFAULTS` at `src/runtime/gameState.js:41`), but nothing
computes the next value of anything.

A targeted search confirms it: across `src/` and `server/` there is no
`economyTick`, no compound growth, no budget arithmetic. The only arithmetic on
economic quantities is (a) aggregating AI supplied components,
`component.population * component.gdpPerCapita`
(`src/runtime/countryStats.js:229`), (b) rescaling components to hit an AI or GM
supplied anchor (`:1046-1095`), and (c) reverting a value that moved too far
(`guardCountryStatContinuity`, `:1406`). `gdpGrowth`, `inflation`, `publicDebt`
and `budgetBalance` are stored as absolute labels and are never used to evolve
anything.

Three concrete failures follow from this.

1. **The client cannot advance time on its own.** With no model there is no
   turn. A provider that stalls, rate limits or refuses leaves the game
   depending on a timeout, and a main thread blocked mid-turn cannot even run
   the timeout that is supposed to rescue it.
2. **Numbers are not reproducible.** Two campaigns from the same scenario, with
   the same orders, diverge, because the trajectory is a model's estimate rather
   than a function of the state.
3. **Numbers cannot be played against.** A player cannot plan against an economy
   that is re-estimated every turn, and a later combat or production system has
   no resource pool to consume.

The chosen direction is that a deterministic local simulation is the source of
truth and the model becomes an advisor and narrator. This specification delivers
the first increment of that: the core tick and the economy.

## Goals

- A pure function advances the economy of every polity by a span of game time.
  Same inputs, same outputs, byte for byte, in a fresh process.
- The economy trajectory is computed locally. It needs no network, no model and
  no wall clock.
- The model keeps a real influence on the story: it declares **classified shocks**
  (a blockade, a failed harvest, a sanctions regime), and the engine translates
  each into transient parameters for a bounded number of months.
- The model never invents an economic value. Its numbers are not written on the
  engine's fields.
- Existing storage, the four write sites, the continuity guard, rollback and the
  2427 test suite keep working with no migration.
- No framework, no new runtime dependency. The tick is data plus pure functions.

## Non-goals

- Production queues, research, construction, equipment, manpower pools. A later
  increment; it consumes the same contract.
- Combat resolution, front lines, attrition. Later increment.
- Computer-opponent decision making, war goals, peace terms. Later increment.
- Direct hand control of units. This is a deliberate design decision that a
  later increment revisits; it collides with today's "state intent, the turn
  narrates it" loop and must not be smuggled in here.
- Scenario **custom** stat sheets (`customStats`, the generic ancient-era
  layout). They keep their own AI path untouched in this increment, because a
  custom sheet deliberately replaces the modern GDP model with era-agnostic
  numbers.
- Any change to `world.units`, `pendingUnitOrders`, markers or projects.

## Design

### 1. Layers

Three layers, in three places, with one direction of dependency.

| Layer | Location | Rule |
|---|---|---|
| Pure core | `src/engine/` (new) | No browser import, no `Date.now`, no `Math.random`, no `localStorage`, no network. Importable by bare `node --test`. |
| Adapter | `src/runtime/` | Reads the world, extracts the economic state, calls the core, writes the result through `mergeCountryStatPatch`. Owns the clock and the ordering. |
| Boundary | `src/Game/AI/` | The jump schema gains the closed shock enum; the prompt gains the period digest. |

The core imports nothing from the adapter, which is what makes it testable and
what keeps `src/engine/` free of the JSX chain. This mirrors the existing
import-free convention (`forcePosture.js`, `scriptedImpacts.js`,
`worldDirection.js`).

### 2. The determinism contract

- The generator is `hashSeed` (xmur3), already in the tree at
  `src/runtime/unitMotion.js:45`, and used the same way espionage already
  resolves deterministically from `${round}:${key}` seeds (documented as a save
  compatibility surface, `docs/world-state.md:280`). No RNG library.
- Per-polity variation (the "national character" term) is a deterministic jitter
  derived from `hashSeed(gameSeed + ":" + polityName)`, not from entropy.
- Every iteration over polities or components sorts by a stable key first.
  Object key order is never relied on.
- `Date.now()` and `new Date()` never enter the core. The only time input is a
  month index, an integer.
- Rounding happens once, at the end of a month step, to fixed precision
  (population to integer, money and percentages to 2 decimals), so a float
  accumulation order cannot change the result.
- The advance is **idempotent and recomputable**: it takes the last committed
  economy and an elapsed month count and returns the economy for the end date.
  Calling it twice with the same arguments returns the same object content.
  There is no hidden incremental state that can drift.

### 3. Time model

A turn is one jump of N whole days and one round
(`nextGame`, `src/Game/AI/gameplay.js:6580-6584`). A long jump may be generated
in segments and then merged, but the round advances once
(`src/Game/AI/jumpSegments.js`). The UI presets are 6 hours and 1, 3, 7, 30, 90,
180, 365 days (`src/Game/GameUI/time.jsx:1285`).

The engine therefore advances in **one-month internal steps**:

- `months = floor(elapsedDays / 30)`, so a 90 day jump is 3 steps and a 6 hour
  jump is 0 steps. A sub-month jump does not move the economy, which is already
  the behaviour of the tracked-stats intervals `[0, 3, 6, 12, 24]`
  (`src/runtime/countryStats.js:12`).
- `MONTH_DAYS = 30` in one constant. Calendar months are not modelled; the game
  clock has no day-of-month semantics and "1 month" is already literally 30 days
  in the picker.
- `MAX_STEPS = 240` (twenty years) per single turn. Beyond it the engine stops
  at the cap, keeps the clock consistent, and logs one line. A 365 day jump is
  12 steps and a 10 year jump is 120, so the cap only bounds a deliberate
  outlier, not normal play.

### 4. State model

The engine works on a compact economic state, not on the world. Extraction and
reinsertion happen in the adapter.

```
EconomicState = {
  version: 1,
  month: number,                 // absolute month index, derived from the game date
  polities: {
    [polityName]: {
      population: number,
      gdp: number,
      gdpPerCapita: number,
      gdpGrowth: number,         // annual percent, as the sheet stores it
      inflation: number,         // annual percent
      unemployment: number,      // percent
      publicDebt: number,        // percent of GDP
      budgetBalance: number,     // percent of GDP, negative is a deficit
      stability: number,         // 0-100
      gdpBreakdown: { agriculture, industry, services },
      components: [ { geography, group, population, gdpPerCapita } ],  // may be empty
      jitter: number,            // deterministic, from hashSeed, in [-1, 1]
    }
  }
}
```

Two properties matter.

First, the **component ledger is the arithmetic authority**, not `gdp` and not
`population`. `finalizeCountryStatSheet` recomputes totals from the ledger and
`mergeCountryStatPatch` rescales components rather than honouring a top level
total (`src/runtime/countryStats.js:468-470`, `:1032-1095`). The engine must
therefore step **per component** where a ledger exists, and on the aggregate only
where it does not. Getting this wrong means the engine's number is silently
overwritten by the ledger's own sum.

Second, the ordering is by `polityName` and then by `geography`, both with a
stable string sort, so the iteration order is a function of the data.

### 5. The step

One month, one component. Every constant lives in a single frozen table
`ECONOMY_STEP` so it is auditable and tunable in one place.

Population:

```
popGrowth = POP_GROWTH_BY_ERA(year) * stabilityFactor * shockPop
population *= (1 + popGrowth)
```

where `POP_GROWTH_BY_ERA` is a monthly rate keyed by year band (pre-1500 through
post-2000, roughly 0.01% to 0.10% per month) and `stabilityFactor` is
`0.5 + stability/100` scaled around 1.

Productivity (this is where the rate of `gdpPerCapita` comes from):

```
base      = PRODUCTIVITY_BY_ERA(year)
structure = 1 + SECTOR_LIFT * (industryShare + servicesShare) / 100
debtDrag  = 1 - DEBT_DRAG_MAX * clamp((publicDebt - 100) / 100, 0, 1)
unempDrag = 1 - UNEMP_DRAG * clamp((unemployment - NATURAL_RATE) / 100, 0, 1)
character = 1 + CHARACTER_AMPLITUDE * jitter
gpcGrowth = base * structure * debtDrag * unempDrag * character * shockGdp
gdpPerCapita *= (1 + gpcGrowth)
```

Inflation:

```
target    = INFLATION_TARGET
deficitPush = DEFICIT_INFLATION * clamp(-budgetBalance - DEFICIT_THRESHOLD, 0, CAP)
inflation = inflation + INFLATION_REVERSION * (target + deficitPush - inflation)
            + shockInflation
inflation = clamp(inflation, MIN_INFLATION, MAX_INFLATION)
```

Unemployment (a discrete Okun step plus mean reversion):

```
gap   = gpcGrowth * 12 - TREND_GROWTH
unemployment = unemployment - OKUN * gap / 12
             + UNEMP_REVERSION * (NATURAL_RATE - unemployment)
             + shockUnemployment
unemployment = clamp(unemployment, 0, 60)
```

Debt and budget:

```
revenue  = REVENUE_PER_GDP(structure)
spending = SPENDING_PER_GDP + MILITARY_PER_GDP * mobilization
budgetBalance = (revenue - spending) * 100          // percent of GDP
interest = publicDebt * RATE_MONTHLY * 12           // percent of GDP, on the debt ratio
realGrowth = gpcGrowth * 12 + popGrowth * 12
publicDebt = publicDebt * (1 + (interest - realGrowth) / 12) - budgetBalance / 12
publicDebt = clamp(publicDebt, 0, DEBT_MAX)
```

(The debt expression is the linearised debt-ratio dynamics: the ratio rises with
the real interest rate, falls with real growth, and falls by the primary
balance. It is written linearised on purpose, so the arithmetic is auditable by
hand and cannot produce the division-by-zero a compounding form invites.)

Stability drifts toward an equilibrium set by growth, inflation and
unemployment, and is then clamped to 0-100:

```
equilibrium = 50 + STAB_GROWTH * (gpcGrowth * 12) - STAB_INFLATION * inflation
                  - STAB_UNEMP * (unemployment - NATURAL_RATE)
stability = stability + STAB_REVERSION * (equilibrium - stability) + shockStability
```

After every component steps, the polity aggregate is recomputed with the
existing helper `aggregateTerritorialEconomy`
(`src/runtime/countryStats.js:217`), so there is exactly one definition of "GDP is
the sum of components" in the codebase and it is already tested.

Notes on the shape of the model, which the implementation plan must preserve:

- `gdpGrowth` on the sheet is an annual percent, so the monthly step is
  annualised on read and de-annualised on write, once, in the adapter.
- Every clamp is explicit. No term can produce a negative population, a negative
  GDP per capita, a sector share outside 0-100, or a debt ratio above the cap.
- Depressions are reachable but not runaway: the debt drag, the deficit
  inflation push and the stability feedback are each bounded, so a collapse is a
  slow spiral rather than a division by zero.

### 6. Shocks

The model's only numeric economic authority is a closed enum of shocks. A shock
is a **transient modifier**: it does not set a value, it scales the rates for a
bounded number of months.

```
EconomicShock = {
  kind: "harvest_failure" | "sanctions" | "blockade" | "industrial_damage"
      | "capital_flight" | "debt_crisis" | "mobilization" | "reconstruction"
      | "aid_inflow" | "trade_boom",
  severity: 1 | 2 | 3,
  durationMonths: number,        // 1..120
  scope: "world" | string[]      // polity names
}
```

Each `kind` maps to a fixed vector of multipliers
`{ population, gdp, inflation, unemployment, stability }` per severity level,
in one frozen table `SHOCK_EFFECTS`. Effects stack by multiplication with a
floor, and an opposite shock does not cancel a negative one; they compose.
Positive kinds exist so the narrator can reward a player, not only punish.

Bounds and validation:

- `economicShocks` is an optional array on the jump payload, at most 20 entries.
- The schema rejects an unknown `kind`, an absent `severity`, a
  `durationMonths` outside 1..120, and a `scope` naming an unknown polity is
  dropped entry by entry rather than failing the turn.
- A rejected entry is logged and ignored. It never costs a request and never
  invalidates the turn.

This is what replaces the model's free numeric estimates:
`src/Game/AI/gameplaySchemas.js:995` (`JUMP_FORWARD_SCHEMA`) gains the field, and
the prompt explains, in the same style as the other instruction blocks, that the
model declares shocks and never states a GDP.

### 7. Turn ordering

Ordering is the part that is easy to get subtly wrong, so it is written down
explicitly.

1. At the start of a turn the adapter reads the committed world and extracts the
   economic state. The projected end date is already known at this point
   (`targetDate`, `src/Game/AI/gameplay.js:12620`).
2. The engine advances from the committed month to the projected month. This is
   pure and cheap, about three steps for a 90 day jump.
3. The adapter builds a short **period digest** and the prompt builder injects it
   as given facts: for the player's polity and the tracked polities, the growth,
   inflation, unemployment and debt the engine just produced, plus a one line
   note of any shock still running. The model is told these are facts and are not
   to be restated with different numbers.
4. The model answers with events and, optionally, shocks. Shocks apply to the
   **following** period, so the model reacts to the digest it was given rather
   than retroactively rewriting the period it just described. A one period lag,
   stated plainly, instead of a race.
5. Event impacts are applied first, as today. They still own indices, stability,
   text, territory, units and markers.
6. The engine's economy fields are applied **last**, through
   `mergeCountryStatPatch`, so the engine wins on `gdp`, `gdpPerCapita`,
   `gdpGrowth`, `inflation`, `unemployment`, `publicDebt` and `budgetBalance`.
   Indices, `stability`, the text fields and the component ledger the model did
   not own survive untouched.
7. If the model's final `stopDate` differs from the projected date, the adapter
   recomputes the advance from the committed state to the final date. Because
   the advance is a pure function of (state, months, shocks), the recomputation
   is exact and cannot drift.

Step 6 is the whole trick, and it is deliberately the smallest possible change:
it means the four existing stat write sites do not move, and no caller has to
know the engine exists. All four funnel through
`applyCountryStatPatchToWorld` (`src/runtime/gameState.js:4087`) into
`mergeCountryStatPatch` (`src/runtime/countryStats.js:946`).

### 8. The continuity guard

`guardCountryStatContinuity` (`src/runtime/countryStats.js:1406`) reverts a value
that moved further than a band, with thresholds at `:1494-1512`. It exists to
catch a language model producing an absurd jump, and it is right to keep it.

But it would also revert the engine. A war that costs 30% of GDP is a legitimate
engine result and an absurd model estimate, and the guard cannot tell them apart.

Decision: **the guard applies to event-sourced patches only.** The engine's own
write is marked as engine-sourced on the continuity record, and the guard skips
a marked write. The engine's own bounds (the clamps in section 5) are its
guardrails instead. An event that moves an index or stability is still guarded
exactly as today.

### 9. Suppressing the periodic AI stats refresh

`refreshTrackedCountryStatsIfDue` (`src/Game/AI/gameplay.js:9469`) is the closest
thing to a tick that exists today: one periodic AI batch, merged per polity at
`:9648` behind `guardCountryStatContinuity`. With the engine owning the
trajectory, that call would now be a competing writer.

Decision: for **standard** sheets, the call is suppressed, and its budget is
redirected into the shock channel, which is far cheaper (a handful of enum
entries in an answer that is being generated anyway, instead of a separate
request). The suppression is a named constant with a development escape hatch,
so the two paths can be compared side by side during implementation and the
engines' numbers checked against the model's for a few campaigns.

`refreshTrackedCustomStatsIfDue` (`:9337`) is **not** suppressed: custom scenario
sheets are out of scope and keep their existing behaviour.

### 10. Performance

The scale is 237 polities and 4955 regions in a 3.4 MB `world.json`
(`server/data/games/modern-day-2026-session/world.json`). The constraint that
matters is that `normalizeWorldState` runs on **every read and every write**
(`src/runtime/gameState.js:3530`, called at `:3815` and `:3884`), which is why
`readWorldStateView` exists.

Therefore:

- The tick is `O(polities * components)`, roughly 237 x 3, and runs **once per
  turn**, not once per read.
- Nothing is added to `normalizeWorldState` that iterates regions. The only new
  normalised object is a small scalar record (section 11).
- Cost per turn is a few milliseconds even at the step cap. It is measured and
  logged with the existing turn performance instrumentation
  (`src/runtime/turnPerf.js`), as the map cartography already is.

### 11. Storage and versioning

One new world field:

```
economyEngine: {
  version: 1,
  seed: string,             // 16 hex chars, generated once per campaign
  lastDate: string,          // the game date the committed economy is at
  lastMonth: number,         // the month index the committed economy is at
  pendingShocks?: []         // shocks declared LAST turn, to run THIS period
}
```

`pendingShocks` was not in the first draft of this section and was added during
implementation, because section 7's one-period lag cannot be honoured without
carrying a declared shock across the write. Entries are held in their **declared**
shape (`{kind, severity, durationMonths, scope}`), not the month-window shape the
step converts them to, so a shock spanning several periods can be re-based onto
the clock in whichever period it actually runs in. The field is sparse: a campaign
with nothing pending keeps the record exactly as it was. See section 6 and
section 13.

It must be added to `WORLD_DEFAULTS` (`src/runtime/gameState.js:41`) and to
`normalizeWorldState` (`:3530`), because an unknown field survives only via the
incoming spread and a **new known field is dropped on write** if it is not
listed. This is the documented new-field trap at `:3624`.

There is no world schema version and no generic migration framework; the only
world marker is the one-shot `ownerSchema` (`server/ownerMigration.js:23`). So:

- An absent `economyEngine` means "first run": the adapter derives the seed from
  the campaign id and the scenario, takes `lastMonth` from the current game date,
  and bootstraps. No migration and no bump of `COUNTRY_STATS_SCHEMA_VERSION`.
- `version` is checked on read. An unknown higher version means the engine
  stands down and the previous behaviour is used, so a save written by a newer
  build never corrupts under an older one.
- `countryStatsHistory` continues to be written by the existing history capture
  at write time (`src/Game/AI/gameplay.js:7182`), so the engine's trajectory
  appears in the stats chart for free.

### 12. Bootstrapping the starting numbers

There is no economic baseline in the data. The scenario
`modern-day-copy-5/world.json` has **zero** `countryStats` sheets, and a real
session has one (the player's), produced by the model. The engine cannot step
from nothing.

The chosen approach is hybrid, and it reuses a design already in the tree: the
model may supply a calibration **node** and native code expands from it
(`calibrateTerritorialComponentPopulations`, `expandTerritorialMacroEstimates`,
`src/runtime/countryStats.js:618`, `:782`).

1. **Physical baseline, always, instantly and offline.** Derived from data
   already on the device: per-region area from the region geometry
   (`@turf/area`, already a dependency), city data with populations
   (`src/runtime/cityFeatures.js:50`), and the scenario's start year for the era
   bands. This gives every one of the 237 polities a defensible starting point
   with no network, no request and no wait.
2. **Optional one-time AI calibration, for tracked polities only.** For the
   player's polity and a small tracked set, one calibration pass may replace the
   baseline node with a historically grounded one, using the existing
   `populationCalibration` and `economicCalibration` machinery. It happens at
   most once per polity per campaign, is skipped entirely offline, and the engine
   takes over from whatever node is present.
3. A previously calibrated or model-written sheet that already exists is used as
   the node as-is. Nothing is thrown away.

The engine never waits for step 2. It starts on step 1 and adopts step 2's node
when it arrives, from the next month on.

### 13. The period digest

A pure function in the adapter builds a compact text block for the prompt:

```
Your economy, 2026-04 to 2026-07: output +0.9%, inflation 4.1%, unemployment
6.8%, public debt 93% of output, budget -3.2%. A sanctions shock (severity 2)
has 4 months left.
```

Rules:

- The player's polity first, then up to `DIGEST_POLITY_CAP` tracked polities,
  the same selection the stats tracking already uses.
- Hard character cap, with the player's line always kept. A digest that overflows
  loses the least important line, never truncates a sentence.
- Only numbers the engine produced. An uncalibrated polity says "estimated".
- With no engine data (a custom-sheet scenario) the digest is empty and the
  prompt is byte-identical to today's.

### 14. Tests

New, beside the core:

- **Determinism**: the same state, months and shocks produce a deep-equal result
  in two separate calls, and across two processes.
- **Idempotence**: advancing 0 months returns the input unchanged; advancing 3
  then 3 again from the result equals advancing 6 from the origin, to the
  rounding precision.
- **Recomputation**: advancing to a date, then recomputing the same span from the
  committed state, is exact.
- **Bounds**: no negative population or GDP per capita; sectors sum to 100;
  inflation and unemployment inside their clamps; debt inside its cap; stability
  in 0-100; every clamp exercised by a hostile input.
- **Shocks**: each kind maps to its expected vector; effects expire after
  `durationMonths`; an unknown kind, absent severity, out of range duration and
  unknown scope are each rejected without throwing.
- **Digest**: capped, player line retained, deterministic, empty for a custom
  sheet.
- **Architecture**: `src/engine/**` contains no `import` of a browser module, no
  `Date.now`, no `new Date`, no `Math.random`, asserted by reading the sources
  the way `worldDirection.test.js` and the import-free tests already do.
- **Guard interaction**: an engine-sourced write is not reverted by
  `guardCountryStatContinuity`; an event-sourced patch still is.
- **Ordering**: an event patch and the engine patch applied in the same turn
  leave the engine's economy fields authoritative and the event's indices intact.

Regression:

- `npm test` stays green (2427 today, 2425 pass, 2 todo).
- `npx eslint .` gains no new error.
- `npm run wiki:check` stays current, since `docs/` and `wiki/` are both touched.

### 15. Docs

- `docs/world-state.md`: the `economyEngine` field, the component-ledger
  authority rule, and the engine-owned field list.
- `docs/ai-overview.md`: the `economicShocks` field, the shock enum, and the
  one-period lag.
- `docs/runtime-services.md`: the `src/engine/` core and the adapter seam.
- `docs/architecture.md`: the three-layer picture, since this is the first
  engine layer in the tree.
- `wiki/reference/troubleshooting.md`: what a stalled provider now means, given
  that the economy no longer depends on one.

## Considered options

- **A framework for turn and state management** (`boardgame.io`, `XState`), as
  an assembly of off-the-shelf modules. Rejected. `boardgame.io` is state and
  networking for turn-based games, not rules: its own description, and its
  dependency set (`koa`, `socket.io`, `redux`, `immer`, `svelte`, `p-queue`)
  brings a server and a transport into a bundle that deliberately eliminates its
  whole backend in two of three build variants (IndexedDB on the web, an
  embedded server on Android). Worse, it would create a second source of truth
  for state, turn order and history beside `gameState.js`, the save layer and the
  rollback snapshots, which is the exact failure this work exists to remove.
  `XState` is well maintained and would be defensible for a small state machine,
  but here it would be a second modelling layer over 237 polities; the turn's own
  phases are already a ~150 line machine in `skipPhases.js`. The core is pure
  functions and data, and libraries are confined to algorithms.
- **Porting an existing engine** (Unciv, Freeciv). Both are licence-compatible
  with AGPL (Unciv MPL-2.0 with the secondary-license clause, Freeciv
  GPL-2.0-or-later), so this is a technical rejection, not a legal one. Both are
  games on a hexagonal or square tile grid with a few hundred tiles; this is a
  real geographic map with about 5000 regions owned by about 237 polities, and
  the whole value of the existing product is that map, its editor and its three
  distribution targets. Porting is the option that costs months instead of
  saving them.
- **Steering `pathfinding.js` and `turf.js` at the problem.** `turf` is already a
  dependency, so it is not an addition, and `pathfinding.js` works on a matrix
  grid, while adjacency here is regions and borders. Any path work in a later
  increment is A* or Dijkstra over a few hundred lines on the existing
  adjacency, not a grid library.
- **The model keeps the trajectory, the engine only smooths it.** Rejected. It
  keeps the network dependency, keeps the irreproducibility, and makes every
  number a negotiation between two authorities.
- **The engine owns economy, the model keeps a bounded correction.** Rejected
  for the same reason at a smaller scale: a blended number is neither
  reproducible nor narratable, and it keeps the continuity guard as an
  arbiter of truth rather than a safety net.
- **Making the engine advance before the model call so the model describes the
  new numbers.** Adopted; it is the ordering of steps 1 to 3 in section 7. The
  alternative, applying the engine after the model has already narrated, is what
  creates the tempting but wrong option of letting the model rewrite the period
  it just described.
- **A generic world schema version, introduced now.** Rejected as scope. The
  world has one ad-hoc marker (`ownerSchema`) and adding a framework is a
  separate decision; `economyEngine.version` is enough to stand down safely.

## Risks

- **Realism regression.** Some players like the model's ability to produce a
  historically apt number. Mitigated by the calibration node, the shock channel
  and the digest, which keep the model in the loop for the facts it is good at.
- **The model keeps emitting numbers.** Mitigated at three layers: the schema
  does not invite them, the ordering makes the engine's write last, and a
  mismatch is not an error, it is simply overridden. The prompt states the rule.
- **The continuity guard silently reverts engine output.** This is the highest
  consequence failure in the design, because it produces plausible numbers
  rather than an error. Mitigated by the explicit engine-sourced mark and a
  dedicated test.
- **Long jumps.** The step cap bounds the worst case; the recommendation is to
  log when it is hit rather than to fail.
- **Determinism broken by the rest of the pipeline.** `normalizeUnitEntry`
  injects `new Date().toISOString()` for units missing timestamps, and
  `pruneSatisfiedUnitOrders` deletes orders on every normalise
  (`src/runtime/gameState.js:894`, `:997`). Neither is touched in this increment,
  and the engine owns no units, so the exposure is contained. It becomes a real
  constraint in the military increment and is recorded here for that reason.
- **Divergent O(n) cost.** A per-region tick would be paid on every read and
  write through `normalizeWorldState`. Mitigated by keeping the tick per polity
  per turn and adding no region iteration to the normaliser.

## Decisions taken

These were put to the author and answered as follows.

1. **Step size: one month.** Three months was rejected because it would make a
   30 day jump a no-op and break the existing sub-month cadence semantics; the
   cap and the step count handle long jumps cheaply enough.
2. **The periodic AI stats refresh is suppressed now** for standard sheets, with
   a development escape hatch to compare paths. Left running, it would be a
   second writer of the same fields.
3. **Scope is the economy only.** Population moves as part of the economic step
   because GDP per capita needs it and the component ledger carries it, but city
   populations, city growth and migration as player-visible systems are a later
   increment.

## Open questions

None block implementation. The following are deliberately deferred and are
recorded so the plan does not silently decide them:

- The exact numeric constants in `ECONOMY_STEP` are first-draft calibration and
  are expected to be tuned against a few campaigns; the tests assert bounds and
  determinism, not specific magnitudes.
- Whether scenario authors should be able to override `ECONOMY_STEP` per
  scenario is a natural follow-on and is not in this increment.
