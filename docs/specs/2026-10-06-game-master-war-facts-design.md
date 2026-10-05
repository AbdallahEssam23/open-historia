<!-- Open Historia - the engine's war facts reach the Game Master transaction (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# Game Master War Facts: The Engine's Held Wars Reach the GM Transaction

The nineteenth increment of the deterministic simulation, and the one that
closes the last path that writes the war ledger without being told the facts.
The eighteenth increment handed the interactive scene the four standing war
digests. The Game Master transaction path meets the same world with none of
them: it can plan an `end`, `ceasefire` or `leave` for a war the engine holds
open, the preview accepts the record, and the apply stage withholds it. This
increment tells the GM the facts before it plans.

## Why this increment exists

1. **The last un-told path that writes the ledger.** Every route that can
   change `world.wars` is now told the standing facts except one. A time skip
   renders `buildWarLedgerDirective` into its live records; an interactive
   scene is handed `[Standing War Facts]`. The Game Master transaction is the
   only path that mutates the ledger and is told nothing about a war the
   engine is holding. `previewGameMasterCommand`
   (`src/Game/AI/gameplay.js`) builds its variables from
   `buildTemplateVariables(bundle, { taskKey: "gameMaster", ... })` and never
   derives the four digests.

2. **The engine withholds, but only after the administrator has planned
   around it.** `applyWarUpdates` refuses to apply a record that would close a
   held war and reports it in `withheldIds`; `applyGameMasterPreview` logs
   `A held war operation was not applied ...`. Nothing writes the operation, so
   the world stays correct. But the preview the administrator inspected showed
   a transaction that will not be applied as written, and the held record is
   discovered only at Apply. Telling the GM the held war before it plans is
   how the preview stops promising a closure the engine will refuse.

3. **The GM has no retry, so the prompt is the only lever.** `runJsonTask`
   excludes `gameMaster` from the last-chance salvage on purpose: "the GM's
   transaction is left alone: half a transaction is not a smaller
   transaction." A GM answer that names a held war as ended is not corrected
   on a second attempt; the preview accepts it and the withhold happens
   silently. The prompt must carry the fact up front.

4. **The GM contract is native and rebuilt live.** `NATIVE_GAME_MASTER_PROMPT`
   is chosen over any campaign template because "a campaign's frozen
   gameMaster prompt would silently roll the transaction semantics back"
   (`buildTaskSystemPrompt`). A call-time append therefore reaches the live GM
   on every campaign, frozen packs included.

5. **The eighteenth increment recorded this as its own increment.** Its open
   questions state: "Whether the Game Master command path, which does mutate
   the ledger and has no retry, should carry the same block is deferred; that
   path is enforced by `applyWarUpdates` today, and a GM-specific telling is
   its own increment." This is that increment.

## Scope

1. A GM framing in the pure, import-free `src/runtime/warFacts.js`.
   `buildWarFactsDirective(variables, { audience })` returns the same four
   fact lines with a transaction-specific closing instruction for
   `audience: "gameMaster"`, and the existing scene framing by default.
2. `previewGameMasterCommand` sets the four variables with the existing shared
   `buildWarFactsVariables({ world, game })` before
   `runJsonTask("gameMaster", ...)`, so the GM reads the same facts the jump
   and the scene read.
3. `buildTaskSystemPrompt` appends the GM block for `taskKey === "gameMaster"`
   at call time, after the frozen prompts are read.
4. Tests: a unit test for the two framings (`node --test`), source-text guards
   for the `gameplay.js` wiring (which imports `main.jsx` and cannot be
   imported under `node --test`), and a note in `docs/runtime-services.md`.

## Non-goals

- **Not preview-time enforcement.** The GM preview keeps validating through
  `validateCanonicalWarEvents`, which does not read `world.peaceOffer`;
  `applyWarUpdates` remains the single enforcement point. This increment only
  tells the model, exactly as the eighteenth increment chose for the scene.
- **Not the canonical war list.** The GM gets the four digests, not the full
  `world.wars` ledger; the facts are the part it must not contradict or close.
- **Not the interactive or jump paths.** Both are unchanged. The scene keeps
  the scene framing; the jump keeps its `[Wars]` ledger.
- **No stored shape change, no schema change, no `ENGINE_VERSION` bump and no
  migration.** The block is built at call time and stored nowhere.

## Design

### 1. Layers

| Layer | Location | What lives here |
| --- | --- | --- |
| Facts, at rest | `src/runtime/treatyObligations.js`, `treatyBreach.js`, `casusBelli.js`, `peaceOffer.js` | The four digest builders (unchanged) |
| Pure directive | `src/runtime/warFacts.js` | `buildWarFactsDirective(variables, { audience })`, import-free; scene and GM framings over the same fact lines |
| Shared builder | `src/Game/AI/gameplay.js`, `buildWarFactsVariables` | Derives the four digest strings from `{ world, game }` (unchanged, reused) |
| Caller | `src/Game/AI/gameplay.js`, `previewGameMasterCommand` | Sets the four variables before the GM plans |
| Prompt | `src/Game/AI/gameplay.js`, `buildTaskSystemPrompt` | Appends the GM block at call time for `gameMaster` |

