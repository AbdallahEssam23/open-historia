# Operations Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the model the player's own supply state and reinforcement policy, and teach it when each policy and consolidation move fits, so its declarations are grounded in fact.

**Architecture:** A new pure builder in `src/runtime/operationsDigest.js` turns plain rows into one capped text block, exactly as `src/runtime/economyDigest.js` does. The runtime adapter `src/runtime/reinforcement.js` gains a small exported policy fold so the wiring reads the policy in one place. `src/Game/AI/gameplay.js` joins the supply read to the roster and hands the block to `buildForcePoolsInstructions`, which gains a rule and a heading. No engine rule changes, nothing is stored.

**Tech Stack:** Node.js ESM, `node:test` + `node:assert/strict`, ESLint, Vite build, the project's own deterministic simulation layers.

## Global Constraints

- Only the player's own polity is shown. Never an enemy's or an ally's supply state.
- `src/runtime/operationsDigest.js` imports nothing (no imports at all, like a pure string transform).
- No engine file under `src/engine/**` is created or modified; `src/engine/enginePurity.test.js` is unaffected.
- `src/runtime/**` never imports `src/Game/AI/**`; the dependency runs one way only.
- No new `package.json` entry, no `ENGINE_VERSION` bump, no migration, no new stored `world` field, no declaration-schema change.
- ASCII only in source and documentation. No emoji, no em dash, no non-ASCII punctuation.
- Caps are `OPERATIONS_ROW_CAP = 6` and `OPERATIONS_CHAR_CAP = 360`, copied verbatim from the spec.
- The digest states no number the engine did not compute (no per-point price, no reinforcement rate).
- Tests run with a glob, never a bare directory: `node --test "src/runtime/*.test.js"`, `node --test "src/Game/AI/*.test.js"`, `node --test "src/engine/*.test.js"`.
- Every commit uses a conventional prefix. The `prepare-commit-msg` hook appends the `Co-authored-by: monkeycode-ai` trailer automatically: never pass that trailer through `-m`.
- Branch: `261001-feat-combat-engagements`.

---

## File Structure

- Create `src/runtime/operationsDigest.js` - the pure builder and its two caps.
- Create `src/runtime/operationsDigest.test.js` - its pure tests.
- Modify `src/runtime/reinforcement.js` - extract and export `readReinforcementPolicies`.
- Modify `src/runtime/reinforcement.test.js` - cover the exported fold.
- Modify `src/Game/AI/gameplayPrompts.js` - the `operations` parameter and the guidance rule.
- Create `src/Game/AI/operationsPrompt.test.js` - the prompt rendering and the rule text.
- Modify `src/Game/AI/gameplay.js` - the wiring in `simulateTimelineJump` and the prompt call.
- Create `src/Game/AI/operationsWiringArchitecture.test.js` - the source-text guard.
- Modify `docs/runtime-services.md` - the new module section.

Each task leaves the suite green.

---

### Task 1: The pure digest builder

**Files:**
- Create: `src/runtime/operationsDigest.js`
- Test: `src/runtime/operationsDigest.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `OPERATIONS_ROW_CAP` (`6`), `OPERATIONS_CHAR_CAP` (`360`).
  - `buildOperationsDigest({ formations, policyInForce, pendingPolicy, cap, charCap }) -> string`.
  - `formations` is `[{ id, name, type, strength, state, reachable }]` where `state` is `"supplied" | "strained" | "isolated"`. Empty or missing `formations` returns `""`.

- [ ] **Step 1: Write the failing test**

Create `src/runtime/operationsDigest.test.js`:

```js
// Run: node --test src/runtime/operationsDigest.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { OPERATIONS_CHAR_CAP, OPERATIONS_ROW_CAP, buildOperationsDigest } from "./operationsDigest.js";

const row = (id, over = {}) => ({
  id,
  name: id,
  type: "infantry",
  strength: 40,
  state: "supplied",
  reachable: true,
  ...over,
});

test("an empty roster produces an empty digest", () => {
  assert.equal(buildOperationsDigest({}), "");
  assert.equal(buildOperationsDigest({ formations: [] }), "");
});

