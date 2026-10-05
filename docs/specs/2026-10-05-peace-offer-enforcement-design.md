<!-- Open Historia - enforcing the held peace the engine offered the player (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# Held Peace Enforcement: The Engine Refuses What Would Close the Offered War

The seventeenth increment of the deterministic simulation, and the one that
turns a warning into a rule. The fifteenth increment made the engine hold a due
settlement of the player's own war as `world.peaceOffer` until the player
decides; the sixteenth handed the model that fact as a war-ledger digest. Both
stopped at telling. This increment makes the engine refuse the one thing the
offer cannot survive: a war record that closes, leaves or ceases fire the held
war before the player has answered.

## Why this increment exists

1. **The warning is prose and nothing backs it.** `buildPeaceOfferDigest`
   (`src/runtime/peaceOffer.js`) ends with "do not close, leave or cease fire
   the war until the player accepts or declines." That line rides in the
   war-ledger directive. A model that ignores it can still write
   `warId~end~...`, `warId~ceasefire~...` or `warId~leave~...`, and
   `applyWarUpdates` (`src/Game/AI/nativeWarLedger.js`) applies it without
   consulting the offer. The save then says the war is over while the engine
   said the settlement was waiting on the player.

2. **The contradiction is exactly what the last two increments tried to
   remove.** The interactive-peace specification deferred "whether the model
   should be told a peace is pending"; the engine-facts-digest specification
   delivered the telling and deferred "whether the engine should enforce the
   pending peace by refusing a model `warUpdates` record that closes the
   player's war mid-offer, rather than only warning the model in prose." This
   is that increment.

3. **Two doors need two different mechanisms.** The turn path calls a
   world-aware validator while a corrective retry still exists, so the cheapest
   fix is to send the model back and let it rewrite the narrative to match the
   mechanics. Every other path that reaches the ledger - the administrator's
   Game Master apply and the per-segment ledger advance - has no retry and no
   model to correct, so they need the ledger itself to hold the record. One
   increment, enforced at both doors.

## Scope

1. A pure, import-free predicate in `src/runtime/peaceOffer.js` that answers
   whether one war record would close the held war, plus the closed set of
   operations it recognises.
2. `validateWarLedgerPayload` (`src/Game/AI/nativeWarLedger.js`) refuses a
   conflicting record while the world holds an offer, so the model's corrective
   retry rewrites its prose. The existing salvage
   (`repairWarLedgerPayload`) drops the record on the final attempt, because it
   makes the batch valid again exactly as it does for a binding failure.
3. `applyWarUpdates` withholds a conflicting record, leaves the war open, and
   reports the ids it held in a new `withheldIds` array that is separate from
   `appliedIds`.
4. The turn notes each withheld war on its receipt and logs it; the Game Master
   apply integrity check counts withheld ids alongside applied ones, so a held
   operation is reported rather than thrown as a failed apply.
5. Tests for the predicate, the refusal, the hold and the two wirings - a
   behaviour test where the module can be imported, and a source-text guard for
   `gameplay.js`, which imports `main.jsx` and cannot be. A note in
   `docs/runtime-services.md`.

## Non-goals

- **New engine arithmetic.** `src/engine/**` is untouched. This increment
  reads state that already exists; it derives nothing.
- **A veto on every war operation.** Only the operations that close the held
  war are held: `end`, `ceasefire` and `leave`. `join-a`, `join-b`, `resume`
  and `goals` stay allowed; a goal declaration does not end the war, and the
  stored offer already carries the terms the engine derived.
- **Enforcement over AI wars.** A war with no pending offer is untouched. The
  engine still settles every AI war on its own through `warUpdates`.
- **A player-authored or countered offer, and weariness decay.** Those remain
  deferred, exactly as the interactive-peace specification recorded them.
- **A stored shape change or a migration.** `world.peaceOffer` already exists
  and `normalizeWorldState` already round-trips it (verified: a normalized
  world keeps it). `withheldIds` is a function return value, never persisted.
  No `ENGINE_VERSION` bump.
- **Enforcement in the pre-game bootstrap.** A pre-game world carries no
  offer, so the hold never fires there and the bootstrap's own count check is
  unchanged.

## Design

### 1. Layers

The same three layers and the same direction of dependency every increment
uses.

| Layer | Location | Rule in this increment |
|---|---|---|
| Pure core | `src/engine/` | Untouched. |
| Runtime predicate | `src/runtime/peaceOffer.js` | Stays import-free. Gains the conflict predicate and the held-operation set. |
| Ledger | `src/Game/AI/nativeWarLedger.js` | The validator refuses; the apply withholds and reports. |
| Turn and GM wiring | `src/Game/AI/gameplay.js` | The turn receipts and logs the hold; the GM apply counts it as reported, not failed. |
| Docs | `docs/runtime-services.md` | A note on the two doors and the held set. |

### 2. The conflict predicate

`src/runtime/peaceOffer.js` gains:

```js
export const PEACE_OFFER_HELD_OPS = Object.freeze(["end", "ceasefire", "leave"]);

// True when this war record would close, leave or cease fire the war the
// engine is holding open for the player's decision.
export const peaceOfferHoldsWarUpdate = ({ update, offer } = {}) => {
  const pending = normalizePeaceOffer(offer);
  if (!pending) return false;
  const warId = String(update?.id ?? "").trim();
  if (!warId || warId !== pending.warId) return false;
  return PEACE_OFFER_HELD_OPS.includes(String(update?.op ?? "").trim().toLowerCase());
};
```

The module stays import-free, so the predicate is tested under `node --test`
with no browser and no AI. `normalizePeaceOffer` already lowercases nothing it
must not: it trims the war id and the operation is lowercased here, so the
comparison matches the ledger's own normalisation (`applyUpdateToWarMap` lower
cases `op` and trims `id`).