### 2. The pure directive and its two framings

`buildWarFactsDirective` keeps its signature and its default output. It gains
an optional audience that selects the closing instruction while the header and
the four fact lines stay identical:

```js
const SCENE_FRAMING = "These are the engine's facts as they stand at the start of this scene. "
  + "Keep the narration consistent with them: do not conclude, close, leave or cease fire a war the engine holds "
  + "for the player's decision, do not deny a standing obligation or a recorded breach, and do not write a war "
  + "as just when the engine has marked it unjust.";

const GAME_MASTER_FRAMING = "These are the engine's facts as they stand before this transaction. "
  + "Keep the event and every warUpdates record consistent with them: do not conclude, close, leave or cease fire "
  + "a war the engine holds for the player's decision; the engine will withhold such a record. Do not deny a standing "
  + "obligation or a recorded breach, and do not write a war as just when the engine has marked it unjust.";
```

- `audience === "gameMaster"` selects `GAME_MASTER_FRAMING`; any other value
  (including the default) selects `SCENE_FRAMING`, so the interactive callers
  that pass no audience render byte-for-byte what they render today.
- Empty stays empty: with all four facts blank the function still returns `""`,
  so a world with no facts adds nothing to either prompt.

### 3. One builder for the facts

`buildWarFactsVariables({ world, game })` already exists from the eighteenth
increment and is reused unchanged. It derives `playerPolity` the same way on
every path (`toCountryName(normalizeString(game?.country))`) and reads
`readTreatyObligations`, `readRecordedBreaches`, `readRecordedUnjustWars` and
`buildPeaceOfferDigest`, so the GM's block is byte-identical to the scene's and
the skip's for the same world.

### 4. Wiring

In `previewGameMasterCommand`, right after the variables are built and before
`runJsonTask("gameMaster", ...)`:

```js
Object.assign(variables, await buildWarFactsVariables({ world: bundle.world, game: bundle.game }));
```

In `buildTaskSystemPrompt`, a second guarded append beside the scene's, so the
scene call literal stays exactly as it is:

```js
if (taskKey === "gameMaster") {
  const warFacts = buildWarFactsDirective(variables, { audience: "gameMaster" });
  if (warFacts) systemPrompt = `${systemPrompt}\n\n${warFacts}`;
}
```

### 5. What stays the same

- The scene append (`interactiveCreation`, `interactiveExecutor`) and its call
  literal are untouched.
- The jump's `buildWarLedgerDirective` and `buildJumpLiveState` are untouched;
  `gameMaster` is not a jump task, so no jump prompt gains the block.
- `validateGameMasterPreviewPayload`, `validateCanonicalWarEvents`,
  `applyWarUpdates` and `applyGameMasterPreview` are untouched.
- Nothing is stored; the block exists only on the live system prompt string.

## Compatibility

The block is appended at call time and stored nowhere, so a save without it
loads unchanged and the next GM preview or interactive turn rebuilds it. A
world with none of the four facts gets an empty string and an unchanged prompt.
No `ENGINE_VERSION` bump, no migration, no new `package.json` entry.

## Testing

- `src/runtime/warFacts.test.js`: the default and `gameMaster` framings differ
  and each carries the record clause; the header and the fixed fact order are
  unchanged; an empty or all-blank input returns `""` for both audiences; the
  scene framing is byte-identical to today's.
- `src/Game/AI/warFactsWiringArchitecture.test.js`: source-text guards that
  `previewGameMasterCommand` calls `buildWarFactsVariables` before
  `runJsonTask("gameMaster"`, that `buildTaskSystemPrompt` appends
  `buildWarFactsDirective(variables, { audience: "gameMaster" })` for
  `taskKey === "gameMaster"`, and that the scene append literal is unchanged.
- The full gate: `npm test`, the engine purity test, eslint on the changed
  files, `npm run wiki:check`, and `npm run build`.

## Open questions

None block implementation. The following are recorded so the plan does not
silently decide them.

- Whether the GM preview should refuse a held record outright (as the turn
  validator does), so the administrator gets a corrective error rather than a
  silently withheld apply, is deferred; this increment tells the model and
  leaves `applyWarUpdates` as the enforcement point, matching the eighteenth
  increment's choice for the scene.
- Whether the GM should also see `withheldIds` from a prior apply, so it knows
  an earlier transaction was trimmed, is deferred; this increment states the
  standing facts, not the history of holds.
- Whether the `actions` suggestion task should carry the block is deferred, as
  the eighteenth increment recorded.
