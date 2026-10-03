<!-- Open Historia - deterministic just cause for war and the cost of an unjust one (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# Just Cause: The Warrant a War Needs and What an Unjust War Costs

The thirteenth increment of the deterministic simulation, and the third branch
of the mechanical diplomacy layer. The eleventh increment gave a treaty teeth:
a bound party is drawn into a war the engine tracks. The twelfth made a promise
breakable, and charged the breaker. Both branches read one promise between two
polities. This increment reads the other end of the same ledger: the moment a
war begins, and whether the power that began it had a reason the world already
records.

## Why this increment exists

1. **A war can begin with no reason at all.** `nativeWarLedger.js` opens a war
   from a `start` record, and the record's `note` becomes a free-text `cause`
   that nothing reads. A power can declare war on any other with no claim, no
   grievance and no consequence: belligerency is free, so the ledger cannot tell
   an aggression from a just war. The model narrates motive; the world holds
   none.

2. **The facts a warrant needs are already recorded.** An irredentist war needs
   a claim, and `world.regionClaimants` already stores every disputed region a
   polity claims. A war of redress needs a broken promise, and the twelfth
   increment already stores `breached` and `breachedBy` on the agreement. This
   increment invents no new fact; it reads the two the world already keeps and
   asks whether the aggressor held either one.

3. **An unjust war has to cost something, and the engine must charge it.** The
   twelfth increment established the posture: the model decides WHETHER to act,
   the engine decides WHAT the world makes of it, in deterministic arithmetic on
   existing stores. An aggression without a recorded warrant is the same social
   fact as a broken promise, and it is charged the same way, to the same two
   stores - a reputation the model reads and a relation it reads.

4. **Nothing needs a new declaration surface.** The two warrants are states the
   engine can see, not assertions the model must make. A `start` record already
   names the aggressor and its target; the claims ledger and the breach record
   already hold the reasons. The engine infers the warrant from the board, so a
   model cannot manufacture a cause it does not hold - exactly as it cannot
   manufacture a treaty obligation it was never bound by.

## Scope

This increment is the judgement of one act: a power begins a war, and the engine
decides whether that power held a reason the world records.

1. A new pure engine module, `src/engine/casusBelli.js`, that reads the
   aggressors, the defenders, the recorded claims and the recorded breaches as
   plain data and returns, per aggressor, whether a just cause existed and which
   one. It imports nothing and reads no world.
2. A new runtime adapter, `src/runtime/casusBelli.js`, that reads the world's
   claims and breaches, resolves every name and region into one canonical key
   space, calls the core, charges the cost for each causeless aggressor, and
   marks the war. It imports no `src/Game/AI/` module.
3. One shared runtime cost function, `src/runtime/diplomaticCost.js`, that
   applies a reputation penalty and a relation penalty for a list of charges.
   The twelfth increment's breach cost is re-expressed through it, so the two
   penalties have exactly one definition.
4. One new optional war field, `unjustAggressors`, naming the aggressors of a
   war that began without a recorded warrant, so the judgement survives a
   read/write round trip and the digest can be rebuilt from state alone.
5. A turn pre-pass in `src/Game/AI/gameplay.js` that resolves the wars started
   this turn, charges the causeless aggressors, and marks the wars - after the
   breach pre-pass, so a breach declared this turn justifies a war begun this
   turn.
6. A capped digest, built from the world's marked wars and printed beside the
   breach digest under `[Wars]`, so the model narrates the price rather than
   reinventing it.

Only a war's initiation is judged. A war that continues, a party that joins one
later, and a war that predates this increment are all left alone.

## Non-goals

- No military or territorial consequence of an unjust war. The engine records
  the diplomatic cost, not a penalty on the battlefield. A causeless war is
  fought exactly as a just one.
- No new war operation and no new transport string. The warrant is inferred from
  the `start` record and the two existing stores; nothing is declared.
- No retaliation, no coalition against the aggressor, and no reputation effect
  on any party other than the aggressor. The world's wider answer is the model's
  to write; the engine charges the two stores it owns.
- No justification for the defender and no defensive war doctrine. A war is
  judged by the aggressor's warrant, never by who was attacked.
- No intelligence or foreknowledge. A judgement is derived the moment the war
  begins and is public state thereafter.
- No player exception. The player's polity pays the same cost for a war it
  begins without a warrant as any other power.
- No change to the stored shape of a claim, a breach or a relation. The war
  record gains one optional field (`unjustAggressors`); nothing else.
- No new dependency, no UI surface, and no new scheduler.

## Design

### 1. Layers

The same three layers and the same direction of dependency every increment has
used.

| Layer | Location | Rule in this increment |
|---|---|---|
| Pure core | `src/engine/casusBelli.js` (new) | The two penalty constants, `MAX_CASUS_AGGRESSORS`, `deriveWarCasus`. Imports nothing, so it passes the engine purity allow-list. No browser import, no `Date.now`, no `Math.random`, no `localeCompare`. |
| Shared cost | `src/runtime/diplomaticCost.js` (new) | `applyDiplomaticCost(world, charges)`: reputation and relation arithmetic, once. Imports `src/runtime/gameState.js` only. |
| Adapter | `src/runtime/casusBelli.js` (new) | `readWarCasus`, `applyWarCasus`, `readRecordedUnjustWars`, `buildWarCasusDigest`. Reads the world, the catalog and the turn's starts; calls the core and the shared cost. Never imports `src/Game/AI/`. |
| Boundary | `src/Game/AI/` | `gameplay.js` runs the pre-pass in the turn and builds the jump digest; `nativeWarLedger.js` and `runtime/gameState.js` preserve the new war field through normalization. |

The core is a separate module from `engine/treatyObligations.js` because the two
answer different questions: the obligation core asks which party a treaty binds
to a war already underway; the casus core asks whether the party that began a
war was entitled to. They share no arithmetic and no input beyond the agreement
type names, so they share no file.

### 2. The just-cause rule

A war's aggressor side is the `start` record's `actors`; the defenders are its
`opponents`, read at the moment the war begins, before any later join. For each
aggressor, the engine asks one question: does the world already record a warrant
for this power against one of these defenders?

- **An unresolved claim**: the aggressor is a claimant of a region whose current
  owner is one of the defenders. The claim is the classical territorial
  warrant, read from `world.regionClaimants`.
- **A recorded breach**: a defender is the recorded breaker of an agreement
  (`status: "breached"`, `breachedBy`) of which the aggressor is a party, and
  the aggressor is not itself the breaker. The war is redress for the broken
  promise, read from the twelfth increment's record.

A power that holds either warrant has a just cause and pays nothing. A power
that holds neither has begun an unjust war and pays the cost. A warrant that is
declared but false is indistinguishable from no warrant: the engine asks only
whether a true warrant exists, never whether the model believed one did, so a
manufactured excuse is exactly as costly as an open aggression.

The judgement is per aggressor, not per war, because a `start` record may name a
coalition. A coalition member that holds a warrant is spared even if its partner
does not; the war is marked only by the aggressors that lacked one.

### 3. The core (`src/engine/casusBelli.js`)

Constants (first-draft calibration; the tests assert the arithmetic, never a
magnitude):

```
UNJUST_WAR_REPUTATION_PENALTY = 15
UNJUST_WAR_RELATION_PENALTY   = 25
MAX_CASUS_AGGRESSORS          = 12
```

`deriveWarCasus({ aggressors = [], defenders = [], claims = [], breaches = [] })
-> { aggressors, summary }`:

- `aggressors` is a list of names; `defenders` a list of names. `claims` is a
  list of `{ regionId, claimant, holder }`; `breaches` a list of
  `{ agreementId, breachedBy, parties }`. Every name and key is compared with
  `asString(...).toLowerCase()`, never with a locale collator.
- The defenders' keys are collected once. The claims are deduped and sorted by
  `(regionId, claimant)`; the breaches by `(agreementId, breachedBy)`; the
  aggressors are deduped case-insensitively (first spelling kept) and sorted by
  key then by raw text, all by plain comparison, so the result cannot depend on
  the order the model wrote the lists in.
- For each aggressor, in that total order, the warrant is looked up in a fixed
  order: an unresolved claim first, then a recorded breach. The first match
  decides `{ kind, target }`; no match yields `{ justified: false, kind: "",
  target: "" }`. A claim is a warrant when its `claimant` is the aggressor and
  its `holder` is a defender; a breach is a warrant when its `breachedBy` is a
  defender, its `parties` include the aggressor, and the aggressor is not the
  breaker itself.
- `MAX_CASUS_AGGRESSORS` caps the returned list; past it, an aggressor is
  dropped rather than judged, so a pathological start cannot force unbounded
  work.
- `summary` is `{ judged, justified, unjust }`, counted over the returned list.

The returned shape:

```
{
  aggressors: [{ polity, justified, kind, target }],
  summary: { judged, justified, unjust },
}
```

### 4. The shared cost (`src/runtime/diplomaticCost.js`)

`applyDiplomaticCost(world, charges, { date = "", round = 0 } = {}) -> world`
applies one reputation penalty and a set of relation penalties for a list of
charges and returns a new normalized world, or the same world for an empty list:

```
charges: [{ actor, wronged: [names], reputationPenalty, relationPenalty, reason }]
```

- The reputation of `actor` loses `reputationPenalty`, floored at `0` and capped
  at `100`, treating an unset value as `50` - the same rule the twelfth
  increment already applies.
- The relation of `actor` with each wronged party loses `relationPenalty`,
  floored at `-100`, its status re-derived from the new score, and the date and
  round stamped. A pair with no recorded relation is created at `0` and then
  charged, with the summary `${actor} ${reason} ${wronged}.`.
- The relations are keyed by the unordered pair of names, lowercased, so the
  same two polities land on one relation however the sides are written.

`src/runtime/treatyObligations.js` is refactored so `applyTreatyBreaches` maps
its accepted breaches to charges (`reason: "broke a treaty with"`, the two
`BREACH_*` penalties, the breaker, and the wronged polities) and delegates the
arithmetic to `applyDiplomaticCost`. The refactor is behavior-preserving: the
existing breach tests, unchanged, are the witness. The two penalty pairs stay
separate constants in their own engine modules, so the casus cost can be
retuned without touching the breach cost.

### 5. The adapter (`src/runtime/casusBelli.js`)

`readWarCasus(world, { starts = [], catalog = [] } = {})`:

- Reads `world.regionClaimants` and produces one claim row per
  `(regionId, claimant)`. The holder is the region's current owner,
  `regionOwnerName(catalogRow, world.regionOwnershipOverrides)`, resolved from
  the catalog row the caller passes, so a claim on a stock-map region is read
  with its real owner. Every name is folded into the world's canonical key space
  through the same `createOwnerResolver` the treaty adapter uses.
- Reads the world's agreements with `status: "breached"` and produces one breach
  row per agreement, `{ agreementId, breachedBy, parties }`.
- For each start the caller passes, keeps only a war that exists and is
  `active` in the world it was given, and records a reason for the ones it drops
  (`war-missing`, `war-inactive`). It calls `deriveWarCasus` with the start's
  aggressors and defenders. It reads only, and returns:

```
{
  wars: [{ warId, aggressors: [{ polity, justified, kind, target }], wronged: [names] }],
  rejected: [{ warId, reason }],
  summary: { judged, justified, unjust },
}
```

The `wronged` defenders are canonicalized, deduped and sorted; the aggregated
summary counts every judged aggressor across the starts.

`applyWarCasus(world, wars, { date = "", round = 0 } = {}) -> world`:

- For each judged war, collects the aggressors with `justified: false`, charges
  each of them against the war's `wronged` defenders through
  `applyDiplomaticCost` (`reason: "began an unjust war on"`, the two
  `UNJUST_WAR_*` penalties), and marks the war with `unjustAggressors`, the
  sorted, deduped, bounded list of those aggressors.
- A war with no unjust aggressor is neither charged nor marked. A world with
  nothing to charge is returned unchanged, by reference.

`readRecordedUnjustWars(world) -> [{ warId, aggressor, wronged }]` scans the
stored wars for a non-empty `unjustAggressors` and, for each named aggressor,
returns one row carrying the war id, the aggressor, and the war's other side as
the wronged, sorted by `(warId, aggressor)`. It reads only.

`buildWarCasusDigest({ wars = [], cap = 6, charCap = 360 })` returns a single
ASCII block, or the empty string for no rows:

```
[Wars Begun Without Just Cause, as simulated]
- Italy began war-ethiopia-1935 without just cause; wronged Ethiopia.
```

At most `cap` rows print and the block is clamped to `charCap` characters on a
line boundary, with a single `+N more.` line when rows are dropped - the
contract of `buildTreatyObligationDigest` and `buildTreatyBreachDigest`, so the
siblings read alike.

### 6. The turn pre-pass

Inside `applySimulationResult`, in this order:

1. The war ledger merges (`applyWarUpdates`), so a war declared this turn exists.
2. The breach pre-pass runs (the twelfth increment), so a breach declared this
   turn is already recorded.
3. The casus pre-pass runs, in its own `try/catch` that logs and skips on
   failure exactly as the breach and obligation steps do, so a broken judgement
   can never lose a completed turn. It reads the `start` records of this turn's
   `warUpdates`, calls `readWarCasus` against the merged world and the primed
   catalog, and, when any war is judged, calls `applyWarCasus` and reassigns
   `worldWithImpacts`.
4. The obligation step runs on the merged world, then the reparations.

The order is deliberate: a breach declared this turn must be a board fact before
the casus pre-pass reads the breaches, so a power may begin a war of redress in
the same turn the promise breaks. The pre-pass reads the `start` records rather
than the war records so that a party joining a long war later is never judged an
aggressor; only the power that wrote the `start` is.

The pre-pass logs through `logDebugEvent("turn", ...)` whenever it judged
anything, including when every aggressor held a warrant, so the trail records
the judgement even when no cost fell.

### 7. Stored state: `unjustAggressors`

The war record gains one optional field, `unjustAggressors`, a bounded list of
the aggressors that began the war without a recorded warrant. It is the precise
form of the approved verdict marker: a `start` record may name a coalition, so
the war must name the unjust members rather than assert the whole war just or
unjust. An absent or empty field means the war was not judged or was fully
justified; both are treated as no cost and nothing to report.

`normalizeWorldWar` (`src/runtime/gameState.js`) and `normalizeWar`
(`src/Game/AI/nativeWarLedger.js`) each gain the field, canonicalized through
`toCountryName`, deduped case-insensitively, sorted, and capped. Both are
required: the war merge re-normalizes every stored war through the ledger's
normalizer, so a field preserved in only one would be erased on the next turn.
No migration is introduced: a war without the field is simply not judged, so a
save written before this increment reads unchanged and incurs no retroactive
cost. There is no `ENGINE_VERSION` bump.

### 8. Telling the model

`gameplay.js` imports `readRecordedUnjustWars` and `buildWarCasusDigest` from the
runtime adapter beside the breach imports. `buildWarLedgerDirective` reads a new
variable, `variables.warCasus`, and prints it under `[Wars]` directly after the
breach block, so the mechanical-diplomacy facts sit together. It adds one
sentence to the war preamble: beginning a war with no recorded claim against the
target and no recorded breach by it marks the aggressor, so a power that means to
fight should hold a reason the world can see. The jump path
(`simulateTimelineJump`) builds the digest beside the breach digest, from the
same `bundle.world`:

```
variables.warCasus = buildWarCasusDigest({
  wars: readRecordedUnjustWars(bundle.world),
});
```

The interactive path is deferred, as it was for the standing obligations and the
breach digest: the judgement still lands in the ledger, and the next jump (or the
standing block, once the interactive path reads it) surfaces it.

## Testing

The core's tests run under a bare `node --test` and assert:

- A claim warrant: the aggressor claims a region a defender holds; a claim on a
  region a third power holds is not a warrant.
- A breach warrant: a defender is the recorded breaker of an agreement the
  aggressor is a party to; a breach by a party that is not a defender, or by the
  aggressor itself, is not a warrant.
- No warrant yields `justified: false` with an empty kind and target; a
  coalition's justified member is spared while its causeless member is not.
- Every branch is a function of the sets, not the order: permuting the claims,
  the breaches and the aggressors yields a byte-identical result.
- `MAX_CASUS_AGGRESSORS` bounds the returned list.

The cost module's tests assert: `applyTreatyBreaches` still produces the exact
world it did before the refactor (the unchanged breach tests are the witness);
the default-`50` reputation, the `0` and `-100` floors, the created relation and
its summary, and the same-world return for an empty charge list.

The adapter's tests assert: a settled claim reads with the catalog owner; a
start whose war is missing or inactive is dropped with a reason; `applyWarCasus`
charges each causeless aggressor against the wronged, marks `unjustAggressors`,
leaves a fully justified war untouched, and returns the same world when there is
nothing to charge; `readRecordedUnjustWars` names each unjust aggressor;
`buildWarCasusDigest` orders, caps, reports the overflow, and returns the empty
string for no rows; and a bridging test feeds `readRecordedUnjustWars` straight
into `buildWarCasusDigest` and asserts the rendered line, so the producer and
consumer shapes cannot drift apart unnoticed.

The ledger and state tests assert: `unjustAggressors` round-trips through
`normalizeWorldState` and through the war ledger's `normalizeWar`, and survives
an `applyWarUpdates` merge of an unrelated operation (the regression that field
preservation in both normalizers prevents).

A wiring guard in the spirit of `treatyObligationsWiringArchitecture.test.js`
reads the source and asserts the seams by position: the casus read and charge
run after the breach charge and before the obligation read; the directive prints
`treatyBreach` and `warCasus`; the jump path sets `variables.warCasus`.

## Acceptance

The whole suite passes with zero failures, ESLint is clean on the changed files
(the pre-existing `src/Game/Map/*` errors are unrelated), `npm run wiki:check`
reports `Wiki is current.` after the documentation is written, and `npm run
build` succeeds. The new engine module passes the engine purity guard. No
`ENGINE_VERSION` bump and no migration are introduced.

## Open questions

None block implementation. The following are deliberately deferred and recorded
so the plan does not silently decide them.

- The two penalties (`UNJUST_WAR_REPUTATION_PENALTY`,
  `UNJUST_WAR_RELATION_PENALTY`) and `MAX_CASUS_AGGRESSORS` are first-draft
  calibration, expected to be tuned against a few campaigns. The tests assert
  the arithmetic and the bounds, never a magnitude.
- A claim's holder is read from the ownership override or the catalog row the
  caller supplies; a claim on a region neither the override nor the catalog
  attributes to a polity is not a warrant. Holding a region with no recorded
  owner is deferred as a modelling question.
- Whether a reputation cost should also fall on a power that joins an unjust war
  it did not begin is deferred; this increment judges only the initiation.
- Whether the player should be warned before an unjust declaration is a UI
  decision for a later increment; the cost is charged when the war begins.
