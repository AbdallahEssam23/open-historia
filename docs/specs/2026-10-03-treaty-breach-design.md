<!-- Open Historia - deterministic treaty breach and its cost (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# Breaking the Promise: Declared Treaty Breach and Its Cost

The twelfth increment of the deterministic simulation, and the second branch of
the mechanical diplomacy layer. The eleventh increment gave a treaty teeth: an
active alliance, mutual defense or guarantee draws a bound party into a war the
engine tracks, every time, without the model's permission. That branch assumes
fidelity - the promise is always kept. This increment adds the one thing a
promise needs to be a promise: the possibility of breaking it, and a cost for
doing so that the engine, not the narrator, enforces.

## Why this increment exists

1. **A promise that cannot be broken is not a promise.** The eleventh increment
   made every obligation automatic: a bound party is drawn in, always. That is
   the right default - an alliance should bind - but it removes the moment the
   whole system exists to produce: the ally that stays home. Without a breach,
   an alliance is a law of physics, not a decision.

2. **The model narrates a refusal it cannot record.** A model that writes "the
   guarantor, its treasury empty, refused to march" tells a story the world does
   not hold. The next turn the engine draws the same party in anyway, and the
   narrative contradicts the board. The refusal must be a declared fact the
   engine reads, exactly as a war declaration is.

3. **A breach has to cost something, and the engine must charge it.** If a
   broken promise changed nothing but prose, breaking it would be free and so
   universal. The cost - a reputation the model already reads, and a relation
   the model already reads - is deterministic arithmetic, not a number the model
   invents. The model decides WHETHER to break; the engine decides WHAT it
   costs.

4. **The ledger already carries every fact the cost needs.** A war knows its
   sides and its aggressor (the eleventh increment); an agreement knows its
   type, parties and guarantor; a reputation and a relation are existing stores.
   This increment adds no new way to fight or to negotiate. It reads a declared
   breach, checks it against the obligation the engine already computes, and
   writes the three consequences into ledgers that already exist.

## Scope

This increment is enforcement plus explanation of one action: a bound party
breaks its treaty obligation instead of honoring it.

1. A new pure engine function, `deriveTreatyBreaches`, in the existing
   `src/engine/treatyObligations.js`, that reads active wars, active agreements
   and the model's declared breaches as plain data and returns the breaches the
   engine accepts, the parties each one wronged, and the declarations it
   rejects. It imports nothing and reads no world.
2. A declaration surface: one new operation, `breach`, inside the existing
   `agreementUpdates` payload, where the single listed party is the breaker.
3. A pre-pass in `src/Game/AI/gameplay.js` that resolves declared breaches
   BEFORE the obligation step, so a broken pact is already non-active when the
   engine decides which parties a war draws in. This is what makes a breach
   block the join it would otherwise have caused.
4. A new runtime cost step, `applyTreatyBreaches` in
   `src/runtime/treatyObligations.js`, that lowers the breaker's reputation and
   its relation with each wronged party. It imports no `src/Game/AI/` module.
5. One new stored agreement status, `breached`, and one optional stored field,
   `breachedBy`, so a broken instrument is distinguishable from one that ended
   normally and so the digest can name the breaker.
6. A capped digest, built from the world's breached agreements and printed
   beside the standing-obligations digest under `[Wars]`, so the model narrates
   the fall-out rather than reinventing it.

Only `alliance`, `mutual_defense` and `guarantee` create an obligation, so only
those three can be breached. Every other agreement type is a promise with no
mechanical clause and is untouched.

## Non-goals

- No casus belli, no retaliatory war and no military consequence of a breach.
  The wronged party's reaction is the model's to write; the engine records the
  diplomatic cost, not a war.
- No economic or material penalty. This branch charges reputation and relations
  only, the two costs the model already reads every turn.
- No intelligence or foreknowledge of a breach. A breach is a public
  declaration, like a war declaration, not a secret.
- No player exception. The engine never joins the player's own polity (the
  eleventh increment), but the model may declare that the player breaks a
  treaty, and the player pays the same reputation and relation cost as any
  power. The model decides the player's actions.
