<!-- Open Historia - research programmes and deterministic research capacity (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# Research Programmes and Deterministic Research Capacity

The third increment of the deterministic simulation. The first increment built
the reserves and the manpower pools; the second built the production and
construction line. This one gives research a clock, a cost and a rate the
engine owns, so a research programme moves because the simulation says so and
not because the narrator decided this turn that it had.

## Why this increment exists

1. **Research already lives on the board, with no engine behind it.** A
   research programme is an ordinary `world.projects` entry. Its `progress` is a
   number the model writes; the milestones are dates the model invents. There is
   no cost, no rate and no queue, so "the reactor programme is half done" is
   prose, not state. Every other long effort shares the defect, but research is
   the one the production specification explicitly deferred to this increment
   (`docs/superpowers/specs/2026-10-01-production-queues-design.md`, sections
   "Non-goals" and "Alternatives considered").
2. **The board promised there is no tech tree.** `wiki/systems/projects.md`
   already tells the player: "There is no tech tree; there is a research
   programme with milestones that either progresses or stalls." That is the
   contract this increment makes true. Progress and stalling become real.
3. **The production line created the thing research builds on.** A completed
   `research_facility` now becomes a real `world.markers` entry through
   `completionBatchesFor`. This increment is the first consumer of that
   structure: the facilities the queue builds are what gives a polity the
   capacity to research.

## Goals

- A research programme is a project with `kind: "research"` and two closed
  fields, `domain` and `scale`, that together determine its cost in research
  points. The model authors the programme; the engine owns its progress.
- Each polity has a monthly research capacity, an integer number of research
  points derived from its completed research facilities plus a population
  modifier. The engine computes it; no model declares it.
- Capacity is allocated strictly sequentially. A polity's research programmes
  form one ordered queue; only the head receives points, and points left over
  when a programme completes flow to the next programme in the same month.
- Progress and completion are deterministic functions of state, the same seed
  and the same span, exactly like the economy, the pools and the line.
- Completion reuses the existing project completion path, so milestones,
  `onComplete` effects and the one-way latch behave the same as for any other
  project. No second completion mechanism.
- The capacity, the head programme and the queue are visible to the model in
  the period digest and to the player on the Projects board.
- No framework, no new runtime dependency, no new `package.json` entry, no
  migration of existing saves, and no new engine state outside the project list.

## Non-goals

- **A tech tree, a technology catalogue, or unlocking.** There is no set of
  named technologies a country acquires, and nothing in the production line,
  the roster or the map becomes gated behind research. A completed research
  programme releases exactly the `onComplete` effects the model already attached
  to it, no more.
- **A second resource.** Research points are a rate the engine computes each
  period from facilities and population, not a stock that is banked, carried
  between periods, or spent against manpower or materiel. Leftover points when
  the queue is empty are discarded.
- **Per-domain mechanical effects.** A domain is a closed label for cost and for
  the player's eye; it does not modify combat, industry or diplomacy.
- **Player-authored research programmes through new UI.** The player keeps the
  two levers the board already exposes, priority and abandoning the effort. The
  model declares programmes through the existing project operations; a direct
  player entry form is a later UI decision and does not change the engine
  contract.
- **A research variant of the production price table.** Research spends no
  manpower and no materiel and does not enter the FIFO line. It is a separate
  pure core with its own capacity rule.
- **Retro-fitting existing saves.** A research programme saved before this
  increment reads with no `domain`, no `scale` and no accumulated points; it is
  normalised to a sensible default rather than dropped, and no migration pass is
  written.

## Design

### 1. Layers

The same three layers and the same direction of dependency the first two
increments established.

| Layer | Location | Rule in this increment |
|---|---|---|
| Pure core | `src/engine/research.js` (new) | The domain and scale enums, the cost table, the capacity rule, programme normalisation, the sequential month step and its completion data. No browser import, no `Date.now`, no `Math.random`. Importable by bare `node --test`. |
| Adapter | `src/runtime/` | `economyEngine.js` extracts each polity's research input from `world.projects`, `world.markers` and `world.countryStats`, runs it inside the advance, and returns progress and completions. `gameState.js` learns the new project fields, the engine-owned progress write and the model guard. |
| Boundary | `src/Game/AI/` and `src/Game/GameUI/` | The jump schema and the project op schema gain `domain` and `scale` and the `research` kind; the prompt gains the rule and the capacity; `gameplay.js` applies the engine's progress and completions through the existing project path; `projects.jsx` shows a research programme as a research programme. |

`src/engine/research.js` is a separate file rather than an addition to
`productionQueue.js` because the two share no arithmetic: the line spends two
stocks over a duration, research converts one derived rate into progress. They
share only the month loop they are stepped in.

### 2. One clock

`src/engine/economyTick.js` stays the single clock, exactly as the production
specification required. `advanceEconomy` gains research as the fifth thing it
walks each month, beside the polity economy, the pools, the shortfall and the
production line. Research is never stepped by a second loop and never against a
different month count, so a research programme and the facilities that feed it
can never be advanced a different number of months.

The research input is grouped by polity and carried in the same `state` object
the advance already threads:

```
state.research = {
  [polity]: {
    points,                                  // integer research points per month
    programmes: [{ id, cost, accumulated }], // this polity's queue, in order
  },
}
```

`advanceEconomy` returns the stepped `state.research` alongside the stepped
pools and line, plus a flat `researchCompletions` list. The adapter converts
`state.research` back into project progress and applies `researchCompletions`
through the project completion path.

**Capacity is computed once per advance, from the opening world.** A research
facility that the production line finishes in month 4 of a twelve-month jump
does not raise capacity until the next jump, because completed structures are
applied to `world.markers` only after the whole advance returns. This is the
same deliberate one-period lag the production specification already accepts for
upkeep, and it is stated here so a future reader does not mistake it for an
ordering bug.

### 3. A research programme is a project

Research does not get a parallel list, a parallel panel or a parallel
completion path. It is a `world.projects` entry with three changes.

**`kind` gains `"research"`.** `PROJECT_KIND_SET` in `gameState.js` becomes
`{"project", "operation", "research"}`. A closed enum, because the engine now
switches on the value: `"research"` is precisely the predicate that says the
engine owns this entry's progress and the model does not. A tag was rejected:
tags are intentionally open (`normalizeTagList`), and a model that writes
`"Research"`, `"R&D"` or forgets the tag would silently opt a programme out of
the simulation.

**`domain` and `scale` are closed fields.** Both are added to the project
normaliser, to the project operation schema, and to the persisted field list.
They are required for a research programme and meaningless otherwise:

```
RESEARCH_DOMAINS = ["military", "naval", "aerospace", "industrial",
                    "electronics", "medical", "nuclear"]
RESEARCH_SCALES  = ["small", "medium", "large"]
```

A research programme with an unrecognised `domain` or `scale` is normalised to
`"industrial"` and `"small"` rather than dropped, the same forgiving rule the
existing project fields use. A non-research project's `domain` and `scale` are
dropped on normalisation.

**`researchPoints` is engine-only.** A new integer field on the project entry
holding the accumulated points the engine has spent on it. It is deliberately
absent from `PROJECT_FIELD_ALIASES`, absent from `PROJECT_PATCHABLE_FIELDS` and
absent from `projectOpSchema`, so no model can read, set or forge it. `progress`
is derived from it each time the engine writes.

### 4. Capacity

Each polity's monthly research capacity is a small integer, computed from the
structures it actually owns and its population. All three constants live in one
table in `research.js`.

```
RESEARCH_BASE_POINTS         = 1
RESEARCH_POINTS_PER_FACILITY = 2
RESEARCH_POPULATION_PER_POINT = 50000000   // one extra point per 50 million people
RESEARCH_MAX_POINTS          = 12
```

```
facilities = count of world.markers owned by the polity with kind
             "research facility" (the word BUILDING_MARKER_KIND maps
             research_facility to)
points = min(RESEARCH_MAX_POINTS,
             RESEARCH_BASE_POINTS
             + RESEARCH_POINTS_PER_FACILITY * facilities
             + floor(population / RESEARCH_POPULATION_PER_POINT))
```

The base of one means a polity with no facilities still researches, slowly; it
cannot be permanently locked out of the board's own promise. The facility term
is the primary driver, so `research_facility` built by the production line has a
real mechanical payoff. The population term is the "the country behind the
laboratory" modifier and is bounded by the cap so a large state cannot outrun
the design. The cap of twelve keeps a single month from completing an
end-game programme by arithmetic accident.

Capacity is a property of a polity, not of the player: a foreign polity with
research programmes advances under the same rule, because the board shows
foreign programmes and a foreign programme that never moves would be a lie the
board tells.

### 5. Sequential allocation

The decision this specification records: capacity is allocated **strictly
sequentially**, to one programme at a time, never split in parallel and never
weighted.

A polity's research queue is its research-kind projects, filtered to those whose
status is `"active"`, ordered by a total, deterministic comparator:

1. `priority` rank (`high` 0, `normal` 1, `low` 2) - the player's existing dial,
   and the only part of the order a human controls.
2. `startedAt` ascending, with an empty date sorting after a set one, so two
   programmes of equal priority run in the order they were begun.
3. `id` ascending - the stable tiebreak that makes the order total, so the same
   board always produces the same queue.

Only the head of this queue receives points. `proposed`, `paused` and `stalled`
programmes draw nothing and do not block the queue: they are simply not in it,
which makes pausing a programme a real way for the engine (through events) to
redirect research without deleting it.

Each month, one step of the queue:

```
remaining = points
for programme in queue order:
    need = programme.cost - programme.accumulated
    take = min(remaining, need)
    programme.accumulated += take
    remaining -= take
    if programme.accumulated >= programme.cost:
        programme completes; continue with the remaining points
    else:
        break   // points are exhausted inside this programme
```

The overflow rule is the second half of the recorded decision: when a programme
completes with points to spare, those points go to the next programme in the
same monthly step, and so on, so a single month may complete more than one
programme. Points left when the queue is exhausted are discarded; there is no
bank. This is what makes the rate, not the number of programmes, the thing that
matters: a country with many parallel programmes does not research faster, it
researches the same amount in queue order.

### 6. Progress and completion

- A programme's cost is `RESEARCH_DOMAIN_BASE[domain] * RESEARCH_SCALE_MULTIPLIER[scale]`,
  an integer (see the Constants section). Cost is derived, never stored, so it cannot
  drift from the domain and scale on the entry.
- `researchPoints` is the accumulated integer. `progress`, the only number the
  board already renders, is
  `clamp(floor(100 * researchPoints / cost), 0, 100)`. Because `researchPoints`
  is exact, a long programme never loses a month to rounding.
- Completion is a transition into status `"complete"`, applied by the engine and
  routed through the existing project completion path so that:
  - pending milestones are marked done and `progress` is forced to 100, exactly
    as the board's `close`/`complete` semantics already do;
  - `onComplete` effects are released once, through the existing one-way latch,
    exactly as for any other project;
  - a research programme that is cancelled or failed releases nothing, exactly
    as for any other project.

No new completion mechanism is introduced. The engine produces the same
transition the model is already allowed to produce for other kinds of project.
The only new rule is who is allowed to produce it for a research programme
(section 7).

### 7. The model's role, and the guard

The model still authors everything a model should author about a research
programme: its name, summary, `domain`, `scale`, `secrecy`, tags, milestones,
`targetDate`, `ongoing` and `onComplete` effects, through the project
operations it already sends. It may move a programme between `proposed`,
`active`, `paused`, `stalled`, `failed` and `cancelled`. It may not do the two
things the engine now owns:

- **It may not set `progress` or `researchPoints` on a research programme.**
  A progress patch against a research-kind target is ignored by the project op
  applier.
- **It may not mark a research programme `complete`.** A completion op against a
  research-kind target is ignored, so `onComplete` effects can never be granted
  by narration. Only a programme the engine actually finished releases its
  effects.

Both guards are implemented by an engine-only flag on the project-apply context.
The model's paths (event impacts, the advisor's projects block) never set it;
the engine's own progress and completion write does. The guard is written as a
property of the target entry (`kind === "research"`), not of the op, so it
cannot be bypassed by reaching for a different op name.

