# Deterministic core: force pools

Date: 2026-10-01
Status: approved for implementation

## Problem

The economy now advances on its own. `advanceEconomy`
(`src/engine/economyTick.js:184`) walks whole months and returns a new economic
state; the adapter `advanceWorldEconomy` (`src/runtime/economyEngine.js:98`)
extracts that state from `world.countryStats`, calls the core and writes the
result back through `mergeCountryStatPatch`, and the model's only numeric
authority is the closed shock enum (`src/engine/economyShocks.js`). Nothing in
that path belongs to the military.

Three gaps follow.

1. **An army costs nothing.** `world.units` carries `strength` as a percentage of
   establishment (`normalizeUnitEntry`, `src/runtime/gameState.js:885`), but no
   stock of people or equipment stands behind it. A polity can hold any force at
   no price, so the map has no reason to weigh one formation against another.
2. **The player cannot mobilize.** There is no posture to set, no peacetime
   economy to trade against a war economy, and no consequence for calling up
   forces. The word "mobilization" exists only as one shock kind, which the
   narrator applies.
3. **The next two increments have nothing to consume.** Production queues and
   research (the later specs in this sequence) draw on reserves. Those reserves
   must exist, be deterministic, and be owned by the engine before a queue can
   spend them.

This specification delivers the first increment of the sequence: the **force
pools**. It is a resource layer and nothing more. Combat, queues and research
consume it later; none of them is built here.

## Goals

- A pure function advances a manpower pool and a materiel pool for every polity
  by a span of game time. Same inputs, same outputs, byte for byte, in a fresh
  process.
- The pools are derived from the population and output the engine already
  computes, in the same month step, on the same clock. There is no second
  timeline to drift.
- Existing forces carry a real monthly cost. A large army drains both pools.
- The player and the narrator can declare a **mobilization posture** from a
  closed enum, with the same one-period lag the shocks use.
- Both pools have a hard zero floor. A shortfall becomes stability pressure, not
  a negative reserve and never a change to `world.units`.
- The pools and the posture are visible on the existing country stat sheet,
  engine-written and engine-only.
- No framework, no new runtime dependency, no migration of existing saves.

## Non-goals

- Production queues, construction, research and anything that spends a pool. The
  following increments in the sequence; they consume this contract.
- Any write to `world.units`, `pendingUnitOrders` or markers. This increment
  **reads** the roster and nothing else.
- Combat resolution, attrition, front lines. Later increment.
- Per-type equipment stock. Materiel is one abstract index in this increment;
  splitting it into categories waits until a queue needs the split.
- Scenario-authored pool overrides or a per-scenario mobilization table. A
  natural follow-on, deliberately out of scope here.

## Design

### 1. Layers

The same three layers, with one direction of dependency, extended rather than
rearranged.

| Layer | Location | Rule in this increment |
|---|---|---|
| Pure core | `src/engine/` | New `forcePools.js`: the pool step, the posture enum, the validation. No browser import, no `Date.now`, no `Math.random`. Importable by bare `node --test`. |
| Adapter | `src/runtime/` | `economyEngine.js` extracts pools and posture, builds the upkeep table from the roster, passes both to the core, writes the result back. `gameState.js` learns the new persistence fields. |
| Boundary | `src/Game/AI/` | The jump schema gains the posture enum; the prompt gains the pool digest and the declaration rule. |

`src/engine/economyTick.js` stays the single clock. `advanceEconomy` gains the
pools as part of the state it walks, so the economy and the reserves can never be
advanced a different number of months. A separate force clock would be a second
source of drift, which is exactly the failure the economy increment removed.

### 2. The determinism contract

Everything the economy contract states applies unchanged, and is not restated in
full here:

- `hashSeed` (`src/runtime/unitMotion.js:45`) is the only generator, and it is
  not needed for the pools: their trajectory is a function of the state, not of
  entropy.
- Iteration is over `stableOrder(...)` keys. Object key order is never relied on.
- `Date.now`, `new Date`, `Math.random`, `localStorage`, `window`, `document`,
  `navigator` and `fetch` never enter `src/engine/forcePools.js`. The existing
  purity guard (`src/engine/enginePurity.test.js`) reads the directory, so the
  new file is covered the moment it exists.
