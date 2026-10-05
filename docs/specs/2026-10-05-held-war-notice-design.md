<!-- Open Historia - show the player the war the engine held (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# Held War Notice: Showing the Player the Record the Engine Refused

The twentieth increment of the deterministic simulation, and the first that
shows the player, rather than the model, what the engine did with a war record.
Seventeen increments hold a war open when the player has a pending peace offer,
and the turn's application receipt says so - but the receipt is read by the
model, never by the player. This increment turns the hold into a short notice
the player sees as the turn lands.

## Why this increment exists

1. **The hold is invisible to the player.** When the model writes a record that
   would close, leave or cease fire the player's offered war, the turn
   validator refuses it and `applyWarUpdates` withholds it, reporting the ids in
   `withheldIds`. The turn notes the hold on its application receipt
   (`gameplay.js`, `noteReceipt(receipt, "withheld", ...)`) and in the debug
   log - both written for the model or a developer. Nothing in
   `src/Game/GameUI` reads a receipt note today, so the player sees only that
   the war is still on the map and a peace offer is up, with no word of why.

2. **The seventeenth increment recorded this as deferred work.** The
   peace-offer-enforcement specification ended: "Whether a held operation should
   also be surfaced in the UI as a notice, rather than only in the turn receipt,
   is deferred; the receipt is where every other engine adjustment already
   appears." This is that increment.

3. **The data is per-turn, so the notice should be per-turn.** `withheldIds` is
   produced on the turn merge and never persisted; only `world.peaceOffer` (and
   the newest receipt's notes) survive. A durable banner would have to be fed by
   new persisted state for a fact that is transient by construction. A transient
   toast fired from the turn that withheld the record matches the data's life
   exactly, and follows the house pattern of `ai:fallback-switch`.

4. **The player already has the decision surface.** `PeaceOfferPanel`
   (`src/Game/GameUI/peaceOffer.jsx`) appears whenever `world.peaceOffer` is
   set, which is precisely the condition under which a hold can happen. The
   notice explains the panel; it does not replace it.

## Scope

1. A pure, import-free `src/runtime/warHoldNotice.js` exporting the event name
   `WAR_HELD_EVENT` and `buildWarHoldNotice({ warIds })`, which renders a short
   player-facing sentence for one or more held war ids and `""` for none.
2. An emitter in `applySimulationResult` (`src/Game/AI/gameplay.js`) that, when
   `warMerge.withheldIds` is non-empty, dispatches a `CustomEvent` carrying the
   message and the ids, beside the receipt note and the debug log it already
   writes.
3. A transient toast `src/Game/GameUI/warHoldNotice.jsx` that listens for that
   event and shows the message, auto-dismissing, deduped while visible, and
   dismissible - mounted in `src/Game/GameUI/main.jsx` beside
   `FallbackSwitchNotice`.
4. Tests: a unit test for the pure formatter (`node --test`), and a source-text
   architecture guard for the `gameplay.js` and UI wiring (neither
   `gameplay.js` nor the `.jsx` component can be imported under `node --test`).
   A note in `docs/runtime-services.md`.

## Non-goals

- **Not persisted, and not reload-proof.** A notice is lost if the page reloads
  before it is read; that is intended. The pending offer, which is the durable
  fact, stays on `world.peaceOffer` and its panel.
- **Not the Game Master apply path.** `applyGameMasterPreview` also withholds a
  held record and logs it; it is an administrator console action, not a player
  turn, and firing the same player toast from it is deferred.
- **Not the timeline or the receipt.** The application receipt keeps its
  model-facing `withheld` note unchanged, and the timeline record is not
  touched; the notice is a separate, transient surface.
- **No new stored shape, no schema change, no `ENGINE_VERSION` bump and no
  migration.** Nothing new is written to a save.

## Design

### 1. Layers

| Layer | Location | What lives here |
| --- | --- | --- |
| The hold | `src/Game/AI/nativeWarLedger.js` `applyWarUpdates` | returns `withheldIds` (unchanged) |
| The message | `src/runtime/warHoldNotice.js` | `WAR_HELD_EVENT`, `buildWarHoldNotice({ warIds })`, import-free |
| The emitter | `src/Game/AI/gameplay.js` `applySimulationResult` | dispatches `WAR_HELD_EVENT` when a hold happened (unchanged hold) |
| The view | `src/Game/GameUI/warHoldNotice.jsx` | transient toast listening for the event |
| The host | `src/Game/GameUI/main.jsx` | mounts the toast beside `FallbackSwitchNotice` |

### 2. The pure formatter and the event name

```js
export const WAR_HELD_EVENT = "oh:war-held";

export const buildWarHoldNotice = ({ warIds = [] } = {}) => {
  const ids = (Array.isArray(warIds) ? warIds : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (!ids.length) return "";
  const list = ids.join(", ");
  if (ids.length === 1) {
    return `The war ${list} stays open: the engine is holding back a record that would close it until you decide the pending peace offer.`;
  }
  return `The wars ${list} stay open: the engine is holding back records that would close them until you decide the pending peace offers.`;
};
```

- Blank and non-string ids are trimmed away by the emptiness filter, so an
  empty or malformed list renders nothing.
- The module imports nothing, so it runs under `node --test` and can never pull
  a `Game/AI` module into the runtime layer.
- The event name is exported so the emitter and the listener cannot drift.

### 3. The emitter

In `applySimulationResult`, inside the existing non-empty guard that writes the
debug log for a hold, dispatch the notice (browser-guarded, like the turn's own
`oh:turn-complete`):

```js
  if (normalizeArray(warMerge.withheldIds).length) {
    logDebugEvent("turn", `Held war operations awaiting the player's peace decision: ${normalizeArray(warMerge.withheldIds).join(", ")}.`);
    const heldWarIds = normalizeArray(warMerge.withheldIds);
    const message = buildWarHoldNotice({ warIds: heldWarIds });
    if (message && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(WAR_HELD_EVENT, { detail: { message, warIds: heldWarIds } }));
    }
  }
