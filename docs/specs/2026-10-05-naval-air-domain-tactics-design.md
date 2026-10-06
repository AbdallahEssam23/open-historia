# Naval and air domain tactics in the engagement core

Date: 2026-10-05
Status: approved for implementation

## Problem

The deterministic engagement core (`src/engine/combat.js`) resolves a battle
from one weight per unit type, one mobilization multiplier and a fixed-hash
jitter. Air and naval formations carry a heavier weight than land formations and
then fight exactly like them: a naval squadron defends a landlocked province as
well as an infantry division, and a fleet can be annihilated by an army that has
no means to reach it.

The combat increment recorded this deliberately as a non-goal: "Special rules
for naval and air formations beyond their weight. They fight like any other
unit." (`docs/specs/2026-10-02-combat-engagements-design.md:69`). This is that
deferred increment. Nothing about the domain is modelled today, so a battle
between combined-arms forces produces the same arithmetic as a battle between
two columns of infantry.

## Goals

- A pure function gives air and naval formations a tactical effect that a land
  force does not have, without the model declaring any number.
- Three rules, each with one clear purpose: air superiority shifts the losses,
  uncontested naval support shifts the power, and a formation can only be
  destroyed by a force that can reach its domain.
- A purely naval or air force cannot take a province: control still means boots
  on the ground.
- Every existing engagement result is byte-identical when neither side fields an
  air or naval unit. The change is inert for a land-only battle.
- The core stays import-free, clock-free and entropy-free; no new module, no
  adapter change, no schema change, no migration.

## Non-goals

- **Terrain, coasts and sea zones.** The engine has no map: the runtime region
  catalog carries no water flag today, and plumbing one is a separate data-model
  decision. The rules are keyed on the unit's declared `type` only.
- **Type-versus-type lethality (anti-air, anti-ship).** Deferred to
  `docs/specs/2026-10-06-anti-type-tactics-design.md`, which adds a named table
  of matchups within the declared types.
- **Reach, range or movement.** A domain changes a unit's effect on a battle it
  is already in; it does not change where the unit can go.
- **A model-facing readout.** No new payload field and no prompt change. The
  rules are automatic from the roster the adapter already builds.
- **Rebalancing the existing weights.** `UNIT_COMBAT_WEIGHT` is untouched.

## Design

### 1. Layers

One layer changes, and only its internals.

| Layer | Location | Rule in this increment |
|---|---|---|
| Pure core | `src/engine/combat.js` | The domain table, the air edge, the naval factor and the destruction predicate. Still imports nothing, reads no clock and no entropy. |
| Adapter | `src/runtime/combatEngagements.js` | **Unchanged.** It already reads only `casualties`, `controlChange`, `winner` and the per-side power/loss fields, all of which keep their meaning. |
| Boundary | `src/Game/AI/` | **Unchanged.** No event field, no schema and no prompt is touched. |

`combat.js` must stay import-free: `combatWiringArchitecture.test.js` asserts it.
The three rules therefore live in the file, beside the tables they read.

### 2. The domain table

The six declared unit types map onto three domains, in one frozen table:

| Type | Domain |
|---|---|
| garrison, infantry, artillery, armor | `land` |
| air | `air` |
| naval | `naval` |

```
export const UNIT_DOMAIN = Object.freeze({
  garrison: "land", infantry: "land", artillery: "land", armor: "land",
  air: "air", naval: "naval",
});
export const unitDomain = (unit) => UNIT_DOMAIN[name(unit?.type)] ?? "land";
```

An unknown type is land, matching the weight table's fallback to infantry. A
`psionics` unit therefore fights and is destroyed exactly as it does today.

### 3. Domain power

Each side's air power and naval power is the sum of its units' combat power,
each multiplied by its owning entry's mobilization multiplier, exactly the way
`scoreSide` already sums total power. One helper computes the share of power a
side holds in a domain:

```
const domainPower = (side, domain) => {
  let power = 0;
  for (const entry of side) {
    const multiplier = mobilizationCombatMultiplier(entry?.posture);
    for (const unit of entry?.units ?? []) {
      if (unitDomain(unit) === domain) power += unitCombatPower(unit) * multiplier;
    }
  }
  return power;
};

// A signed edge in [-1, 1]: +1 when A holds all of the domain, 0 when the two
// sides are equal or neither fields the domain, -1 when B holds all of it.
const domainEdge = (powerA, powerB) => {
  const total = powerA + powerB;
  return total > 0 ? (powerA - powerB) / total : 0;
};
```

### 4. Air superiority

The side that holds the larger share of the air power takes fewer losses; the
other takes more. The effect is a bounded multiplicative adjustment to each
side's loss fraction, applied after `combatLossFraction` and clamped to the same
`[COMBAT_LOSS_MIN, COMBAT_LOSS_MAX]` band:

```
export const AIR_EDGE_MAX = 0.35;

// sideEdge is +airEdge for A, -airEdge for B.
const adjustLoss = (loss, sideEdge) =>
  clamp(loss * (1 - AIR_EDGE_MAX * sideEdge), COMBAT_LOSS_MIN, COMBAT_LOSS_MAX);
```

With no air units on either side the edge is 0 and every loss fraction is
unchanged. The adjustment can only move a fraction inside the band it already
had, so it can neither create nor remove a destroyable loss on its own.

### 5. Naval support

A side that holds the larger share of naval power multiplies its raw power by a
bounded factor before the jitter. This is shore support and sea control: it
raises the side's effective strength in the battle, and with it every share,
loss and control decision that follows:

```
export const NAVAL_SUPPORT_MAX = 0.25;

const navalFactor = (sideEdge) => 1 + NAVAL_SUPPORT_MAX * sideEdge;
```

