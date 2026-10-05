# Interactive War Facts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the interactive event prompts (`interactiveCreation`, `interactiveExecutor`) the same four engine war facts a time skip carries, so a scene's narration does not contradict the war ledger it cannot change.

**Architecture:** A pure, import-free renderer in `src/runtime/warFacts.js` turns the four digest strings into one `[Standing War Facts]` block (or nothing). One shared async builder in `src/Game/AI/gameplay.js` (`buildWarFactsVariables`) derives those four strings from the world, replacing the jump's inline block. `buildTaskSystemPrompt` appends the block at call time for the two interactive tasks, exactly as it already appends the reputation and placement directives.

**Tech Stack:** Node.js ESM, `node --test`, React 18 (JSX) for the existing UI, Vite for the build.

## Global Constraints

- Pure core `src/engine/**` is untouched this increment. It must keep importing
  no browser module and using no `Date.now`/`new Date`/`Math.random`
  (`src/engine/enginePurity.test.js` enforces this).
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

---

### Task 1: The pure war-facts directive

**Files:**
- Add: `src/runtime/warFacts.js`
- Add: `src/runtime/warFacts.test.js`

**Interfaces:**
- Consumes: nothing; the module imports nothing.
- Produces: `buildWarFactsDirective({ treatyObligations, treatyBreach, warCasus, peaceOffer })`,
  a string: the empty string when all four are blank, otherwise a
  `[Standing War Facts]` block with the non-blank digests in that fixed order.

- [ ] **Step 1: Write the failing test**

Create `src/runtime/warFacts.test.js`:

```js
// Run: node --test src/runtime/warFacts.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { buildWarFactsDirective } from "./warFacts.js";

test("no facts is no block", () => {
  assert.equal(buildWarFactsDirective(), "");
  assert.equal(buildWarFactsDirective({}), "");
  assert.equal(
    buildWarFactsDirective({ treatyObligations: "  ", treatyBreach: "", warCasus: null, peaceOffer: undefined }),
    "",
  );
});

test("one fact renders under the header with the framing", () => {
  const block = buildWarFactsDirective({ peaceOffer: "[Peace Offer Pending, as simulated]" });
  assert.match(block, /^\[Standing War Facts\]\n/);
  assert.match(block, /\[Peace Offer Pending, as simulated\]/);
  assert.match(block, /do not conclude, close, leave or cease fire/);
});

test("all four render in the fixed order with no blank lines", () => {
  const block = buildWarFactsDirective({
    treatyObligations: "OBLIGATION",
    treatyBreach: "BREACH",
    warCasus: "CASUS",
    peaceOffer: "OFFER",
  });
  const positions = ["OBLIGATION", "BREACH", "CASUS", "OFFER"].map((line) => block.indexOf(line));
  assert.ok(positions.every((at) => at > 0), "every fact is present");
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), "the facts keep their fixed order");
  assert.equal(block.split("\n\n").length, 1, "the block has no blank separator");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/runtime/warFacts.test.js"`
Expected: FAIL, the module `./warFacts.js` cannot be found.

- [ ] **Step 3: Write the minimal implementation**

Create `src/runtime/warFacts.js`:

```js
/*! Open Historia - the engine's war facts as one scene directive (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/runtime/warFacts.test.js
//
// An interactive event runs the same turn as a time skip and narrates the same
// world, but it is a scene that writes no ledger records: its resolved event
// carries empty impacts. So it is told the facts it must not contradict, not
// the war-updates contract it cannot use. This module renders the four digests
// the skip already carries into one block. It imports nothing, so it runs
// under node --test.

const text = (value) => String(value ?? "").trim();

// The block, or "" when the world has no war facts to state. The order is the
// order the jump's [Wars] ledger already prints them in.
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
  return `[Standing War Facts]