- No change to the stored shape of a relation or a war. The agreement record
  gains one status value and one optional field (`breachedBy`); nothing else.
- No new dependency, no UI surface, and no new diplomatic scheduler.

## Design

### 1. Layers

The split is the established one, and identical to the eleventh increment
because this is the same rule read in the other direction.

`src/engine/treatyObligations.js` stays pure: it already receives `{ wars,
agreements }` as canonicalized plain data and returns plain data. This increment
adds a second export to the same module rather than a new file, because "which
parties a treaty binds" must have exactly one definition; a breach is that same
question asked about a party that refuses. The module still imports nothing and
passes the engine purity guard.

`src/runtime/treatyObligations.js` is the adapter: it reads the stored world,
resolves every name into one canonical key space through `createOwnerResolver`,
calls the engine, applies the agreement status change through the existing
director, and writes the reputation and relation cost. It imports
`src/runtime/gameState.js`, `src/runtime/ownerNames.js` and
`src/engine/treatyObligations.js`, and nothing from `src/Game/AI/`.

`src/Game/AI/nativeDiplomaticDirector.js` keeps ownership of the agreement
lifecycle: it gains the `breach` operation, the `breached` status and the
`breachedBy` field, exactly as it owns `start`, `suspend`, `end` and `expire`.

`src/Game/AI/gameplay.js` owns the turn wiring: the pre-pass and the digest.

### 2. The declaration: `op: "breach"` in `agreementUpdates`

The model already declares agreement lifecycles with a compact line per record:
`agreementId~op~type~partiesCSV~eventNumbersCSV~title~terms`. This increment adds
`breach` to the `op` list. A breach record names the broken agreement in
`agreementId`, lists exactly one polity in `partiesCSV` (the breaker), and cites
the event that shows the refusal. `type`, `title` and `terms` are blank; the
agreement already carries them.

- The prompt's `op` list (the `agreementUpdates` line in
  `buildDiplomaticLedgerDirective`) gains `breach`, with one clause: a breach
  names the one party that refused.
- `validateDiplomaticLedgerPayload` (`nativeDiplomaticDirector.js`) adds
  `"breach"` to its operation whitelist. Structural rules only: the agreement
  must already exist and not be terminal, and the record must list exactly one
  party. Whether that party was actually bound is the engine's decision, not
  validation's, so a structurally valid but unbound breach is dropped by the
  engine with a logged reason rather than failing the whole response.
- `decodeAgreementUpdates` is unchanged: `op` is a free string, and `parties` is
  already parsed.

The existing causal-event rule applies unchanged: a breach, like every other
agreement record, must reference an event, or it is dropped.

### 3. The acceptance rule: who may break

A declared breach `{ agreementId, polity }` is accepted only when the breaker
would actually have been drawn in, so a breach of an agreement that binds no one
cannot manufacture a cost. The engine computes, for the agreement and each
active war, the side each bound party is obliged to join - the same computation
the join derivation uses - and accepts the breach when the named party has a
target side with at least one other relevant party already on it.

- **`alliance`:** the breaker is a party and another party is already fighting;
  the breaker was bound to that fighting party's side. The wronged parties are
  that fighting party and any other party of the agreement already on that side.
- **`mutual_defense`:** the breaker is a protector and another party is a victim
  (a pre-derivation defender, exactly as the join rule defines it); the breaker
  was bound to the defender side. The wronged parties are the victims.
- **`guarantee`:** the breaker is the guarantor and the beneficiary is a victim;
  the breaker was bound to the defender side. The wronged party is the
  beneficiary.

The rule is applied to the war set as the turn's own `warUpdates` left it, so a
war opened this turn can be breached in the same turn. A declaration whose
agreement is missing, not active, of a non-obligating type, whose polity is not
a relevant party, or which binds the polity to no side, is rejected with a
reason and changes nothing.

