# Deterministic core: production and construction queues

Date: 2026-10-01
Status: approved for implementation

## Problem

The force pools exist and are spent by upkeep, but nothing can build with them.
`advanceEconomy` (`src/engine/economyTick.js:185`) walks whole months and returns
new pools for every polity; the adapter `advanceWorldEconomy`
(`src/runtime/economyEngine.js:143`) extracts that state, calls the core and
writes it back through `mergeCountryStatPatch`. The model's numeric authority is
the closed shock enum and the closed posture enum. None of it can raise a
formation or lay a foundation.

Three consequences follow.

1. **The reserves only shrink.** Manpower and materiel are produced every month
   and drained by upkeep, but no decision spends them on anything. A pool at its
   cap is dead state: the player can mobilize, and pays for it, but cannot turn
   the surplus into an army or a structure.
2. **Every new unit and every new structure already has a path, but only the
   model drives it.** `world.units` grows through `impacts.unitOps` and
   `world.markers` through `impacts.markerOps`, both authored by the narrator in
   the same turn they are described. There is no cost, no delay and no queue, so
   "a factory is built over two years" is prose, not state.
3. **The next increment has nothing to sit on.** Research is the later spec in
   this sequence and it lives inside the projects board; it needs a queue that
   already knows how to spend reserves, hold an item for a span of months and
   report completion. That queue does not exist.

This specification delivers the second increment of the sequence: the
**production and construction queues**. It spends the reserves the first
increment created and it emits the same kinds of world mutation the narrator
already emits, through the same appliers. Combat and research are not built
here.

## Goals

- A pure function advances one FIFO production line per polity by a span of game
  time, spending manpower and materiel and completing items on the same clock
  the economy and the pools already run on.
- The model declares **orders**, never costs and never durations. The engine
  owns the price, the build time and the draw on the reserves.
- An order is paid in full when it enters the line. A polity that cannot afford
  an order has that order rejected deterministically; there is no partial build
  and no stall.
- One line per polity, strictly first-in first-out. The head of the line is the
  only item making progress.
- A completed unit becomes a real `world.units` entry and a completed structure
  becomes a real `world.markers` entry, applied through the existing event
  impact path so owner resolution, map placement and volume bounds are shared
  with everything else.
- The queue and the order lag are visible to the model in the period digest and
  to the player in the Forces panel.
- No framework, no new runtime dependency, no migration of existing saves.

## Non-goals

- Research and technology. The later increment in the sequence; it consumes this
  contract.
- Combat resolution, attrition, front lines. Later increment.
- Player-authored orders through a new panel. The model declares; a direct
  player queue is a later UI decision and does not change the engine contract.
- Cancelling or refunding an order. An order that is paid for is built.
- Per-type equipment stock. Materiel stays one abstract index.
- Any economics of upkeep for the newly built forces beyond what the first
  increment already does: a unit completed this period pays upkeep from the next
  period on, because the upkeep table is built from the period's opening roster.

## Design

### 1. Layers

The same three layers, with one direction of dependency, extended rather than
rearranged.

| Layer | Location | Rule in this increment |
|---|---|---|
| Pure core | `src/engine/` | New `productionQueue.js`: the cost and time tables, the closed kind and type enums, order validation, the FIFO line step and the completion data. No browser import, no `Date.now`, no `Math.random`. Importable by bare `node --test`. |
| Adapter | `src/runtime/` | `economyEngine.js` reads and writes the queue, pays for orders from the pools, and translates completions into `unitOps`/`markerOps`. `gameState.js` learns the new persistence fields. |
| Boundary | `src/Game/AI/` | The jump schema gains the order list; the prompt gains the queue digest and the declaration rule; `gameplay.js` applies the engine's completion ops through the existing impact path. |

`src/engine/economyTick.js` stays the single clock. `advanceEconomy` gains the
production line as part of the state it walks, next to the pools, so the
economy, the reserves and the queues can never be advanced a different number of
months. The line is a fourth consumer of one ledger, not a second clock.

`src/engine/productionQueue.js` is a separate file rather than an addition to
`forcePools.js` because the two have different shapes: `forcePools.js` is a
stock that rises and falls, and `productionQueue.js` is a state machine with a
head, a tail and completions. Keeping them apart keeps each file small enough to
read in one pass and lets each be tested alone.