${lines.join("\n")}
These are the engine's facts as they stand at the start of this scene. Keep the narration consistent with them: do not conclude, close, leave or cease fire a war the engine holds for the player's decision, do not deny a standing obligation or a recorded breach, and do not write a war as just when the engine has marked it unjust.`;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/runtime/warFacts.test.js"`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/warFacts.js src/runtime/warFacts.test.js
git commit -m "feat(runtime): render the engine's war facts as one scene block"
```

---

### Task 2: One shared builder for the four digests

**Files:**
- Modify: `src/Game/AI/gameplay.js` (add `buildWarFactsVariables` before `buildWarLedgerDirective` at ~591; replace the inline block in `simulateTimelineJump` at ~13220)
- Add: `src/Game/AI/warFactsWiringArchitecture.test.js`

**Interfaces:**
- Consumes: `toCountryName`, `normalizeString`, `readTreatyObligations`,
  `readRecordedBreaches`, `readRecordedUnjustWars`, `buildTreatyObligationDigest`,
  `buildTreatyBreachDigest`, `buildWarCasusDigest`, `buildPeaceOfferDigest`
  (all already imported).
- Produces: `buildWarFactsVariables({ world, game })`, an async function
  returning `{ treatyObligations, treatyBreach, warCasus, peaceOffer }`.

- [ ] **Step 1: Write the failing guard test**

Create `src/Game/AI/warFactsWiringArchitecture.test.js`:

```js
// Run: node --test src/Game/AI/warFactsWiringArchitecture.test.js
//
// gameplay.js imports main.jsx and cannot be imported by node --test, so its
// wiring is pinned by reading the source. This is the house pattern for the
// other wiring architecture guards.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const gameplay = read("./gameplay.js");

test("the four war digests are built in exactly one place", () => {
  for (const builder of [
    "buildTreatyObligationDigest(",
    "buildTreatyBreachDigest(",
    "buildWarCasusDigest(",
    "buildPeaceOfferDigest(",
  ]) {
    assert.equal(gameplay.split(builder).length - 1, 1, `${builder} is built once`);
  }
  assert.match(gameplay, /const buildWarFactsVariables = async \(\{ world, game \} = \{\}\)/);
});

