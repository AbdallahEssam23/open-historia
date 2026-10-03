<!-- Open Historia - deterministic treaty obligations (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# Giving Agreements Teeth: Automatic Treaty Obligations

The eleventh increment of the deterministic simulation, and the first that gives
the diplomatic ledgers a mechanical effect. Parts seven to ten taught the engine
the operational and informational layers of a war - fronts, supply and its
attrition, reinforcement and rotation, and the digest that shows the player its
own loop. The diplomatic ledgers stayed narrative the whole time: a relation, an
alliance and a guarantee are recorded, narrated and remembered, but nothing in
the engine reads them when a war begins. A treaty is a promise with no
consequence. This increment makes one class of promise real: an active treaty
pulls its parties into a war the engine already tracks.

## Why this increment exists

1. **The ledgers are recorded, then ignored.** `world.relations`,
   `world.agreements` and `world.wars` are engine-owned state
   (`nativeDiplomaticDirector.js`, `nativeWarLedger.js`), normalized and capped
   in `gameState.js`. The model writes them through `relationUpdates`,
   `agreementUpdates` and `warUpdates`, and the engine keeps them. But the only
   reader that turns any of it into a consequence is `warSettlement.js`, and it
   reads the fighting, not the promises.

2. **An alliance does not exist until it is tested.** The whole point of an
   alliance, a mutual defense pact or a guarantee is the moment a partner is
   attacked. Today that moment passes silently: the protected party fights
   alone, the guarantor watches, and nothing in the world records that the
   promise was honored or broken. The feature the player expects - the alliance
   system that drags Europe into war - is absent.

3. **The engine already owns the one thing needed.** A war is an engine record
   with two sides (`sideA`, `sideB`), and joining a side is an existing
   transition (`applyWarUpdates`, ops `join-a` / `join-b`). This increment adds
   no new way to fight; it decides, deterministically, which recorded promise
   calls for the existing transition to fire.

4. **Silence has a cost the model pays.** When the engine joins an ally, the
   next turn's model sees a war whose sides changed with no explanation and must
   either guess why or contradict it. The increment must therefore both enforce
   the promise and tell the model it was enforced, the same way the operations
   digest tells the player about its supply state.

## Scope

This increment is the first branch of the mechanical diplomacy layer, and only
that branch: treaty obligations on a war. It is enforcement plus explanation.

1. A new pure engine module, `src/engine/treatyObligations.js`, that reads
   active wars and active agreements as plain data and returns the joins a
   treaty calls for, the standing obligations the world already realizes, and
   the rejections the caps force. It imports nothing and reads no world.
2. One new stored field on the war record, `aggressor` (`"a"` or `"b"`), so the
   engine can tell a war of aggression from a war of defense. Without it a
   mutual defense pact cannot know whether the protected party was attacked or
   was the attacker.
3. A new runtime adapter, `src/runtime/treatyObligations.js`, that reads the
   stored world, canonicalizes every name, calls the engine, and applies the
   joins to `world.wars`. It imports no `src/Game/AI/` module.
4. A wiring change in `src/Game/AI/gameplay.js` that runs the adapter once per
   turn, immediately after the turn's own `warUpdates` land, so the joins are in
   the world for the rest of the turn.
5. A capped digest built from the same derivation and handed to the war ledger
   directive, so the model narrates the ally's entry instead of inventing it.

Only `alliance`, `mutual_defense` and `guarantee` create an obligation. Every
other agreement type is a promise with no mechanical clause and is untouched.

## Non-goals

- No change to the stored shape of an agreement, a relation or a war beyond the
  single `aggressor` field. No `terms` are parsed; type and parties are the whole
  input.
- No diplomacy for the player. The engine never adds the player's own polity, so
  a withheld player join is never a chain node and propagates nothing; the model
  decides the player's entry. But a war the player is in is not skipped: an
  ally's obligation to enter the player's war, or an enemy's ally to enter
  against the player, still fires, because that is another power's decision, not
  the player's.
- No breaking of treaties. This branch honors promises; a breach would need a
  reason, a reputation cost and a declaration surface, and is a later branch.
- No new declaration field or schema change. The model still declares wars with
  `warUpdates`; the engine derives the aggressor from `start`.
- No new diplomatic pulse or scheduler. Non-player diplomacy still advances on
  the player's turn; this increment reads the ledgers at that point.
- No reputation or relation change in this branch. The mechanical-diplomacy
  layer has a reputation branch of its own; an obligation honored here changes
  no score.
- No new dependency, no UI surface, and no per-polity diplomatic AI.

## Design

### 1. Layers

The split is the established one. `src/engine/treatyObligations.js` is pure: it
receives `{ wars, agreements }` as already-canonicalized plain data and returns
plain data, so it can be tested with no world and passes the engine purity
guard. `src/runtime/treatyObligations.js` is the adapter: it reads the stored
world, resolves every name into one canonical key space through
`createOwnerResolver`, calls the engine, and writes the joins back as a new
normalized world. `src/Game/AI/gameplay.js` owns the turn wiring. The digest is
built in the runtime adapter from the engine's standing rows.

This mirrors `warSettlement.js` / `src/engine/warSettlement.js`: the adapter
reads the world, the core decides, and `gameplay.js` applies. It deliberately
does not put the rule in `nativeWarLedger.js`, because a name-canonicalizing
reader of `agreements` does not belong in the war ledger, and it does not add a
general "diplomatic pulse", because one clause with one reader is not a system.

### 2. The engagement model: the `aggressor` field

A war already records both sides but not which of them began it. The engine
needs that one bit to separate an offensive alliance from a defensive pact, so
the war record gains `aggressor`, an enum of `"a"` and `"b"`.

- `normalizeWorldWar` (`src/runtime/gameState.js`, the war whitelist) reads
  `entry.aggressor === "b" ? "b" : "a"`, so every war already stored defaults to
  `"a"` with no migration.
- `normalizeWar` (`src/Game/AI/nativeWarLedger.js`) preserves it the same way,
  so a field the world carries is not dropped on the next write.
- The `start` op in `applyWarUpdates` sets `aggressor: "a"`. The prompt already
  defines the `start` actors as the side that starts the war, named side A, and
  the opponents as side B, so side A is the declarer, and the default and the
  declaration agree.
- Every other op (`join-a`, `join-b`, `leave`, `ceasefire`, `resume`, `end`,
  `goals`) preserves the field by spreading the prior record.

Because the model never writes `aggressor`, the schema does not change. The
prompt states the convention explicitly - the `start` actors are the side that
begins the war, recorded as side A - so a model that lists the attacked side
first cannot invert the defensive logic. The interpretation is fixed and
documented here: the aggressor is the side whose `start` opened the war, which
is side A.

### 3. The obligation rule

Inputs, all already canonical strings: active wars `{ id, status, sideA, sideB,
aggressor }` and active agreements `{ id, type, status, parties, guarantor,
beneficiary }`. Only `status === "active"` wars and agreements are considered; a
ceasefire or a suspension breaks the clause for this pass without ending the
agreement. The three obligating type strings are hardcoded in the engine because
the purity guard forbids importing the runtime enum; a test asserts they equal
the `WORLD_AGREEMENT_TYPE_SET` values so the two cannot drift.

For each war, `aggressorSide` is `war.aggressor` (`"a"` unless it is `"b"`) and
`defenderSide` is the other. A polity is a **victim** when it is recorded on
`defenderSide` *before the derivation begins*: a polity that joins during the
fixed point is a belligerent but never a victim, so a defensive join does not
manufacture the very fact that would trigger the next one.

- **`alliance` (offensive and defensive):** every party is bound to join the
  side of any other party already fighting. If the partner fights on the
  aggressor side, the ally joins the aggressor side; if the partner is a victim,
  the ally joins the defender side.
- **`mutual_defense`:** each party is bound to join the defender side when the
  other party is a victim. A party that is itself the aggressor pulls no one.
- **`guarantee`:** the `guarantor` is bound to join the defender side when the
  `beneficiary` is a victim. The obligation runs one way, guarantor to
  beneficiary.
- Every other type creates no obligation.

The rule is applied to a fixed point. A polity that joins becomes a belligerent
and can, in turn, drag its own `alliance` partners; a `mutual_defense` or
`guarantee` join propagates nothing, because the joiner is not a victim. Each
pass collects every proposal the current sides call for, applies the admissible
ones in one batch, and repeats until a pass adds nothing or the pass cap is
reached. This is the "alliances drag alliances" behavior, made finite and
ordered.

### 4. Determinism and caps

Every iteration is over a totally ordered list: wars by `id`, agreements by `id`
then by `parties`, proposals by polity key. Keys are compared with `<` and
lowercased with `toLowerCase`, never `localeCompare` or `toLocaleLowerCase`, so
the result does not depend on the host locale and reordering any input gives the
identical output.

The caps are hard and every one is explicit, never a silent drop: a refused join
is recorded as a rejection, and a cap that truncates the derivation is flagged.

- `MAX_WAR_SIDE = 12`, matching the normalization cap on a side, so a join that
  would grow a side past it is rejected with reason `side-full`.
- A polity already on the opposing side is rejected with reason
  `already-opposed`; a polity already on the target side is a no-op, not a
  rejection, because the obligation is already honored.
- `MAX_TREATY_JOINS_PER_STEP = 32` bounds the joins applied across the whole
  derivation; the remainder is reported as `truncated` in the summary.
- `MAX_OBLIGATION_PASSES = 8` bounds the fixed point per war.

### 5. The engine output

`deriveTreatyObligations({ wars = [], agreements = [], inadmissible = [] })`
returns:

```
{
  joins: [{ warId, side, polity, viaAgreementId }],
  standing: [{ warId, side, agreementId, agreementType, polities }],
  rejections: [{ warId, side, polity, agreementId, reason }],
  summary: { wars, joined, standing, rejected, truncated },
}
```

`joins` are the new admissions to apply. `standing` is a separate, descriptive
read: the obligation links the world already realizes, computed by the same
module so there is one definition of "which agreement types bind". A link is
standing when at least two of an obligating agreement's relevant parties sit on
the same side of an active war (for a `guarantee`, the `guarantor` and the
`beneficiary`). `standing` is what the digest prints, because the join the
engine makes this turn is already history by the next prompt: without a standing
read the model would be told nothing the turn after the ally joined. It is
bounded by `MAX_STANDING_OBLIGATIONS = 128`.

`inadmissible` is a list of polity keys the engine never adds. A barred polity is
skipped before any other check, so it is neither added nor recorded as a
rejection. This matters because a polity that joins becomes a chain node: the
fixed point would otherwise drag that polity's own alliance partners in. A barred
polity already recorded on a side still participates, because it is in the
initial sides, so a war the barred polity is in still drags its partners.

### 6. The runtime adapter

`src/runtime/treatyObligations.js` exports two functions.

`readTreatyObligations(world, { playerPolity = "" } = {})` normalizes the world
with `normalizeWorldState`, resolves every war polity and agreement party into
one canonical key space with
`createOwnerResolver(buildOwnerAliasMap(world?.polityOverrides))` and
`toCountryName`, and passes the canonical player key as `inadmissible` to
`deriveTreatyObligations`. The player is therefore never added inside the engine
and is never a chain node, so a withheld player admission propagates nothing to
its allies. It reads only; it is the direct analogue of `resolveWarSettlements`,
which takes the player polity the same way. Wars are not skipped: only the
player's own admission is withheld.

`applyTreatyJoins(world, joins, { date, round })` returns a new normalized world
with each join's polity appended to the named side of its war (deduped, capped
by the normalization the world already applies), its `lastUpdatedDate` set to
the turn date and its `updatedRound` set. When `joins` is empty it returns the
same world unchanged, so a quiet turn copies nothing.