test("the summary counts supply and the rows are ordered severity first", () => {
  const text = buildOperationsDigest({
    formations: [
      row("a", { name: "Alpha", strength: 80, state: "supplied" }),
      row("b", { name: "Bravo", strength: 40, state: "strained" }),
      row("c", { name: "Charlie", strength: 30, state: "isolated" }),
      row("d", { name: "Delta", strength: 100, state: "supplied" }),
    ],
    policyInForce: "replacements",
  });
  const lines = text.split("\n");
  assert.match(lines[1], /2 of 4 formations in supply; 1 strained, 1 cut off\. 3 below full strength\./);
  const rows = lines.filter((line) => line.startsWith("- "));
  assert.equal(rows[0], "- Charlie [id c] 30%, cut off.");
  assert.equal(rows[1], "- Bravo [id b] 40%, strained.");
  assert.equal(rows[2], "- Alpha [id a] 80%, in supply.");
  assert.equal(rows.some((line) => line.includes("Delta")), false);
});

test("a zero count is omitted from the summary line", () => {
  const text = buildOperationsDigest({
    formations: [row("a", { state: "supplied", strength: 100 }), row("b", { state: "strained", strength: 50 })],
    policyInForce: "none",
  });
  const summary = text.split("\n")[1];
  assert.match(summary, /1 of 2 formations in supply; 1 strained\./);
  assert.equal(summary.includes("cut off"), false);
});

test("the policy line names the policy in force and the pending only when it differs", () => {
  const same = buildOperationsDigest({
    formations: [row("a")],
    policyInForce: "replacements",
    pendingPolicy: "replacements",
  });
  assert.match(same, /Reinforcement policy: replacements \(in force\)\./);
  assert.equal(same.includes("declared for next period"), false);
  const changed = buildOperationsDigest({
    formations: [row("a")],
    policyInForce: "replacements",
    pendingPolicy: "belligerent",
  });
  assert.match(changed, /Reinforcement policy: replacements \(in force\); declared for next period: belligerent\./);
  const blank = buildOperationsDigest({ formations: [row("a")] });
  assert.match(blank, /Reinforcement policy: none in force\./);
});

test("the roster is capped and the overflow is counted", () => {
  const formations = Array.from({ length: 10 }, (_, i) =>
    row(`u${i}`, { name: `Unit ${i}`, state: "isolated", strength: 20 + i }),
  );
  const text = buildOperationsDigest({ formations, policyInForce: "none" });
  const lines = text.split("\n").filter((line) => line.startsWith("- "));
  assert.equal(lines.length, OPERATIONS_ROW_CAP);
  assert.match(text, /\+4 more out of supply\./);

  // A longer policy line must not push the overflow notice out of the budget.
  const realistic = buildOperationsDigest({ formations, policyInForce: "replacements" });
  assert.match(realistic, /\+4 more out of supply\./);
});

test("a block longer than the character cap is clamped on a line boundary", () => {
  const formations = Array.from({ length: 40 }, (_, i) =>
    row(`u${i}`, { name: `A very long formation name number ${i}`, state: "isolated", strength: 10 }),
  );
  const text = buildOperationsDigest({ formations, policyInForce: "none", cap: 40 });
  assert.ok(text.length <= OPERATIONS_CHAR_CAP, `got ${text.length}`);
  // The fixed section header is the only line that does not end in a period;
  // every clamped body line must, or a mid-line truncation slipped through.
  const lines = text.split("\n").filter(Boolean);
  assert.equal(lines[0], "[Your Forces in the Field, as simulated]");
  for (const line of lines.slice(1)) {
    assert.ok(line.endsWith("."), `partial line: ${line}`);
  }
});

test("the input is not mutated and the output is ASCII", () => {
  const formations = [row("a", { name: "Alpha" }), row("b", { state: "isolated" })];
  const snapshot = structuredClone(formations);
  const text = buildOperationsDigest({ formations, policyInForce: "replacements" });
  assert.deepEqual(formations, snapshot);
  assert.match(text, /^[\x00-\x7F]*$/);
});