test("the jump says its war facts through the shared helper", () => {
  const jumpAt = gameplay.indexOf("export const simulateTimelineJump");
  assert.ok(jumpAt > 0, "the jump entry point is missing");
  assert.ok(
    gameplay.indexOf("await buildWarFactsVariables({", jumpAt) > jumpAt,
    "the jump still builds its war facts inline",
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/Game/AI/warFactsWiringArchitecture.test.js"`
Expected: FAIL, `buildWarFactsVariables` is not found and the digest builders
occur twice (the helper is absent, the inline block is present).

- [ ] **Step 3: Add the shared helper**

In `src/Game/AI/gameplay.js`, immediately before `const buildWarLedgerDirective = (variables) => {`, insert:

```js
// The four war facts the model must not contradict, derived from the world in
// one place so every path that shows them reads them the same way. A time skip
// prints them in its [Wars] ledger; an interactive scene gets them as their own
// block (runtime/warFacts.js).
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

- [ ] **Step 4: Replace the jump's inline block**

In `simulateTimelineJump`, replace this block:

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

with one call:

```js
    Object.assign(variables, await buildWarFactsVariables({ world: bundle.world, game: bundle.game }));
```

The four values are identical: the helper reads the same `bundle.world` and
derives the same `playerPolity`. The `playerPolity` local just above is still
used by the economy projection; leave it.

- [ ] **Step 5: Verify the guard passes and the file parses**

Run: `node --test "src/Game/AI/warFactsWiringArchitecture.test.js"`
Expected: PASS, 2 tests.

Run: `node --check src/Game/AI/gameplay.js`
Expected: no output (syntax OK).

- [ ] **Step 6: Commit**

```bash
git add src/Game/AI/gameplay.js src/Game/AI/warFactsWiringArchitecture.test.js
git commit -m "refactor(ai): derive the war facts in one shared builder"
```

---

### Task 3: Carry the block into the interactive prompts

**Files:**
- Modify: `src/Game/AI/gameplay.js` (import; `buildTaskSystemPrompt` near the reputation block at ~2540; `createInteractive` at ~11895; `advanceActiveInteractive` at ~12118)
- Modify: `src/Game/AI/warFactsWiringArchitecture.test.js`

**Interfaces:**
- Consumes: `buildWarFactsDirective` from Task 1; `buildWarFactsVariables` from
  Task 2.
- Produces: no new export. The `interactiveCreation` and `interactiveExecutor`
  prompts carry the block; both interactive callers set the four variables.

- [ ] **Step 1: Extend the failing guard test**

Append to `src/Game/AI/warFactsWiringArchitecture.test.js`:

```js
test("the interactive prompts carry the engine's war facts", () => {
  assert.match(gameplay, /from "\.\.\/\.\.\/runtime\/warFacts\.js"/);
  assert.match(gameplay, /\["interactiveCreation", "interactiveExecutor"\]\.includes\(taskKey\)/);
  assert.match(gameplay, /buildWarFactsDirective\(variables\)/);
});

test("both interactive turns build the war facts", () => {
  const call = "await buildWarFactsVariables({ world: bundle.world, game: bundle.game })";
  const createAt = gameplay.indexOf("export const createInteractive");
  const advanceAt = gameplay.indexOf("export const advanceActiveInteractive");
  assert.ok(createAt > 0 && advanceAt > 0, "the interactive entry points are missing");
  assert.ok(gameplay.indexOf(call, createAt) > createAt, "createInteractive says the war facts");
  assert.ok(gameplay.indexOf(call, advanceAt) > advanceAt, "advanceActiveInteractive says the war facts");
});

test("the war facts module imports nothing", () => {
  const facts = read("../../runtime/warFacts.js");
  assert.doesNotMatch(facts, /^import /m);
  assert.match(facts, /export const buildWarFactsDirective/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/Game/AI/warFactsWiringArchitecture.test.js"`
Expected: FAIL on the three new tests: the import, the append and the two
caller calls are absent.

- [ ] **Step 3: Import the directive**

In `src/Game/AI/gameplay.js`, after the `../../runtime/peaceOffer.js` import, add:

```js
import { buildWarFactsDirective } from "../../runtime/warFacts.js";
```

- [ ] **Step 4: Append the block in `buildTaskSystemPrompt`**

After the intelligence block for `["actions", "interactiveCreation", "interactiveExecutor"]`
(the second such guarded block, which ends `...do not jump it by tens of points for a single measure.";\n    }\n  }`), insert:

```js
  // The engine's war facts travel with a scene too, so its narration does not
  // contradict a war the engine holds. A time skip has them in its live records;
  // the scene has no ledger contract to use, so it gets the facts alone.
  if (["interactiveCreation", "interactiveExecutor"].includes(taskKey)) {
    const warFacts = buildWarFactsDirective(variables);
    if (warFacts) systemPrompt = `${systemPrompt}\n\n${warFacts}`;
  }
```

- [ ] **Step 5: Set the variables in both interactive callers**

In `createInteractive`, after `const variables = await buildTemplateVariables(bundle, { lookups: true });`, add:

```js
    Object.assign(variables, await buildWarFactsVariables({ world: bundle.world, game: bundle.game }));
```

In `advanceActiveInteractive`, after its `const variables = await buildTemplateVariables(bundle, { ... });` call, add:

```js
  Object.assign(variables, await buildWarFactsVariables({ world: bundle.world, game: bundle.game }));
```

- [ ] **Step 6: Verify the guards pass and the file parses**

Run: `node --test "src/Game/AI/warFactsWiringArchitecture.test.js"`
Expected: PASS, 5 tests.

Run: `node --check src/Game/AI/gameplay.js`
Expected: no output (syntax OK).

- [ ] **Step 7: Commit**

```bash
git add src/Game/AI/gameplay.js src/Game/AI/warFactsWiringArchitecture.test.js
git commit -m "feat(ai): carry the war facts into the interactive scene"
```

---

### Task 4: Document the scene's war facts

**Files:**
- Modify: `docs/runtime-services.md` (the table near line 29; a paragraph after the held-peace note ending at ~line 64)

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing.

- [ ] **Step 1: Add the table row**

After the `| Peace offer | ... |` row (line 29), add:

```markdown
| War facts | `src/runtime/warFacts.js` | renders the four engine war digests (standing obligations, a recorded breach, the casus verdict, the player's pending peace) as one block for a narrated scene | `src/Game/AI/gameplay.js` (the interactive event prompts) |
```

- [ ] **Step 2: Add the paragraph**

After the paragraph that ends `...each held war with a \`withheld\` receipt line and a debug log.` (line 64), before the `---`, insert:

```markdown
A scene played out as an interactive event runs the same turn as a time skip
and narrates the same world, but until now it was told none of these war facts.
`src/runtime/warFacts.js` renders the four digests the skip already carries -
the standing treaty obligations, a recorded breach, the casus verdict and the
pending peace offer - into one `[Standing War Facts]` block, and returns an
empty string when there are none, so a world with no facts adds nothing.
`buildTaskSystemPrompt` (`src/Game/AI/gameplay.js`) appends that block at call
time to the `interactiveCreation` and `interactiveExecutor` prompts, and both
interactive callers set the four variables through the shared
`buildWarFactsVariables` helper, so the scene and the skip read the same facts
the same way. The jump's own `[Wars]` ledger is unchanged.
```

- [ ] **Step 3: Check the wiki freshness and commit**

Run: `npm run wiki:check`
Expected: `Wiki is current.` (the interactive paths keep being noted as
deferred in the older specs; that is historical text and is not edited here).

```bash
git add docs/runtime-services.md
git commit -m "docs(runtime): note the war facts the scene now carries"
```

---

### Task 5: Whole-suite gate

**Files:**
- None (verification only).

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: 0 failures. The baseline before this increment was 3014 tests, 3012
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