### 3. The validator refuses, so the model rewrites its prose

`validateWarLedgerPayload(candidate, { world })` today returns the binding
verdict from `validateBoundWarBatch`. It gains one step after that verdict
passes:

```js
const bound = validateBoundWarBatch({ events, updates, world, requireUpdateLinks: true });
if (bound) return bound;
const pendingOffer = world?.peaceOffer;
for (const update of updates) {
  if (peaceOfferHoldsWarUpdate({ update, offer: pendingOffer })) {
    return `War ${update.id} is held open by a pending peace offer; the engine will not apply a ${update.op} record. `
      + "The war stays active until the player accepts or declines. Narrate the war as unresolved: keep it open and write no end, ceasefire or leave record for it.";
  }
}
return "";
```

Ordering is deliberate: a malformed or unbound record still reports its
binding error first, because that is the defect the model most needs named. The
held-war message is only reached once the batch is otherwise valid.

Two properties make this the right home:

1. `validateWarLedgerPayload` is imported only by the turn's
   `validateSegmentLedgers` and by `repairWarLedgerPayload`. The Game Master
   preview validates through `validateCanonicalWarEvents` ->
   `validateBoundWarBatch` and never through this function, so the
   administrator is not blocked from authoring the operation at preview; the
   apply-time hold below is what catches it.
2. `repairWarLedgerPayload` already makes the batch valid by dropping one
   record at a time (`trial`), so a record held by the offer is dropped on the
   final attempt with no new salvage code. The war stays open.

In the turn, this returns the message as the segment's `ledgerError`;
`validateSegmentLedgers` runs it strict while a retry remains, so the model is
told the war is held and rewrites the narrative. On the final attempt the
salvage drops the record and the event stands as history, which is the same
outcome the apply-time hold would reach, arrived at one door earlier.

### 4. The apply holds, so any path without a retry still cannot close it

`applyWarUpdates` reads the offer from the world it is already normalising:

```js
const heldWarId = normalizePeaceOffer(nextWorld.peaceOffer)?.warId || "";
const appliedIds = [];
const withheldIds = [];

for (const update of decoded) {
  if (heldWarId && peaceOfferHoldsWarUpdate({ update, offer: nextWorld.peaceOffer })) {
    withheldIds.push(update.id);
    continue;
  }
  const linkedEvents = linkedEventsForUpdate(update, events);
  const date = firstLinkedDate(update, events) || sortDate(stopDate);
  const result = applyUpdateToWarMap({ map, update, date, round, linkedEvents, resolveRegion });
  if (result.error) {
    console.warn(`[OH war ledger] dropped invalid ${update.op} for ${update.id}: ${result.error}`);
    continue;
  }
  appliedIds.push(update.id);
}
```

The record is withheld, not counted as invalid: it is well formed and the
engine is choosing not to apply it. Because the map is never touched, the war
keeps its status. The return grows one field, `withheldIds`:

```js
return { world: { ...nextWorld, wars }, wars, appliedIds, withheldIds };
```

