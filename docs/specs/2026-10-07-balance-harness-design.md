# Headless Balance Harness: Economy-Only Scenario Runner

> Status: approved design, ready to implement. Wave 2, item 6 of
> `docs/specs/2026-10-07-grand-strategy-roadmap-design.md`. Scope agreed with
> the owner: **economy only**. No combat, no settlements, no supply, no regions
> or units.

## Problem

The deterministic turn engines are pure, so they already run headless under
`node --test`, but nothing drives them over a long horizon to answer the
balancing questions a grand-strategy game lives or dies on:

- Does a small early advantage compound into a runaway leader (snowballing)?
- Does a shock or a debt spiral actually collapse a polity, or does it recover?
- Are two polities with the same inputs still identical after a century?

Today those questions are answered by hand, by replaying the game in the UI. The
roadmap's Wave 2 item 6 asks for a `node --test` harness over the existing
engines, with no new runtime and no new dependency.

## Goal

A pure engine module, `src/engine/balanceHarness.js`, that composes the existing
`advanceEconomy` clock over many polities and months and reports two readings:
**snowballing** (how concentrated the world economy has become) and
**collapse** (which polities hit a floor). Its test file runs representative
scenarios and pins the balance properties, so a future constant change that
breaks them fails CI.

## Non-goals

- No combat, settlement, supply, reinforcement, front-line or war-ledger phases.
  The roadmap's full-turn variant is a separate, much larger piece of work.
- No UI, no report file, no CLI. It is a library plus tests; a `scripts/` runner
  that prints a report can wrap it later if a human wants one.
- No new runtime dependency and no change to any existing engine module. The
  harness only imports what is already exported.
- No tuning of `economyConstants.js`. The harness measures; it does not change
  the simulation.

## Architecture

### Pure core: `src/engine/balanceHarness.js`

Import-free except for existing engine modules (`economyTick.js`,
`economyMath.js`), exactly like the other engine files, so
`src/engine/enginePurity.test.js` covers it automatically with no change: no
clock, no entropy, no browser global.

```
BALANCE_THRESHOLDS = { snowballTopShareDelta, collapseStabilityFloor,
                       collapseGdpDropFraction, debtCeiling }

concentrationOf(values) -> { total, count, topShare, hhi }

runBalanceScenario({ polities, months, startDate, sampleEvery,
                     shocks, trade, posture, upkeep, researchEffects,
                     orders, seed }) -> {
  months, samples, polities, snowball, collapsed,
  concentration
}
```

`concentrationOf` is the snowballing measurement. It keeps only finite,
non-negative values, sums them into `total`, and returns `count`, `topShare`
(the largest value divided by the total, `0` when the total is `0`) and `hhi`
(the sum of squared shares). A rising `topShare` and `hhi` over the samples is
what "snowballing" means here: the leader is pulling away from the field.

`runBalanceScenario` builds each polity with `makePolityEconomy` (injecting a
deterministic `jitterFor(seed, name)` character unless the caller pinned one),
then steps the span in `sampleEvery`-month chunks. Chunking is how a time series
is produced, because `advanceEconomy` returns only an end state: each chunk
carries the returned state into the next. Absolute shock months are re-based by
the running origin so a shock declared at month 0 does not re-fire every chunk,
matching how `src/runtime/economyEngine.js` re-bases declared shocks across
turns. The total run is capped at `MAX_STEPS`, and the returned `months` is the
number of months actually simulated.

Each sample records the running month and the concentration readings plus
`totalGdp`, `meanStability` and `maxDebt`. Each polity summary records start and
end GDP, the growth multiple, minimum stability, maximum debt, end population
and a `collapsed` flag.

`BALANCE_THRESHOLDS` is a frozen table so the readings are explainable and
tunable without touching the loop:

- A scenario **snowballs** when the last sample's `topShare` exceeds the first
  sample's by at least `snowballTopShareDelta`.
- A polity **collapses** when its minimum stability reaches
  `collapseStabilityFloor`, its maximum debt reaches `debtCeiling`, or its GDP
  falls below `1 - collapseGdpDropFraction` of its starting value.

The `collapsed` list is the polity names, sorted by code unit, so the report is
stable across runs.

## Data flow

```
polities (fixture)  ->  makePolityEconomy  ->  advanceEconomy (chunked)
                                                      |
                                     samples + per-polity summaries
                                                      |
                              concentrationOf + collapse test -> report
```

The harness reads and returns plain data. It writes nothing and stores nothing
between calls, so re-running a scenario is exact.

## Edge cases

- Empty polity list: no samples beyond month 0, `count` 0, no crash.
- One polity: concentration is `topShare` 1 and `hhi` 1; a lone polity's own
  stability and debt still decide `collapsed`.
- `months` 0, negative or non-finite: nothing is simulated and the report is the
  opening state.
- `months` beyond `MAX_STEPS`: capped, `months` reflects the cap, exactly as
  `advanceEconomy` already does.
- All-zero or all-negative values: `total` is `0`, every share is `0`, and no
  division happens.
- `sampleEvery` not a positive integer: clamped to 1.

## Testing

`src/engine/balanceHarness.test.js` (new), under `node --test`:

- `concentrationOf`: empty, single, equal split, one leader, non-finite and
  negative entries ignored, `total` 0 gives all-zero shares.
- Balanced scenario: identical polities with the same jitter stay identical (no
  false snowball), `snowball` is false, and `totalGdp` grows over the span.
- Inflationary scenario: a leader given a genuine growth advantage (research
  effect or a richer sector mix) reports `snowball` true and a rising
  `topShare` from first to last sample.
- Collapse scenario: a polity under a `debt_crisis` shock or an extreme opening
  debt is reported in `collapsed` with a floor stability or a debt at the
  ceiling.
- Determinism: two identical runs are deep-equal.
- Bounds: `months` is capped at `MAX_STEPS`, and the sample count matches
  `ceil(months / sampleEvery) + 1`.
- The existing `enginePurity.test.js` covers the new file automatically; no
  existing test is edited.

## Files

- New: `src/engine/balanceHarness.js`, `src/engine/balanceHarness.test.js`.
- Edit: none. No existing module, constant or test changes.

## Open questions

1. Which numeric thresholds ship as defaults? The spec starts conservative
   (a leader must gain a clear share of the world to count as snowballing, and a
   collapse must hit a hard floor), and the constants are one table to tune once
   real scenarios are run.
2. Should the harness later wrap the full deterministic turn? Explicitly out of
   scope now; it would require region and unit fixtures and would be fragile to
   phase changes.

## TODO

- [ ] Implement `concentrationOf`, `runBalanceScenario`, `BALANCE_THRESHOLDS`
      (TDD).
- [ ] Write the balanced, snowball and collapse scenario tests.
- [ ] Run `npm test`, `npm run build` and `enginePurity.test.js`.