Because this is the same "bound side" computation as the join derivation, it is
extracted as one internal helper in the engine. `deriveTreatyObligations` and
`deriveTreatyBreaches` both call it, so the two can never disagree about who was
bound. The helper is not exported; the two derived exports are the whole
surface.

### 4. Turn order: the pre-pass

The obligation step runs immediately after the turn's `warUpdates` merge
(`applySimulationResult`) and reads the agreements' status to decide the joins.
For a breach to block the join it would have caused, the breach must be recorded
before that step runs, in the same pass.

`applySimulationResult` therefore splits the turn's decoded `agreementUpdates`
into the `breach` records and the rest:

```
const breachUpdates = agreementUpdates.filter((update) => update.op === "breach");
const otherAgreementUpdates = agreementUpdates.filter((update) => update.op !== "breach");
```

The pre-pass runs between `worldWithImpacts = warMerge.world;` and the
obligation step:

1. `readTreatyBreaches(worldWithImpacts, { breaches })` validates each declared
   breach against the post-war-merge world and returns the accepted ones and the
   rejected ones.
2. The accepted breach records are applied through the existing
   `applyDiplomaticUpdates` (already imported), so
   `nativeDiplomaticDirector` marks each agreement `breached` and stamps
   `breachedBy`. The breach records are removed from the update list the later
   diplomatic merge receives, so no agreement is marked twice.
3. `applyTreatyBreaches(worldWithImpacts, accepted, { date, round })` writes the
   reputation and relation cost.

Only then does the obligation step run, on a world where every broken agreement
is already `breached` and therefore not `active`; the join the breaker would
have caused simply does not happen. The step is wrapped exactly as the
obligation step is, so a failure logs and skips it without losing a completed
turn.

This ordering is deliberate and is the whole point of the increment: a breach
decided now is a board fact before the board reacts to it.

### 5. Stored state: the `breached` status and `breachedBy`

The agreement status enum gains one terminal value:

- `AGREEMENT_STATUS_VALUES` (`nativeDiplomaticDirector.js`, exported and pinned
  by a test) gains `"breached"`.