This module imports `src/runtime/gameState.js`, `src/runtime/ownerNames.js` and
`src/engine/treatyObligations.js`, and nothing from `src/Game/AI/`.

### 7. Wiring and turn order

In `applySimulationResult` (`src/Game/AI/gameplay.js`), the obligation step runs
immediately after the turn's own war ledger merges:

```
const warMerge = applyWarUpdates({ ... });
worldWithImpacts = warMerge.world;
// Treaty obligations run on the world this turn's warUpdates just produced:
// a war opened now drags its allies now, and the join is visible to every
// reader later in the turn.
const obligationOutcome = readTreatyObligations(worldWithImpacts, {
  playerPolity: normalizeString(baseGame.country),
});
if (obligationOutcome.joins.length) {
  worldWithImpacts = applyTreatyJoins(worldWithImpacts, obligationOutcome.joins, {
    date: nextGame.gameDate,
    round: nextGame.round,
  });
  logDebugEvent("turn", `Treaty obligations drew ${obligationOutcome.summary.joined} polity(ies) into active war(s).`, { ... });
}
worldWithImpacts = applyWarReparations(worldWithImpacts, dueSettlements);
```

The step is wrapped so a failure logs and skips it without losing the completed
turn, exactly as the supply-attrition and reinforcement steps are. It does not
run before the war merge because the war it must react to is created by that
merge; it does not run before the supply or reinforcement steps in the same
function because those already ran on the pre-merge world - which is the same
one-period lag the war ledger itself has, and is deliberate: joining is a board
fact for the rest of this turn and for every turn after, not a re-run of a
battle already narrated.

