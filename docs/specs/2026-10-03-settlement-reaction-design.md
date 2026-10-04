<!-- Open Historia - deterministic reaction to an unjust war at the peace (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# Settlement Reaction: What an Unjust War Costs at the Peace

The fourteenth increment of the deterministic simulation, and the fourth branch
of the mechanical diplomacy layer. The eleventh increment drew a bound party
into a war. The twelfth made a promise breakable and charged the breaker. The
thirteenth judged the moment a war begins and charged a power that began one
with no recorded warrant. All three read the same two stores - a claim and a
breach - and act once. This increment reads the other end of the war the
thirteenth judged: the peace that settles it.

## Why this increment exists

1. **A verdict with no consequence after the fact.** The thirteenth increment
   charges an unjust aggressor once, when the war begins: a reputation loss and
   a relation loss. It records the verdict in `unjustAggressors` and then does
   nothing with it. If that aggressor goes on to win the war, the settlement
   hands it the spoils exactly as if it had held a warrant, so aggression paid
   and the judgement is spent. The record the thirteenth increment wrote is read
   by nothing at the peace.

2. **The facts the reaction needs are already stored.** A war carries its
   declared goals (`goals`), its exhaustion (`weariness`) and, since the
   thirteenth increment, the names of the aggressors that lacked a warrant
   (`unjustAggressors`). The settlement core already derives, from those, who
   wins and on what terms. Legitimacy is a missing input to an existing
   derivation, not a missing system.

3. **A peace is where a war's meaning is decided.** The settlement core decides
   the victor by goal score and writes the terms from the victor's declared
   kind. A war fought without a warrant should not read the same as one fought
   with one: the world should weigh the unjust side's result less and, if that
   side loses, should make it pay more. This is the second half of the reaction
   the twelfth increment's specification named when it deferred "whether the
   wronged party should gain a casus belli or a right to retaliate"; the casus
   branch delivered the warrant, this branch delivers the consequence at peace.

4. **Nothing needs a new declaration surface.** The legitimacy of a side is
   derived from the record the engine already kept; the model declares its war
   goals as it always has, and the engine decides what the world makes of the
   result - exactly as it does for an obligation and for an unjust beginning.

## Scope

This increment is the judgement of one peace: a war with a recorded unjust
aggressor settles, and the settlement reflects the unjust side's diminished
standing.

1. Two constants in the existing pure core `src/engine/warSettlement.js`, and
   two new inputs, `unjustA` and `unjustB`, one per side.
2. Legitimacy degrades the unjust side's goal score before the victor is chosen,
   so the unjust side loses a tie and struggles to out-score a just opponent. A
   clear battlefield dominance is still a victory.
3. A punitive peace when the unjust side loses: a doubled reparations share, and
   an annex that takes every declared target, held or not, rather than only the
   targets already controlled.
4. The runtime adapter `src/runtime/warSettlement.js` derives which side is
   unjust from the war's stored `unjustAggressors` and passes the two flags to
   the core. It imports no `src/Game/AI/` module.
5. The narrated peace event and the turn receipt name a punitive settlement, so
   the model narrates the price rather than reinventing it.

Only the settlement of a war changes. The battlefield arithmetic, the one-time
reputation and relation cost the thirteenth increment already charges, and the
war ledger's transitions are untouched.

## Non-goals

- No battlefield or territorial consequence beyond the declared annex targets. A
  war with an unjust aggressor is fought exactly as any other; the engine
  records what the peace makes of the result, not a penalty on the fighting.
- No reverse transfer, no occupation change and no new peace term. The only
  terms remain a territorial transfer, reparations and a white peace.
- No new war operation, no new transport string and no new declaration. The
  legitimacy is inferred from the stored `unjustAggressors`; nothing is
  declared.
- No change to the casus cost, to the `unjustAggressors` shape, or to when the
  one-time cost is charged. This increment reads the record; it does not
  rewrite it.
- No reputation or relation change at the peace. The thirteenth increment
  already charged the two stores at the declaration; a second charge here would
  double it.
- No effect on `wearinessStep` or `warPressure`. Legitimacy decides who wins a
  peace, not how tired a side becomes or when a peace is compelled.
- No player exception in principle, but a war the player is a party to is
  withheld from settlement exactly as it is today, so the player's own unjust
  wars remain open until the deferred peace-dialogue increment.
- No new dependency, no UI surface, no new digest and no new scheduler.
- No migration and no `ENGINE_VERSION` bump: both flags default to false, so a
  war without the field settles byte for byte as it does today.

## Design

### 1. Layers

The same three layers and the same direction of dependency every increment has
used. This increment adds no file; it extends one core, one adapter and one
boundary.

| Layer | Location | Rule in this increment |
|---|---|---|
| Pure core | `src/engine/warSettlement.js` (extended) | Two constants, two inputs on `settleWar`, the legitimacy-degraded score, the punitive terms and a `punitive` flag on the returned settlement. It keeps importing only `./economyMath.js`, so it stays inside the engine purity allow-list. |
| Adapter | `src/runtime/warSettlement.js` (extended) | Derives the unjust side of each active war from its stored `unjustAggressors`, passes `unjustA`/`unjustB` to the core, and names a punitive settlement in the peace event. It never writes the ledger. |
| Boundary | `src/Game/AI/gameplay.js` (one line) | The existing receipt line that reports a closed war gains a punitive qualifier. No new seam and no new pre-pass: the adapter already runs in the turn with the pre-turn world that holds the field. |

### 2. The reaction rule

A war has two recorded facts the reaction reads: the goals each side declared,
and the names in `unjustAggressors`. A side is **unjust** when any of its
declared members is one of those names, folded into the same canonical key
space as every other comparison. The two flags are derived per side, so a
coalition whose aggressor was unjust carries the mark on the side that began the
war, and a war with no recorded unjust aggressor is unaffected.

When a war settles, legitimacy does two things:

- **It degrades the unjust side's goal score.** The score the victor is chosen
  by is the side's raw goal score multiplied by `UNJUST_LEGITIMACY_FACTOR` (for
  the unjust side) or by `1` (for the just side). So the unjust side loses an
  otherwise even race and must out-fight a just opponent by a clear margin. A
  dominance large enough to survive the factor is still a victory: the war was
  won on the map, and the engine does not pretend otherwise.
