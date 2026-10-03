<!-- Open Historia - deterministic operations digest (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# Closing the Loop: Showing a Polity Its Operation

The tenth increment of the deterministic simulation, and the first that adds no
rule. Parts seven, eight and nine taught the engine the operational layer of a
war - front lines, the supply graph and its attrition, and the reinforcement and
rotation remedies - but every one of those numbers is computed after the model
has spoken. The model is handed the roster (id, type, owner, strength, posture
and region) and the pooled reserves, and is blind to which of its own formations
are in supply and which policy is in force, so it cannot direct the remedies the
engine already understands. This increment closes that loop for the player's own
polity: a short, capped digest that states the operational state as a given
fact, and a prompt rule that teaches the model when each policy and each
consolidation move is the right call. No engine behaviour changes; only what the
model is told.

## Why this increment exists

1. **The engine acts, but the model cannot direct it.** Reinforcement is
   automatic under the default `replacements` policy, so the engine works
   without the model. But rotation and merging are declared intents, and a
   declaration requires knowing which formations are in supply, how weak they
   are and which policy is already in force - none of which the model is shown.

2. **Supply state is the missing fact.** `buildUnitsSummaryText`
   (`src/Game/AI/promptContext.js`) already prints id, type, owner, strength,
   posture and region for a unit (up to sixty). What it cannot print is the
   derived supply state (`supplied`, `strained`, `isolated`) and reachability,
   because those live in the supply graph the summary function does not read.

3. **The policy line is a given the model must not guess.** The reinforcement
   policy takes effect on a one-period lag (`pendingReinforcement`, mirroring
   `mobilization`). A model that cannot see the policy in force will restate it
   wrongly or re-declare the same policy forever.

4. **The remedy needs a reason, not just a fact.** Knowing the state is not the
   same as knowing what to do with it. The rules exist (replacements,
   belligerent, none; rotate, merge), but nothing in the prompt ties a policy to
   the situation that justifies it, so the declarations the model produces are
   arbitrary.

## Scope

This increment is display and guidance, not a new rule.

1. A new pure builder, `src/runtime/operationsDigest.js`, that turns the
   player's own supply rows, roster and policy into one short, capped text
   block. It reads no world and imports nothing from `src/Game/AI/`.
2. A wiring change in `src/Game/AI/gameplay.js` that reads the same supply and
   policy facts the runtime already computes, builds the block, and hands it to
   the force-pools prompt builder alongside the existing digest.
3. A prompt rule added to `buildForcePoolsInstructions`
   (`src/Game/AI/gameplayPrompts.js`) that binds each policy and each
   consolidation move to the situation that justifies it.

Only the player's own polity is shown. The engine decides nothing new, the
declaration surface gains no field, and nothing is stored.

## Non-goals

- No automatic rotation or merging. The engine still resolves only declared
  intents, and this increment does not make the engine choose for the model.
- No enemy or third-party state in the block. This is the player's own loop.
- No new declaration field or schema change. The reinforcement, rotation and
  merge fields already exist and already reach `applySimulationResult`.
- No new stored `world` field, no migration and no `ENGINE_VERSION` bump. The
  block is derived on each build, exactly as the economy digest is.
- No per-unit price or reinforcement rate in the text. The engine owns every
  number, and the model does not need to restate them.
- No change to `buildUnitsSummaryText`. It is shared by many tasks and widening
  it would inflate every prompt.
- No new dependency, and no new UI surface.

## Design

### 1. Layers

The split follows the established one. A pure builder in `src/runtime` owns the
formatting and the caps; `src/Game/AI/gameplay.js` owns the wiring; the prompt
builder owns the guidance. The builder is the closest analogue of
`src/runtime/economyDigest.js`: it receives plain data and returns a string, so
it can be tested with no world and no catalog.

### 2. The digest builder

`src/runtime/operationsDigest.js` exports one function:

```
buildOperationsDigest({ formations = [], policyInForce = "", pendingPolicy = "", cap = 6, charCap = 360 })
```

It returns a single ASCII string, or the empty string when `formations` is
empty. Its output is three parts on separate lines:

```
[Your Forces in the Field, as simulated]
9 of 12 formations in supply; 2 strained, 1 cut off. 4 below full strength.
Reinforcement policy: replacements (in force); declared for next period: belligerent.
- 1st Infantry [id u7] 35%, cut off.
- 2nd Armor [id u9] 40%, strained.
```

The builder never mutates its input, and reads nothing outside its arguments.

### 3. The formation rows

`formations` is an array of `{ id, name, type, strength, state, reachable }`,
already filtered to the player and already paired with the supply state. The
builder trusts these rows and does not re-derive supply.

The summary line counts over every row: total formations, those `supplied`
(printed as "in supply"), those `strained`, those `isolated` (printed as
"cut off"), and those below full strength (`strength < 100`). A zero count is
omitted from the line so a healthy roster prints only what is true.

The list is a reminder, not an inventory. A row is listed when it is out of
supply (`state` is `strained` or `isolated`) or below full strength; a supplied
formation at full strength is healthy and is left out. Rows are ordered by
severity first (`isolated`, then `strained`, then the below-strength supplied
ones), then by ascending strength, then by ascending id so the order is total
and stable. Each printed row is `<name> [id <id>] <strength>%, <state>` with the
state spelled as in the summary line. The id is printed because rotation and
merging are declared by id.

### 4. The policy line

`policyInForce` is the policy in force this period (committed, already
overridden by last turn's pending declaration), and `pendingPolicy` is the
declaration now stored for the next period. The line always names the policy in
force, and names the pending declaration only when it differs from the one in
force. A blank `policyInForce` prints the line as "none in force", so a missing
policy is a stated fact rather than an omission.

### 5. Caps and limits

At most `cap` rows are printed. When more rows qualify than `cap`, the block
adds one line, `+N more out of supply.`, where `N` counts the unlisted rows that
are out of supply. A supplied but below-strength row that is dropped by the cap
is not counted in `N`, because the summary line already carries the
below-strength total. The whole block is then clamped to `charCap` characters on
a line boundary, so a very large roster cannot inflate the prompt. The empty
input yields the empty string, never a lone header.

### 6. The prompt rule

`buildForcePoolsInstructions` (`src/Game/AI/gameplayPrompts.js`) gains one entry
in its `rules` array, directly after the existing reinforcement paragraph, and
renders the digest under a new heading below the reserve block:

```
Your own forces' real state is given below; treat it as fact. Choose the policy
by what the war asks of you: replacements (the default) keeps every in-supply
formation topped up, for a general war or a full treasury; belligerent tops up
only the formations of a polity fighting an active war, for a limited war or
thin reserves; none stops the top-ups, to husband reserves after a peace or to
save for production. Relieve a worn in-supply formation by rotating in a fresh
one of the same type when both are in supply; fold two weak formations of one
type standing together into one by merging, which works even in a pocket. The
engine owns every cost and result; declare only what the period's events
justify, and most periods have none.
```

The guidance states no number. It ties each policy to a reason and separates
rotation (which spends the reserve) from merging (which works even inside a
pocket), which is the distinction the model cannot infer from the state alone.

### 7. Wiring

In `src/Game/AI/gameplay.js`, inside the dry-run economy block of
`simulateTimelineJump` (the block that already builds `variables.forcePoolsDigest`
when `projected.months > 0`), the wiring:

1. Reads supply with the already-imported adapter,
   `readSupplyAttrition(bundle.world, getPrimedScenarioRegionCatalog() ?? [], { fromDate: originDate, toDate: targetDate })`,
   the same synchronous accessor the runtime wiring uses.
2. Filters the supply rows to the canonicalised `playerPolity`, then joins them
   to `bundle.world.units` for `name`, `type` and the current `strength`. The
   supply row carries `unitId`, `state` and `reachable` but not the current
   strength (its `nextStrength` is the strength after attrition, which is not
   the state shown), so the roster is the source of the strength the block
   prints, matching what `buildUnitsSummaryText` already shows.
3. Reads the policy in force and the pending policy for `playerPolity`.
4. Calls `buildOperationsDigest` and sets `variables.operationsDigest`.
5. Passes `operationsDigest` to `buildForcePoolsInstructions`, which gains an
   `operations = ""` parameter beside `digest`.

To keep one definition of the policy-in-force fold, the runtime adapter
`src/runtime/reinforcement.js` gains an exported `readReinforcementPolicies(world)`
that returns `{ inForce, pending }`, keyed by resolved polity, and
`readReinforcement` is refactored to consume it. The fold (committed overridden
by last turn's pending) then lives in exactly one place, and the existing
adapter tests continue to pass unchanged.

### 8. Determinism and edges

The builder is pure and total: the same input yields the same string, and
reordering `formations` never changes it because the sort is total (severity,
strength, id). A missing strength is treated as full, matching the core's
default rather than reading a blank as zero. A missing name falls back to the
id. A jump whose `projected.months` is zero leaves `operationsDigest` unset,
exactly as the pool digest is left out today.

## Testing

`src/runtime/operationsDigest.test.js` (pure, no world):

- A mixed roster prints the summary counts, orders rows cut-off-first then
  strained then weakest, and prints each row's id and state.
- A supplied, full-strength formation is not listed, but it counts in the total.
- A zero count (no strained, no cut off) is omitted from the summary line.
- The policy line names the policy in force always, and the pending declaration
  only when it differs.
- A roster larger than `cap` prints exactly `cap` rows and the
  `+N more out of supply.` line with the correct `N`.
- A block longer than `charCap` is clamped on a line boundary.
- Empty input returns the empty string.
- The input array is not mutated, and the output is ASCII.
- Determinism: serializing the same input twice is identical, and reordering
  the input gives the same string.

`src/Game/AI/operationsPrompt.test.js` (prompt text):

- `buildForcePoolsInstructions` renders the operations heading and the passed
  block, and omits the heading when the block is empty.
- The guidance rule is present and mentions husbanding reserves and merging in
  a pocket.

`src/runtime/reinforcement.test.js` (the refactor):

- `readReinforcementPolicies` returns the committed policy overridden by the
  pending declaration, and `readReinforcement` still produces the same ops,
  reserve draw and summary over the added indirection.

A source-text guard, in the established style of
`src/runtime/reinforcementWiringArchitecture.test.js`, asserts that
`src/Game/AI/gameplay.js` reads supply, builds the digest and passes it to
`buildForcePoolsInstructions`, so a later edit cannot silently drop the wiring
the way the part-three declaration fields were once dropped.

`src/engine/enginePurity.test.js` is unaffected (no engine file changes), and
the existing economy-digest, declaration-schema and prompt tests still pass.
The model's own behaviour cannot be gated here (no LLM key, no browser), so the
increment gates the block, the wiring and the prompt text only.

## Acceptance

The whole suite passes with zero failures, `node --test "src/engine/*.test.js"`
and `node --test "src/runtime/*.test.js"` pass, ESLint is clean on the new and
changed files, `npm run wiki:check` reports `Wiki is current.` after any
documentation is regenerated, and `npm run build` succeeds. No `ENGINE_VERSION`
bump, no migration, no stored `world` field, no declaration-schema change and
no new `package.json` entry is introduced.

## Open questions

None block implementation. The following are deliberately deferred and recorded
so the plan does not silently decide them.

- Whether the block should also show the pool balance behind the reserve (the
  economy digest already states it) is deferred; this increment shows supply and
  policy, the facts new to the model.
- Whether an ally's or an enemy's supply state should ever be shown is left to
  the war model, as in parts eight and nine; this increment is the player only.
- Whether the policy line should explain the one-period lag in text, rather
  than only naming the pending declaration, is deferred; the fact is shown, the
  mechanism is not restated.
- Whether the same block should be built for the interactive (non-jump) turn
  path is deferred; this increment wires the jump path that already builds the
  neighbouring digests.