This is the same contract as the production line, restated for research: the
model declares, the engine executes. The one asymmetry is deliberate. On the
production line the model declares an order the engine then prices; on research
the model declares a programme the engine then funds out of a capacity the
country actually has.

### 8. Persistence

Nothing is added to `economyEngine`. A research programme's whole simulated
state is `researchPoints` on the project entry, and the project list is already
persisted, bounded (`MAX_PROJECTS = 120`) and evicted by the existing rule that
finished work goes first. A polity's capacity is derived, so it is never stored.

Two consequences, stated so the plan does not rediscover them:

- A research programme that is evicted from a full board takes its accumulated
  points with it; the country's capacity is unaffected, and a later programme of
  the same domain and scale simply starts again. This is the existing eviction
  policy, not a new one.
- The eviction rule already protects running programmes (`evictionRank`), so a
  research programme with status `active` is not the first thing dropped. A
  `complete` one is.

### 9. Digest and prompt

The model cannot narrate research honestly without knowing the rate and the
queue, so both are surfaced the same way the production line already is.

- `src/runtime/economyDigest.js` gains a **player-only** research line, beside
  the existing production line: the player's monthly research points, the head
  programme and its percent, and how many programmes are queued behind it. It is
  omitted entirely for a polity with no research programmes, so a campaign that
  never researches pays nothing for the feature.