A side's raw power is multiplied by `navalFactor(+navalEdge)` and the other by
`navalFactor(-navalEdge)`. With no naval units the factor is 1 and the raw
power is unchanged.

### 6. Domain-aware destruction

A winning force can only destroy a formation it can reach:

| Losing unit's domain | Destroyed when the winner has |
|---|---|
| land | any power (today's rule) |
| air | air power greater than zero |
| naval | air power or naval power greater than zero |

A unit that cannot be reached is **not destroyed**; it still takes its strength
loss and stays on the map. The predicate is evaluated on the WINNER's domain
power, so it is the winner's composition that decides what it can finish off:

```
const canReach = (unit, airPower, navalPower) => {
  const domain = unitDomain(unit);
  if (domain === "air") return airPower > 0;
  if (domain === "naval") return airPower > 0 || navalPower > 0;
  return true;
};
```

`applyLosses` takes the winner's air and naval power and consults the predicate
only on the side that lost. A winning side is never destroyed, so the predicate
does not touch its own units.

### 7. Control requires land

A province changes hands only when the winning side has at least one land-domain
formation on the field. A pure fleet or air wing can win the battle and take
losses, but cannot occupy:

```
const sideHasLand = (side) =>
  side.some((entry) => (entry?.units ?? []).some((unit) => unitDomain(unit) === "land"));
```

The existing control rule is unchanged in every other respect: the attacker must
win, the defender's share must fall below `CONTROL_THRESHOLD`, and the new
controller is still the winner's first polity with units.

### 8. Ordering inside resolveEngagement

The steps that already exist keep their order; the domain rules slot in at three
points:

1. `scoreSide` for each side (raw power, mobilization included) - unchanged.
2. **New:** multiply each raw power by its naval factor.
3. Jitter from the fixed hash - unchanged, now on the naval-adjusted power.
4. Shares, `combatLossFraction` - unchanged.
5. **New:** adjust each loss fraction by the air edge.
6. `applyLosses` - unchanged, now with the destruction predicate.
7. Winner, and then control - unchanged, now gated on `sideHasLand`.

### 9. Result shape

The result keeps every field it has. Two observations are added, per side, so a
test and a future digest can read the domain state without recomputing it:

```
sideA: {
  power, adjustedPower, lossFraction, units,   // unchanged
  airPower, navalPower,                        // new
}
```

and one top-level pair, `airEdge` and `navalEdge`, in `[-1, 1]`. Additive
fields, so `combatEngagements.js` and its consumers are unaffected.

### 10. Inert when land only

This is the safety property the change is built around. When neither side fields
an air or naval unit:

- `domainEdge(0, 0) = 0`, so the naval factor is 1 and the air adjustment is 1.
- Every unit's domain is `land`, so `canReach` is true for every unit.
- If a winning side exists it has land units only, so `sideHasLand` is true.

Every code path returns exactly today's value, so the whole existing combat
suite is a regression test for the inert case.

## Tests

New, beside the core in `src/engine/combat.test.js`:

- **Domain table**: every declared unit type maps to a domain; an unknown type
  is land.
- **Inert land battle**: two land-only armies produce a deep-equal result to a
  frozen expected outcome (or to the same call with domains stripped), pinning
  that the change is invisible without air or naval units.
- **Air superiority**: equal armies, one with an air wing, leave the air holder
  with a smaller loss fraction and the other with a larger one, both inside the
  band; the edge is positive and bounded by 1.
- **Naval support**: equal armies, one with a fleet, give the fleet holder the
  larger adjusted power.
- **Domain destruction**: a land-only winner cannot destroy an air or naval
  unit (it survives with reduced strength); an air-capable winner can destroy an
  air unit; a naval-capable winner can destroy a naval unit.
- **Control requires land**: an air-only winning force produces no
  `controlChange`; a land winning force still does.
- **Determinism**: every new case is deep-equal across two calls.

Regression:

- `npm test` stays green.
- `src/engine/enginePurity.test.js` and
  `src/runtime/combatWiringArchitecture.test.js` stay green: `combat.js` still
  imports nothing.
- `npx eslint` gains no new error.

## Docs

- `docs/runtime-services.md`: the combat section gains the domain rules.
- `docs/specs/2026-10-02-combat-engagements-design.md`: its non-goal line is
  superseded by a pointer to this design.

## Considered options

- **Terrain-keyed rules (a fleet cannot enter an inland province).** Rejected as
  this increment: the runtime region catalog carries no water flag, so it needs
  a data-model change to the map pipeline before the rule can even be expressed.
  The type-keyed rules deliver the tactical distinction now and do not preclude
  a terrain increment later.
- **A full type-versus-type matrix.** Rejected as scope and calibration risk: one
  edge per domain is auditable; six types squared is a table nobody can defend
  in review.
- **A separate `src/engine/domainTactics.js`.** Rejected because `combat.js` is
  pinned import-free, so a sibling module could not be imported by the core
  anyway; the rules are small enough to live where they are used.
- **Letting the model declare the air or naval edge.** Rejected: this is exactly
  the class of number the deterministic core exists to own.

## Risks

- **A land-only battle drifting by a float.** The air adjustment multiplies by
  exactly 1 and the naval factor is exactly 1 when both domains are absent, so
  the arithmetic is unchanged rather than merely close. The inert test pins it.
- **Over-strong air or naval effect.** Both edges are bounded (0.35 on losses,
  0.25 on power) and the loss band is the existing one, so a single domain
  advantage cannot flip a battle that the underlying power did not already
  favour by a wide margin.
- **A naval force taking land.** Closed by `sideHasLand`; a pure fleet or air
  wing cannot take a province.
