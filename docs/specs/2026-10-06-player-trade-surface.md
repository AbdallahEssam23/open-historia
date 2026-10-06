# The player's trade surface

Date: 2026-10-06
Status: approved for implementation

## Problem

The trade field is already derived. `runtime/economyEngine.js` builds it from
`world.relations`/`world.agreements`/`world.wars` on every advance and never
stores it, and the turn tells the *model* who the network favoured and who it cut
off through the pure `describeTradeClimate(trade)` clause on the application
receipt. But the receipt is only read once, by the next jump's prompt. The player
never sees it: it is not rendered in the timeline, and the stats panel shows the
three diplomatic ledgers without the economic shape they add up to.

So the engine computes a real, deterministic effect and the person playing the
game has no surface for it.

## Goals

- Surface the engine's own trade climate to the player, read-only. No new
  mechanic, no new engine rule and no new request: the field and its descriptive
  clause are read exactly as they already exist.
- Store each turn's climate on that turn's `simulationHistory` entry, so the
  timeline can show what the network did in a turn whose world has since moved
  on.
- Show the stored climate as a turn receipt line in the timeline.
- Show a per-polity climate indicator in the stats panel, derived directly from
  `tradeMultipliers` on the current ledgers, with no state of its own.
- Byte-for-byte inert when the network nets to nothing: with no ledgers the
  clause is empty, the history key is omitted, and a save written before this
  increment round-trips unchanged.

## Non-goals

- **No engine change.** `tradeCore.js`, `economyTick.js` and the economy adapter
  are untouched. The field is not stored in `world.economyEngine`; it stays a
  pure function of the ledgers.
- **No historical recompute.** The timeline shows the climate stored on the
  turn; it does not rebuild past fields from today's world.
- **No new state, store or request.** The stats indicator is a `useMemo` over the
  ledgers it already receives.
- **No player action.** The climate is told, not chosen. Nothing here changes what
  the player or the AI can do.

## The stored clause

`applySimulationResult` (`src/Game/AI/gameplay.js`) already computes the clause in
its economy tick:

```
const tradeClimate = economy.months > 0 ? describeTradeClimate(economy.trade) : "";
if (tradeClimate) noteReceipt(receipt, "adjusted", `Trade: ${tradeClimate}.`);
```

The receipt note is kept exactly as it is: the next jump's model still needs to
be told who the network favoured. What is added is the storage. When the clause
is non-empty, the newest `simulationHistory` entry (this turn's) gains a
`tradeClimate` string:

```
{ ...newestEntry, tradeClimate }
```

The key is **omitted when the clause is empty**, matching `strategicMoves`: an
intent-less, ledger-less turn's entry is byte-for-byte what it was.

## The normalizer

`normalizeWorldState` (`src/runtime/gameState.js`) already rebuilds each history
entry field by field. `tradeClimate` is taken out of the spread (so a malformed
save's raw value is dropped, not kept) and re-emitted only when non-empty:

```
const tradeClimate = typeof entry.tradeClimate === "string" ? normalizeOptionalString(entry.tradeClimate) : "";
...
...(tradeClimate ? { tradeClimate } : {}),
```

Absent, non-string and empty all leave no key, so a malformed save is dropped
rather than kept raw, and the polled world file is unchanged for every campaign
the engine found nothing to say about.

## The timeline

`buildTurnRecord` (`src/Game/GameUI/time.jsx`) exposes the stored clause as
`tradeClimate` on the turn record. `TimelineHistoryPanel` renders it once the
events are revealed, as the turn's closing note beside the closing strategic
moves: a small framed line reading the clause verbatim. A turn with no clause
renders nothing.

## The stats indicator

`DiplomacySection` (`src/Game/GameUI/stats.jsx`) already canonicalises the three
ledgers for the selected polity. It now also feeds the canonicalised ledgers to
`tradeMultipliers` and reads the selected polity's index
(`stability / TRADE_STEP.STABILITY_MAX`), showing it as a fourth diplomacy
metric: favoured, cut off, or neutral, with the stability drift as the value. The
table is a `useMemo` over the same ledgers; nothing new is stored.

## Equivalence

- Empty or absent ledgers: `tradeMultipliers` returns `{}`, `describeTradeClimate`
  returns `""`, no receipt note is added, no history key is written, the timeline
  note and the stats delta stay hidden. Every existing test that pins the inert
  month step is untouched.
- A turn whose clause is non-empty gains exactly one string field; nothing else
  about the entry, the receipt, the world or the events changes.

## Tests

- `runtime/economyWiringArchitecture.test.js` gains assertions that the turn
  stores the clause on the newest history entry and that `gameState.js` omits the
  key when empty.
- A `normalizeWorldState` round-trip pins that a stored `tradeClimate` survives
  and that an absent one leaves no key.
- The existing trade-core, economy-tick and `describeTradeClimate` tests are
  unchanged and must still pass.