- The declaration path is the separate `projects` task, whose prompt is a frozen
  template plus call-time directives: the rule is appended there by
  `buildResearchBoardDirective` (`projectsDirective.js`), because a jump no longer
  emits project ops. It says research programmes are declared with
  `kind: "research"`, `domain` and `scale`; the engine advances them by research
  points; the model must not state progress, must not state completion, and may
  still end one when the events do. The jump narration additionally keeps a
  paragraph in `buildProductionInstructions` so it does not invent research
  progress in prose, and should narrate the queue the digest reports rather than
  a rate it imagines.
- The project op schema (`PROJECTS_SCHEMA`, the separate board pass that declares
  programmes) gains the optional `domain` and `scale` fields and `research` in its
  `kind` enum; a jump no longer carries project ops. This is the only schema change, and the
  schema size budget (`projectOpSchema.test.js`, `jumpChars < 29500`) must be
  re-checked; if the two fields push it over, they are made terse or folded into
  the existing description before the budget is raised.

### 10. UI

`src/Game/GameUI/projects.jsx` already renders every project, its progress bar
and its milestones, so a research programme needs no new panel. Two small
changes make it readable:

- A research programme renders with a distinct kind badge and its `domain` and
  `scale` on the card, so the board distinguishes a research programme from a
  construction project at a glance.