### 2. The determinism contract

Everything the economy and force-pool contracts state applies unchanged, and is
not restated in full here:

- Iteration is over `stableOrder(...)` keys. Object key order is never relied on.
- Floats are summed in a fixed order (the declared order of the accepted orders,
  and for a completion the roster of one line in order), because float addition
  is not associative.
- `Date.now`, `new Date`, `Math.random`, `localStorage`, `window`, `document`,
  `navigator` and `fetch` never enter `src/engine/productionQueue.js`. The
  existing purity guard (`src/engine/enginePurity.test.js`) reads the directory,
  so the new file is covered the moment it exists.
- Rounding happens once, when a value is written: manpower to an integer,
  materiel to two decimals.
- The advance is **idempotent and recomputable**: it takes the committed queue,
  the orders entering it this span, the pools and an elapsed month count, and
  returns the queue, the pools and the completions for the end date. Calling it
  twice with the same arguments returns the same content.

### 3. Time model

Identical to the economy and the pools, because it is the same loop:

- `months = floor(elapsedDays / 30)` with `MONTH_DAYS = 30`. A 6 hour jump is
  0 steps and does not move a line.
- `MAX_STEPS = 240` per turn, shared with the economy step.
- An item's `monthsTotal` counts monthly steps. An item declared with 3 months
  completes on the third step after the step it started, never on the date it
  was declared.
- A completion is stamped with the 1-based step within the span at which it
  landed (`monthOffset`), so a structure founded mid-span can carry the date it
  was actually founded rather than the end of the jump.

### 4. State model

The engine's block grows three fields, beside the pools, so they ride inside
`world` and every existing read, write, poll, rollback snapshot and
`viewAsSeen` path carries them with no new plumbing.

```
economyEngine = {
  version, seed, lastDate, lastMonth, pendingShocks?,
  pools?, mobilization?, pendingMobilization?, upkeepShortfall?,

  // The committed lines. Sparse: a polity with no line is absent.
  production?: {
    [polityName]: {
      active?: { kind, type, count, at?, name?, monthsDone, monthsTotal },
      queue:  [ { kind, type, count, at?, name? }, ... ],   // waiting, FIFO, possibly empty
    },
  },

  // Declared THIS turn, runs NEXT period. Same lag, same reason, as pendingShocks.
  pendingProduction?: [ { polity, kind, type, count?, at?, name? } ],

  // Orders this period's advance rejected, for the same reason rejectedShocks exists.
  rejectedProduction?: [ { polity, kind, type, count?, reason } ],
}
```

Sparse by construction, matching `normalizeEconomyEngine`
(`src/runtime/gameState.js:3423`):

- `production` is written only once a month has actually advanced, and a polity
  whose line is empty (no `active` and no `queue`) is omitted entirely, so a
  campaign that never builds keeps a record byte-identical to the force-pool
  increment's.
- `pendingProduction` and `rejectedProduction` are omitted entirely when empty.

Absent or half-written state is `null`-safe and initializes cleanly. There is no
migration.

#### Order shape

One order is the model's whole vocabulary. It names a polity, what is being
made, how many, and, for a structure, where.

```
order = {
  polity: string,                         // required, must be a known polity
  kind:   "unit" | "building",            // required
  type:   string,                         // required; from the closed lists below
  count:  integer >= 1,                   // optional, default 1; capped
  at:     string,                         // optional; a structure's site, or a unit's override
  name:   string,                         // optional; what a completed unit is called
}
```

`kind` and `type` must agree: a `unit` order's `type` is a unit type and a
`building` order's `type` is a building type. A disagreement is a rejected
entry.

### 5. The closed enums and the tables

The unit types are the six the roster already knows
(`UNIT_TYPES`, `src/runtime/gameState.js:223`). They are re-declared in the
engine, exactly as `UNIT_UPKEEP` re-declares them, because the engine may not
import the runtime; a runtime test asserts the two lists are equal so they
cannot drift.

```
PRODUCTION_UNIT_TYPES =
  [ "infantry", "armor", "air", "naval", "artillery", "garrison" ]

BUILDING_TYPES =
  [ "fortification", "airfield", "naval_base", "military_base",
    "industrial_plant", "logistics_hub", "research_facility" ]
```