- Rounding happens once, at the end of a month step: manpower to an integer,
  materiel to two decimals.
- The advance is **idempotent and recomputable**: it takes the last committed
  pools, the posture in force, the upkeep table and an elapsed month count, and
  returns the pools for the end date. Calling it twice with the same arguments
  returns the same content.

### 3. Time model

Identical to the economy, because it is the same loop:

- `months = floor(elapsedDays / 30)` with `MONTH_DAYS = 30`. A 6 hour jump is
  0 steps and does not move a pool.
- `MAX_STEPS = 240` per turn. The cap is shared with the economy step; a capped
  turn caps both together and logs one line.
- A new pool is stepped **after** the economy step for the same month, because it
  reads that month's population and output. See section 5.

### 4. State model

The engine's block grows four fields. They live inside `world.economyEngine`,
beside `pendingShocks`, so they ride inside `world` and every existing read,
write, poll, rollback snapshot and `viewAsSeen` path carries them with no new
plumbing.

```
economyEngine = {
  version, seed, lastDate, lastMonth, pendingShocks?,

  pools: { [polityName]: { manpower: number, materiel: number } },

  mobilization: { [polityName]: "demobilized" | "peacetime" | "partial" | "total" },

  // Declared THIS turn, runs NEXT period. Same lag, same reason, as pendingShocks.
  pendingMobilization: [ { polity: string, posture: string } ],

  // Sparse. Only the polities whose last month could not pay full upkeep.
  upkeepShortfall?: { [polityName]: { manpower: number, materiel: number } },
}
```

Sparse by construction, matching `normalizeEconomyEngine`
(`src/runtime/gameState.js:3417`):

- `pools` is written only once a month has actually advanced. A polity with no
  entry is initialized on the first step that reaches it, never at read time.
- `mobilization` holds only polities whose posture is not the default
  (`peacetime`). An absent name means `peacetime`.
- `pendingMobilization` and `upkeepShortfall` are omitted entirely when empty, so
  a campaign that never mobilizes and never runs short keeps a record
  byte-identical to the economy increment's.

Absent or half-written state is `null`-safe and initializes cleanly, exactly as
`normalizeEconomyEngine` already does for the rest of the block. There is no
migration.

#### Initialization

The first time a polity is stepped, before any production:

```
manpower = round(population * INITIAL_MANPOWER_SHARE)
materiel = gdp * INITIAL_MATERIEL_SHARE
```

from the polity's committed population and output. A save made before this
increment therefore opens with full reserves, which is the honest reading: the
forces existed, they simply had no ledger.

### 5. The month step: pools

One new pure function, `stepPolityPools`, in `src/engine/forcePools.js`. It takes
the polity **after** `stepPolityMonth` has run for that month, so it reads that
month's population and output, and returns the next reserves plus any shortfall.

Production, then upkeep, in that order. Producing first means a polity that
earns enough this month can pay this month, which avoids a one-month death spiral
that production-after-upkeep would create.

```
// 1. Production.
manpower += population * MANPOWER_PER_CAPITA_MONTHLY * EXTRACTION[posture]
manpower  = min(manpower, population * MANPOWER_CAP_SHARE)

materiel += gdp * INDUSTRY_SHARE * MATERIEL_PER_OUTPUT_MONTHLY * ALLOCATION[posture]
materiel  = min(materiel, gdp * MATERIEL_CAP_SHARE)

// 2. Upkeep, with the hard zero floor. `available` is what this month's
//    production left on hand, which is what upkeep is paid from.
available = manpower
manpower = Math.max(0, available - upkeep.manpower)
shortfall.manpower = Math.max(0, upkeep.manpower - available)

available = materiel
materiel = Math.max(0, available - upkeep.materiel)
shortfall.materiel = Math.max(0, upkeep.materiel - available)
```

The zero floor rule is absolute. `manpower` and `materiel` are never negative
under any input, including a hostile one. A pool at zero stays at zero; the
unmet remainder is recorded, not subtracted, and becomes stability pressure
(section 7). This is what keeps "negative manpower" out of every later
specification that reads these numbers.

After the month, round once: manpower to an integer, materiel to two decimals,
both floored at zero.