- The progress bar becomes explicitly read-only for research - it already is for
  every project, because progress was never a player control; this just makes
  the new ownership legible in the code and the copy.

`src/Game/GameUI/forces.jsx` is not touched. Research is not a force.

## Constants

```
RESEARCH_DOMAINS = ["military", "naval", "aerospace", "industrial",
                    "electronics", "medical", "nuclear"]
RESEARCH_SCALES  = ["small", "medium", "large"]

RESEARCH_DOMAIN_BASE = {
  military: 30, naval: 36, aerospace: 48, industrial: 24,
  electronics: 36, medical: 30, nuclear: 60,
}
RESEARCH_SCALE_MULTIPLIER = { small: 1, medium: 2, large: 3 }

RESEARCH_BASE_POINTS          = 1
RESEARCH_POINTS_PER_FACILITY  = 2
RESEARCH_POPULATION_PER_POINT = 50000000
RESEARCH_MAX_POINTS           = 12
```

The numbers are tuning, not contract; the rule is contract. They live in one
table so a later balance pass changes one file. The tests below assert the shape
of the computation, not the specific balance.

## Interaction with the earlier increments

- **Slice 1 (pools).** Research spends no manpower and no materiel, so it does
  not draw on the reserves the pools hold. A country can be bankrupt and still
  research at the rate its facilities allow; that is intended.
- **Slice 2 (production line).** The line and research are siblings in the same
  month loop. A `research_facility` completed by the line raises capacity, one
  period later, by exactly `RESEARCH_POINTS_PER_FACILITY`. This is the one
  direction of interaction and it points from production into research, never
  the reverse.