```

This runs once per turn, on the single turn path every turn type shares, so a
time skip and an interactive scene both announce a hold. The receipt note and
the debug log are unchanged.

### 4. The view

`src/Game/GameUI/warHoldNotice.jsx` follows `fallbackSwitchNotice.jsx`: a small
`useEffect` listener for `WAR_HELD_EVENT`, state holding at most three notices,
a `SHOW_MS` auto-dismiss timer, and a dismiss button. It rebuilds the notice
from the event's `message` (and may carry the ids for a future link), deduping
identical messages while one is visible so a repeated hold says it once per
showing. It renders nothing when there is no notice. It uses the peace offer's
amber accent so the two surfaces read as one story. Its icon and every added
character are ASCII.

It is mounted statically in `main.jsx` beside `<FallbackSwitchNotice />`; the
component is tiny and needs no lazy chunk.

### 5. What stays the same

- `applyWarUpdates` still withholds and reports `withheldIds`; nothing about the
  hold changes.
- The turn receipt keeps its `withheld` note and the debug log its line.
- `PeaceOfferPanel`, `world.peaceOffer` and `keepHeldPeaceOffer` are untouched.
- The jump's and the Game Master's prompts and blocks are untouched.
- A turn that withholds nothing dispatches nothing and shows nothing.

## Compatibility

The notice is created at turn end and stored nowhere, so a save without it
loads unchanged and no migration is needed. In a non-browser context the
dispatch is skipped and the pure formatter still returns its string. No
`ENGINE_VERSION` bump, no new dependency, no new stored field.

## Testing

- `src/runtime/warHoldNotice.test.js`: `""` for no ids, blank ids and a
  non-array; the single and plural sentences; trimming; the event name is the
  exact string `oh:war-held`; only ASCII.
- `src/Game/GameUI/warHoldNoticeArchitecture.test.js`: source-text guards that
  `gameplay.js` imports and calls `buildWarHoldNotice` and dispatches
  `WAR_HELD_EVENT` exactly once, inside `applySimulationResult` before the
  peace offer is kept; that `main.jsx` imports and renders `WarHoldNotice`; and
  that the component registers and removes a `WAR_HELD_EVENT` listener and
  auto-dismisses. The guard must fail if the dispatch is removed.
- The full gate: `npm test`, the engine purity test, eslint on the changed
  files, `npm run wiki:check`, and `npm run build`.

## Open questions

None block implementation. The following are recorded so the plan does not
silently decide them.

- Whether the notice should offer a button that opens the peace offer (and
  thereby the panel) rather than only stating the fact is deferred; this
  increment states it.
- Whether the Game Master apply should fire the same notice, so an administrator
  who withheld a record sees it without reading the console log, is deferred.
- Whether a hold repeated across several turns should re-announce each turn or
  only once until the offer is answered is deferred; this increment announces on
  every turn that actually withheld a record, which is the fact that changed.