`withheldIds` is additive, so every existing caller that reads `appliedIds`
alone is unchanged. `normalizeWorldState` preserves `peaceOffer` (asserted in
the tests), so the hold is live in the turn, in `advanceLedgerWorld`'s
per-segment merge, and in the Game Master apply, which all pass a world
carrying the offer.

### 5. The two callers that must not misread the hold

The Game Master apply (`gameplay.js`) asserts that every war record landed and
throws otherwise:

```js
if (warMerge.appliedIds.length !== warUpdatesForApply.length) {
  throw new Error("A canonical war operation failed during the in-memory apply. Nothing was persisted; regenerate the preview.");
}
```

It becomes a check that every record either landed or was deliberately held:

```js
if (warMerge.appliedIds.length + warMerge.withheldIds.length !== warUpdatesForApply.length) {
  throw new Error("A canonical war operation failed during the in-memory apply. Nothing was persisted; regenerate the preview.");
}
if (warMerge.withheldIds.length) {
  logDebugEvent("turn", `A held war operation was not applied: ${warMerge.withheldIds.join(", ")} awaits the player's peace decision.`);
}
```

The administrator's turn is reported as successful with the hold named, not
thrown: the operation was intentionally not applied, which is the point of the
safety net.

The turn (`applySimulationResult`, after `warMerge`) adds a receipt line and a
log for each withheld id, so a hold is visible to the player's turn record:

```js
for (const warId of normalizeArray(warMerge.withheldIds)) {
  if (receipt) {
    noteReceipt(receipt, "withheld", `The war ${warId} is held open by the player's pending peace offer; the engine did not apply the record that would close it.`);
  }
}
if (warMerge.withheldIds.length) {
  logDebugEvent("turn", `Held war operations awaiting the player's peace decision: ${warMerge.withheldIds.join(", ")}.`);
}
```

The pre-game bootstrap and its probe are untouched: a pre-game world carries no
offer, so `withheldIds` is empty and their `appliedIds.length` comparison still
holds.

### 6. Data flow

1. A turn starts on a world whose `peaceOffer` was stored at the end of the
   previous turn and re-derived this turn's directive from the same field.
2. The model returns war records. The turn's strict validator refuses any that
   would close the held war, and the model retries with the war left open.
3. On the final attempt, the salvage drops a still-conflicting record.
4. When the turn applies the surviving records, `applyWarUpdates` withholds any
   conflict that reached it anyway, so the war is active in the committed world.
5. A Game Master apply reaches `applyWarUpdates` without the turn validator;
   the ledger holds the record, the id is reported, and the apply does not
   throw.
6. The offer is re-derived next turn exactly as before; a declined offer simply
   clears and the war stays open.

## Compatibility

- No stored shape changes. `world.peaceOffer` already round-trips through
  `normalizeWorldState`; `withheldIds` is never persisted.
- `applyWarUpdates`'s return is additive; existing destructuring is unaffected.
- The validator change reaches the model only, as a corrective retry; that
  behavioural change is the increment's purpose and is covered by tests.
- No new dependency, no `ENGINE_VERSION` bump, no migration.

## Testing

- `src/runtime/peaceOffer.test.js`: the predicate's truth table - held on
  `end`/`ceasefire`/`leave` for the offered war; not held for another war, for
  `join-a`/`join-b`/`resume`/`goals`, for a blank op, or when there is no
  offer.
- `src/Game/AI/warLedger.test.js`: the validator refuses each held op and
  allows the rest; `applyWarUpdates` splits `appliedIds` from `withheldIds` and
  leaves the held war active; a second war in the same batch still applies.
- `src/Game/AI/peaceOfferWiringArchitecture.test.js`: source-text guards that
  the validator reads `world.peaceOffer`, that `applyWarUpdates` returns
  `withheldIds`, that the turn receipts it, and that the Game Master count
  includes `withheldIds`.
- The full gate: `npm test`, the engine purity test, eslint on the changed
  files, `npm run wiki:check` (unchanged), and `npm run build`.

## Open questions

None block implementation. The following are recorded so the plan does not
silently decide them.

- Whether a held operation should also be surfaced in the UI as a notice,
  rather than only in the turn receipt, is deferred; the receipt is where every
  other engine adjustment already appears.
- Whether `resume` should also be held (it reopens a ceasefire on a war whose
  settlement is due) is deferred; this increment holds only the operations the
  digest already names, `end`, `ceasefire` and `leave`.