The bounds are frozen beside the enums:

```
MAX_PRODUCTION_ORDERS = 20   // orders a single period may declare
MAX_UNIT_COUNT        = 20   // identical items in one order
MAX_PRODUCTION_QUEUE  = 12   // waiting items a line's tail may hold
```

Each type maps to a fixed row in one frozen table. The numbers are first-draft
calibration and the tests assert ordering and bounds, never a magnitude: a naval
unit costs more and takes longer than an infantry unit, an industrial plant
takes longer than a fortification.

```
PRODUCTION_TABLE = {
  infantry:        { manpower:  8000, materiel:  6, months: 2 },
  armor:           { manpower:  6000, materiel: 24, months: 3 },
  artillery:       { manpower:  5000, materiel: 16, months: 3 },
  air:             { manpower:  2000, materiel: 40, months: 4 },
  garrison:        { manpower:  3000, materiel:  3, months: 1 },
  naval:           { manpower: 12000, materiel: 90, months: 6 },

  fortification:   { manpower:  4000, materiel: 30, months: 4 },
  airfield:        { manpower:  3000, materiel: 45, months: 5 },
  logistics_hub:   { manpower:  4000, materiel: 35, months: 4 },
  military_base:   { manpower:  5000, materiel: 50, months: 6 },
  naval_base:      { manpower:  6000, materiel: 70, months: 7 },
  industrial_plant:{ manpower:  9000, materiel: 60, months: 8 },
  research_facility:{manpower:  7000, materiel: 55, months: 9 },
}
```

A `count` greater than one is a series of identical items. Its price is
`count * row` for both resources, paid once at the head; its build time is
`count * row.months`, because one line builds them one after another. A
structure is always a series of one: a `building` order with `count > 1` is
rejected, because two identical named structures at one site is not a thing.

The structure's `marker.kind` is a human label derived from the type by a frozen
map (`naval_base -> "naval base"`, `industrial_plant -> "industrial plant"`, and
so on), so a queued structure appears on the map with the same kind vocabulary
the narrator and the game master already use.

### 6. Validation, the line and the price

One pure function validates orders, mirroring `normalizeMobilization` and
`normalizeShocks`: an entry that fails is dropped, never fatal to the turn, and
returned so the caller can log it.

```
normalizeProductionOrders(value, { knownPolities }) -> { valid, rejected }
```

Rejections, each with a reason: not an object; unknown polity; unknown `kind`;
`kind`/`type` disagreement; `count` out of range; more than `MAX_PRODUCTION_ORDERS`
(20) orders in one period (a new polity is refused past the cap, duplicates do
not consume it); a structure with `count > 1`.

The committed line is validated separately and without a world, so a corrupted
save costs the entry, never the world:

```
normalizeProductionQueue(value) -> { [polityName]: { active?, queue } }
```

An order does not build anything until a line exists for its polity. Both arrive
together, at the start of an advance.

#### Price and payment

Payment is **in full, when the order enters the line**. There is no deposit and
no installment. For each accepted order the checks run **capacity first, then
price**, so a full line never takes money for an order it will not hold:

```
if (lineTail.length >= MAX_PRODUCTION_QUEUE) { reject(order, "line full"); continue; }

price = { manpower: count * row.manpower, materiel: count * row.materiel }
if (pool.manpower >= price.manpower && pool.materiel >= price.materiel) {
  pool.manpower -= price.manpower
  pool.materiel -= price.materiel
  enqueue(order)
} else {
  reject(order, "cannot afford")   // no partial build, no stall
}
```

The pool an order is paid from is the same base the month step uses, so the two
agree: `pools[polity] ?? initialPoolsFor(polity)`. Payment happens **before** the
first monthly step of the span, so the month's own production cannot fund the
same month's order; the reserves a polity opens the period with are what it
spends. The pool keeps its absolute zero floor: payment is never allowed to take
it below zero, because it is only taken when the whole price is present.

Income and outgoings in one span therefore read, in order: pay for accepted
orders, then for each month produce and pay upkeep as today.

#### The line

One polity, one line. `active` is the head and is the only item that progresses;
`queue` is the tail and waits. Each monthly step:

