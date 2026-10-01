<!-- Open Historia - deterministic research effects (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# Research Effects: Deterministic Modifiers from Completed Programmes

The fourth increment of the deterministic simulation. The first increment built
the reserves and the manpower pools; the second built the production and
construction line; the third gave research a clock, a cost and a rate. This one
makes a completed research programme change the simulation: the engine derives a
modifier from the programme's closed `domain` and `scale` and applies it to the
production line, the force pools and the economic step.

## Why this increment exists

1. **The third increment ended research in a dead end.** A research programme
   advances, completes, and then changes nothing the engine owns. The only effect
   of finishing one is the `onComplete` payload the model attached to it, which
   is prose-shaped state, not simulation. The player's own `wiki` page promises
   that "when it finishes, whatever the programme was for is released"; today
   that release is pure narration.
2. **`domain` and `scale` already exist and already price the programme.** They
   are closed fields the engine owns. Deriving an effect from the same pair adds
   no new vocabulary for the model to learn and no new field for it to author.
3. **The three consumers are all in place.** The line, the pools and the economic
   step were built in the first two increments and are stepped in one month loop.
   Research is the first system that can feed all three from a single completion.
4. **The third increment explicitly left this open.** Its design makes a
   completed programme release exactly the `onComplete` effects the model wrote,
   "no more", and lists per-domain mechanical effects as a non-goal. This
   increment is the deliberate reversal of that non-goal, recorded here so the
   reversal is a decision rather than a drift.

## Goals

- A completed research programme grants its polity a deterministic modifier
  derived from its closed `domain` and `scale`. The engine computes and owns it;
  no model declares, reads or writes it.
- The modifier is additive to the model's `onComplete` payload, never a
  replacement: the narrative effect and the mechanical effect are independent
  layers, and either may be absent.
- Three targets, one per consumer, each with a fixed application: the production
  line builds faster, the force pools regenerate faster, the economy grows
  faster.
- The mapping from `domain` to target is a fixed, documented 7-to-3 table, and
  the modifier per completion is a fixed function of `scale`, so the outcome is
  reproducible from the same completions in the same order.
- The totals persist on `economyEngine` behind a normalizer, survive a save and a
  reload, and are applied from the period after the completion - the same
  one-period lag the shocks, the posture and the facilities already have.
- The effect is symmetric: every polity's completed programmes modify that
  polity, whether or not it is the player.
- The effect is visible to the model in the period digest and to the player on
  the Forces panel and on the research card, so neither narrates it blind.
- No framework, no new runtime dependency, no `package.json` entry, and no
  migration of existing saves.

## Non-goals

- **Combat, attrition, front lines.** There is no combat system to modify yet;
  this increment does not build one and does not defer to one.
- **A tech tree, a technology catalogue, or named technologies.** There is still
  no set of named technologies a country acquires. The effect is derived from
  the programme's existing closed pair, not looked up in a catalogue.
- **Unlocking.** Nothing in the production line, the roster or the map becomes
  gated behind research. A programme that grants a modifier does not, for
  example, unlock a unit type.
- **A per-domain effect beyond the three targets.** The seven domains map onto
  exactly three targets; there is no per-domain arithmetic and no domain that
  grants something other than a rate or a growth bonus.
- **Direct player-authored programmes.** The player still steers with priority
  and abandonment; the model declares programmes through the existing project
  operations. This increment adds no entry form.
- **Retro-fitting existing saves.** A programme completed before this increment
  grants no modifier: effects start accumulating from the first completion the
  engine folds after this increment is installed, exactly as a pre-increment
  programme "starts accumulating from zero".
- **Research capacity feeding itself.** The modifier does not alter
  `researchPointsFor`. A country's research rate is still a function of its
  facilities and population alone, so this increment introduces no compounding
  research loop.

## Design

### 1. Layers

The same three layers and the same direction of dependency the first three
increments established.

| Layer | Location | Rule in this increment |
|---|---|---|
| Pure core | `src/engine/researchEffects.js` (new) | The target enum, the domain-to-target table, the scale-to-points table, the per-target cap, the per-point application factors, and the fold/normalize functions. No browser import, no `Date.now`, no `Math.random`. Importable by bare `node --test`. |
| Adapter | `src/runtime/` | `economyEngine.js` reads the committed totals, threads them into the advance, folds this span's completions, and writes the new totals back. `gameState.js` learns the new `economyEngine` field's normalizer. `economyDigest.js` renders the player's totals. |
| Boundary | `src/Game/AI/` and `src/Game/GameUI/` | `gameplay.js` passes the effects into the advance and builds the digest line; `forces.jsx` and the research card show the modifier. No schema and no prompt change: the model neither authors nor sets the effect. |

`src/engine/researchEffects.js` is a separate file rather than an addition to
`research.js` because the two share no arithmetic: `research.js` converts a rate
into progress, this converts a completed pair into a multiplier. They share only
the completion the third increment already produces.

### 2. The modifier model

Three targets, one per consumer:

```
RESEARCH_EFFECT_TARGETS = ["production", "pools", "economy"]
```

The fixed domain-to-target table. Every domain belongs to exactly one target;
the table is total over `RESEARCH_DOMAINS`, so every programme the engine can
price can also be applied:

```
RESEARCH_DOMAIN_EFFECT = {
  military:    "pools",
  naval:       "pools",
  aerospace:   "pools",
  industrial:  "production",
  electronics: "production",
  medical:     "economy",
  nuclear:     "economy",
}
```

The points a completion adds, by `scale`. Larger programmes move the target
more, and the same scale is worth the same everywhere:

```
RESEARCH_EFFECT_POINTS = { small: 1, medium: 2, large: 3 }
MAX_RESEARCH_EFFECT_POINTS = 6
```

Each target accumulates its own total per polity, clamped at
`MAX_RESEARCH_EFFECT_POINTS`. The cap keeps a long campaign from turning one
target into an unbounded multiplier, the same reason the pools and the research
rate are capped.

The application factors are first-draft calibration and are expected to be tuned
against a few campaigns. The tests assert bounds, ordering and determinism,
never a magnitude. For a target total `n` points:

| Target | Application | Constant |
|---|---|---|
| `production` | building time multiplied by `1 / (1 + 0.05 * n)` | `PRODUCTION_SPEED_PER_POINT = 0.05` |
| `pools` | regeneration multiplied by `1 + 0.05 * n` | `POOL_REGEN_PER_POINT = 0.05` |
| `economy` | annual growth plus `0.1 * n` percentage points | `ECONOMY_GROWTH_PER_POINT = 0.1` |

At the cap of 6 points, the most a target can be moved is a 30% shorter build
time, a 30% faster regeneration and an annual-growth bonus of 0.6 percentage
points. These are the intended ceilings, not sacred numbers.

The core exposes the arithmetic as pure functions so each consumer imports the
one it needs and no consumer re-derives a constant:

```
effectTargetFor(domain)                       -> target or "" for an unknown domain
effectPointsFor(domain, scale)                -> integer points, 0 if either is unknown
foldResearchEffect(totals, { domain, scale }) -> a new totals object, capped
normalizeResearchEffects(value)               -> { [polity]: { production, pools, economy } }
researchEffectTotalsFor(map, polity)          -> one polity's totals, zeros when absent
productionTimeMultiplier(points)              -> 1 / (1 + PRODUCTION_SPEED_PER_POINT * points)
poolRegenMultiplier(points)                   -> 1 + POOL_REGEN_PER_POINT * points
economyGrowthBonus(points)                    -> ECONOMY_GROWTH_PER_POINT * points
```

`normalizeResearchEffects` mirrors `normalizePools`: non-finite and negative
totals are dropped or floored, every total is clamped at the cap, and a polity
row that ends up all-zero is omitted so a campaign that never researches keeps
its `economyEngine` record byte-identical to the third increment's.

### 3. The three seams

The totals in force are read once, at the start of the span, from
`world.economyEngine.researchEffects`, and threaded into `advanceEconomy` as a
new `researchEffects` option. They are applied in three places, each a pure
function that gains an optional argument defaulting to "no effect", so every
existing caller and every existing test keeps its current result.

1. **The production line.** `enqueueOrders` gains `timeMultiplier = 1`, and
   stamps `monthsTotal` as `max(1, ceil(price.months * timeMultiplier))`. The
   multiplier is `productionTimeMultiplier(totals.production)`. Because a
   duration is stamped at the moment an order is paid for, an order already on
   the line is unaffected: the effect reaches orders declared from the next span
   on. That is the same "stamped at declaration" rule the price already follows.
2. **The force pools.** `stepPolityPools` gains `regenMultiplier = 1` and
   multiplies both regeneration terms by it, before the cap is applied. The
   multiplier is `poolRegenMultiplier(totals.pools)`.
3. **The economic step.** `stepPolityMonth` gains `growthBonus = 0`, added to
   `annualGrowth` as percentage points before the stability equilibrium is
   computed, so a research-driven expansion also feeds the stability it implies.
   The bonus is `economyGrowthBonus(totals.economy)`.

`advanceEconomy` looks each polity's totals up once per step, beside the posture
and the upkeep it already reads, and passes the three numbers to the three
functions. It does not branch on the target names.

### 4. The fold, and the one-period lag

The effect of a completion is folded in the adapter, not in the pure core,
because the core's normalized programmes have already shed `domain` and `scale`
(`normalizeResearchProgrammes` prices the pair and keeps the cost). The adapter
still holds the pair in the input it built with `buildResearchInput`.

After `advanceEconomy` returns, for each `{ polity, id }` in
`researchCompletions`, the adapter finds the matching programme in
`researchInput[polity].programmes`, reads its `domain` and `scale`, and folds
`effectPointsFor(domain, scale)` into that polity's running totals with
`foldResearchEffect`. The result is written to
`nextWorld.economyEngine.researchEffects`.

The lag follows from where the read and the write sit: the totals read at the
start of the span are the ones applied during it, and the fold happens after the
span, so a programme completed inside a span takes effect in the next. This is
the same one-period lag the shocks, the posture and the facilities already have,
and the specification states it rather than leaving it to be observed.

The fold cannot double-count. A completed programme leaves the active queue
(`stepResearchMonth`), so a later month in the same span does not report it
again, and the fold is driven by the completion list, not by the board. A
programme that is cancelled or failed is never completed and never folds.

Only the authoritative advance writes: the digest's dry run (`gameplay.js`)
computes totals on a throwaway world that is discarded, and only the advance
whose `world` is assigned to `nextWorld` persists them.

### 5. Persistence

One new field on `economyEngine`, written sparse:

```
economyEngine.researchEffects = { [polity]: { production, pools, economy } }
```

`normalizeEconomyEngine` in `runtime/gameState.js` reads it through
`normalizeResearchEffects` and omits it when empty, exactly as it does for
`pools`, `mobilization`, `production` and `upkeepShortfall`. A save written
before this increment has no such field and opens with no effects; a save
written after it round-trips them. There is no migration pass, and the version
number does not move.

### 6. Visibility

- **The digest.** `buildEconomyDigest` gains `playerResearchEffects`, and a
  `researchEffectsClauseFor` renders one player-only line beside the pool, the
  production and the research lines:
  `Research effects: production +30%, pools +10%, growth +0.2pp`. Only the
  non-zero targets appear, so a country with no completed research pays nothing
  for the feature and the line is omitted entirely. It is a reserve-block line,
  so it is not charged against `DIGEST_CHAR_CAP`, the same as the pool, the
  production and the research lines. It states the totals in force this period,
  which the adapter returns as `researchEffects` (read before the fold), not the
  ones this span's completions will produce.
- **The Forces panel.** The panel reads `world.economyEngine.researchEffects`
  for the player and shows the same line, read-only, beside the production line
  it already shows.
- **The research card.** A completed research programme shows its own
  contribution (`+10% production` for an `industrial`/`medium` programme), so the
  board explains where a modifier came from. The card derives this from
  `effectPointsFor(domain, scale)`, not from a stored per-programme field.

### 7. The model's role, and the guards

The model's role is unchanged from the third increment plus one fact it is told:
finishing a programme grants a modifier it did not author. Concretely:

- The model cannot write the totals. `researchEffects` is absent from every
  schema, from `PROJECT_PATCHABLE_FIELDS` and from the project field aliases, so
  no op, no event impact and no advisor block can reach it. It is written only
  by the adapter.
- The model cannot fold by hand, because it cannot complete a research
  programme. The third increment's `holdResearchInvariant` already refuses a
  model-sourced `progress` or `complete` on a research entry; that guard is the
  whole protection here, and this increment adds no second one.
- The model is told the totals in the digest, so it narrates a build-up, a
  recruitment drive or an expansion as caused by research rather than restating
  a number of its own.

### 8. Interaction with the earlier increments

- **Research is unchanged.** The capacity rule, the sequential allocation, the
  queue order and the completion path are untouched. This increment only reads
  the completions the third one already produces and the pair the third one
  already stores.
- **The line and the pools are unchanged in behavior when no totals exist.** All
  three seams default to "no effect", so an unmodified campaign and every
  existing test compute exactly what they computed before.
- **A facility completed this span already raises the next span's research
  rate** (the third increment's one-period lag); the modifier folded this span
  likewise applies next span, so the two lags agree and do not compound oddly.

## Compatibility

- No new runtime dependency, no `package.json` change.
- One new `economyEngine` field, normalized on read and written sparse, so an
  old save opens unchanged and a new save round-trips.
- The three engine functions gain optional arguments with defaults that
  reproduce current behavior, so no existing caller changes its result.
- Existing tests are not edited to accommodate the change; new tests assert the
  new behavior.

## Testing

- **Core** (`src/engine/researchEffects.test.js`): the target table is total over
  the domains; `effectPointsFor` returns the documented points and zero for an
  unknown pair; `foldResearchEffect` accumulates and caps at 6 and is pure (the
  input totals are not mutated); the three multipliers return 1 (or 0) at zero
  points and the documented value at the cap; `normalizeResearchEffects` floors,
  rejects and omits empty rows; a fold is order-independent for the same
  multiset of completions.
- **Adapter** (`src/runtime/economyEngine.research.test.js`): a span that
  completes a programme writes the folded total once and by the right amount; a
  second span does not fold it again; the totals are applied to the next span's
  build time, regeneration and growth but not the span that produced them; the
  result returns the applied totals and the world returns the folded ones.
- **Persistence** (`src/runtime/gameState.test.js` or the research test): the
  field round-trips, an absent field reads as empty, an out-of-range total is
  clamped, and a save without the field normalizes unchanged.
- **Wiring guard** (`src/runtime/researchWiringArchitecture.test.js` extended, or
  a sibling): `buildResearchInput`'s pair reaches `foldResearchEffect`, the
  folded map is written to `economyEngine.researchEffects`, and the three
  multipliers reach the three seams.
- **Digest** (`src/runtime/economyDigest.test.js`): the line names only the
  non-zero targets, is omitted when the totals are empty, and is not charged
  against the cap.
- **UI** (`src/Game/GameUI/projectsResearch.test.js` or a sibling): the
  completed card shows its contribution, and the Forces panel shows the totals
  line.

## Acceptance

The increment is done when a campaign that completes a research programme sees
`economyEngine.researchEffects` rise once, by the programme's `scale` in the
programme's `domain` target, and then build the next span's orders faster,
regenerate its pools faster and grow faster; when a second completion in the
same target accumulates up to the cap and no further; when the effect appears in
the period digest, on the Forces panel and on the research card; when a model
attempt to write a total is impossible through every path it has; when an
unmodified campaign and the existing suite are numerically unchanged; and when a
save written before the increment opens with no effects and no migration.