- `WORLD_AGREEMENT_STATUS_SET` (`gameState.js`, the normalizer's whitelist)
  gains `"breached"`, so the status survives a read/write round trip instead of
  resetting to `active`.
- `applyAgreementUpdates` handles `op === "breach"`: `status` becomes
  `"breached"`, `endedDate` is set to the turn date, and `breachedBy` is set to
  the canonical breaker. The agreement's recorded `parties` are kept unchanged:
  the single party on a breach record names the breaker, it is not a new party
  list, so the breach branch must not overwrite `prior.parties` the way an
  `update` does. Every other field (`type`, `title`, `terms`) is preserved from
  the prior record.
- The agreement sort rank (`applyAgreementUpdates`) places `breached` after
  `expired`, so a broken instrument sinks to the end of the capped list exactly
  as a terminal one should.

`breachedBy` is one optional string field on the agreement, read by the
normalizer's whitelist and preserved like `guarantor`/`beneficiary`. It exists
so the digest and any later reader can name who broke it without re-deriving
from events. There is no migration: an agreement without the field is simply not
breached, and the status default stays `active`.

This is the only stored-shape change in the increment, and it is deliberately as
small as the eleventh increment's `aggressor` field: one enum value and one
optional field, both defaulted.

### 6. The cost

The cost is deterministic arithmetic on existing stores, with the amounts fixed
as engine constants so the number is never the model's to choose:

- `BREACH_REPUTATION_PENALTY = 15`. The breaker's
  `world.internationalReputation[breaker]` drops by 15, clamped to `0..100`. A
  polity with no stored reputation is treated as the ordinary `50` the rest of
  the code already assumes, so it drops to 35.
- `BREACH_RELATION_PENALTY = 25`. The relation between the breaker and each
  wronged party drops by 25, clamped to `-100..100`. A pair with no stored
  relation starts from `0` and is created, so a breach always leaves a strained
  pair where none was recorded. The status is left blank on write and derived
  from the new score by the existing normalizer, so the band cannot drift from
  the score.
- `MAX_TREATY_BREACHES_PER_TURN = 16`. At most sixteen breaches are accepted per
  turn; the remainder are rejected with reason `cap-reached` and logged.

The reputation write is a plain map update the world normalizer already clamps
and keys by canonical name. The relation write reuses `normalizeWorldState`,
which dedupes the pair and re-sorts the ledger, so the adapter does not
reimplement the relation record.

`applyTreatyBreaches` returns the same world unchanged when there are no
accepted breaches, so a quiet turn copies nothing - the same contract as
`applyTreatyJoins`.

### 7. The engine output

`deriveTreatyBreaches({ wars = [], agreements = [], breaches = [] })` returns:

```
{
  breaches: [{ agreementId, agreementType, polity, warIds, wrongedPolities }],
  rejected: [{ agreementId, polity, reason }],
  summary: { declared, accepted, rejected },
}
```

Every list is in a total order that does not depend on input order: breaches by
`agreementId` then polity, wronged polities by key, wars by `id`. Keys are
compared with `<` and lowercased with `toLowerCase`, never `localeCompare` or
`toLocaleLowerCase`, so the result is locale-independent. Reordering the input
gives the identical output.

`rejected` carries a machine reason: `agreement-missing`, `agreement-inactive`,
`not-a-party`, `no-active-obligation`, or `cap-reached`. A rejection changes
nothing; it exists so a future digest or a debug log can say why a declaration
was ignored rather than dropping it silently.

### 8. The runtime adapter

`src/runtime/treatyObligations.js` gains three functions beside the existing
three.

`readTreatyBreaches(world, { breaches = [] } = {})` normalizes the world,
resolves the declared breach's agreement id and polity into the canonical key
space, calls `deriveTreatyBreaches`, and returns the result with display names
restored on the accepted breaches' `polity`, `wrongedPolities` and on the
rejected rows. It reads only.

`readRecordedBreaches(world)` scans the stored agreements for `status ===
"breached"` and returns the digest rows the world already holds, so the digest
can be rebuilt from state alone. It reads only.

`applyTreatyBreaches(world, breaches, { date = "", round = 0 } = {})` returns a
new normalized world with the reputation and relation cost applied for each
accepted breach, or the same world unchanged for an empty list. It writes only
`world.internationalReputation` and `world.relations`; the agreement status is
the director's write, not this function's.

### 9. The digest

`buildTreatyBreachDigest({ breaches = [], cap = 6, charCap = 360 })` returns a
single ASCII block, or the empty string when there are no rows:

```
[Treaty Breaches, as simulated]
- France broke franco-russian-alliance-1894 (alliance); wronged Russia.
```

Rows are ordered by `agreementId`, then by breaker, so the order is total. At
most `cap` rows are printed and the block is clamped to `charCap` characters on
a line boundary, with a single `+N more.` line when rows are dropped - exactly
the contract of `buildTreatyObligationDigest`, so the two siblings read alike.

### 10. Telling the model

`gameplay.js` imports `buildTreatyBreachDigest` and `readRecordedBreaches` from
the runtime adapter beside the obligation imports. `buildWarLedgerDirective`
reads a second variable, `variables.treatyBreach`, and prints it under `[Wars]`
directly after the standing-obligations block, so the two mechanical-diplomacy
facts sit together. It adds no new rule sentence: the obligations sentence
already tells the model the engine obeys treaties, and this block is the record
of the one that was not obeyed.

The jump path (`simulateTimelineJump`) builds the digest beside the obligations
digest, in the same `projected.months > 0` block and from the same
`bundle.world`:

```
variables.treatyBreach = buildTreatyBreachDigest({
  breaches: readRecordedBreaches(bundle.world),
});
```

Like the obligations block, it is a state read shown to the model at the start
of the segment, not a per-turn event feed. The interactive (non-jump) path is
deferred, exactly as the obligations digest was deferred to the jump path
first; an interactive turn still records the breach in the ledger and the
events, and the next jump (or the standing block, once the interactive path is
wired) carries it.

## Testing

`src/engine/treatyObligations.test.js` (pure, no world), added cases:

- An alliance breach is accepted when a partner is fighting, with the partner as
  the wronged party, and the breaker's would-be join no longer appears.
- A mutual-defense breach is accepted only when the protected party is a victim;
  a declaration naming the aggressor's protector is rejected
  `no-active-obligation`.
- A guarantee breach is accepted with the beneficiary as the wronged party.
- A declaration naming a missing agreement, an inactive agreement, a
  non-obligating type, or a polity that is not a party is rejected with the
  right reason and changes nothing.
- The per-turn cap accepts `MAX_TREATY_BREACHES_PER_TURN` and rejects the rest
  `cap-reached`.
- Determinism: reordering wars, agreements, parties and declarations gives an
  identical result.

`src/runtime/treatyObligations.test.js` (adapter), added cases:

- `readTreatyBreaches` reads a stored world, resolves names into one key space,
  and returns accepted breaches with the wronged parties.
- `applyTreatyBreaches` lowers reputation by 15 (from `50` when absent) and the
  relation by 25, creates a relation where none existed, clamps at the ends, and
  returns the same world for an empty list.
- `readRecordedBreaches` returns the rows for agreements already `breached`.
- `buildTreatyBreachDigest` orders rows, caps at `cap` with `+N more.`, clamps
  to `charCap`, and returns the empty string for no rows.
- The adapter still imports nothing from `src/Game/AI/`.

`src/Game/AI/diplomaticLedger.test.js`, which owns the agreement lifecycle, gains
the `breach` cases: the operation is accepted by validation, an agreement
becomes `breached` with `breachedBy` set, a terminal agreement cannot be
breached, and a structurally invalid breach record is rejected.

`src/runtime/gameState.ledgers.test.js` gains the `breached` status case: a
stored `breached` status and `breachedBy` survive a normalize round trip.

`src/Game/AI/treatyObligationsWiringArchitecture.test.js` gains source-text
assertions that the pre-pass reads the breaches before the obligation step,
applies them, and that `gameplay.js` passes the digest to
`buildWarLedgerDirective`, so a later edit cannot silently drop the wiring.

`src/engine/enginePurity.test.js` covers the new export unchanged (no imports,
no clock, no randomness). The model's own behavior cannot be gated here (no LLM
key, no browser), so the increment gates the rule, the adapter, the wiring and
the digest text only.