```
if (!active && queue.length) active = shift(queue)
if (active) {
  active.monthsDone += 1
  if (active.monthsDone >= active.monthsTotal) {
    completions.push(completionFor(active, monthOffset))
    active = undefined
    if (queue.length) active = shift(queue)   // and it starts next month, not this one
  }
}
```

An item that completes does **not** start its successor in the same month: the
line works one item at a time, and the month it finishes is spent on the item it
finished. A `MAX_PRODUCTION_QUEUE` (12) bounds a line's tail; an order that
would exceed it is rejected with reason `"line full"`.

#### Completions

A completion is plain data, produced by the pure core:

```
completion = { polity, kind, type, count, at, name, monthOffset }
```

The core never touches a unit or a marker. It states that the item is done and
the adapter turns that statement into a world mutation.

### 7. From completion to world

The adapter translates each completion into the same operations the narrator
already emits, because those are what the rest of the pipeline understands:

- A `unit` completion becomes `count` spawn operations,
  `{ op: "spawn", unit: { type, ownerCode: polity, strength: 100, at, name } }`.
  The site is the order's `at` when the model gave one; otherwise the polity's
  `countryStats[polity].capital`; otherwise the polity's first
  `territorialComponents[].geography`. A unit with no resolvable site is dropped
  with a receipt note rather than placed at `0,0`.
- A `building` completion becomes one build operation,
  `{ op: "build", marker: { name, kind, ownerCode: polity, at, status: "active" } }`,
  where `at` is the order's site, required for a structure.

`name` for a completed unit is the order's `name` when given, else a stable
label built from the type and the polity's running count of that type. The
engine never invents a display name; naming is a boundary concern.

The operations are then applied **through the existing impact path**, not by a
hand-rolled applier, in `gameplay.js` immediately after the authoritative
economy advance (`src/Game/AI/gameplay.js:7219`):

1. Build one synthetic event per distinct completion date, the date derived from
   the completion's `monthOffset` as `addGameMonths(fromDate, monthOffset)`, with
   `impacts: { unitOps, markerOps }`. This is exactly the pattern
   `applyIdlePulseUnitOps` uses (`src/Game/AI/gameplay.js:15007`), extended to
   carry a date, so a structure founded mid-span is stamped on the date it was
   founded rather than the end of the jump.
2. Run it through `resolvePlacements` (`src/Game/AI/gameplay.js:1933`), so a
   site phrase is resolved against the real map, an army is never raised at sea,
   and new structures are spaced off what already stands.
3. Hand it to `applyEventImpactsToWorld` (imported at
   `src/Game/AI/gameplay.js:166`), which resolves owner names, applies the
   volume bounds and writes `world.units` and `world.markers` through the same
   code as any narrated operation.

This is why the engine returns data and not `world` mutations: the core cannot
know the map, and the boundary already has a resolver and an applier that are
tested and that already handle every failure mode (unresolvable place, sea
placement, over-volume). The completion rides them; it does not duplicate them.

A completion that fails placement is a receipt note and nothing else, the same
way a narrated operation that fails placement already is. It never loses the
turn.

### 8. Turn ordering

The economy's ordering is unchanged and the line rides inside it. The additions
are marked.

1. Start of turn: the projection call (`simulateTimelineJump`,
   `src/Game/AI/gameplay.js:12715`) runs `advanceWorldEconomy` as a dry run and
   the returned digest (section 10) is injected as given facts.
2. The model answers with events, optionally shocks, optionally a posture, and
   optionally `productionOrders`.
3. Event impacts are applied, as today. They still own indices, stability, text,
   territory, units and markers.
4. The authoritative `advanceWorldEconomy` runs on the post-impact world
   (`:7219`), with this turn's `declaredProduction` and `declaredMobilization`.
   It enqueues and pays for the orders that were declared the **previous** turn,
   advances the lines month by month, stores this turn's orders as the new
   pending set, and returns the completions.
5. The completion operations are applied through the impact path, on the world
   the engine just advanced.
6. `captureCountryStatsHistory` runs after, so the snapshot captures the world
   with this period's completions already in it.

Inside the advance the order is: fold in the previous turn's pending orders and
pay for them, walk the months (economy step, pool step, line step), store this
turn's orders as the new pending set, and write the result.

