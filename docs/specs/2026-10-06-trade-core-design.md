# Trade is a standing field derived from the diplomatic network

Date: 2026-10-06
Status: approved for implementation

## Problem

Trade does not exist as a system. The only economic echo of diplomacy is the
model's open shock channel: `blockade` and `trade_boom` in `SHOCK_KINDS`
(`src/engine/economyShocks.js`) are a bounded window the model declares, not a
standing consequence of the world. The world already holds three engine-owned
diplomatic ledgers, and none of them touches the economy:

- `world.relations`: one warmth score in `-100..100` per polity pair;
- `world.agreements`: typed pacts, including `trade_economic`, `alliance` and
  the rest of `WORLD_AGREEMENT_TYPE_SET`;
- `world.wars`: active wars carrying `sideA` and `sideB`.

A polity that signs a trade pact, joins a warm network or is dragged into a war
that severs its commerce sees no economic consequence in the engine. Only the
model's own shocks can express one, and those are the model's decisions, which
the constitution deliberately keeps the engine out of. Interdependence is an
economic fact, and an economic fact belongs to the economy core.

## Goals

- A pure core, `src/engine/tradeCore.js`, turns the three diplomatic ledgers
  into a per-polity multiplier vector in the exact shape the shock channel
  already uses, so the economy composes it with no new channel and no new
  storage.
- The economy clock applies the field every month: a polity embedded in a warm
  network grows a little faster and is a little steadier, a polity cut off by
  war is dragged.
- Deterministic and inert: no diplomatic data, or a network that nets to
  neutrality, leaves the economy byte-for-byte as it is today.
- Derived, never persisted: no world state, no schema, no migration.
- The model is told WHO the field favoured and who it cut off, in one receipt
  clause, never by how much.

## Non-goals

- **Computer-opponent decision-making.** The constitution defers it
  (`docs/superpowers/specs/2026-10-01-deterministic-core-economy-design.md`).
  This field is an outcome of diplomacy already on the record, not a chooser and
  not a new role for the model.
- **A new data source or any write to the ledgers.** `relations`, `agreements`
  and `wars` are read only.
- **Replacing or rebalancing the model's shock channel.** A shock stays the
  model's window; the field is standing and state-derived. The two compose.
- **Level changes to GDP.** The field scales the growth rate and drifts
  stability, exactly as a shock does; it never sets a level.
- **Persisting the field.** It is a function of the world and is recomputed on
  every advance.
- **A player-facing trade panel.** No browser is available here to verify one.

## Design

### 1. Layers

| Layer | Location | Rule in this increment |
|---|---|---|
| Pure core | `src/engine/tradeCore.js` (+ `.test.js`) | `tradeMultipliers({ relations, agreements, wars })` returns the per-polity vector. No forbidden import. |
| Economy core | `src/engine/economyTick.js`, `src/engine/economyShocks.js` | `advanceEconomy` composes the shock vector with the field vector through a new pure `composeMultipliers`. |
| Adapter | `src/runtime/economyEngine.js` | Builds the field from the world, hands it to the clock, and forwards the field plus a `describeTradeClimate` clause. |
| Boundary | `src/Game/AI/gameplay.js` | Appends one receipt note naming who benefited and who was cut off. |
| Guards | `src/engine/tradeCore.test.js`, `src/runtime/economyWiringArchitecture.test.js` | The inertness proof and the source pin on the wiring. |
| Docs | `docs/runtime-services.md`, this file | The seventh deterministic system. |

No new module outside `src/engine/`, no new shock kind, no prompt block, no
schema, no migration.

### 2. The edge

For a polity pair `(p, q)` the edge is a single number in `[-1, 1]`:

- If `p` and `q` sit on opposite sides of an **active** war, the edge is `-1`.
  A war overrides every other signal: commerce between belligerents is severed.
- Otherwise the edge is
  `clamp(score / 100 + sum(bonus(type)), -1, 1)`, where `score` is the pair's
  relation score (default `0` when no relation is recorded, so an unrecorded
  pair is neutral) and `bonus(type)` adds a bounded lift per active agreement
  the two parties share.

The agreement bonuses are a closed table:

| `type` | bonus |
|---|---|
| `trade_economic` | 0.35 |
| `alliance` | 0.25 |
| `military_cooperation` | 0.15 |
| `friendship_consultation` | 0.10 |
| `non_aggression` | 0.05 |
| any other | 0 |

Only an agreement whose `status` is `active` counts, and only among its
`parties` (an unordered pair within the party list). A pact between two other
polities never touches a third.

### 3. The index and the vector

The partners of `p` are every distinct name that shares a relation, an active
agreement or an active war with `p`. The index is the mean of the edges to
those partners:

```
T(p) = clamp(mean_q w(p, q), -1, 1)
```

A polity with no partners has `T(p) = 0`: autarky is neutral, not a penalty.
The mean is order-independent by construction; the edge list is summed in a
stable name order so float addition cannot reorder the total.

The vector has the same shape the shock channel produces:

| field | value |
|---|---|
| `population` | `1` |
| `gdp` | `1 + TRADE_GDP_MAX * T(p)`, `TRADE_GDP_MAX = 0.15` |
| `inflation` | `0` |
| `unemployment` | `0` |
| `stability` | `TRADE_STABILITY_MAX * T(p)`, `TRADE_STABILITY_MAX = 0.25` |

`tradeMultipliers` emits an entry only when `T(p) !== 0`. A neutral polity is
absent, which is what makes the empty case inert.

### 4. Composition on the clock

`composeMultipliers(a, b)` is pure and multiplies the two multiplicative fields
and adds the additive ones, so a shock and the field offset rather than cancel:

```
{ population: a.population * b.population,
  gdp:        a.gdp * b.gdp,
  inflation:  a.inflation + b.inflation,
  unemployment: a.unemployment + b.unemployment,
  stability:  a.stability + b.stability }
```

In `advanceEconomy`'s month loop, for each polity, the shock vector
(`activeMultipliers(own, month)`) is composed with `trade[name]` before
`applyMobilization`, so posture, shortfall pressure and mobilization still see a
single combined vector, exactly as before.

### 5. Inert when there is no network

This is the safety property. With no `relations`, no active `agreements` and no
active `wars`, every polity has no partners, so `T(p) = 0`, the table is empty,
`trade[name]` is `undefined`, and the month step reads the shock vector
unchanged. The economy is byte-for-byte what it is today. A network whose edges
all net to zero is equally inert by the same clause (`T(p) !== 0` gate).

### 6. The clause

`describeTradeClimate(trade)` lives in the adapter (`src/runtime/economyEngine.js`),
is pure and returns `""` when the table is empty. Otherwise it is a lower-case
clause without a trailing period that names up to two beneficiaries
(`T >= TRADE_NOTE_THRESHOLD`, the strongest first) and up to two polities cut
off (`T <= -TRADE_NOTE_THRESHOLD`), for example:

```
open commerce favoured France and Spain; the war cut Prussia off
```

The turn appends it to the receipt once, in a single note, the same channel the
battle tactics clause uses. The clause names who, never the share: the engine
keeps its numbers.

## Tests

Core (`src/engine/tradeCore.test.js`):

1. **A war severs**: two polities on opposite sides of an active war get a
   negative index even when their relation is warm.
2. **An agreement lifts**: a `trade_economic` pact raises the index above the
   bare relation score.
3. **Neutral is absent**: a relation scored `0` and no pact yields no entry.
4. **Mean, not sum**: partners at `+0.5` and `-1.0` give `-0.25`, not `-0.5`.
5. **No data is empty**: `tradeMultipliers({})` is `{}`.
6. **Determinism**: the table is identical across two calls and independent of
   the order of the input arrays.

Economy (`src/engine/economyTick.test.js`):

7. **The field bites**: `advanceEconomy` with a non-empty `trade` table changes
   `gdpGrowth`/`stability` against the same advance without it.
8. **Absent field is inert**: the same advance with no `trade` is byte-for-byte
   the pre-change result.

Adapter (`src/runtime/economyEngine.test.js`):

9. **Built from the world**: a world carrying relations and wars yields the
   matching field and a clause naming who.
10. **An empty world says nothing**: `describeTradeClimate({})` is `""`.

Wiring (`src/runtime/economyWiringArchitecture.test.js`):

11. A source guard that the turn calls `describeTradeClimate` and that the
    adapter calls `tradeMultipliers`.

Regression:

- `npm test`, `npx eslint`, `npm run build` and `npm run wiki:check` stay green.
- `src/engine/enginePurity.test.js` stays green: `tradeCore.js` imports only
  engine files.

## Considered options

- **Sum aggregation (network degree).** Rejected: it rewards breadth without
  bound, makes isolation a different baseline from neutrality, and needs a
  scaling constant and a clamp whose values are arbitrary. The mean is bounded,
  isolation-neutral and simplest to prove inert.
- **A standing shock injected into `pendingShocks`.** Rejected: the shock
  channel is the model's declared window and is persisted; the field is
  standing, derived and must not survive as state.
- **Persisting the field on `world.economyEngine`.** Rejected: derived data that
  can drift from its inputs, and it would need a migration.
- **A digest line instead of a receipt note.** Rejected: the digest is per-polity
  numbers for the prompt; naming who benefited is a narrative observation and
  belongs on the receipt, matching the tactics precedent.

## Risks

- **Name resolution.** The ledgers carry canonical polity names and the economy
  keys by the `countryStats` name. A ledger name with no economy entry simply
  gets no vector; a real mismatch would under-count, not corrupt. The guard is
  that the core keys by whatever names the ledgers actually carry.
- **Changing real saves that carry diplomacy.** Intended: this is the feature.
  The equivalence the constitution requires is the empty-network case, which is
  exactly inert.
- **Magnitude.** Every term is clamped and `T` is a mean of values in `[-1, 1]`,
  so the vector is bounded by the constants above; the digest and the deltas
  report the resulting growth honestly.
