# Anti-type tactics in the engagement core

Date: 2026-10-06
Status: approved for implementation

## Problem

The engagement core (`src/engine/combat.js`) gives a formation its weight and,
since the domain increment, an air and a naval edge. Two formations of different
land types still fight exactly alike: an artillery battery firing on armour is
worth the same as an infantry column firing on the same armour, and the same
battery does nothing special to an aircraft or a fleet.

The domain increment recorded this as an explicit non-goal: "Type-versus-type
lethality (anti-air, anti-ship). One domain edge per kind, not a matrix."
(`docs/specs/2026-10-05-naval-air-domain-tactics-design.md:41`). This is that
deferred increment. Nothing about type matchups is modelled today, so a
combined-arms battle produces the same arithmetic as a battle between two
single-type columns.

## Goals

- A pure function gives a formation a tactical effect against the types it
  counters, without the model declaring any number.
- One named table of matchups within the six declared unit types: the artillery
  arm is the counter arm, plus a land rock-paper-scissors triangle.
- The effect is a bounded multiplicative adjustment to a side's raw power,
  applied before the jitter, exactly the way naval support already works.
- Every existing engagement result is byte-identical when no counter matchup
  connects the two sides. The change is inert for a battle with no such matchup.
- The core stays import-free, clock-free and entropy-free; no new module, no
  adapter change, no runtime change, no schema change, no migration.

## Non-goals

- **Terrain, coasts and sea zones.** The engine has no map: the runtime region
  catalog carries no water flag, so this remains a separate data-model decision.
  The rules are keyed on the unit's declared `type` only, and a terrain increment
  is left open.
- **A full 6x6 type-versus-type matrix.** A named table of matchups is auditable;
  thirty-six calibrated cells are not. Six types squared is out of scope.
- **New unit types (dedicated anti-air or anti-ship units).** The counters are
  expressed within the existing `UNIT_TYPES`; adding types would need a roster
  and migration change.
- **Reach, range or movement.** A matchup changes a unit's effect on a battle it
  is already in; it does not change where the unit can go.
- **A model-facing readout.** No new payload field and no prompt change. The
  rules are automatic from the roster the adapter already builds.
- **Rebalancing the existing weights, domains or loss band.**
  `UNIT_COMBAT_WEIGHT`, `UNIT_DOMAIN`, `AIR_EDGE_MAX` and `NAVAL_SUPPORT_MAX`
  are untouched.

## Design

### 1. Layers

One layer changes, and only its internals.

| Layer | Location | Rule in this increment |
|---|---|---|
| Pure core | `src/engine/combat.js` | The matchup table, the counter score and the anti-type power factor. Still imports nothing, reads no clock and no entropy. |
| Adapter | `src/runtime/combatEngagements.js` | **Unchanged.** It reads only `casualties`, `controlChange`, `winner` and the per-side power/loss fields, all of which keep their meaning. |
| Boundary | `src/Game/AI/` | **Unchanged.** No event field, no schema and no prompt is touched. |

`combat.js` must stay import-free: `combatWiringArchitecture.test.js` asserts it.
The rule therefore lives in the file, beside the tables it reads.

### 2. The matchup table

One frozen table names, per counter type, the types it counters. It is the
artillery arm plus a land triangle:

| Counter type | Counters |
|---|---|
| artillery | armor, air, naval |
| armor | infantry |
| infantry | artillery |

```
export const ANTI_COUNTERS = Object.freeze({
  artillery: Object.freeze(["armor", "air", "naval"]),
  armor: Object.freeze(["infantry"]),
  infantry: Object.freeze(["artillery"]),
});
```

Artillery is the counter arm: it beats armour with direct fire, reaches air with
anti-aircraft fire and reaches ships with coastal fire. Armour beats infantry in
the open; infantry beats artillery in close terrain. The triangle gives the
three land types a reason to be mixed; the artillery list extends the same idea
to the other two domains without touching the domain rules.

### 3. Counter power

Each side's power is grouped by type, each unit's combat power multiplied by its
owning entry's mobilization multiplier, exactly the way `scoreSide` already sums
total power. A helper groups a side's power by unit type:

```
const powerByType = (side) => {
  const byType = {};
  for (const entry of side) {
    const multiplier = mobilizationCombatMultiplier(entry?.posture);
    for (const unit of entry?.units ?? []) {
      const type = name(unit?.type) || "infantry";
      byType[type] = (byType[type] ?? 0) + unitCombatPower(unit) * multiplier;
    }
  }
  return byType;
};
```

The counter score of one side against the other is the sum, over every matchup
in the table, of the counter type's power times the countered type's power. It
is a scalar, and it is zero when no matchup connects the two sides:

```
const counterScore = (attackerByType, targetByType) => {
  let score = 0;
  for (const [counter, targets] of Object.entries(ANTI_COUNTERS)) {
    const power = attackerByType[counter] ?? 0;
    if (!power) continue;
    for (const target of targets) score += power * (targetByType[target] ?? 0);
  }
  return score;
};
```

The score is a product of powers, so a matchup only bites when both sides
actually field the relevant types. One infantry on each side against an
artillery battery scores a small amount; the same battery against an armoured
column scores more, because the armour it counters is worth more.

### 4. The anti-type edge and factor

The two scores are turned into one signed share with the same helper the domain
edges use, and the factor mirrors `navalFactor`:

```
export const ANTI_SUPPORT_MAX = 0.2;

const antiEdge = domainEdge(antiA, antiB);
const antiFactor = (sideEdge) => 1 + ANTI_SUPPORT_MAX * sideEdge;
```

The edge is `+1` when one side's counter score is the only one, `0` when the two
scores are equal or when no matchup connects the sides, and negative for the
other side. The factor then scales the side's raw power.

### 5. Ordering inside resolveEngagement

The steps that already exist keep their order; the anti-type factor joins the
naval factor on the raw power, before the jitter:

1. `scoreSide` for each side (raw power, mobilization included) - unchanged.
2. Multiply each raw power by its naval factor - unchanged.
3. **New:** multiply each raw power by its anti-type factor.
4. Jitter from the fixed hash - unchanged, now on the naval- and anti-adjusted
   power.
5. Shares, `combatLossFraction` - unchanged.
6. Adjust each loss fraction by the air edge - unchanged.
7. `applyLosses`, winner, and then control - unchanged.

```
const powerA = scoreSide(sideA) * navalFactor(navalEdge) * antiFactor(antiEdge);
const powerB = scoreSide(sideB) * navalFactor(-navalEdge) * antiFactor(-antiEdge);
```

The anti-type factor is a raw-power quantity, beside naval support. The air edge
remains a separate loss-fraction quantity, so an artillery battery that counters
air does not change `airEdge`; it changes raw power only.

### 6. Result shape

The result keeps every field it has. One observation is added per side and one at
the top level, mirroring the domain fields, so a test and a future digest can
read the anti-type state without recomputing it:

```
sideA: {
  power, adjustedPower, lossFraction, units,   // unchanged
  airPower, navalPower,                        // unchanged
  antiPower,                                   // new: this side's counter score
}
```

and one top-level `antiEdge`, in `[-1, 1]`, beside `airEdge` and `navalEdge`.
Additive fields, so `combatEngagements.js` and its consumers are unaffected.

### 7. Inert when no matchup connects

This is the safety property the change is built around. When no matchup in the
table connects the two sides (`counterScore` is zero for both), `antiA = antiB =
0`, so `domainEdge(0, 0) = 0`, the anti-type factor is exactly `1`, and every
code path returns today's value. This covers, among others:

- infantry versus infantry, armor versus armor, and a mixed land force against a
  mixed land force that shares no counter-target pair;
- garrison against anything (garrison is neither a counter nor a target), air
  against air, naval against naval.

A matchup is absent only when neither side fields a counter whose target the
other side also fields. Infantry versus armor is therefore NOT inert: armour on
one side counters the infantry on the other. The arithmetic is unchanged rather
than merely close when the matchup is truly absent, so the existing combat cases
that field no counter-target pair are a regression test for the inert case.

## Tests

New, beside the core in `src/engine/combat.test.js`, seven cases:

1. **Table is well formed**: every counter and every target names a declared unit
   type, and every list is non-empty.
2. **Land triangle**: artillery against armor, armor against infantry, infantry
   against artillery each give the counter holder a positive `antiEdge`.
3. **Artillery counters the other domains**: artillery against air and against
   naval each give the artillery holder a positive `antiEdge`.
4. **Power edge is bounded**: with a matchup, the counter holder's raw `power` is
   larger than the baseline and within `[1 - ANTI_SUPPORT_MAX, 1 + ANTI_SUPPORT_MAX]`
   of its plain score.
5. **Inert land battle**: infantry against infantry produce `antiEdge = 0` and
   the same loss fractions and adjusted powers as a baseline with no counter.
6. **Air edge is untouched**: an artillery-versus-air battle raises raw power but
   leaves `airEdge` at its no-artillery value.
7. **Determinism**: every new case is deep-equal across two calls.

Regression:

- `npm test` stays green.
- `src/engine/enginePurity.test.js` and
  `src/runtime/combatWiringArchitecture.test.js` stay green: `combat.js` still
  imports nothing.
- `npx eslint` gains no new error.

## Docs

- `docs/runtime-services.md`: the combat section gains the anti-type rules.
- `docs/specs/2026-10-05-naval-air-domain-tactics-design.md`: its non-goal line
  is superseded by a pointer to this design.

## Considered options

- **A full 6x6 matrix.** Rejected as scope and calibration risk: a named table of
  matchups is auditable; thirty-six calibrated cells are a table nobody can
  defend in review. The same reason the domain increment rejected it.
- **New dedicated anti-air and anti-ship types.** Rejected: it needs a roster
  change and a migration, and the matchup table already expresses the intent
  within the types the game fields today.
- **An anti-type loss edge instead of a power edge.** Rejected: two loss edges
  would stack inside the same band and would be hard to attribute. A raw-power
  factor mirrors the naval support the code already has, so the increment adds
  one concept, not two.
- **Letting the model declare the counter advantage.** Rejected: this is exactly
  the class of number the deterministic core exists to own.

## Risks

- **A non-matching battle drifting by a float.** The anti-type factor is exactly
  `1` when no matchup connects the sides, so the arithmetic is unchanged rather
  than merely close. The inert test pins it.
- **Over-strong counter effect.** The factor is bounded to
  `[1 - ANTI_SUPPORT_MAX, 1 + ANTI_SUPPORT_MAX]`, smaller than the naval bound,
  and it multiplies raw power only; a single matchup cannot flip a battle the
  underlying power did not already favour.
- **A mismatch between the table and `UNIT_TYPES`.** A type typo would silently
  disable a matchup. The well-formedness test reads the declared types.