### 9. The boundary: schema and the size guard

`JUMP_FORWARD_SCHEMA` (`src/Game/AI/gameplaySchemas.js`) gains one field,
`productionOrders`, beside `mobilization` (`:1090`):

```
productionOrders: {
  type: "array",
  maxItems: MAX_PRODUCTION_ORDERS,
  description: "Production and construction orders for next period: closed
    lists; the engine computes cost, time and the draw on the reserves. State
    no numbers.",
  items: {
    type: "object",
    properties: {
      polity: { type: "string" },
      kind:   { type: "string", enum: ["unit", "building"] },
      type:   { type: "string", enum: [ ...PRODUCTION_UNIT_TYPES, ...BUILDING_TYPES ] },
      count:  { type: "integer", minimum: 1, maximum: MAX_UNIT_COUNT },
      at:     { type: "string" },
      name:   { type: "string" },
    },
    required: ["polity", "kind", "type"],
    additionalProperties: false,
  },
}
```

The `type` enum is the union of the unit types and the building types, so the
provider rejects an unknown token before the engine sees it; `kind` and the
engine's validator settle the rest. The schema does **not** gain `manpower`,
`materiel` or `months`: the model declares an order, never a price.

The jump schema is measured by a guard:
`assert.ok(jumpChars < 28000, ...)` in
`src/Game/AI/projectOpSchema.test.js`. It is measured at **27995** characters
with only five to spare, so this field cannot be added without moving the
guard. The guard's own comment says a new impact family may raise it on purpose,
with the reason written down. The field and its description cost roughly 800
characters, and the guard moves to **29000**, with the reason recorded in the
comment beside the number:

```
// 28,000 -> 29,000: the production queue joined the jump contract. The engine
// owns the price and the build time, so the model declares an order and never a
// number; the field is a closed-list array with a union type enum, ~800 chars.
```

The game master schema is not touched: it has no queue of its own and its
authored events keep their board access.

### 10. The period digest

`buildEconomyDigest` (`src/runtime/economyDigest.js:51`) gains a **player-only**
production line, kept with the pool line so the character cap cannot drop it:

```
Your reserves: manpower 1,240,000, materiel 318.40. Mobilization: partial.
Production line: 2x infantry (1 month left), then 1x fortification (4 months).
```

Rules:

- The line is built from the **projected end-of-span** line: what is under
  construction now and what is waiting, in order. It is what the model must see
  before it declares the next order, so it does not duplicate work already in
  the queue.
- The line is player-only, exactly like the pool line, so `DIGEST_CHAR_CAP`
  still holds. Tracked polities keep economy-only lines.
- An empty line is absent, and a 0-month jump leaves the whole line out, so the
  prompt stays byte-identical when there is nothing to say.
- No number in it is the model's: the counts and the remaining months are the
  engine's.

### 11. Visibility: the Forces panel

The player sees the line in the existing Forces panel
(`src/Game/GameUI/forces.jsx`), which already owns formations and is the
smallest surface that makes sense for a queue that spends manpower and materiel.

A new read-only "Production" section lists the active item with its remaining
months and the waiting items in order. It reads the committed line directly from
`world.economyEngine.production[playerCode]`; the panel gains one asynchronous
`readWorldStateView` read when it opens and when the unit list changes. There is
no new panel, no new launcher and no new route.

The state is **not** mirrored onto `countryStats[name].forces`. The panel is the
only reader that needs it and it reads the engine block; adding a second copy
would widen the country-stat schema and its strip logic for no reader. This is
the one place this increment deliberately does less than the force-pool
increment did.

### 12. Not a second authority: the narrator and the game master

The queue is the building authority for anything listed in it. Without a rule,
the narrator would both queue a formation and spawn the same formation through
`impacts.unitOps`, and the game master would both queue a structure and build
the same structure through `impacts.markerOps`. That is a double build, and it
is the one failure this increment introduces that the earlier increments did
not have.

The rule, stated in the prompt and in the game master guidance:

- When an event raises a formation or opens a structure that is **already on the
  board or in the queue**, the event narrates it and emits **no** `unitOps` spawn
  or `markerOps` build for it. The engine will place it when it completes.
