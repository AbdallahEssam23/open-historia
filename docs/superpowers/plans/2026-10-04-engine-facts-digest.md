# Engine Facts Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the model the four facts the engine already enforces - the
standing treaty obligations, the recorded breaches, the casus verdict and the
pending peace offer - and deliver the three existing ones on every jump, not
only on a skip of a month or more.

**Architecture:** A new import-free `buildPeaceOfferDigest` in
`src/runtime/peaceOffer.js` renders the pending `world.peaceOffer` as one line.
`buildWarLedgerDirective` in `gameplay.js` appends it beside the three digests
it already carries. In `simulateTimelineJump` the three legal digests and the
new peace line are moved out of the `if (projected.months > 0)` gate and above
`advanceWorldEconomy`, because they read the world as it stands and not the
projection. No new mechanic, no core change, no migration.

**Tech Stack:** Node.js ESM, `node --test`.

## Global Constraints

- Pure core `src/engine/**` is unchanged this increment. It must keep importing
  no browser module and using no `Date.now`/`new Date`/`Math.random`
  (`src/engine/enginePurity.test.js` enforces this).
- `src/runtime/**` must never import a `src/Game/AI/**` module. The new builder
  lives in `src/runtime/peaceOffer.js`, which imports nothing at all.
- Only ASCII in every added line. No emoji, no em dash, no middle dot.
- No new dependency in `package.json`. No `ENGINE_VERSION` bump. No migration.
- Every commit is conventional and carries the trailer
  `Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>`. The
  `prepare-commit-msg` hook appends it: never pass it with `-m`.
- Tests run with globs, never a directory: `node --test "src/runtime/*.test.js"`,
  `node --test "src/Game/AI/*.test.js"`, `node --test "src/engine/*.test.js"`.
- Do not weaken an existing test to pass. This increment moves assignments; it
  changes no digest's text and no test's expectation.
- `src/Game/AI/gameplay.js` imports `./main.jsx`, so it is never imported by a
  `node --test` file. Its wiring is pinned by a source-text architecture test
  plus `node --check`.

---

## Pre-flight findings

Checked against the working tree at `ec4177a` + spec `1057cd8` before writing
this plan. Each item below is load-bearing for a task.

1. **The gate is real and it is the only one.** `if (projected.months > 0) {`
   appears exactly once in `gameplay.js` (`:13218`). The three legal digests sit
   inside it (`:13263-13271`) and read only `bundle.world` and the already-bound
   `playerPolity`; none reads `projected`. Moving them above
   `advanceWorldEconomy` (`:13198`), after `playerPolity` is bound (`:13197`), is
   therefore safe. Economic digests (`forcePoolsDigest`, `operationsDigest`,
   `productionDigest`) do read `projected` and stay behind the gate.
2. **Assignments are visible to the prompt.** `simulateTimelineJump` sets
   `variables.*` after `buildTemplateVariables` (`:13177`); the prompt is
   rendered later, in `buildTaskSystemPrompt` (`:2246`), which calls
   `buildJumpLiveState` (`:2127`) and only then renders. So setting
   `variables.peaceOffer` beside the other digests reaches the model exactly as
   `variables.warCasus` already does.
3. **The directive is the only consumer of these variables.**
   `buildWarLedgerDirective` (`:591`) reads `variables.treatyObligations`,
   `treatyBreach` and `warCasus`; it is called only from `buildJumpLiveState`
   (`:2154`), which is only reached for jump tasks (`:2268`). Adding
   `variables.peaceOffer` reads/writes one new key with no other consumer.
4. **No name collision.** `buildPeaceOfferDigest` exists nowhere in `src/`. The
   template key `variables.peaceOffer` is distinct from the world field
   `world.peaceOffer`; the former does not exist yet.
5. **Existing source-text guards tolerate the move.** The obligations and casus
   guards (`treatyObligationsWiringArchitecture.test.js`,
   `casusBelliWiringArchitecture.test.js`) assert the directive body reads their
   variable and that `variables.X =` appears SOMEWHERE. They do not pin the
   assignment inside the gate, so moving it keeps them green. They, and the
   peace wiring guard, do not close the directive body on a `${` line, so
   appending a fourth conditional keeps the extracted body matchable.
6. **Baseline is green.** `node --test` on
   `src/runtime/peaceOffer.test.js`,
   `src/Game/AI/peaceOfferWiringArchitecture.test.js`,
   `src/Game/AI/treatyObligationsWiringArchitecture.test.js` and
   `src/Game/AI/casusBelliWiringArchitecture.test.js` passes (19 tests, 0 fail);
   `node --check src/Game/AI/gameplay.js` and
   `node --check src/runtime/peaceOffer.js` are clean.