The **cap** (`MANPOWER_CAP_SHARE`, `MATERIEL_CAP_SHARE`) is what stops a hundred
peaceful years from producing an unbounded reserve. It is expressed as a share of
the same population and output the pools are drawn from, so the ceiling scales
with the polity rather than being an absolute number.

`stepPolityMonth` is **not changed**. Mobilization reaches the economy by folding
its multipliers into the `multipliers` table the clock already builds per step
(section 6), so the existing step keeps its signature and its meaning.

### 6. Mobilization

A closed enum of postures:

```
posture = "demobilized" | "peacetime" | "partial" | "total"   // default "peacetime"
```

Each posture maps to a fixed vector in one frozen table, `MOBILIZATION_EFFECTS`:

```
{
  extraction,    // multiplies manpower production
  allocation,    // multiplies materiel production
  growthDrag,    // subtracts from the economy's gdp multiplier (workforce pulled out)
  stabilityDrag, // subtracted from stability every month, the political cost of the call-up
}
```

`peacetime` is the identity vector: `extraction: 1, allocation: 1, growthDrag: 0,
stabilityDrag: 0`. `demobilized` trades lower production for no drag and a small
growth bonus. `partial` and `total` raise production and raise the drag. The
numbers are first-draft calibration in the table, and the tests assert bounds and
ordering (total drags more than partial), never a magnitude.

Within `advanceEconomy`, for each polity and each step:

```
multipliers = shockMultipliers(own)          // exactly as today
multipliers = applyMobilization(multipliers, posture, MOBILIZATION_EFFECTS)
polity      = stepPolityMonth(polity, { year, multipliers })   // UNCHANGED
pools       = stepPolityPools(polity, { posture, upkeep, multipliers })
```

So one clock drives both, and `stepPolityMonth` learns nothing new.

#### Declaration and the one-period lag

The model declares a **scoped list**, exactly as it declares shocks:

```
mobilization: [ { polity: "France", posture: "total" } ]
```

- `normalizeMobilization(value, { knownPolities })` in `forcePools.js` validates
  it. An unknown `polity` or an unknown `posture` is dropped entry by entry, never
  fatal to the turn, and returned in `rejected`. Same discipline as
  `normalizeShocks` (`src/engine/economyShocks.js:86`).
- At most `MAX_MOBILIZATION` (20) entries per turn. Duplicate polities fold, last
  one winning, because a posture is one value per polity.
- A posture declared this turn is **not applied now**. It is stored verbatim on
  `pendingMobilization` and runs in the **next** advance, which is the same
  one-period lag the shocks use and for the same reason: the period the model
  just narrated is not rewritten by a decision it took after narrating it.
- In the advance, the previous turn's `pendingMobilization` is validated against
  the known polities, becomes the posture **in force** for this period, and is
  merged over the committed `mobilization`. The committed posture is what a
  polity with no pending declaration keeps running.

Any posture a polity is not currently at is simply `peacetime`. Nothing needs to
be written to "unmobilize" a polity except a declaration of `peacetime`.

### 7. Upkeep and the zero floor

The adapter builds the upkeep table, because it is the only layer that knows the
world shape. A new pure helper `buildUpkeepTable(world)` in `economyEngine.js`
sums, per owning polity, over that polity's units:

```
UNIT_UPKEEP[type] = { manpower, materiel }   // one entry per UNIT_TYPE
```

running over the closed `UNIT_TYPE_SET` (`src/runtime/gameState.js:218`), summed
with a stable key order so the arithmetic is order-independent. It is passed to
the core as plain data, so the core stays import-free.

Two rules make the projection and the authoritative advance agree:

1. The table is built from the **period's opening roster**, computed once by the
   caller and handed to both `advanceWorldEconomy` calls (the dry run at
   `src/Game/AI/gameplay.js:12699` and the real advance at `:7210`). The dry run
   passes the roster of `bundle.world`; the real advance passes the roster of the
   period's opening world. A unit created by this turn's events pays from the
   **next** period on. This is stated plainly rather than approximated, because a
   projection that disagrees with the sheet is worse than a one-month delay. It
   fixes the roster term; the dry run is still a projection, and the authoritative
   advance is the final word, exactly as it already is for the economy.