- `unitOps` and `markerOps` remain for everything the queue does not own:
  moving, reinforcing, renaming, removing, and any structure the narrator
  establishes outright without a queue entry.
- The digest's production line is the list of what the queue already owns, so
  the model can see it before it writes.

This mirrors the rule the force-pool increment already states for the roster:
the engine owns the number, the narrator describes it.

### 13. Tests

New:

- `src/engine/productionQueue.test.js`: determinism (two calls deep-equal);
  order validation (unknown polity, unknown kind, kind/type disagreement, count
  bounds, the per-period cap, a structure with `count > 1`); payment rejects an
  unaffordable order and leaves the pool untouched, and accepts an affordable
  one and draws it exactly; the FIFO line completes in order with the right
  `monthOffset`; an item finishing does not start its successor in the same
  month; the queue cap; `normalizeProductionQueue` drops half-written state; a
  zero-month advance is a no-op.
- `src/engine/economyTick.test.js`: the existing advance still produces the same
  economy and the same pools when no orders are supplied, so the change is
  additive.
- `src/runtime/economyEngine.test.js`: `pendingProduction` round-trips (declare
  this turn, run next, committed after); a completion becomes the expected
  `unitOps`/`markerOps`; a unit site falls back from the order's `at` to the
  capital to the first component geography; `rejectedProduction` is written when
  it exists and absent when it does not.
- `src/runtime/gameState.economyEngine.test.js`: the new fields normalize,
  survive a reload, and are dropped when half-written.
- `src/runtime/productionUnitTypes.test.js`: the engine's
  `PRODUCTION_UNIT_TYPES` equals `UNIT_TYPES`.
- `src/engine/enginePurity.test.js`: already covers the new file by directory
  scan; confirmed to still pass.
- `src/Game/AI/productionWiringArchitecture.test.js`: constrains the call order
  and the completion application inside `applySimulationResult` the way
  `forceWiringArchitecture.test.js` does for the pools: the line step after the
  pool step, the completion applied after the economy advance and through
  `resolvePlacements` then `applyEventImpactsToWorld`, the digest built before
  the model call.
- `src/Game/AI/projectOpSchema.test.js`: the raised guard, and that
  `productionOrders` is present, closes its enum and caps its count.
- `src/runtime/economyDigest.test.js`: the production line is kept when the cap
  bites, is absent when the line is empty, and is absent on a 0-month jump.

Regression:

- `npm test` stays green plus the new tests.
- `npx eslint .` gains no new error.
- `node --test "src/engine/*.test.js"` stays green.
- `npm run wiki:check` stays current, since `docs/` and `wiki/` are both
  touched.
- `npm run build` succeeds.

### 14. Docs

- `docs/world-state.md`: the three `economyEngine` fields, the line shape and
  the zero floor for payment.
- `docs/ai-overview.md`: the `productionOrders` field, the closed enums and the
  one-period lag.
- `docs/ai-schemas.md`: the `productionOrders` entry in `JUMP_FORWARD_SCHEMA`.
- `docs/runtime-services.md`: `productionQueue.js`, the line step inside the
  existing clock, and the completion path through the impact appliers.
- `docs/architecture.md`: the production queue as the third consumer of the
  engine contract, and the "no second authority" rule it adds.
- `docs/wiki/systems/projects.md`: a note that research remains inside the
  projects board while physical production is the engine's queue.
- `wiki/`: regenerated with `npm run build:wiki` and committed, per
  `docs/wiki.md`.

## Considered options

- **A general order engine serving both production and research now.** Rejected
  as premature. Research's shape is not known yet, and abstracting a shared
  command type before a second consumer exists would guess at the seam. The
  line is a plain FIFO of typed items; research can either reuse it or add its
  own layer beside it when its spec arrives.
- **Fold the queue into `forcePools.js`.** Rejected. A stock and a state machine
  have different invariants and different tests; one file that does both is
  harder to read and harder to change without touching the other.
- **Installments with a stall when the pool is empty.** Rejected. A stall needs
  a second state (blocked), a rule for what unblocks it, and tests for partial
  progress, for no gain in determinism. Paying in full and rejecting is one
  state, and the pool's scarcity is visible at the moment of the order.
- **Let the model state cost and duration.** Rejected on the same ground the
  economy and the pools rejected model numbers: a model-stated price is not
  reproducible and blends two authorities.
