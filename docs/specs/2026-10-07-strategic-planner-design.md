# GOAP-Lite Strategic Planner: Goals, Chains and a Scored Sequence

> Status: delivered. Wave 2, item 5 of
> `docs/specs/2026-10-07-grand-strategy-roadmap-design.md`. Implemented as
> `src/engine/strategicPlanner.js` with its tests, including the balance-harness
> integration.

## Problem

An opponent's options are already derived, and its character is already derived,
but nothing joins the two into a plan.

- `src/engine/strategicIntent.js` (`deriveIntentMenu`) says what an actor is
  **allowed** to do: declare, claim, or sue for peace. It never recommends.
- `src/engine/opponentPersonality.js` (`derivePersonality`) says **who** the
  actor is, from five axes read off its record. It deliberately decides nothing.
- `src/runtime/economyEngine.js` and `src/engine/economyTick.js` are the levers
  an actor can actually pull (mobilization posture, research effects, trade).

So when the narrator wants "what is this power trying to do this turn, in what
order, and why", the answer is assembled ad hoc, if at all. The roadmap's Wave 2
item 5 asks for a small, pure, deterministic planner beside `strategicIntent.js`
that turns current state into a goal and a scored sequence of steps.

## Goal

A pure engine module, `src/engine/strategicPlanner.js`, that:

1. scores a closed set of strategic goals against the actor's compact state and
   its derived personality,
2. picks the best goal deterministically,
3. expands that goal into an ordered, bounded sequence of prerequisite-first
   actions, skipping any action that is not currently available,
4. exposes a thin pure bridge from a plan to the economy-clock inputs, so a plan
   can be run and inspected through `src/engine/balanceHarness.js`.

It is advice, not law: the planner may only choose among actions the legal menu
already permits, and it never mutates state. The existing `deriveIntentMenu` and
`strategicGateway` remain the sole authority on what is legal and what is
applied.

## Non-goals

- No new runtime dependency, no change to `strategicIntent.js`,
  `opponentPersonality.js`, `gameplay.js` or any gateway. The planner is a new
  leaf; wiring the model's narration to it is a later increment.
- No combat action authoring. The planner does not invent wars or claims; the
  one menu-consuming action it has is de-escalation (`seekPeace`), because
  ending a war is the precondition for a bloc. A legal war action, if wanted, is
  a later increment with its own review.
- No map-dependent actions. Production orders that need a building site are out
  of scope; the economy bridge uses only site-free levers (posture, research
  effects, trade).
- No AI model call. The planner is deterministic arithmetic; a model may later
  read its output, exactly as it reads the personality profile today.

## Architecture

### Pure core: `src/engine/strategicPlanner.js`

Import-free except existing engine modules (`./economyMath.js`), so
`src/engine/enginePurity.test.js` covers it with no change: no clock, no
entropy, no browser global. Every input is a compact fact set, so equal facts
yield equal plans in any process.

```
STRATEGIC_GOALS      // frozen goal table
STRATEGIC_ACTIONS    // frozen action table
MAX_PLAN_STEPS = 6

scoreGoals({ state, personality }) -> [{ goal, score }]        // descending
derivePlan({ polity, state, personality, menu }) -> {
  polity, goal, score, steps, totalCost, alternatives, reason
}
planEconomyInputs(plan, { polity }) -> { posture, researchEffects, trade }
describePlan(plan) -> string                                   // one bounded line
```

### Inputs

`state` is the actor's compact economic and strategic facts, all numeric:
`gdpPerCapita`, `gdpGrowth`, `publicDebt`, `unemployment`, `stability`,
`powerShare`, `mobilization`, `activeWars`, `claims`, `allies`. Missing or
non-finite values read as their neutral default, so a half-filled sheet still
plans.

`personality` is the five-axis profile `derivePersonality` already returns.
`menu` is `deriveIntentMenu`'s output; only its array lengths are read, so a
plan can never name an option the menu does not offer.

### Goals

Three goals, matching the roadmap's own examples:

| Goal | Reads | Levers |
|---|---|---|
| `economic_expansion` | growth headroom: low unemployment, low debt, high opportunism and patience | research (economy), trade |
| `military_insurance` | threat: active wars, a weak power share, high aggression, high grievance | mobilization posture, research (pools) |
| `political_bloc` | isolation: few allies, low active wars, high patience and honor | de-escalation (menu `seekPeace`), relations, trade |

`scoreGoals` is a deterministic, clamped (0..100) weighted sum of normalized
features and the matching personality axes. Goal order in the returned list is
by score descending, ties broken by goal id compared by code unit (never
`localeCompare`). The weights are first-draft calibration in a frozen table, in
the same spirit as `economyConstants.js`: the tests pin direction and
determinism, never a specific magnitude.

### Actions and the chain

Each action is static data in the frozen catalog:

```
{ id, goal, label, requires: [actionId], cost,
  economy: { posture?, research?, trade? } }
```

Availability and the human-readable reason are separate pure predicates keyed by
action id (`actionAvailable`, `actionReason`), so the table stays inert data and
the two behaviours are read in one place each.