test("the digest is deterministic and order-independent", () => {
  const a = row("a", { name: "Alpha", strength: 50, state: "strained" });
  const b = row("b", { name: "Bravo", strength: 30, state: "isolated" });
  const c = row("c", { name: "Charlie", strength: 90, state: "supplied" });
  const first = buildOperationsDigest({ formations: [a, b, c], policyInForce: "replacements", pendingPolicy: "none" });
  const second = buildOperationsDigest({ formations: [c, a, b], policyInForce: "replacements", pendingPolicy: "none" });
  assert.equal(first, second);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/runtime/operationsDigest.test.js"`
Expected: FAIL, `Cannot find module` for `./operationsDigest.js`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/runtime/operationsDigest.js`:

```js
/*! Open Historia - the operations digest for the prompt (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the model is told about its own formations in the field: the supply
// state part two derives, the policy part three puts in force, and the ids it
// needs to name a rotation or a merge. Player-only and capped, so a large
// roster cannot inflate every prompt. A string transform with no imports.

export const OPERATIONS_ROW_CAP = 6;
export const OPERATIONS_CHAR_CAP = 360;

const number = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const name = (value) => String(value ?? "").trim();

// The engine's three supply states, read for the prompt: isolated is a pocket,
// strained is a formation only reached around the network, supplied is fed.
const STATE_LABEL = { supplied: "in supply", strained: "strained", isolated: "cut off" };
const SEVERITY = { isolated: 0, strained: 1, supplied: 2 };

const stateLabel = (state) => STATE_LABEL[name(state)] || name(state) || "unknown";

// A strength the engine never wrote is full, not zero: the roster prints the
// same default the core uses, so a blank field never reads as a broken unit.
const strengthOf = (row) => Math.max(0, Math.min(100, Math.round(number(row?.strength, 100))));

const needsAttention = (row) => name(row?.state) !== "supplied" || strengthOf(row) < 100;

const compareRows = (a, b) => {
  const sa = SEVERITY[name(a?.state)] ?? 3;
  const sb = SEVERITY[name(b?.state)] ?? 3;
  if (sa !== sb) return sa - sb;
  const wa = strengthOf(a);
  const wb = strengthOf(b);
  if (wa !== wb) return wa - wb;
  const ia = name(a?.id);
  const ib = name(b?.id);
  return ia < ib ? -1 : ia > ib ? 1 : 0;
};

const summaryLineFor = (rows) => {
  const supplied = rows.filter((row) => name(row.state) === "supplied").length;
  const strained = rows.filter((row) => name(row.state) === "strained").length;
  const isolated = rows.filter((row) => name(row.state) === "isolated").length;
  const weak = rows.filter((row) => strengthOf(row) < 100).length;
  let line = `${supplied} of ${rows.length} formations in supply`;
  const tail = [];
  if (strained > 0) tail.push(`${strained} strained`);
  if (isolated > 0) tail.push(`${isolated} cut off`);
  if (tail.length) line += `; ${tail.join(", ")}`;
  line += ".";
  if (weak > 0) line += ` ${weak} below full strength.`;
  return line;
};

const policyLineFor = (policyInForce, pendingPolicy) => {
  const inForce = name(policyInForce).toLowerCase();
  let line = inForce ? `Reinforcement policy: ${inForce} (in force)` : "Reinforcement policy: none in force";
  const pending = name(pendingPolicy).toLowerCase();
  if (pending && pending !== inForce) line += `; declared for next period: ${pending}`;
  return `${line}.`;
};

const rowLineFor = (row) =>
  `- ${name(row.name) || name(row.id)} [id ${name(row.id)}] ${strengthOf(row)}%, ${stateLabel(row.state)}.`;

export const buildOperationsDigest = ({
  formations = [],
  policyInForce = "",
  pendingPolicy = "",
  cap = OPERATIONS_ROW_CAP,
  charCap = OPERATIONS_CHAR_CAP,
} = {}) => {
  const rows = (Array.isArray(formations) ? formations : []).filter((row) => row && typeof row === "object" && name(row.id));
  if (!rows.length) return "";

  const limit = Math.max(0, Math.round(number(cap, OPERATIONS_ROW_CAP)));
  const budget = Math.max(0, Math.round(number(charCap, OPERATIONS_CHAR_CAP)));

  const ordered = rows.filter(needsAttention).sort(compareRows);
  const shown = ordered.slice(0, limit);
  // Only the rows left out that are out of supply are counted; a below-strength
  // row dropped by the cap is already in the summary's below-strength total.
  const overflow = ordered.slice(limit).filter((row) => name(row.state) !== "supplied").length;
  // The overflow notice is reserved before the clamp and emitted after the kept
  // rows, so the count the block exists to give can never be silently dropped.
  const overflowLine = overflow > 0 ? `+${overflow} more out of supply.` : "";

  const fixed = [
    "[Your Forces in the Field, as simulated]",
    summaryLineFor(rows),
    policyLineFor(policyInForce, pendingPolicy),
  ].join("\n");

  const detail = shown.map(rowLineFor);

  // A line that would overflow the cap is dropped whole rather than truncated,
  // so the model is never handed half a fact, like the economy digest.
  let used = fixed.length + (overflowLine ? overflowLine.length + 1 : 0);
  const kept = [];
  for (const line of detail) {
    if (used + line.length + 1 > budget) break;
    kept.push(line);
    used += line.length + 1;
  }
  return [fixed, ...kept, overflowLine].filter(Boolean).join("\n");
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/runtime/operationsDigest.test.js"`
Expected: PASS, all 8 tests green.

- [ ] **Step 5: Run the whole runtime suite to check for regressions**

Run: `node --test "src/runtime/*.test.js"`
Expected: PASS, zero failures.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/operationsDigest.js src/runtime/operationsDigest.test.js
git commit -m "feat(runtime): add the pure operations digest builder"
```

---

### Task 2: The policy fold, exported once

**Files:**
- Modify: `src/runtime/reinforcement.js:16-34`
- Test: `src/runtime/reinforcement.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `readReinforcementPolicies(world) -> { inForce, pending }`, each an object keyed by resolved polity with lower-cased policy values. `readReinforcement` keeps its exact signature and output, now folding `{ ...inForce, ...pending }` internally.

- [ ] **Step 1: Write the failing test**

Add to `src/runtime/reinforcement.test.js`. First extend the import line:

```js
import { readReinforcement, readReinforcementPolicies } from "./reinforcement.js";
```

Then append this test at the end of the file:

```js
test("the policy fold is exposed: committed overridden by the pending declaration", () => {
  const world = {
    economyEngine: {
      reinforcement: { France: "replacements", Germany: "none" },
      pendingReinforcement: [{ polity: "France", policy: "belligerent" }],
    },
  };
  const { inForce, pending } = readReinforcementPolicies(world);
  assert.deepEqual(inForce, { France: "replacements", Germany: "none" });
  assert.deepEqual(pending, { France: "belligerent" });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/runtime/reinforcement.test.js"`
Expected: FAIL, `readReinforcementPolicies is not a function` (or an import error).

- [ ] **Step 3: Write the minimal implementation**

In `src/runtime/reinforcement.js`, replace the policy block inside `readReinforcement` (currently the `const committed = ...` through the pending loop, then `const policies = ...` is not present, so the fold is inline) with an exported function, and call it. Insert this function immediately after the `list` helper and before `readReinforcement`:

```js
// The policy in force this span: committed, overridden by last turn's pending
// declaration. This turn's declaration is not read here; the economy commit
// stores it for next period, exactly as mobilization lags. Exported so the
// prompt wiring reads the same fold rather than restating it.
export const readReinforcementPolicies = (world) => {
  const resolveOwner = createOwnerResolver(buildOwnerAliasMap(world?.polityOverrides));
  const inForce = {};
  for (const [rawKey, rawValue] of Object.entries(world?.economyEngine?.reinforcement ?? {})) {
    const polity = resolveOwner(name(rawKey));
    const policy = name(rawValue).toLowerCase();
    if (polity && policy) inForce[polity] = policy;
  }
  const pending = {};
  for (const entry of list(world?.economyEngine?.pendingReinforcement)) {
    const polity = resolveOwner(name(entry?.polity ?? entry?.country));
    const policy = name(entry?.policy).toLowerCase();
    if (polity && policy) pending[polity] = policy;
  }
  return { inForce, pending };
};
```

Then, inside `readReinforcement`, replace the inline policy loop with the fold:

```js
  const resolveOwner = createOwnerResolver(buildOwnerAliasMap(world?.polityOverrides));
  const { inForce, pending } = readReinforcementPolicies(world);
  const policies = { ...inForce, ...pending };
```

The rest of `readReinforcement` (pools, units, wars, supply, `deriveReinforcement`, return) is unchanged. Do not remove the `resolveOwner` line: `pools` and `wars` still use it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/runtime/reinforcement.test.js"`
Expected: PASS, the existing 4 tests plus the new one.

- [ ] **Step 5: Run the runtime and wiring-guard suites**

Run: `node --test "src/runtime/*.test.js"`
Expected: PASS, zero failures, including `reinforcementWiringArchitecture.test.js`.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/reinforcement.js src/runtime/reinforcement.test.js
git commit -m "refactor(runtime): expose the reinforcement policy fold once"
```

---

### Task 3: The prompt rule and heading

**Files:**
- Modify: `src/Game/AI/gameplayPrompts.js:493-513`
- Test: `src/Game/AI/operationsPrompt.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildForcePoolsInstructions({ digest = "", operations = "" }) -> string`. When `operations` is non-empty it is appended after the reserve fact block as its own paragraph (it already carries its own `[Your Forces in the Field, as simulated]` header).

- [ ] **Step 1: Write the failing test**

Create `src/Game/AI/operationsPrompt.test.js`:

```js
// Run: node --test src/Game/AI/operationsPrompt.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { buildForcePoolsInstructions } from "./gameplayPrompts.js";

test("the force-pool block renders the operations digest when it is given", () => {
  const text = buildForcePoolsInstructions({
    digest: "Your reserves: nothing.",
    operations: "[Your Forces in the Field, as simulated]\n1 of 1 formations in supply.",
  });
  assert.match(text, /\[Your Forces in the Field, as simulated\]/);
  assert.match(text, /1 of 1 formations in supply\./);
});

test("the operations heading is omitted when the block is empty", () => {
  const text = buildForcePoolsInstructions({ digest: "Your reserves: nothing." });
  assert.equal(text.includes("[Your Forces in the Field"), false);
});

test("the rule teaches when each policy and each consolidation fits", () => {
  const text = buildForcePoolsInstructions();
  assert.match(text, /husband/i);
  assert.match(text, /pocket/i);
  assert.match(text, /replacements/);
  assert.match(text, /belligerent/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/Game/AI/operationsPrompt.test.js"`
Expected: FAIL: the heading test fails because `operations` is ignored, and the rule test fails because the guidance paragraph does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

In `src/Game/AI/gameplayPrompts.js`, change the signature and body of `buildForcePoolsInstructions`:

```js
export const buildForcePoolsInstructions = ({ digest = "", operations = "" } = {}) => {
```

Add this paragraph to the `rules` array immediately after the existing "Reserves can also rebuild a formation" entry (the one that ends `state no manpower or materiel number.`), and before `"Declare a posture sparingly ..."`:

```js
    "Your own forces' real state is given below; treat it as fact. Choose the policy by what the war asks "
    + "of you: replacements (the default) keeps every in-supply formation topped up, for a general war or a "
    + "full treasury; belligerent tops up only the formations of a polity fighting an active war, for a "
    + "limited war or thin reserves; none stops the top-ups, to husband reserves after a peace or to save for "
    + "production. Relieve a worn in-supply formation by rotating in a fresh one of the same type when both "
    + "are in supply; fold two weak formations of one type standing together into one by merging, which works "
    + "even in a pocket. The engine owns every cost and result; declare only what the period's events "
    + "justify, and most periods have none.",
```

Replace the tail of the function:

```js
  const facts = String(digest ?? "").trim();
  return facts ? `${rules}\n\n[The Period's Reserves, as simulated]\n${facts}` : rules;
```

with:

```js
  const facts = String(digest ?? "").trim();
  const field = String(operations ?? "").trim();
  const parts = [rules];
  if (facts) parts.push(`[The Period's Reserves, as simulated]\n${facts}`);
  if (field) parts.push(field);
  return parts.join("\n\n");
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/Game/AI/operationsPrompt.test.js" "src/Game/AI/reinforcementPrompt.test.js" "src/Game/AI/forcePoolsPrompt.test.js"`
Expected: PASS, including the pre-existing force-pool and reinforcement prompt tests.

- [ ] **Step 5: Commit**

```bash
git add src/Game/AI/gameplayPrompts.js src/Game/AI/operationsPrompt.test.js
git commit -m "feat(ai): teach the force-pool prompt the operations state"
```

---

### Task 4: The wiring and its guard

**Files:**
- Modify: `src/Game/AI/gameplay.js` (imports near lines 34, 101, 308; the jump block near lines 13022-13033; the prompt call near line 2648)
- Test: `src/Game/AI/operationsWiringArchitecture.test.js`

**Interfaces:**
- Consumes: `buildOperationsDigest` (Task 1), `readReinforcementPolicies` (Task 2), `buildForcePoolsInstructions` (Task 3).
- Produces: `variables.operationsDigest` set in the jump path beside `variables.forcePoolsDigest`, and passed to `buildForcePoolsInstructions`.

- [ ] **Step 1: Write the failing test**

Create `src/Game/AI/operationsWiringArchitecture.test.js`:

```js
// Run: node --test src/Game/AI/operationsWiringArchitecture.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const builder = readFileSync(new URL("../../runtime/operationsDigest.js", import.meta.url), "utf8");

test("the operations digest builder imports nothing", () => {
  const specifiers = [...builder.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(specifiers, []);
});

test("the jump reads supply from the primed catalog for the operations digest", () => {
  assert.ok(
    gameplay.includes("readSupplyAttrition(bundle.world, getPrimedScenarioRegionCatalog() ?? []"),
    "the operations supply read is missing",
  );
  assert.ok(gameplay.includes("buildOperationsDigest("), "the operations digest is not built");
  assert.ok(
    gameplay.includes("operations: variables?.operationsDigest"),
    "the operations digest is not handed to the prompt",
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/Game/AI/operationsWiringArchitecture.test.js"`
Expected: FAIL: the builder file exists, so the first test passes, but the wiring test fails because `gameplay.js` has no operations build yet. (If `operationsDigest.js` is missing, run Task 1 first; tasks run in order.)

- [ ] **Step 3: Add the imports**

In `src/Game/AI/gameplay.js`:

Change line 34 from:

```js
import { readReinforcement } from "../../runtime/reinforcement.js";
```

to:

```js
import { readReinforcement, readReinforcementPolicies } from "../../runtime/reinforcement.js";
```

Change the line 101 import from:

```js
import { buildOwnerAliasMap, canonicalOwnerName, toCountryName } from "../../runtime/ownerNames.js";
```

to:

```js
import { buildOwnerAliasMap, canonicalOwnerName, createOwnerResolver, toCountryName } from "../../runtime/ownerNames.js";
```

Add, after the `buildEconomyDigest` import (line 308):

```js
import { buildOperationsDigest } from "../../runtime/operationsDigest.js";
```

Confirm `createOwnerResolver` is exported from `src/runtime/ownerNames.js` before relying on it:

Run: `grep -n "export const createOwnerResolver" src/runtime/ownerNames.js`
Expected: one match.

- [ ] **Step 4: Build the digest in the jump path**

In `src/Game/AI/gameplay.js`, inside `simulateTimelineJump`, find this block (around line 13022):

```js
    if (projected.months > 0) {
      const committedPosture = bundle.world?.economyEngine?.mobilization?.[playerPolity] || DEFAULT_POSTURE;
      const postureNow = projected.posture?.[playerPolity] || DEFAULT_POSTURE;
      variables.forcePoolsDigest = buildEconomyDigest({
        deltas: [],
        playerPolity,
        playerPools: projected.pools?.[playerPolity] ?? null,
        playerPosture: postureNow,
        postureChanged: postureNow !== committedPosture,
        playerShortfall: projected.shortfall?.[playerPolity] ?? null,
      });
      const researchState = projected.research?.[playerPolity];
```

Insert the operations build between the `forcePoolsDigest` assignment and `const researchState`:

```js
      // The player's own formations in the field: the supply state part two
      // derives and the policy part three puts in force. The model is otherwise
      // blind to both, so it cannot direct a rotation or a merge. Player-only
      // and capped; built from the same reads the turn itself uses.
      const resolveOwner = createOwnerResolver(buildOwnerAliasMap(bundle.world?.polityOverrides));
      const playerKey = resolveOwner(playerPolity) || playerPolity;
      const supplyById = new Map(
        readSupplyAttrition(bundle.world, getPrimedScenarioRegionCatalog() ?? [], {
          fromDate: originDate,
          toDate: targetDate,
        }).units.map((row) => [normalizeString(row.unitId), row]),
      );
      const formations = (Array.isArray(bundle.world?.units) ? bundle.world.units : [])
        .filter((unit) => resolveOwner(normalizeString(unit?.ownerCode)) === playerKey)
        .map((unit) => {
          const supply = supplyById.get(normalizeString(unit?.id));
          return {
            id: normalizeString(unit?.id),
            name: normalizeString(unit?.name) || normalizeString(unit?.id),
            type: normalizeString(unit?.type),
            strength: unit?.strength,
            state: supply?.state,
            reachable: supply?.reachable,
          };
        });
      const { inForce, pending } = readReinforcementPolicies(bundle.world);
      variables.operationsDigest = buildOperationsDigest({
        formations,
        policyInForce: inForce?.[playerKey] ?? "",
        pendingPolicy: pending?.[playerKey] ?? "",
      });
```

- [ ] **Step 5: Hand the digest to the prompt**

Find the force-pools prompt call (around line 2648):

```js
    const forceBlock = buildForcePoolsInstructions({ digest: variables?.forcePoolsDigest });
```

Replace it with:

```js
    const forceBlock = buildForcePoolsInstructions({
      digest: variables?.forcePoolsDigest,
      operations: variables?.operationsDigest,
    });
```

- [ ] **Step 6: Run the guard test to verify it passes**

Run: `node --test "src/Game/AI/operationsWiringArchitecture.test.js"`
Expected: PASS, both tests green.

- [ ] **Step 7: Lint the changed file and run the AI suite**

Run: `npx eslint src/Game/AI/gameplay.js`
Expected: no errors (the 10 pre-existing warnings are acceptable).

Run: `node --test "src/Game/AI/*.test.js"`
Expected: PASS, zero failures.

- [ ] **Step 8: Commit**

```bash
git add src/Game/AI/gameplay.js src/Game/AI/operationsWiringArchitecture.test.js
git commit -m "feat(ai): wire the operations digest into the jump prompt"
```

---

### Task 5: Document the module

**Files:**
- Modify: `docs/runtime-services.md` (insert after the reinforcement section, which ends before the `---` that precedes `## Library store`)

**Interfaces:**
- Consumes: nothing.
- Produces: a documentation section only.

- [ ] **Step 1: Insert the section**

In `docs/runtime-services.md`, find the end of the reinforcement section (the bullet that begins `- **The turn** applies the ops in applySimulationResult`), and insert after it:

```markdown

---

## Operations digest - `src/runtime/operationsDigest.js`

`buildOperationsDigest({ formations, policyInForce, pendingPolicy, cap, charCap })`
renders the player's own formations in the field as one short, capped block the
jump prompt shows through `buildForcePoolsInstructions`
(`src/Game/AI/gameplayPrompts.js`): a supply summary, the reinforcement policy in
force and any pending declaration, and a reminder list of the formations that
are cut off, strained or below full strength, each with the id a rotation or a
merge names. It is player-only, so an enemy's supply state is never disclosed,
and it is a pure string transform with no imports: `src/Game/AI/gameplay.js`
supplies the rows, joining the supply read of part two to the roster for each
formation's name, type and current strength. The row cap is `OPERATIONS_ROW_CAP`
(6) and the character cap `OPERATIONS_CHAR_CAP` (360), mirroring the economy
digest. Nothing is stored and no engine rule changes: the model is shown what
the engine already computed.
```

- [ ] **Step 2: Verify the wiki check is still current**

Run: `npm run wiki:check`
Expected: `Wiki is current.` (this file is under `docs/`, not `wiki/`, so no regeneration is needed; the check confirms nothing drifted).

- [ ] **Step 3: Commit**

```bash
git add docs/runtime-services.md
git commit -m "docs(runtime): document the operations digest"
```

---

## Final Acceptance

After all five tasks:

- [ ] `node --test "src/engine/*.test.js"` passes.
- [ ] `node --test "src/runtime/*.test.js"` passes.
- [ ] `node --test "src/Game/AI/*.test.js"` passes.
- [ ] `npm test` passes with zero failures (the known `server/appUpdate.test.js` network flake, if it appears, is not a regression).
- [ ] `npx eslint src/runtime/operationsDigest.js src/runtime/reinforcement.js src/Game/AI/gameplayPrompts.js src/Game/AI/gameplay.js` reports no errors.
- [ ] `npm run wiki:check` reports `Wiki is current.`
- [ ] `npm run build` exits `0`.
- [ ] `git diff <base>..HEAD -- package.json` is empty and `ENGINE_VERSION` is unchanged.
- [ ] Every commit carries the `Co-authored-by: monkeycode-ai` trailer.