### 8. Telling the model

The digest is a pure builder, `buildTreatyObligationDigest({ standing = [],
cap = 6, charCap = 360 })`, in the runtime adapter. It returns a single ASCII
block, or the empty string when `standing` is empty:

```
[Treaty Obligations, as simulated]
- Under franco-russian-alliance-1894 (alliance), France, Russia hold side A of war-france-germany-1914.
```

Rows are ordered by `warId`, then side, then `agreementId`, so the order is
total. At most `cap` rows are printed and the whole block is clamped to
`charCap` characters on a line boundary, so a large ledger cannot inflate the
prompt; when the cap drops rows the block adds one `+N more.` line, exactly as
`operationsDigest.js` does.

The wiring in `simulateTimelineJump` builds it beside the operations digest, in
the same `projected.months > 0` block, from the same `bundle.world`: it calls
`readTreatyObligations(bundle.world, { playerPolity })`, passes the result's
`standing` rows to `buildTreatyObligationDigest`, and sets
`variables.treatyObligations`. `gameplay.js` imports both from the runtime
adapter. `buildWarLedgerDirective` (`gameplay.js`) prints the block as a fact
under `[Wars]`, directly after the recorded-wars context and before the rules,
and adds one rule sentence: an obligation is obeyed by the engine, so the model
must narrate an ally's entry rather than re-declare it or contradict it. The
rule states no number and no polity.