- **A `status_quo` side is a baseline, not a discount.** A side that declares
  `status_quo` scores its satisfaction of `1`; when that side is just the score
  is not discounted, so it is a bar an unjust opponent cannot clear, since the
  opponent's discount caps it at `0.75`. A just side that asks for nothing
  therefore cannot be out-scored by an unjust side, however completely that side
  took its declared aim; the unjust side loses that peace, and because a
  `status_quo` victor takes no terms the peace is white even though the unjust
  side's defeat is punitive.
- **It punishes an unjust defeat.** When the loser is the unjust side, the
  victor's ordinary terms are made punitive: the reparations share is
  `UNJUST_REPARATION_SHARE` instead of `REPARATION_SHARE`, and an annex takes
  every declared target, whether or not the victor already controls it, exactly
  as a capitulation would. An unjust side that wins takes its declared kind's
  ordinary terms; only its defeat is punitive.

The two effects are separate on purpose. The degraded score decides *who wins*
a war that was close; the punitive terms decide *what the loser pays* once it
has lost. Either can apply without the other.

**The `achieved` gate is read on the raw score (Option A).** A war closes
because a side plainly attained its declared aim (`achieved`) or because
weariness compelled it. `achieved` is measured on the raw goal score, before the
factor, so a war one side has won is still a war that can close; legitimacy then
decides who wins that peace. Degrading the gate itself would let an unjust side
that plainly took its objective stall a war it had already won, which is not the
reaction this increment is for.

### 3. The core (`src/engine/warSettlement.js`)

Two constants, first-draft calibration; the tests assert the arithmetic, never a
magnitude:

```
UNJUST_LEGITIMACY_FACTOR = 0.75   // the unjust side's goal score is scaled by this
UNJUST_REPARATION_SHARE  = 0.5    // the unjust loser pays this, not REPARATION_SHARE
```

`settleWar(input)` gains two optional inputs, `unjustA = false` and
`unjustB = false`, and derives in this order:

1. `rawScoreA` and `rawScoreB` from `warGoalScore`, exactly as today.
2. `effectiveA = rawScoreA * legitimacy(unjustA)`, and likewise for B, where
   `legitimacy(true)` is `UNJUST_LEGITIMACY_FACTOR` and `legitimacy(false)` is
   `1`. The flags are coerced to booleans, so an absent flag is a just side.
3. The `achieved` gate reads `rawScoreA >= 1` / `rawScoreB >= 1`, unchanged;
   `warPressure` still reads only the weariness pair.
4. The victor is chosen by the **effective** scores in both the
   both-capitulate branch and the general branch, tie broken by the lower
   weariness and then by side A, exactly as `pickVictor` does today.
5. `punitive = unjustLoser`, where the loser is the side that is not the victor.
6. The terms: a `reparations` victor takes `punitive ?
   UNJUST_REPARATION_SHARE : REPARATION_SHARE` of the loser's pools (the
   manpower cap is unchanged); an `annex` victor transfers a declared target
   when `capitulation || punitive || heldVictor.has(regionId)`, so a punitive
   peace takes every declared target and an ordinary war still takes only what
   it holds; `status_quo` is still a white peace.

The returned settlement gains one field:

```
{
  key, victor, loser, capitulation, white, punitive,
  transfers: [{ regionId, fromCode, toCode }],
  reparations: { fromCode, toCode, manpower, materiel },
}
```