2. Upkeep is a **passive cost only**. It never edits a unit, never lowers
   `strength`, never disbands anything. A polity that cannot pay still has its
   army on the map; it pays in stability instead.

The shortfall is the whole point. It feeds the same stability multiplier the
shock table already contributes to, so an over-stretched army and a sanctions
regime push one dial:

```
shortfallRatio = clamp(shortfall.manpower / max(1, upkeep.manpower), 0, 1)
               + clamp(shortfall.materiel / max(1, upkeep.materiel), 0, 1)
stabilityPressure = stabilityDrag[posture] + STABILITY_UPKEEP_SHORTFALL * clamp(shortfallRatio, 0, 1)
```

The latest shortfall per polity is stored on `upkeepShortfall` and reported in the
digest, so the player is told why stability is slipping instead of discovering
it.

### 8. Turn ordering

The economy's ordering is unchanged and the pools ride inside it. The additions
are marked.

1. Start of turn: the projection call (`simulateTimelineJump`,
   `src/Game/AI/gameplay.js:12647`) builds the upkeep table from `bundle.world`
   and asks `advanceWorldEconomy` for a dry run. The returned digest
   (section 11) is injected as given facts.
2. The model answers with events, optionally shocks, optionally a mobilization
   declaration.
3. Event impacts are applied, as today. They still own indices, stability, text,
   territory, units and markers.
4. The authoritative `advanceWorldEconomy` runs on the post-impact world
   (`:7210`), with the **same upkeep table** from step 1 and this turn's
   `declaredMobilization` and `declaredShocks`. The engine writes its economy
   fields **last**, the pools included, through `mergeCountryStatPatch` with
   `engineSourced: true`.
5. `captureCountryStatsHistory` runs after the engine write, so the snapshot
   captures the engine's numbers as it already does for the economy.

Inside the advance the order is: apply the previous turn's pending shocks and
pending mobilization, walk the months (economy step, then pool step), store this
turn's declarations as the new pending set, and write the result.

### 9. The engine-sourced mark and the continuity guard

The pools are not indices and are not subject to `guardCountryStatContinuity` in
any meaningful way (a pool has no continuity band), but the **write** still
carries `engineSourced: true`, for one reason: it is what lets
`mergeCountryStatPatch` (`src/runtime/countryStats.js:963`) accept the engine's
`forces` block and refuse it from any other writer.

The rule:

- `countryStats[name].forces` is merged **only** when `engineSourced === true`.
  An ordinary event patch or an advisor write that carries `forces` is ignored,
  field by field, never partially applied.
- `normalizeCountryStatSheet` (`src/runtime/countryStats.js:427`) learns to read
  `forces`, so a reloaded save keeps it and a stray-key rejection does not drop
  it.
- `forces` is absent from the model-facing stat schema and from every patchable
  field list, so a strict provider cannot emit it at all. The schema is the first
  line, the `engineSourced` gate is the second, and neither is relied on alone.

### 10. Visibility: the forces sheet fields

The readable mirror lives on the sheet, in the same namespace as `stability` and
`economy`:

```
countryStats[name].forces = {
  manpower: integer,
  materiel: number,      // two decimals
  mobilization: posture, // the posture IN FORCE this period
}
```

It is a mirror, not the source of truth. The engine reads its own
`economyEngine.pools` and `economyEngine.mobilization` on the next extraction;
the sheet exists so the player can see the numbers on the existing country panel
(`src/Game/GameUI/stats.jsx`) without a new panel, a new route or a new fetch.
The panel gains a read-only "Forces" section listing the two pools, the posture,
and, when present, the shortfall. That is the only UI change in this increment.

### 11. The period digest

`buildEconomyDigest` (`src/runtime/economyDigest.js`) gains a **player-only**
pool line, kept after the existing economy header and before the tracked
polities, so the character cap cannot drop it:

```
Your reserves: manpower 1,240,000, materiel 318.40. Mobilization: peacetime
(partial takes effect next period). Upkeep shortfall last month: 42,000
manpower.
```

Rules:

- The player's pool line is always kept, like the player's economy line.
  Tracked polities keep economy-only lines, so the digest does not double in
  length and the existing `DIGEST_CHAR_CAP` still holds.
- The posture shown is the one in force **this** period. A posture declared this
  turn is named as taking effect next period, so the lag is visible to the model
  rather than implied.
