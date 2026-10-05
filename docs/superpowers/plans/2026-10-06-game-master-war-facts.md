# Game Master War Facts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Game Master transaction prompt (`taskKey === "gameMaster"`) the same four engine war facts a time skip and an interactive scene already carry, so the GM does not plan a `end`/`ceasefire`/`leave` record for a war the engine is holding open via `world.peaceOffer`.

**Architecture:** `src/runtime/warFacts.js` (pure, import-free) gains an `audience` option so the same four fact lines render with a transaction-specific closing instruction for the GM, and the existing scene framing by default. `previewGameMasterCommand` in `src/Game/AI/gameplay.js` sets the four variables with the existing shared `buildWarFactsVariables`, and `buildTaskSystemPrompt` appends the GM block at call time for `taskKey === "gameMaster"`.

**Tech Stack:** Node.js ESM, `node --test`, React 18 (JSX) for the existing UI, Vite for the build.

## Global Constraints

- Pure core `src/engine/**` is untouched this increment.
- `src/runtime/**` must never import a `src/Game/AI/**` module. The reverse
  import (Game/AI reading a runtime helper) is allowed.
- Only ASCII in every added line. No emoji, no em dash, no middle dot.
- No new dependency in `package.json`. No `ENGINE_VERSION` bump. No migration.
- Every commit is conventional and carries the trailer
  `Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>`. The
  `prepare-commit-msg` hook appends it: never pass it with `-m`.
- Tests run with globs, never a directory: `node --test "src/runtime/*.test.js"`,
  `node --test "src/Game/AI/*.test.js"`, `node --test "src/engine/*.test.js"`.
- Do not weaken an existing test to pass.
- `src/Game/AI/gameplay.js` imports `./main.jsx`, so it is never imported by a
  `node --test` file. Its wiring is pinned by a source-text architecture test
  plus `node --check`.
- The scene append (`interactiveCreation`, `interactiveExecutor`) and its
  literal `buildWarFactsDirective(variables)` must stay exactly as they are; the
  GM gets its own block beside it.

---

### Task 1: The GM framing in the pure directive

**Files:**
- Modify: `src/runtime/warFacts.js`
- Modify: `src/runtime/warFacts.test.js`

**Interfaces:**
- Consumes: nothing; the module still imports nothing.
- Produces: `buildWarFactsDirective(variables, { audience })`. The default
  (`"scene"`) output is byte-for-byte what it renders today; `"gameMaster"`
  renders the same header and fact lines with a transaction-specific closing
  instruction. An empty or all-blank input returns `""` for every audience.

- [ ] **Step 1: Extend the failing test**

Append to `src/runtime/warFacts.test.js`:

```js
test("the game master framing names the record the engine withholds", () => {
  const block = buildWarFactsDirective({ peaceOffer: "OFFER" }, { audience: "gameMaster" });
  assert.match(block, /^\[Standing War Facts\]\n/);
  assert.match(block, /before this transaction/);
  assert.match(block, /the engine will withhold such a record/);
  assert.match(block, /do not conclude, close, leave or cease fire/);
});

test("the default framing is the scene's, unchanged", () => {
  const withDefault = buildWarFactsDirective({ peaceOffer: "OFFER" });
  assert.equal(withDefault, buildWarFactsDirective({ peaceOffer: "OFFER" }, { audience: "scene" }));
  assert.match(withDefault, /at the start of this scene/);
  assert.doesNotMatch(withDefault, /before this transaction/);
});

test("no facts is no block for either audience", () => {
  assert.equal(buildWarFactsDirective({}, { audience: "gameMaster" }), "");
  assert.equal(buildWarFactsDirective({ treatyBreach: "  ", warCasus: "" }, { audience: "gameMaster" }), "");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/runtime/warFacts.test.js"`
Expected: FAIL on the `gameMaster` framing test (`"before this transaction"` is
absent; the second argument is currently ignored). The `default framing`
test passes already, because the single-argument function returns the scene
framing it asserts; the four-fact order tests still pass.

- [ ] **Step 3: Add the audience to the directive**

Replace the body of `src/runtime/warFacts.js` below the header comment with the
scene framing as a named constant, the GM framing, and a single renderer. Keep
`text` and the export name:

```js
const text = (value) => String(value ?? "").trim();

const SCENE_FRAMING = "These are the engine's facts as they stand at the start of this scene. "
  + "Keep the narration consistent with them: do not conclude, close, leave or cease fire a war the engine holds "
  + "for the player's decision, do not deny a standing obligation or a recorded breach, and do not write a war "
  + "as just when the engine has marked it unjust.";

const GAME_MASTER_FRAMING = "These are the engine's facts as they stand before this transaction. "
  + "Keep the event and every warUpdates record consistent with them: do not conclude, close, leave or cease fire "
  + "a war the engine holds for the player's decision; the engine will withhold such a record. Do not deny a standing "
  + "obligation or a recorded breach, and do not write a war as just when the engine has marked it unjust.";

// The block, or "" when the world has no war facts to state. The order is the
// order the jump's [Wars] ledger already prints them in. The audience changes
// only the closing instruction: a scene narrates, a GM transaction writes a
// warUpdates record the engine may refuse.
export const buildWarFactsDirective = (variables = {}, { audience = "scene" } = {}) => {
  const { treatyObligations, treatyBreach, warCasus, peaceOffer } = variables ?? {};
  const lines = [treatyObligations, treatyBreach, warCasus, peaceOffer]
    .map(text)
    .filter(Boolean);
  if (!lines.length) return "";
  const framing = audience === "gameMaster" ? GAME_MASTER_FRAMING : SCENE_FRAMING;
  return `[Standing War Facts]\n${lines.join("\n")}\n${framing}`;
};
```