`key` and `white` are unchanged: `key` still names the war, date and the two
sides, and `white` is still true when no region moves and no reparations are
paid.

### 4. The adapter (`src/runtime/warSettlement.js`)

In `resolveWarSettlements`, for each active war and before it calls the core,
the adapter derives the two flags from the war's stored field:

- The unjust names are canonicalized and lowercased once, through the same
  `canonical` (`toCountryName`) the adapter already uses for every other name.
- `unjustA` is true when any member of `war.sideA` is one of those names;
  `unjustB` likewise for `war.sideB`. The check is symmetric, so it does not
  assume the unjust names sit on any one side.

The two flags join the existing arguments to `settleWar`. The weariness step,
the player-party withholding and the `unresolved` list are untouched: a war the
player is a party to is skipped as before, so a player's unjust war is not
settled here.

### 5. Telling the model

The peace event the turn already builds is the channel. `buildSettlementEvent`
appends a punitive clause to the event description when the punitive terms
actually apply, which is when `settlement.punitive` is true and the settlement
is not white, so the model reads that the defeated side paid more for having
begun the war unjustly without ever reading a price that was not imposed. The
turn's receipt line for a closed war gains the same qualifier beside the
white-peace/settlement wording, under the same condition. No digest, no new
variable and no prompt change beyond that clause: the settlement already travels
into the next turn's events, and the model narrates the price the engine already
decided.

## Testing

The core's tests run under a bare `node --test` and assert:

- The two constants are the declared values.
- A settlement with both flags absent or false reproduces every field the core
  produced before this increment, and `punitive` is `false` (the regression
  witness), so a war with no recorded unjust aggressor settles on exactly the
  terms it did before.
- Legitimacy flips an even race to the just side: with equal raw scores and
  equal weariness that compels a peace, `unjustA: true` makes side B the victor
  where side A won before, and `unjustB: true` mirrors it.
- Legitimacy does not overturn a clear dominance: an unjust side whose raw score
  is far higher still wins.
- A just side that declares `status_quo` is not out-scored by an unjust side: a
  just side's `status_quo` score of `1` is not discounted, so an unjust side
  cannot beat a just side that asks for nothing, and that defeat is a punitive
  but white peace.
- The `achieved` gate is read on the raw score (Option A): an unjust side that
  plainly attained its declared aim, with no weariness compulsion, still makes a
  peace due, so legitimacy decides that peace rather than stalling a war the side
  has already won on the map. A raw score high enough to survive the factor still
  wins, which the dominance case above asserts.
- A punitive defeat doubles the reparations share and leaves the manpower cap in
  force; an unjust victor's terms are ordinary.
- A punitive annex takes every declared target, including one the victor does
  not hold, while a just victor takes only the targets it holds.
- The returned settlement carries `punitive` true exactly when the unjust side
  lost.

The adapter's tests assert:

- `resolveWarSettlements` marks a war unjust on side A when `unjustAggressors`
  names a side-A member, and on side B when it names a side-B member, through
  the canonical key space.
- A war without `unjustAggressors` settles with `punitive: false`.
- A punitive settlement whose terms apply reaches the narrated peace event and
  its description names it; a punitive but white settlement is not named.

The existing settlement tests, unchanged, remain the witness that a war with no
recorded unjust aggressor settles exactly as before.

## Acceptance

The whole suite passes with zero failures, `node --test "src/engine/*.test.js"`,
`node --test "src/runtime/*.test.js"` and `node --test "src/Game/AI/*.test.js"`
pass, ESLint is clean on the changed files (the pre-existing `src/Game/Map/*`
errors are unrelated), `npm run wiki:check` reports `Wiki is current.` after the
documentation is written, and `npm run build` succeeds. The extended core still
passes the engine purity guard. No `ENGINE_VERSION` bump and no migration are
introduced.

## Open questions

None block implementation. The following are deliberately deferred and recorded
so the plan does not silently decide them.

- The two constants (`UNJUST_LEGITIMACY_FACTOR`, `UNJUST_REPARATION_SHARE`) are
  first-draft calibration, expected to be tuned against a few campaigns. The
  tests assert the ordering and the arithmetic, never a magnitude.
- Whether the punitive annex should take every declared target or be bounded to
  the targets already held is a modelling question; this increment takes every
  declared target, which the existing `MAX_TARGET_REGIONS` cap already bounds.
- Whether a power that joins an unjust war it did not begin should also settle
  on punitive terms is deferred with the thirteenth increment's same question;
  this increment reads the names the war recorded, which are the starters.
- Whether the interactive (non-jump) turn path should surface the punitive flag
  directly is deferred, as the standing obligations and the breach digest
  deferred it; the peace event already carries it.
- The player's own unjust wars are not settled here, because a player-party war
  is withheld from settlement; the player-facing peace dialogue remains the
  deferred increment that would react to them.