The declared order of `STRATEGIC_ACTIONS` is the canonical order; the planner
never re-sorts the catalog, so the same goal always yields the same sequence.
Expansion is a bounded depth-first resolution of `requires` (prerequisites
emitted before the dependent action), de-duplicated by id, skipping any action
whose `available` predicate is false, capped at `MAX_PLAN_STEPS`. If a goal has
no available action, the planner falls back to the next goal by score; if no
goal has one, it returns an empty plan with `goal: null` and a reason.

Catalog (first draft):

| Goal | Action | Requires | Available when |
|---|---|---|---|
| `economic_expansion` | `invest_industry` | - | always |
| `economic_expansion` | `expand_output` | `invest_industry` | always |
| `military_insurance` | `mobilize_partial` | - | posture not already partial or total |
| `military_insurance` | `invest_readiness` | `mobilize_partial` | always |
| `military_insurance` | `fortify_defenses` | `invest_readiness` | always |
| `political_bloc` | `deescalate` | - | menu `seekPeace` is non-empty |
| `political_bloc` | `open_relations` | - | always (after any de-escalation) |
| `political_bloc` | `formalize_bloc` | `open_relations` | always |

`reason` returns a short ASCII clause built from the facts that made the action
available (for example "at war on 2 fronts"), never free prose, so `describePlan`
is deterministic and bounded.

### The economy bridge

`planEconomyInputs(plan, { polity })` is the only point where a plan meets the
economy clock. It folds the plan's steps into the exact shapes
`advanceEconomy` already takes:

- `posture`: `{ [polity]: "partial" | "total" }` from mobilization actions,
- `researchEffects`: `{ [polity]: { economy, pools } }` summed from investment
  actions, capped by the existing `MAX_RESEARCH_EFFECT_POINTS`,
- `trade`: `{ [polity]: { gdp, stability } }` from bloc actions, a positive
  vector in the same shape `composeMultipliers` merges.

It is pure, returns empty maps for a plan with no steps, and never emits an
order that needs a site. This is the seam the balance harness consumes.

## Data flow

```
state + personality --> scoreGoals --> goal
                                        |
                          menu ---- > expand chain (prerequisite-first)
                                        |
                                    plan.steps
                                   /          \
                       describePlan        planEconomyInputs
                     (inspection)               |
                                          runBalanceScenario
                                        (headless outcome)
```

The planner reads and returns plain data. It writes nothing and stores nothing
between calls.

## Edge cases

- Empty state or missing personality: neutral defaults; a goal is still chosen
  and the plan is a valid, if generic, sequence.
- No legal menu: `deescalate` is unavailable, so `political_bloc` plans
  `open_relations` and `formalize_bloc` only.
- Already-mobilized actor: `mobilize_partial` is skipped, so the plan starts at
  `invest_readiness` or is empty if the goal had only that ready.
- A goal whose every action is unavailable: fall back to the next goal; report
  the chosen goal and its score, not the skipped one.
- Ties in goal score: broken by goal id by code unit, so order never flickers.
- Steps beyond `MAX_PLAN_STEPS`: truncated in declared order, deterministic.

## Testing

`src/engine/strategicPlanner.test.js` (new), under `node --test`:

- `scoreGoals`: returns all goals in descending order, ties by id; a rich,
  peaceful, opportunistic state tops `economic_expansion`; a warring, weak,
  aggrieved state tops `military_insurance`; an isolated, patient, honorable
  state tops `political_bloc`.
- `derivePlan`: emits prerequisites before dependents; honours the menu
  (no `deescalate` without a `seekPeace` entry); skips unavailable actions;
  falls back to the next goal when the best has none; caps at `MAX_PLAN_STEPS`;
  is deep-equal across two calls.
- `planEconomyInputs`: empty plan gives empty maps; a mobilization plan sets
  `posture`; an invest plan sums `researchEffects` under the cap; a bloc plan
  emits a positive `trade` vector.
- Integration through the harness: derive a plan, feed
  `planEconomyInputs` into `runBalanceScenario`, and assert the steered polity
  diverges from the unsteered baseline in the expected direction (an
  `economic_expansion` plan raises its growth multiple; a `military_insurance`
  plan raises its mobilization-driven cost; a `political_bloc` plan lifts its
  GDP through the trade vector). This is the requirement that plans be
  inspectable through the balance harness.
- `describePlan`: always a single bounded line, identical across two calls.
- `enginePurity.test.js` covers the new file automatically; no existing test is
  edited.

## Files

- New: `src/engine/strategicPlanner.js`, `src/engine/strategicPlanner.test.js`.
- Edit: none. The planner is a leaf; it is not wired into the game loop yet.

## Open questions

1. Should the planner later feed the model's prompt directly, or stay a fact
   the model may read? This spec assumes the latter, matching the personality
   profile's role; wiring is a separate increment.
2. Should a legal war action join the catalog? Deferred; it needs its own review
   because it consumes the war gateway, not just the economy clock.
3. Which goal weights ship as defaults? The frozen tables are first draft and
   are tuned once `balanceHarness` scenarios show which plans dominate.

## TODO

- [x] Implement `STRATEGIC_GOALS`, `STRATEGIC_ACTIONS`, `scoreGoals`,
      `derivePlan`, `planEconomyInputs`, `describePlan` (TDD).
- [x] Add the goal, chain, bridge and harness-integration tests.
- [x] Run `npm test`, `npm run build` and `enginePurity.test.js`.