The default path must render exactly what the old template literal rendered:
header, newline, joined lines, newline, scene framing.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/runtime/warFacts.test.js"`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/warFacts.js src/runtime/warFacts.test.js
git commit -m "feat(runtime): add the game master framing to the war facts"
```

---

### Task 2: The GM caller sets the facts

**Files:**
- Modify: `src/Game/AI/gameplay.js` (`previewGameMasterCommand`, the variables block at ~14361-14364)
- Modify: `src/Game/AI/warFactsWiringArchitecture.test.js`

**Interfaces:**
- Consumes: `buildWarFactsVariables({ world, game })` (already defined at ~596).
- Produces: no new export. `previewGameMasterCommand` sets the four variables on
  its `variables` object before `runJsonTask("gameMaster", ...)`.

- [ ] **Step 1: Extend the failing guard test**

Append to `src/Game/AI/warFactsWiringArchitecture.test.js`:

```js
test("the game master preview says the war facts before it plans", () => {
  const call = "await buildWarFactsVariables({ world: bundle.world, game: bundle.game })";
  const previewAt = gameplay.indexOf("export const previewGameMasterCommand");
  const applyAt = gameplay.indexOf("export const applyGameMasterPreview");
  assert.ok(previewAt > 0 && applyAt > previewAt, "the game master entry points are missing or reordered");
  const callAt = gameplay.indexOf(call, previewAt);
  const planAt = gameplay.indexOf('runJsonTask("gameMaster"', previewAt);
  assert.ok(callAt > previewAt && callAt < planAt, "previewGameMasterCommand says the war facts before it plans");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/Game/AI/warFactsWiringArchitecture.test.js"`
Expected: FAIL on the new test: `previewGameMasterCommand` does not call the
shared builder.

- [ ] **Step 3: Set the variables in `previewGameMasterCommand`**

In `src/Game/AI/gameplay.js`, right after the `variables` object in
`previewGameMasterCommand`:

```js
    const variables = {
      ...(await buildTemplateVariables(bundle, { taskKey: "gameMaster", gameMasterRequest: request, lookups: true })),
      gameMasterMode: selectedMode,
    };
```

add:

```js
    Object.assign(variables, await buildWarFactsVariables({ world: bundle.world, game: bundle.game }));
```

The call must sit before `runJsonTask("gameMaster", ...)` so the prompt is built
from the same `variables` object the block is derived from.

- [ ] **Step 4: Verify the guard passes and the file parses**

Run: `node --test "src/Game/AI/warFactsWiringArchitecture.test.js"`
Expected: PASS, 6 tests.

Run: `node --check src/Game/AI/gameplay.js`
Expected: no output (syntax OK).

- [ ] **Step 5: Commit**

```bash
git add src/Game/AI/gameplay.js src/Game/AI/warFactsWiringArchitecture.test.js
git commit -m "feat(ai): give the game master the war facts before it plans"
```

---

### Task 3: The GM prompt carries the block

**Files:**
- Modify: `src/Game/AI/gameplay.js` (`buildTaskSystemPrompt`, beside the scene append at ~2577-2583)
- Modify: `src/Game/AI/warFactsWiringArchitecture.test.js`

**Interfaces:**
- Consumes: `buildWarFactsDirective` from Task 1 (already imported at line ~304).
- Produces: no new export. The `gameMaster` prompt carries the block at call
  time; the scene append is unchanged.

- [ ] **Step 1: Extend the failing guard test**

Append to `src/Game/AI/warFactsWiringArchitecture.test.js`:

```js
test("the game master prompt carries the engine's war facts", () => {
  const from = gameplay.indexOf("const buildTaskSystemPrompt");
  const to = gameplay.indexOf("const GM_REMINDER_TASKS");
  assert.ok(from > 0 && to > from, "the prompt builder span is missing");
  const promptBody = gameplay.slice(from, to);
  assert.match(
    promptBody,
    /if \(taskKey === "gameMaster"\) \{[\s\S]*?buildWarFactsDirective\(variables, \{ audience: "gameMaster" \}\)/,
    "the GM block must be gated on the GM task key and live in buildTaskSystemPrompt",
  );
  assert.equal(
    promptBody.split('buildWarFactsDirective(variables, { audience: "gameMaster" })').length - 1,
    1,
    "the GM war-facts append is exactly one",
  );
  // The scene append stays the no-audience literal.
  assert.equal(promptBody.split("buildWarFactsDirective(variables)").length - 1, 1, "the scene append changed");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/Game/AI/warFactsWiringArchitecture.test.js"`
Expected: FAIL on the new test: the GM audience literal is absent.

- [ ] **Step 3: Append the GM block in `buildTaskSystemPrompt`**

Immediately after the existing scene append:

```js
  if (["interactiveCreation", "interactiveExecutor"].includes(taskKey)) {
    const warFacts = buildWarFactsDirective(variables);
    if (warFacts) systemPrompt = `${systemPrompt}\n\n${warFacts}`;
  }
```

insert:

```js
  // The Game Master writes the ledger the scene cannot. It has no retry and its
  // preview accepts a held record, so it is told the facts before it plans.
  if (taskKey === "gameMaster") {
    const warFacts = buildWarFactsDirective(variables, { audience: "gameMaster" });
    if (warFacts) systemPrompt = `${systemPrompt}\n\n${warFacts}`;
  }
```

Do not change the scene block above it.

- [ ] **Step 4: Verify the guards pass and the file parses**

Run: `node --test "src/Game/AI/warFactsWiringArchitecture.test.js"`
Expected: PASS, 7 tests.

Run: `node --check src/Game/AI/gameplay.js`
Expected: no output (syntax OK).

- [ ] **Step 5: Commit**

```bash
git add src/Game/AI/gameplay.js src/Game/AI/warFactsWiringArchitecture.test.js
git commit -m "feat(ai): carry the war facts into the game master prompt"
```

---

### Task 4: Document the GM's war facts

**Files:**
- Modify: `docs/runtime-services.md` (the `| War facts |` row near line 30; the paragraph that ends `...The jump's own \`[Wars]\` ledger is unchanged.` at ~line 77)

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing.

- [ ] **Step 1: Extend the table row**

Replace the `| War facts | ... |` row with one that names both audiences:

```markdown
| War facts | `src/runtime/warFacts.js` | renders the four engine war digests (standing obligations, a recorded breach, the casus verdict, the player's pending peace) as one block for a narrated scene or a Game Master transaction | `src/Game/AI/gameplay.js` (the interactive event prompts and the GM preview) |
```

- [ ] **Step 2: Add a paragraph after the scene paragraph**

After the paragraph that ends `...The jump's own \`[Wars]\` ledger is unchanged.`, insert:

```markdown
The Game Master transaction is the one path that writes the war ledger without
a retry. `previewGameMasterCommand` sets the four variables through the same
`buildWarFactsVariables` helper, and `buildTaskSystemPrompt` appends
`buildWarFactsDirective(variables, { audience: "gameMaster" })` to its prompt at
call time. The GM framing says what the scene's does and adds the consequence a
transaction needs: a record that closes, leaves or ceases fire a held war will
be withheld by the engine. Nothing is enforced at preview time; `applyWarUpdates`
stays the enforcement point.
```

- [ ] **Step 3: Check the wiki freshness and commit**

Run: `npm run wiki:check`
Expected: `Wiki is current.`

```bash
git add docs/runtime-services.md
git commit -m "docs(runtime): note the war facts the game master now carries"
```

---

### Task 5: Whole-suite gate

**Files:**
- None (verification only).

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: 0 failures. The baseline before this increment was 3022 tests, 3020
pass, 0 fail, 2 todo; this increment adds the new tests and must not lose any.
If a network-based test flakes (`server/appUpdate.test.js` is a known flake),
re-run once and record it.

- [ ] **Step 2: Engine purity**

Run: `node --test "src/engine/*.test.js"`
Expected: all pass (the pure core is untouched).

- [ ] **Step 3: Runtime and wiring tests**

Run: `node --test "src/runtime/*.test.js"`
Expected: all pass, including `warFacts.test.js`.

Run: `node --test "src/Game/AI/warFactsWiringArchitecture.test.js"`
Expected: all pass.

- [ ] **Step 4: Lint the changed files**

Run: `npx eslint src/runtime/warFacts.js src/runtime/warFacts.test.js src/Game/AI/gameplay.js src/Game/AI/warFactsWiringArchitecture.test.js`
Expected: 0 errors (pre-existing warnings in unrelated regions are acceptable).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 6: Record the gate**

Write the exact counts and any flake to `.superpowers/sdd/progress.md`. No
commit for this step unless a change was needed.