- **Projects board.** Completion, milestones, `onComplete`, secrecy,
  verification, eviction and the activity feed are all inherited unchanged.
  Research is a kind of project, not a subsystem beside projects.

## Errors and edges

- **A research programme with no `domain` or `scale`** (a pre-increment save, or
  a model that omitted them) normalises to `industrial`/`small`. It researches
  and can complete; it is not silently inert, because inert is what the board's
  promise forbids.
- **A polity with programmes but zero capacity** cannot occur: the base of one
  guarantees at least one point per month.
- **A programme whose accumulated points already meet its cost** (only reachable
  through a hand-edited save) completes on the first step of the next advance
  rather than carrying negative need.
- **A one-month or sub-month span.** The step runs once per whole game month,
  same as the economy; a jump shorter than a month advances no research, exactly
  as it advances no economy.
- **Many programmes, one rate.** The overflow loop is bounded by the polity's
  queue, which is bounded by `MAX_PROJECTS`, and points are integers, so a
  single step terminates after at most that many completions.
- **An unrecognised `domain`/`scale` in a model op** is normalised to the
  default, not rejected, matching every other forgiving project field.

## Testing

The pattern the first two increments established, applied to research.

- **Pure core** (`src/engine/research.js` and its test): the cost table is a
  deterministic function of `(domain, scale)`; capacity is the documented
  formula including the cap; the sequential step allocates only to the head,
  carries overflow across completions in one month, discards leftover points at
  the end of the queue, ignores non-active programmes, and completes in queue
  order. A same-input-same-output test over a multi-month span.
- **Purity**: `src/engine/enginePurity.test.js` already scans the whole
  directory; `research.js` must pass it with no exemption.
- **Clock parity**: a test that research and the economy are advanced the same
  number of months in one `advanceEconomy`, so neither can be stepped a
  different distance.
- **Adapter** (`src/runtime/economyEngine.js` / `gameState.js` tests): capacity
  is read from the polity's real research-facility markers plus population;
  `researchPoints` round-trips through a save; the percent derivation is exact.
- **Guard** (`src/runtime/gameState` tests): a model progress patch against a
  research-kind project is ignored; a model completion op against a research-kind
  project is ignored and releases no `onComplete`; the engine's own write is
  honoured.
- **Digest** (`src/runtime/economyDigest.test.js`): the research line appears
  for a researching player, is player-only, and is absent when there is no
  research, under the existing character cap.
- **Boundary** (`src/Game/AI/` tests): the schema accepts `kind: "research"` and
  `domain`/`scale`, rejects an out-of-enum domain or scale, the schema size
  budget holds, and the prompt instruction is present in the built jump prompt.
- **Wiring architecture**: a `researchWiringArchitecture.test.js` beside the
  existing production/force/economy guards, asserting the source structure -
  that `projectOps` creation reaches research kind, that the engine
  progress/completion write is called on the jump path, and that the model path
  does not set the engine-owned flag.

## Documentation

- `docs/world-state.md`: the research programme fields and the
  `economyEngine`-adjacent research state (derived capacity, project
  `researchPoints`).
- `docs/ai-overview.md` and `docs/ai-schemas.md`: the `kind: "research"`
  declaration, the `domain`/`scale` enums and the "declare, do not progress"
  rule.
- `docs/runtime-services.md`: the research capacity consumer beside the
  production line.
- `wiki/systems/projects.md`: replace the forward-looking "there is no tech
  tree" note with the shipped rule - a research programme has a rate and a cost,
  the engine advances it, the player steers it with priority and by keeping it
  running. `npm run build:wiki` then `npm run wiki:check`.

## Compatibility

- No new runtime dependency, no `package.json` change.
- No new `economyEngine` field, so no change to `normalizeEconomyEngine`'s
  shape and no migration.
- New project fields are additive and normalised on read; an old save opens with
  research programmes that simply start accumulating from zero.

## Acceptance

The increment is done when a campaign that creates a research programme sees it
advance by the engine across a jump at the polity's computed rate, complete
through the existing project completion path, release its `onComplete` effects
once, refuse a model's attempt to set its progress or complete it, and appear
with its rate and queue in the digest and on the board.