7. **The docs target exists.** The module map already has a Peace offer row and
   a `## The player's own peace, offered` section (`docs/runtime-services.md`
   `:315`); the docs task extends that section rather than adding a row. The
   stale sentence the interactive-peace increment was to correct (`:309-311`) is
   already corrected, so this task only adds the digest note.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/runtime/peaceOffer.js` (modify) | Add the import-free `buildPeaceOfferDigest`. |
| `src/runtime/peaceOffer.test.js` (modify) | Cases for the new builder. |
| `src/Game/AI/gameplay.js` (modify) | Append the peace line to the war directive; build the legal digests and the peace line before the projection gate. |
| `src/Game/AI/peaceOfferWiringArchitecture.test.js` (modify) | Source-text guard for the new line and the new turn order. |
| `docs/runtime-services.md` (modify) | A note on the peace line and the delivery rule. |

---

### Task 1: The import-free peace digest

**Files:**
- Modify: `src/runtime/peaceOffer.js` (append after `choosePeaceOffer`, now at
  `:74-84`)
- Test: `src/runtime/peaceOffer.test.js`

**Interfaces:**
- Consumes: `normalizePeaceOffer` (already in the module).
- Produces: `buildPeaceOfferDigest({ offer } = {})` returns "" when there is no
  usable offer, else one header line followed by one line naming the war and
  stating the settlement is held.

- [ ] **Step 1: Write the failing test**

In `src/runtime/peaceOffer.test.js`, extend the import and append the case:

```js
import { buildPeaceOfferDigest, choosePeaceOffer, normalizePeaceOffer } from "./peaceOffer.js";
```

```js
test("the peace digest names the pending war and holds it open", () => {
  assert.equal(buildPeaceOfferDigest({}), "");
  assert.equal(buildPeaceOfferDigest(), "");
  assert.equal(buildPeaceOfferDigest({ offer: null }), "");
  assert.equal(buildPeaceOfferDigest({ offer: { warId: "" } }), "");
  const line = buildPeaceOfferDigest({ offer: offer({ warId: "war-7" }) });
  assert.match(line, /\[Peace Offer Pending/);
  assert.match(line, /war-7/);
  assert.match(line, /do not close/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/runtime/peaceOffer.test.js"`
Expected: FAIL, `buildPeaceOfferDigest` is not exported.

- [ ] **Step 3: Write the builder**

In `src/runtime/peaceOffer.js`, after `choosePeaceOffer`:

```js
// The pending offer as one line for the war ledger the model reads, or "" when
// none is due. It exists so the model does not narrate a settlement the engine
// is still holding: the war is real, the terms are derived, and only the
// player's decision is outstanding.
export const buildPeaceOfferDigest = ({ offer } = {}) => {
  const pending = normalizePeaceOffer(offer);
  if (!pending) return "";
  return `[Peace Offer Pending, as simulated]
- ${pending.warId} is settled on the engine's terms and awaits the player's decision; do not narrate it as concluded, and do not close, leave or cease fire the war until the player accepts or declines.`;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/runtime/peaceOffer.test.js"`
Expected: PASS. Then run the runtime glob to be sure nothing else moved:
`node --test "src/runtime/*.test.js"`.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/peaceOffer.js src/runtime/peaceOffer.test.js
git commit -m "feat(runtime): render the pending peace as a ledger line"
```

---

### Task 2: Deliver the legal digests on every jump

**Files:**
- Modify: `src/Game/AI/gameplay.js` (the import at `:303`; the directive at
  `:591-603`; the digest block at `:13193-13299`)
- Test: `src/Game/AI/peaceOfferWiringArchitecture.test.js`

**Interfaces:**
- Consumes: `buildPeaceOfferDigest` (Task 1),
  `buildTreatyObligationDigest`/`buildTreatyBreachDigest` (already imported at
  `:50`), `buildWarCasusDigest` (already imported).
- Produces: on every jump, `variables.treatyObligations`, `variables.treatyBreach`,
  `variables.warCasus` and `variables.peaceOffer` are set from the world as it
  stands; `buildWarLedgerDirective` prints the peace line.

- [ ] **Step 1: Write the failing guard**

Append to `src/Game/AI/peaceOfferWiringArchitecture.test.js`:

```js
test("the war directive prints the pending peace digest the jump prompt builds", () => {
  const start = gameplay.indexOf("const buildWarLedgerDirective = (variables) => {");
  assert.ok(start > 0, "the war directive builder is missing");
  const end = gameplay.indexOf("\n};", start);
  const body = gameplay.slice(start, end);
  assert.match(body, /peaceOffer/, "the directive does not read the pending peace digest");
  assert.ok(gameplay.indexOf("variables.peaceOffer =") > 0, "the jump prompt never sets variables.peaceOffer");
});

test("the legal digests are built before the projection gate", () => {
  const gateAt = gameplay.indexOf("if (projected.months > 0)");
  assert.ok(gateAt > 0, "the projection gate is missing");
  for (const name of [
    "variables.treatyObligations =",
    "variables.treatyBreach =",
    "variables.warCasus =",
    "variables.peaceOffer =",
  ]) {
    const at = gameplay.indexOf(name);
    assert.ok(at > 0 && at < gateAt, `${name} must be built before the projection gate`);
  }
});
```

- [ ] **Step 2: Run the guard to verify it fails**

Run: `node --test "src/Game/AI/peaceOfferWiringArchitecture.test.js"`
Expected: FAIL, `variables.peaceOffer` and the directive line do not exist and
the three legal assignments are still inside the gate.

- [ ] **Step 3: Import the builder and print the peace line**

In `src/Game/AI/gameplay.js`, extend the runtime/peaceOffer import at `:303`:

```js
import { buildPeaceOfferDigest, choosePeaceOffer } from "../../runtime/peaceOffer.js";
```

In `buildWarLedgerDirective`, add a binding beside `warCasus` (`:596`):

```js
  const peaceOffer = normalizeString(variables?.peaceOffer);
```

and append the conditional to the returned line (`:598`), after the `warCasus`
conditional:

```js
${warCasus ? `\n${warCasus}` : ""}${peaceOffer ? `\n${peaceOffer}` : ""}
```

- [ ] **Step 4: Move the legal digests above the projection**

In `simulateTimelineJump`, the digest block currently reads (abridged): the
`try` opens at `:13193`, `playerPolity` is bound at `:13197`, then
`const projected = advanceWorldEconomy(...)` at `:13198`, then
`variables.economyDigest` at `:13207`, and inside `if (projected.months > 0)`
(`:13218`) the calls at `:13263-13271`:

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
```

Remove that comment block and those three calls from inside the gate, and insert
the following directly after `const playerPolity = toCountryName(...);`
(`:13197`), before `const projected = advanceWorldEconomy(...)`:

```js
    // The legal facts the world already realizes do not depend on the economic
    // projection, so they are built from the world as it stands on every jump,
    // including one shorter than a month. Only the projected-economy digests
    // need a month, so only they stay behind the projection gate below.
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

The comment block that sat directly above the removed calls ("The treaty links
the world already realizes...") is removed with them; the new block carries the
explanation.

- [ ] **Step 5: Run the guard and the syntax check**

Run: `node --test "src/Game/AI/peaceOfferWiringArchitecture.test.js"`
Expected: PASS.

Run: `node --check src/Game/AI/gameplay.js`
Expected: no output.

- [ ] **Step 6: Run the sibling guards and the AI glob**

Run: `node --test "src/Game/AI/treatyObligationsWiringArchitecture.test.js" "src/Game/AI/casusBelliWiringArchitecture.test.js"`
Expected: PASS, unchanged.

Run: `node --test "src/Game/AI/*.test.js"`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/Game/AI/gameplay.js src/Game/AI/peaceOfferWiringArchitecture.test.js
git commit -m "feat(ai): surface the engine facts on every jump"
```

---

### Task 3: Document the delivery rule

**Files:**
- Modify: `docs/runtime-services.md` (the `## The player's own peace, offered`
  section, `:315-339`)

**Interfaces:**
- Consumes: the finished increment.
- Produces: a paragraph stating the peace line and when the legal digests are
  built.

- [ ] **Step 1: Add the paragraph**

At the end of the `## The player's own peace, offered` section, after the panel
sentence (`:338-339`):

```markdown
The war ledger the model reads now carries this offer too:
`buildPeaceOfferDigest` (same module) renders the pending offer as one line, and
`buildWarLedgerDirective` (`gameplay.js`) appends it beside the standing
obligations, the recorded breaches and the casus verdict it already printed.
Those three digests, and this line, read the world as it stands, so they are
built before the economy projection on every jump, including one shorter than a
month. Only the digests that state a projected month (the force pools, the
operations and the production) stay behind the projection gate.
```

- [ ] **Step 2: Check the added lines are ASCII**

Run: `git diff --unified=0 -- docs/runtime-services.md | rg '^\+' | rg '[^\x00-\x7F]'`
Expected: no output.

- [ ] **Step 3: Check the wiki is still current**

Run: `npm run wiki:check`
Expected: `Wiki is current.`

- [ ] **Step 4: Commit**

```bash
git add docs/runtime-services.md
git commit -m "docs(runtime): note the engine facts delivered to the model"
```

---

## Acceptance

After all tasks, on the final HEAD:

- `npm test` passes with 0 failures (the known `server/appUpdate.test.js` flake
  is network-only and must not be the cause of a failure).
- `node --test "src/engine/*.test.js"`, `node --test "src/runtime/*.test.js"`
  and `node --test "src/Game/AI/*.test.js"` all pass.
- `npx eslint .` shows no new errors beyond the pre-existing 18 in
  `src/Game/Map/*`.
- `npm run wiki:check` prints `Wiki is current.`
- `npm run build` exits 0.
- Every commit in the increment carries the `Co-authored-by` trailer.
- `package.json` and `ENGINE_VERSION` are unchanged.