- The shortfall clause appears only when `upkeepShortfall` names the player.
- Every number is one the engine produced. With no engine data (a custom-sheet
  scenario, or a 0-month jump) the line is absent and the prompt is
  byte-identical to today's.

### 12. Segment merge and the boundary

A long jump is generated in segments and merged by `mergeSegmentPayloads`
(`src/Game/AI/jumpSegments.js:236`). The mobilization declaration merges the same
way `economicShocks` does, by being concatenated across segments and carried into
the merged payload so the final answer reaches `applySimulationResult` intact.
One difference: shocks stack, a posture does not, so the mobilization list is
then folded to one entry per polity, the last segment winning, because the merge
is a fold over segments in order and a later segment is the later intent.

The boundary additions:

- `JUMP_FORWARD_SCHEMA` (`src/Game/AI/gameplaySchemas.js:995`) gains
  `mobilization`: an array of `{ polity, posture }`, `posture` an enum, at most
  `MAX_MOBILIZATION` entries. The schema does **not** gain `manpower` or
  `materiel`: the model declares a posture, never a reserve.
- `gameplayPrompts.js` gains `buildForcePoolsInstructions`, in the same style as
  `buildEconomyEngineInstructions`: what the pools are, that upkeep is paid
  automatically from the roster, that a posture is declared for named polities
  and takes effect next period, and that the model must never state a manpower or
  materiel number.
- `gameplay.js` threads `declaredMobilization` into both `advanceWorldEconomy`
  calls and passes the pool digest into `variables`, beside `economyDigest`.

### 13. Tests

New:

- `src/engine/forcePools.test.js`: determinism (two calls deep-equal, across
  processes); the zero floor under an upkeep larger than the pool, asserting a
  non-negative pool and the exact shortfall; the cap under a hundred peaceful
  years; posture ordering (`total` drains more than `partial`, `demobilized`
  produces less); idempotence (0 months is a no-op, 3 then 3 equals 6).
- `src/engine/economyTick.test.js`: the existing advance still produces the same
  economy when no upkeep and no posture are supplied, so the change is additive.
- `src/runtime/economyEngine.test.js`: `buildUpkeepTable` groups by owner and is
  order-independent; `pendingMobilization` round-trips (declare this turn, runs
  next, committed after); `upkeepShortfall` is written when it exists and absent
  when it does not.
- `src/runtime/gameState.economyEngine.test.js`: the new fields normalize,
  survive a reload, and are dropped when half-written.
- `src/engine/enginePurity.test.js`: already covers the new file by directory
  scan; no edit needed beyond confirming it still passes.
- `src/Game/AI/forceWiringArchitecture.test.js`: constrains the call order inside
  `applySimulationResult` the way `economyWiringArchitecture.test.js` does for the
  economy (the pool step after `stepPolityMonth`, the engine write after the
  event impacts, the digest built before the model call).
- `src/Game/AI/gameplaySchemas.test.js` and the prompt tests: the `mobilization`
  field is accepted, the enum is closed, the cap is enforced.
- `src/runtime/countryStats.test.js`: `mergeCountryStatPatch` accepts `forces`
  only under `engineSourced: true` and ignores it otherwise.
- `src/runtime/economyDigest.test.js`: the player pool line is kept when the cap
  bites, is absent without engine data, and names a next-period posture.

Regression:

- `npm test` stays green (2486 today, 2484 pass, 2 todo) plus the new tests.
- `npx eslint .` gains no new error beyond the four pre-existing files.
- `npm run wiki:check` stays current, since `docs/` and `wiki/` are both touched.
- `npm run build` succeeds.

### 14. Docs

- `docs/world-state.md`: the four `economyEngine` fields, the `forces` sheet
  mirror and the engine-only rule, and the zero floor.
- `docs/ai-overview.md`: the `mobilization` field, the posture enum and the
  one-period lag.
- `docs/ai-schemas.md`: the `mobilization` entry in `JUMP_FORWARD_SCHEMA`.
- `docs/runtime-services.md`: `forcePools.js`, `buildUpkeepTable` and the pool
  step inside the existing clock.
- `docs/architecture.md`: the force pools as the second consumer of the engine
  contract.