## Acceptance

The whole suite passes with zero failures, `node --test "src/engine/*.test.js"`,
`node --test "src/runtime/*.test.js"` and `node --test "src/Game/AI/*.test.js"`
pass, ESLint is clean on the new and changed files, `npm run wiki:check` reports
`Wiki is current.` after any documentation is regenerated, and `npm run build`
succeeds. The new engine export passes `enginePurity.test.js`. No migration and
no new `package.json` entry is introduced; the only stored-state changes are the
single `breached` status value and the single optional `breachedBy` field, both
defaulted.

## Open questions

None block implementation. The following are deliberately deferred and recorded
so the plan does not silently decide them.

- Whether the wronged party should gain a casus belli or a right to retaliate is
  the war-reaction branch; this branch records the diplomatic cost only.
- Whether a breach should also cost a material reserve or a stockpile is
  deferred with the material-cost branch of the eleventh increment.
- Whether a later `resume` should be able to un-break a `breached` agreement is
  deliberately excluded: `breached` is terminal, and a renewed pact is a new
  agreement with a new id.
- Whether the interactive (non-jump) turn path should build the digest is
  deferred, exactly as the obligations digest deferred it; this increment wires
  the jump path that already builds the neighbouring digests.
- Whether the rejection list should itself become a digest row is deferred; this
  increment logs rejections and shows only honored costs.
