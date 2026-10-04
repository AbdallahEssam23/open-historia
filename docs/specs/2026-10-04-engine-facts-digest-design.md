<!-- Open Historia - the engine facts the model narrates from (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# Engine Facts for the Model: The Standing Ledger the Model Cannot See

The sixteenth increment of the deterministic simulation, and the one that hands
the model the facts the engine already knows and the narration needs. The
eleventh through fifteenth increments each built a deterministic layer and each
closed by deferring the same question: how does the model learn what the engine
decided, so its prose does not contradict it. This increment answers that
question for the facts that exist today, and does it without adding a single
mechanic.

## Why this increment exists

1. **The engine holds facts the model cannot see.** Every turn the model writes
   the chronicle, yet it is blind to three things the engine is enforcing at the
   same moment: which polities a standing treaty drags into a war, which
   agreements have already been recorded as breached, and which wars were begun
   without a just cause. The digests that state these facts already exist
   (`buildTreatyObligationDigest`, `buildTreatyBreachDigest`, `buildWarCasusDigest`)
   and are already placed in the war-ledger directive, so the missing piece is
   not the fact but its delivery.

2. **The delivery is gated behind a fact it does not depend on.** In
   `simulateTimelineJump` the three legal digests are built inside
   `if (projected.months > 0)`. That gate exists because the *economic* digests
   need a projected month, but the legal digests need only the world as it
   stands. A time skip short of thirty days therefore steps the world and
   narrates it with no treaty, breach or casus facts at all, even though a week
   can see an ally drawn into a war it did not declare.

3. **The pending peace is not surfaced at all.** The fifteenth increment made
   the engine hold a due settlement of the player's own war as
   `world.peaceOffer` until the player decides. The model is told nothing about
   it, so on the next skip it may narrate the war as concluded, or close it with
   a `warUpdates` record, while the engine is still holding the offer open. Its
   own prose then contradicts the save.

4. **Every prior specification deferred exactly this.** The treaty-obligations
   and treaty-breach specifications deferred "whether the model should be told"
   and the interactive-peace specification deferred "whether the model should be
   told a peace is pending ... to the same later increment that would surface
   the standing obligations, the breach digest and the casus verdict." This is
   that increment.

## Scope

This increment gives the model four facts it was missing, and makes the three
that already existed arrive on every skip rather than only on long ones.

1. A new `buildPeaceOfferDigest({ offer })` in `src/runtime/peaceOffer.js`
   renders the pending offer as one bounded block, or the empty string when
   there is no offer.
2. `buildWarLedgerDirective` appends that block beside the obligation, breach
   and casus digests it already carries.
3. The three legal digests and the new peace block are moved out of the
   `projected.months > 0` gate and above the economy projection, so they are
   built from the world as it stands on every jump, including a sub-month one.
4. Tests for the new builder and a source-text guard pinning the new turn order,
   plus a note in `docs/runtime-services.md`.

## Non-goals

- **Engine enforcement over the model.** This increment shows the model the
  pending peace; it does not add a mechanism that refuses or rewrites a
  `warUpdates` record the model writes during the same turn. The war ledger
  already refuses an operation that would re-end an ended war; the offer line is
  a fact, not a new veto, and any enforcement is a separate decision.
- **The interactive (non-jump) turn path.** The war-ledger directive with these
  digests is built only for the jump templates. Whether the non-jump turn path
  should build the same digests is deferred, exactly as the treaty-obligations
  specification deferred it; this increment fixes the gate and the offer line
  within the jump path.
- **Rejected or deferred obligations as digest rows.** Whether the digest should
  show what the engine refused or postponed is the separate deferred question of
  the obligations increment; this increment shows what the world holds.
- **New core arithmetic.** `src/engine/` is untouched. The digests read the
  world; they derive no new state.
- **A stored negotiation state or a migration.** The pending offer already lives
  on `world.peaceOffer`; this increment reads it, it does not move it. No
  `ENGINE_VERSION` bump and no migration are introduced.

## Design

### 1. Layers

The same three layers and the same direction of dependency the earlier
increments established.

| Layer | Location | Rule in this increment |
|---|---|---|
| Pure core | `src/engine/` | Untouched. |
| Runtime digests | `src/runtime/treatyObligations.js`, `src/runtime/casusBelli.js`, `src/runtime/peaceOffer.js` | The four builders stay pure text functions of stored rows; the three existing ones are unchanged, the new one is added to the import-free peace module. |
| Model-facing | `src/Game/AI/gameplay.js` | Builds the digests from the world as it stands, outside the projection gate, and appends the peace block in the war-ledger directive. |
| Docs | `docs/runtime-services.md` | A note on the peace block and the delivery rule. |

`src/runtime/peaceOffer.js` still imports nothing, so the new builder is testable
under `node --test` with no browser and no AI, exactly as the chooser is.

### 2. The gate that hid half the turns

Today the block reads, in `simulateTimelineJump`:

```
const projected = advanceWorldEconomy(...);
variables.economyDigest = buildEconomyDigest({...});
if (projected.months > 0) {
  variables.forcePoolsDigest = buildEconomyDigest({...});
  variables.operationsDigest = buildOperationsDigest({...});
  variables.treatyObligations = buildTreatyObligationDigest({...});
  variables.treatyBreach = buildTreatyBreachDigest({...});
  variables.warCasus = buildWarCasusDigest({...});
  variables.productionDigest = buildEconomyDigest({...});
}
```

The three legal digests move directly above the economy projection, and the
peace block joins them there. They keep the `playerPolity` they already use and
read `bundle.world` unchanged.

The economic digests stay where they are. Their absence on a zero-month skip is
correct: there is no projected month to state, and a pool, operations or
production line for a period that did not advance would be a fiction. The
distinction is the point of the increment: a fact about the world as it stands
is always available, and only a fact about a projected month is not.

The moved calls stay inside the existing `try`, which already turns any failure
into a warning and lets the turn continue without the digest. Being above
`advanceWorldEconomy` also means a projection that throws does not take the
legal facts down with it, because they are built before it runs.

### 3. The pending peace digest

`buildPeaceOfferDigest({ offer })` mirrors the house digest shape:

```
[Peace Offer Pending, as simulated]
- <warId> is settled on the engine's terms and awaits the player's decision; do not narrate it as concluded, and do not close, leave or cease fire the war until the player accepts or declines.
```

- `normalizePeaceOffer(offer)` first, so a corrupt or partial value renders
  nothing rather than a half fact.
- `null` or no `warId` returns the empty string, so the war-ledger directive's
  existing conditional-append style adds nothing when there is no offer.
- There is no row cap and no overflow line: at most one offer can be pending, so
  the block is one header and one line. A char cap large enough for one line is
  unnecessary; the line is short and fixed.

The wording exists for one reason: the model must not close a war the engine is
holding open. It names the war id so the model can match it to the ledger, and
it states the one prohibition the save enforces by holding the offer.

### 4. Wiring

In `buildWarLedgerDirective` the peace block is appended the way the other three
are, each present only when non-empty:

```
${canonicalWarContext || "No wars are recorded."}${treatyObligations ? `\n${treatyObligations}` : ""}${treatyBreach ? `\n${treatyBreach}` : ""}${warCasus ? `\n${warCasus}` : ""}${peaceOffer ? `\n${peaceOffer}` : ""}
```

`simulateTimelineJump` sets `variables.peaceOffer = buildPeaceOfferDigest({ offer: bundle.world?.peaceOffer })`
in the same block as the legal digests, before the projection.

## Testing

1. `src/runtime/peaceOffer.test.js` gains the builder's cases: `null`, a
   non-object and a value with no `warId` each return `""`; a normalized offer
   returns a block that names its `warId` and carries the do-not-close
   instruction; the chooser's existing cases are unchanged.
2. `src/Game/AI/peaceOfferWiringArchitecture.test.js` gains source-text
   assertions that pin the new turn order in `gameplay.js`: the
   `variables.warCasus = buildWarCasusDigest` and
   `variables.peaceOffer = buildPeaceOfferDigest` assignments both appear before
   the `if (projected.months > 0)` gate. This is the same source-reading guard
   the peace wiring already uses, because `gameplay.js` imports `main.jsx` and
   cannot be imported under `node --test`.
3. The existing obligation, breach and casus builder tests are unchanged; this
   increment does not alter their arithmetic or their text.

## Compatibility

The new turn order is additive: on a long skip the same digests are built, just
earlier; on a short skip the three legal digests and the peace block appear for
the first time. No stored shape changes, no `ENGINE_VERSION` bump and no
migration are introduced.

## Open questions

None block implementation. The following are deliberately deferred and recorded
so the plan does not silently decide them.

- Whether the engine should enforce the pending peace by refusing a model
  `warUpdates` record that closes the player's war mid-offer, rather than only
  warning the model in prose, is deferred; this increment states the fact.
- Whether the non-jump interactive turn path should build the same war-ledger
  digests is deferred, as the treaty-obligations increment deferred it.
- Whether the pending peace should also appear outside the war ledger (for
  example in a turn receipt) is deferred; the war ledger is where every other
  war fact already lives.