- `wiki/`: regenerated with `npm run build:wiki` and committed, per `docs/wiki.md`.

## Considered options

- **A separate `world.materielEngine` block with its own clock.** Rejected. It
  would give the reserves a second time line that can drift from the economy they
  are drawn from, and it duplicates the seed, the date and the normalization the
  economy block already carries. The pools are a row on the same ledger, not a
  second ledger.
- **Ready reckoning instead of a stored pool** (recompute reserves from
  population and output every read). Rejected. It cannot express a stock drawn
  down by past upkeep, so a long war would leave no trace, and it would put an
  O(polities) computation on every read through `normalizeWorldState`.
- **Let the model state manpower and materiel numbers.** Rejected on the same
  ground the economy rejected it: a model-stated reserve is not reproducible and
  blends two authorities. The model declares a posture; the engine owns the
  number.
- **Charge upkeep by editing `world.units`** (lower `strength`, disband on
  failure). Rejected as scope, and it violates the increment boundary: the
  military increment owns unit mutation, and this one must not smuggle it in.
  Upkeep pays in stability, which is already an engine field.
- **Assess upkeep from the post-impact world** (so a unit created this turn pays
  immediately). Rejected. The projection runs before the model answers, so it
  would either charge a different roster than the authoritative advance or force
  the projection to guess. Charging from the period's opening roster keeps the
  digest and the sheet in exact agreement.
- **A per-type equipment split now.** Rejected as premature. One abstract
  materiel index is enough until a production queue needs to spend specific
  categories, and the split is additive when it comes.

## Risks

- **The panel shows a number the player cannot act on yet.** Mitigated by the
  digest and the posture, which are both actionable in this increment: the player
  can mobilize or stand down, and sees the cost.
- **Upkeep makes large armies unplayable before combat exists.** Mitigated by
  keeping `UNIT_UPKEEP` first-draft and the shortfall a stability push rather than
  a unit removal, so the worst case is a slower economy, not a vanishing army.
- **The projection and the sheet disagree.** This is the highest-consequence
  failure, because it produces plausible numbers rather than an error. Mitigated
  by the single opening-roster upkeep table and a dedicated test that runs both
  calls with the same inputs.
- **The digest outgrows its cap.** Mitigated by making the pool line player-only
  and keeping tracked polities economy-only.
- **Determinism broken by the rest of the pipeline.** Unchanged from the economy
  increment: `normalizeUnitEntry` injects `new Date().toISOString()` and
  `pruneSatisfiedUnitOrders` deletes orders on every normalize
  (`src/runtime/gameState.js:885`, `:997`). Neither is touched here, and the
  engine reads units and never writes them, so the exposure is contained. It
  becomes a real constraint in the combat increment and is recorded for it.
- **A model declares `total` mobilization for every polity at once.** That is
  allowed and is a legitimate story, and the engine prices it: the drag and the
  upkeep are borne per polity, so a world at total mobilization pays for it.

## Decisions taken

Put to the author and answered as follows.

1. **Scope is pools only.** Manpower and materiel, with mobilization and upkeep.
   Production queues and research are the next increments.
2. **The engine owns the pools; the sheet is a mirror.** The source of truth is
   `economyEngine`; the reading is `countryStats[name].forces`.
3. **The model declares a scoped posture from a closed enum**, with the same
   one-period lag as the shocks, rather than stating reserves or acting per
   player only.
4. **Existing forces pay a monthly upkeep**, read from the roster and never
   written back to it.
5. **Zero floor is absolute.** `Math.max(0, pool - upkeep)` for both pools, and
   the unmet remainder becomes stability pressure recorded on `upkeepShortfall`.

## Open questions

None block implementation. The following are deliberately deferred and recorded
so the plan does not silently decide them.

- The exact constants (`UNIT_UPKEEP`, `MOBILIZATION_EFFECTS`, the shares and the
  caps) are first-draft calibration and are expected to be tuned against a few
  campaigns. The tests assert bounds, ordering and determinism, never a
  magnitude.
- Whether scenario authors should be able to override the pool constants per
  scenario is a natural follow-on and is not in this increment.
- Whether the posture should be settable directly from the country panel, rather
  than declared through the narration, is a UI decision for a later increment.
  The engine contract does not change either way.
