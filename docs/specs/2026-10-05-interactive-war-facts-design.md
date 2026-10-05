<!-- Open Historia - the engine's war digests reach the interactive scene (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# Interactive War Facts: The Engine's War Digests Reach the Scene

The eighteenth increment of the deterministic simulation, and the one that
closes a gap five specifications recorded in the same words. The engine tells
the model the war facts it must not contradict - the standing treaty
obligations, a recorded breach, the casus verdict and the player's pending
peace - but only on a time skip. A scene played out as an interactive event
runs the same turn (`applySimulationResult`) and narrates the same world, yet
it is told none of them. This increment hands the scene the same facts.

## Why this increment exists

1. **The same turn, two prompts.** An interactive event resolves through
   `applySimulationResult` (`src/Game/AI/gameplay.js`), exactly as a time skip
   does: the engine settles due AI wars and re-derives the player's peace offer
   on that path too. But the four war digests are built only in
   `simulateTimelineJump`, and `buildWarLedgerDirective` is rendered only into
   the jump's live records (`buildJumpLiveState`). The scene's prompts
   (`interactiveCreation`, `interactiveExecutor`) carry the reputation and
   intelligence blocks and even the placement directive, but no war facts at
   all.

2. **Every prior specification deferred exactly this.** The treaty-obligations,
   treaty-breach, casus-belli, operations-digest and engine-facts-digest
   specifications each ended with the same recorded open question: "Whether the
   interactive (non-jump) turn path should build the digest is deferred; this
   increment wires the jump path that already builds the neighbouring digests."
   The interactive-peace specification tied it to the peace offer: "Whether the
   model should be told a peace is pending for the player, so its narration does
   not close a war the engine is holding open, is deferred to the same later
   increment that would surface the standing obligations, the breach digest and
   the casus verdict." This is that increment.

3. **A scene that contradicts the ledger is worse than a skip that does.** The
   scene is the player's closest view of the world: its opening, every beat and
   the summary become the event they read. A scene that narrates the offered war
   as concluded, or denies a breach the world recorded, writes a fact the engine
   will not honor when the scene resolves, because the scene's event carries no
   impacts and cannot change the ledger.

## Scope

1. A pure, import-free directive builder in `src/runtime/warFacts.js` that
   renders the four war digests into one block, and renders nothing when there
   is nothing to say, so no empty header is appended.
2. One shared builder in `src/Game/AI/gameplay.js`
   (`buildWarFactsVariables({ world, game })`) that derives the four digest
   strings from the world, used by `simulateTimelineJump` and by the two
   interactive callers (`createInteractive`, `advanceActiveInteractive`), so the
   same facts are read the same way on every path.
3. `buildTaskSystemPrompt` appends `buildWarFactsDirective(variables)` for
   `interactiveCreation` and `interactiveExecutor`, at call time, so a
   campaign's frozen prompt pack gets it too.
4. Tests: a unit test for the pure directive (`node --test`), and source-text
   guards for the `gameplay.js` wiring, which imports `main.jsx` and cannot be
   imported under `node --test`. A note in `docs/runtime-services.md`.

## Non-goals

- **New engine arithmetic.** `src/engine/**` is untouched. The digests already
  exist (`buildTreatyObligationDigest`, `buildTreatyBreachDigest`,
  `buildWarCasusDigest`, `buildPeaceOfferDigest`); this increment renders them
  somewhere new.
- **A change to the jump prompt.** `buildWarLedgerDirective` and the jump's
  live records keep their exact text. The shared builder is a
  behaviour-preserving extraction of the four digest variables the jump already
  set.
- **The full war ledger on the scene.** The scene writes no `warUpdates`, so it
  is told the four facts, not the canonical war list and not the `warUpdates`
  line format. Keeping the contract out of a prompt that cannot use it avoids
  inviting a record the output schema has no field for.
- **Enforcement in the scene.** The scene's output has no war records, so there
  is nothing to refuse or hold. The held-peace enforcement stays where it is:
  the turn validator and `applyWarUpdates`.
- **The other non-jump paths.** The `actions` suggestion task, the Game Master
  command path and the `interactiveSummary` step are out of scope; the
  interactive summary only compresses the scene and should assert no new fact.
- **A stored shape change, a dependency, or an `ENGINE_VERSION` bump.** None is
  needed; nothing is persisted differently.

## Design

### 1. Layers

The same layers and the same direction of dependency every increment uses.

| Layer | Location | Rule in this increment |
|---|---|---|
| Pure core | `src/engine/` | Untouched. |
| Runtime directive | `src/runtime/warFacts.js` | New, import-free. Renders the four digest strings into one block. |
| Turn wiring | `src/Game/AI/gameplay.js` | One shared digest builder; the interactive prompts receive the block. |
| Docs | `docs/runtime-services.md` | A note that the scene now carries the same war facts as the skip. |

### 2. The pure directive

`src/runtime/warFacts.js` exports one function and imports nothing, so it runs
under `node --test`:

```js
const text = (value) => String(value ?? "").trim();

export const buildWarFactsDirective = ({
  treatyObligations,
  treatyBreach,
  warCasus,
  peaceOffer,
} = {}) => {
  const lines = [treatyObligations, treatyBreach, warCasus, peaceOffer]
    .map(text)
    .filter(Boolean);
  if (!lines.length) return "";
  return [
    "[Standing War Facts]",
    lines.join("\n"),
    "These are the engine's facts as they stand at the start of this scene. Keep the narration consistent with them: do not conclude, close, leave or cease fire a war the engine holds for the player's decision, do not deny a standing obligation or a recorded breach, and do not write a war as just when the engine has marked it unjust.",
  ].join("\n");
};
```

The order is fixed - obligations, breach, casus, peace offer - the same order
`buildWarLedgerDirective` already prints them in for the jump. An all-blank
input returns `""` rather than a lone header, so the caller can append
unconditionally and a world with no war facts adds nothing to the prompt.

### 3. One builder for the facts

`simulateTimelineJump` today sets the four variables inline from
`bundle.world`:

```js
variables.treatyObligations = buildTreatyObligationDigest({
  standing: readTreatyObligations(bundle.world, { playerPolity }).standing,
});
variables.treatyBreach = buildTreatyBreachDigest({
  breaches: readRecordedBreaches(bundle.world),
});
variables.warCasus = buildWarCasusDigest({
  wars: readRecordedUnjustWars(bundle.world),
});
variables.peaceOffer = buildPeaceOfferDigest({ offer: bundle.world?.peaceOffer });
```

That block moves into an async helper beside `buildWarLedgerDirective`:

```js
const buildWarFactsVariables = async ({ world, game } = {}) => {
  const playerPolity = toCountryName(normalizeString(game?.country));
  return {
    treatyObligations: buildTreatyObligationDigest({
      standing: readTreatyObligations(world, { playerPolity }).standing,
    }),
    treatyBreach: buildTreatyBreachDigest({
      breaches: readRecordedBreaches(world),
    }),
    warCasus: buildWarCasusDigest({
      wars: readRecordedUnjustWars(world),
    }),
    peaceOffer: buildPeaceOfferDigest({ offer: world?.peaceOffer }),
  };
};
```

`simulateTimelineJump` calls it and spreads the result onto `variables`, so the
four values are byte-identical to the inline block it replaces. The two
interactive callers call the same helper on their own `bundle`:
`createInteractive` after `readSeenGameStateBundle`, `advanceActiveInteractive`
after `readGameStateBundle`.

### 4. Wiring into the interactive prompts

`buildTaskSystemPrompt` already appends world-derived directives for exactly
these task keys - the reputation and intelligence blocks for
`["actions", "interactiveCreation", "interactiveExecutor"]`, the placement
directive for `interactiveExecutor`. The war facts join them, for the two
interactive tasks only:

```js
if (["interactiveCreation", "interactiveExecutor"].includes(taskKey)) {
  const warFacts = buildWarFactsDirective(variables);
  if (warFacts) systemPrompt = `${systemPrompt}\n\n${warFacts}`;
}
```

Because the append happens at call time, a campaign carrying a frozen
`interactiveCreation` or `interactiveExecutor` template still receives the
current facts, exactly as the frozen jump template does.

### 5. What stays the same

The jump path is unchanged in output. `buildWarLedgerDirective` keeps its
`[Wars]` header, its canonical war list and its `warUpdates` contract; only the
source of the four digest strings moves from an inline block to the shared
helper, and the helper produces the same strings from the same reads.

## Compatibility

- No stored shape changes, no migration, no new dependency, no `ENGINE_VERSION`
  bump.
- The interactive prompts grow one appended block, and only while the world has
  war facts to state; a world with none is byte-identical to before.
- The jump prompt's text is unchanged; the extraction is behaviour-preserving.
- The scene still cannot change the ledger: its resolved event carries empty
  impacts, and the enforcement of the held peace stays on the turn validator
  and `applyWarUpdates`.

## Testing

- `src/runtime/warFacts.test.js`: all-blank input returns `""`; whitespace-only
  input returns `""`; each single fact renders under the header; all four render
  in the fixed order; the framing sentence is present.
- `src/Game/AI/warFactsWiringArchitecture.test.js`: source-text guards that
  `buildWarLedgerDirective` and the interactive append read the same
  `variables` names, that `buildTaskSystemPrompt` appends
  `buildWarFactsDirective(variables)` for both interactive task keys, and that
  `createInteractive` and `advanceActiveInteractive` set the four variables
  through the shared helper.
- The full gate: `npm test`, the engine purity test, eslint on the changed
  files, `npm run wiki:check`, and `npm run build`.

## Open questions

None block implementation. The following are recorded so the plan does not
silently decide them.

- Whether the `actions` suggestion task should also carry the block is
  deferred; it proposes the player's next orders and does not narrate the war.
- Whether the Game Master command path, which does mutate the ledger and has no
  retry, should carry the same block is deferred; that path is enforced by
  `applyWarUpdates` today, and a GM-specific telling is its own increment.
- Whether the scene should also see the canonical war list, rather than the
  four facts alone, is deferred; the lookup functions already expose the war
  ledger, and the facts are the part the model must not contradict.