## Testing

`src/engine/treatyObligations.test.js` (pure, no world):

- An alliance drags a non-fighting partner onto the fighting partner's side,
  including onto the aggressor side.
- A mutual defense joins the protector only when the protected party is the
  victim, on the defender side; a mutual defense where the protected party is
  the aggressor joins no one.
- A guarantee pulls the guarantor to the beneficiary's defender side and never
  the reverse.
- An alliance chain is applied to a fixed point, while a defense join propagates
  nothing.
- An `inadmissible` polity is never added and never becomes a chain node, so a
  third party allied only to it is not dragged in; a barred polity already on a
  side still drags its alliance partners.
- A join is rejected with `side-full` at `MAX_WAR_SIDE` and with
  `already-opposed` against the other side; a party already on the target side is
  a no-op.
- The pass cap and the join cap bound the derivation and report `truncated`.
- A ceasefire war and a suspended agreement bind no one.
- Determinism: reordering wars, agreements and parties gives an identical
  result.

`src/runtime/treatyObligations.test.js` (adapter):

- `readTreatyObligations` reads a stored world, resolves names into one key
  space, withholds the player polity from the derivation, and returns joins and
  standing.
- A player allied to a belligerent and to a neutral third party yields no joins
  at all: the withheld player admission does not drag the third party in.
- `applyTreatyJoins` grows the named side, sets the date and round, and returns
  the same world for an empty join list.
- `buildTreatyObligationDigest` orders rows, caps at `cap` with the `+N more.`
  line, clamps to `charCap`, and returns the empty string for no rows.
- The adapter source imports nothing from `src/Game/AI/`.

`src/Game/AI/treatyObligationsWiringArchitecture.test.js`, in the established
style of `warSettlementWiringArchitecture.test.js`, asserts as source text that
`gameplay.js` reads the obligations after `applyWarUpdates`, applies the joins,
and passes the digest to `buildWarLedgerDirective`, so a later edit cannot
silently drop the wiring.

`src/runtime/gameState.ledgers.test.js` gains the `aggressor` cases: a war
without the field normalizes to `"a"`, an explicit `"b"` survives, and `"a"`
survives a round trip. `src/Game/AI/warLedger.test.js`, which owns
`applyWarUpdates`, gains the `start` op assertion that a started war carries
`aggressor: "a"` and that a war written with `"b"` keeps it.

`src/engine/enginePurity.test.js` covers the new engine module unchanged (no
imports, no clock, no randomness). The model's own behavior cannot be gated here
(no LLM key, no browser), so the increment gates the rule, the adapter, the
wiring and the digest text only.

## Acceptance

The whole suite passes with zero failures, `node --test "src/engine/*.test.js"`,
`node --test "src/runtime/*.test.js"` and `node --test "src/Game/AI/*.test.js"`
pass, ESLint is clean on the new and changed files, `npm run wiki:check` reports
`Wiki is current.` after any documentation is regenerated, and `npm run build`
succeeds. The new engine module passes `enginePurity.test.js`. No migration, no
declaration-schema change and no new `package.json` entry is introduced; the
only stored-state change is the single `aggressor` field with its default.

## Open questions

None block implementation. The following are deliberately deferred and recorded
so the plan does not silently decide them.

- Whether a joined ally spends readiness or reserves to enter - a material cost
  to honoring a treaty - is deferred; this branch moves a polity onto a side and
  nothing else.
- Whether an alliance should ever refuse to honor a pact (a separate, declared
  breach with a reputation cost) is the breach branch; this branch assumes
  fidelity.
- Whether `guarantee` should extend to the beneficiary's defense only while the
  beneficiary is not itself the aggressor across an ongoing war, rather than per
  declaration, is left to the same one-bit model; the aggressor field answers it
  for now.
- Whether the digest should also show obligations the engine rejected or
  deferred this turn is deferred; this increment shows what the world realizes.
- Whether the interactive (non-jump) turn path should build the digest is
  deferred; this increment wires the jump path that already builds the
  neighbouring digests.