- **Apply completions by writing `world.units` and `world.markers` directly in
  the adapter.** Rejected. It would bypass location resolution, sea-placement
  refusal, owner-name resolution and volume bounds, and it would put map
  knowledge into the adapter. Routing through `resolvePlacements` and
  `applyEventImpactsToWorld` reuses all of it.
- **Put the orders in the projects-board call, which has its own schema.**
  Rejected. The board is narrative bookkeeping that is skipped when nothing
  moved, its state is `world.projects` and the engine does not own it. The queue
  is deterministic state on the engine's clock and belongs beside the shocks and
  the posture.
- **Put the orders on a separate gameplay call of their own.** Rejected. It
  would cost a whole request for a field the one-period lag already makes
  cheap, and the jump is exactly where a decision taken for next period already
  travels.
- **Mirror the queue onto `countryStats`.** Rejected as a second copy with a
  single reader that can read the source. It widens the country-stat schema and
  its strip logic for nothing.

## Risks

- **The projection and the authoritative advance disagree on the line.** The
  same class of risk the pools already carry, with the same mitigation: both
  calls read the committed queue and the same opening roster, and the
  authoritative advance is the final word. A dedicated test runs both with the
  same inputs.
- **Double building by the narrator.** The highest-consequence new failure,
  because it is silent: two formations where the story describes one. Mitigated
  by the digest list and the explicit "no second authority" rule, and watched by
  the architecture guard on the prompt builders.
- **The jump schema outgrows its provider.** Mitigated by a compact field, a
  union enum instead of an `anyOf`, no descriptions longer than one clause, and
  the documented, deliberate move of a guard that is a prompt-size guard rather
  than a provider limit.
- **A polity buys a navy it can never pay upkeep on.** Intended: the next
  period's upkeep shortfall is the consequence, and it is already priced and
  reported by the force-pool increment.
- **The queue grows without bound.** Mitigated by `MAX_PRODUCTION_QUEUE` per
  polity and `MAX_PRODUCTION_ORDERS` per period, both rejected entry by entry,
  never fatal to the turn.

## Decisions taken

Put to the author and answered as follows.

1. **One queue, two kinds of item.** Units and structures share one FIFO line,
   one cost table shape and one completion path.
2. **The model declares, the engine executes.** The model names polity, kind,
   type, count and site; the engine owns the price, the build time and the draw.
3. **The reserves are the currency.** Manpower and materiel only; no new cash
   balance.
4. **Paid in full when the order enters the line, then built over months.** No
   installments, no stall; an unaffordable order is rejected.
5. **One strictly serial line per polity.** FIFO, with a bounded tail.
6. **The state lives in `economyEngine`**, sparse, and rides the existing world
   reads and writes with no new plumbing.
7. **Closed enums and a declared site.** Unit types and building types are
   closed lists; a structure's site is declared by the model, and a completed
   unit is placed automatically at the polity's capital unless the order names a
   site.
8. **The engine returns completion data; the boundary applies it** through
   `resolvePlacements` and `applyEventImpactsToWorld`.
9. **One-period lag**, the same as shocks and posture.
10. **The queue is the authority for what it lists**, with the narrator and game
    master told not to duplicate it.
11. **Visible in the Forces panel and in the digest.**
12. **No cancellation in this increment.** A paid order is built.

## Open questions

None block implementation. The following are deliberately deferred and recorded
so the plan does not silently decide them.

- The exact constants (`PRODUCTION_TABLE`, `MAX_PRODUCTION_QUEUE`,
  `MAX_UNIT_COUNT`) are first-draft calibration and are expected to be tuned
  against a few campaigns. The tests assert ordering, bounds and determinism,
  never a magnitude.
- A jump shorter than one month declares nothing, because the engine's advance
  returns before any month is stepped; this is the force-pool increment's own
  behavior for `pendingMobilization`, mirrored rather than changed here. If it
  is later judged wrong, it is fixed for both declarations at once.
- Whether the player should be able to cancel a waiting order, and whether a
  cancellation refunds in full or in part, is a UI and economy decision for a
  later increment and does not change the engine contract.
- Whether research reuses this line or gets its own layer is decided by the
  research spec, not here.
