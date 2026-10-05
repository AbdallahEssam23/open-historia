# Held Peace Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the engine refuse and withhold any war record that would end, leave or cease fire the player's war while a peace offer is pending, at both the validator door and the apply door.

**Architecture:** A pure, import-free predicate in `src/runtime/peaceOffer.js` names the conflict. `validateWarLedgerPayload` refuses a conflicting record so the model rewrites its prose on the corrective retry; the existing `repairWarLedgerPayload` salvage drops it on the final attempt. `applyWarUpdates` independently withholds a conflicting record and reports it in a new `withheldIds` array, which the turn receipts and the Game Master apply counts so a held operation is reported, not thrown.

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

### Task 1: The conflict predicate

**Files:**
- Modify: `src/runtime/peaceOffer.js` (append after `buildPeaceOfferDigest`)
- Test: `src/runtime/peaceOffer.test.js`

**Interfaces:**
- Consumes: the module's existing `normalizePeaceOffer`.
- Produces:
  - `PEACE_OFFER_HELD_OPS`: a frozen array `["end", "ceasefire", "leave"]`.
  - `peaceOfferHoldsWarUpdate({ update, offer })`: boolean, true when `update`
    is one of the held ops for the offered war.

- [ ] **Step 1: Write the failing test**

Append to `src/runtime/peaceOffer.test.js`:

```js
import {
  PEACE_OFFER_HELD_OPS,
  peaceOfferHoldsWarUpdate,
} from "./peaceOffer.js";

test("the held ops are the three that close the offered war", () => {
  assert.deepEqual([...PEACE_OFFER_HELD_OPS], ["end", "ceasefire", "leave"]);
});

test("a record that would close the offered war is held", () => {
  const held = { warId: "war-7" };
  for (const op of ["end", "ceasefire", "leave"]) {
    assert.equal(peaceOfferHoldsWarUpdate({ update: { id: "war-7", op }, offer: held }), true, op);
  }
  assert.equal(
    peaceOfferHoldsWarUpdate({ update: { id: "war-7", op: " END " }, offer: held }),
    true,
    "the op is trimmed and lower-cased like the ledger does",
  );
});

test("a record the offered war survives is not held", () => {
  const held = { warId: "war-7" };
  for (const op of ["join-a", "join-b", "resume", "goals", "start"]) {
    assert.equal(peaceOfferHoldsWarUpdate({ update: { id: "war-7", op }, offer: held }), false, op);
  }
  assert.equal(
    peaceOfferHoldsWarUpdate({ update: { id: "war-8", op: "end" }, offer: held }),
    false,
    "another war is untouched",
  );
  assert.equal(peaceOfferHoldsWarUpdate({ update: { id: "war-7", op: "" }, offer: held }), false);
});

test("no offer holds nothing", () => {
  assert.equal(peaceOfferHoldsWarUpdate({ update: { id: "war-7", op: "end" }, offer: null }), false);
  assert.equal(peaceOfferHoldsWarUpdate({ update: { id: "war-7", op: "end" }, offer: { warId: "" } }), false);
  assert.equal(peaceOfferHoldsWarUpdate({ update: { id: "war-7", op: "end" } }), false);
  assert.equal(peaceOfferHoldsWarUpdate(), false);
});
```

Note: the file already imports `test`, `assert`, and `buildPeaceOfferDigest`,
`choosePeaceOffer`, `normalizePeaceOffer` from `./peaceOffer.js`. Merge the new
names into that existing import rather than adding a second import statement.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/runtime/peaceOffer.test.js"`
Expected: FAIL, `peaceOfferHoldsWarUpdate is not a function` (or an import
error for the missing names).

- [ ] **Step 3: Write the minimal implementation**

Append to `src/runtime/peaceOffer.js`:

```js
// The operations that end a war's life. A pending offer holds exactly these:
// a goal declaration or a joiner does not close the war, so neither is held.
export const PEACE_OFFER_HELD_OPS = Object.freeze(["end", "ceasefire", "leave"]);

// True when this war record would close, leave or cease fire the war the engine
// is holding open for the player's decision. The ledger trims an id and
// lower-cases an op, so this matches that normalisation and nothing more.
export const peaceOfferHoldsWarUpdate = ({ update, offer } = {}) => {
  const pending = normalizePeaceOffer(offer);
  if (!pending) return false;
  const warId = String(update?.id ?? "").trim();
  if (!warId || warId !== pending.warId) return false;
  return PEACE_OFFER_HELD_OPS.includes(String(update?.op ?? "").trim().toLowerCase());
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/runtime/peaceOffer.test.js"`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/peaceOffer.js src/runtime/peaceOffer.test.js
git commit -m "feat(runtime): name the war records a pending peace offer holds"
```

---

### Task 2: The validator refuses, so the model rewrites

**Files:**
- Modify: `src/Game/AI/nativeWarLedger.js` (import block; `validateWarLedgerPayload` at ~946)
- Test: `src/Game/AI/warLedger.test.js`

**Interfaces:**
- Consumes: `peaceOfferHoldsWarUpdate` from `../../runtime/peaceOffer.js`.
- Produces: no new export. `validateWarLedgerPayload(candidate, { world })`
  keeps its `string` return; a conflicting record now yields the held-war
  message instead of `""`.

- [ ] **Step 1: Write the failing test**

Append to `src/Game/AI/warLedger.test.js`:

```js
test("a record that would close the held war is refused, and the rest are not", () => {
  const heldWorld = {
    polityOverrides: {},
    wars: [
      { id: "war-1", status: "active", sideA: ["Prussia"], sideB: ["France"], startedDate: "1800-01-01" },
      { id: "war-2", status: "active", sideA: ["Spain"], sideB: ["Portugal"], startedDate: "1800-01-01" },
    ],
    peaceOffer: { warId: "war-1", round: 3, pressure: 0.7 },
  };
  const endOne = [{
    id: "e1", date: "1800-02-01", title: "Peace of Basel",
    description: "Prussia and France sign a peace.", kind: "military",
    warId: "war-1", combatants: ["Prussia", "France"],
  }];
  const endTwo = [{
    id: "e2", date: "1800-02-02", title: "Peace of Madrid",
    description: "Spain and Portugal sign a peace.", kind: "military",
    warId: "war-2", combatants: ["Spain", "Portugal"],
  }];

  const refused = validateWarLedgerPayload(
    { events: endOne, warUpdates: "war-1~end~Prussia~~1~Peace signed" },
    { world: heldWorld },
  );
  assert.match(refused, /held open by a pending peace offer/);

  // A goal declaration does not close the war.
  assert.equal(
    validateWarLedgerPayload({ events: [], warUpdates: "war-1~goals~Prussia:annex~~~" }, { world: heldWorld }),
    "",
  );
  // A different war is untouched.
  assert.equal(
    validateWarLedgerPayload({ events: endTwo, warUpdates: "war-2~end~Spain~~1~Peace signed" }, { world: heldWorld }),
    "",
  );
  // Without an offer the very same record is valid.
  assert.equal(
    validateWarLedgerPayload(
      { events: endOne, warUpdates: "war-1~end~Prussia~~1~Peace signed" },
      { world: { polityOverrides: {}, wars: heldWorld.wars } },
    ),
    "",
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/Game/AI/warLedger.test.js"`
Expected: FAIL on the `assert.match(refused, /held open by a pending peace offer/)`
line, because the current validator returns `""` and the war ends.

- [ ] **Step 3: Write the minimal implementation**

Add the import beside the other runtime imports at the top of
`src/Game/AI/nativeWarLedger.js`:

```js
import { peaceOfferHoldsWarUpdate } from "../../runtime/peaceOffer.js";
```

Change `validateWarLedgerPayload` so it runs the held-war check only after the
binding verdict passes. Replace its body's final `return validateBoundWarBatch(...)`
with:

```js
  const bound = validateBoundWarBatch({ events, updates, world, requireUpdateLinks: true });
  if (bound) return bound;
  // A due settlement of the player's own war is held as world.peaceOffer until
  // the player decides. A record that would close, leave or cease fire that war
  // is refused here so the corrective retry rewrites the prose; on the final
  // attempt repairWarLedgerPayload makes the batch valid again by dropping it,
  // exactly as it does for a binding failure, and the war stays open.
  for (const update of updates) {
    if (peaceOfferHoldsWarUpdate({ update, offer: world?.peaceOffer })) {
      return `War ${update.id} is held open by a pending peace offer; the engine will not apply a ${update.op} record. `
        + "The war stays active until the player accepts or declines. Narrate the war as unresolved: keep it open and write no end, ceasefire or leave record for it.";
    }
  }
  return "";
```

`validateWarLedgerPayload` is imported only by the turn's
`validateSegmentLedgers` and by `repairWarLedgerPayload`, so this refusal
reaches the model's turn and not the Game Master preview (which validates
through `validateCanonicalWarEvents`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/Game/AI/warLedger.test.js"`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add src/Game/AI/nativeWarLedger.js src/Game/AI/warLedger.test.js
git commit -m "feat(ai): refuse a war record that closes the held peace offer"
```

---

### Task 3: The apply withholds and reports

**Files:**
- Modify: `src/Game/AI/nativeWarLedger.js` (`applyWarUpdates` at ~1126)
- Test: `src/Game/AI/warLedger.test.js`

**Interfaces:**
- Consumes: `peaceOfferHoldsWarUpdate` (Task 1, already imported in Task 2);
  `normalizePeaceOffer` is not imported here, the hold reads `nextWorld.peaceOffer`.
- Produces: `applyWarUpdates` now returns
  `{ world, wars, appliedIds, withheldIds }`. `withheldIds` is a `string[]` of
  war ids whose records were held; those ids never appear in `appliedIds`.

- [ ] **Step 1: Write the failing test**

Append to `src/Game/AI/warLedger.test.js`:

```js
test("applyWarUpdates holds the offered war and still applies the rest", () => {
  const heldWorld = {
    polityOverrides: {},
    wars: [
      { id: "war-1", status: "active", sideA: ["Prussia"], sideB: ["France"], startedDate: "1800-01-01" },
      { id: "war-2", status: "active", sideA: ["Spain"], sideB: ["Portugal"], startedDate: "1800-01-01" },
    ],
    peaceOffer: { warId: "war-1", round: 3, pressure: 0.7 },
  };
  const events = [
    { id: "e1", date: "1800-02-01", title: "Peace of Basel", description: "Prussia and France sign a peace.", kind: "military", warId: "war-1", combatants: ["Prussia", "France"] },
    { id: "e2", date: "1800-02-02", title: "Peace of Madrid", description: "Spain and Portugal sign a peace.", kind: "military", warId: "war-2", combatants: ["Spain", "Portugal"] },
  ];
  const updates = decodeWarUpdates(
    "war-1~end~Prussia~~1~Peace signed\nwar-2~end~Spain~~2~Peace signed",
  );
  const merge = applyWarUpdates({ world: heldWorld, updates, events, stopDate: "1800-02-02", round: 4 });

  assert.deepEqual(merge.appliedIds, ["war-2"]);
  assert.deepEqual(merge.withheldIds, ["war-1"]);
  const status = Object.fromEntries(merge.wars.map((war) => [war.id, war.status]));
  assert.equal(status["war-1"], "active", "the held war stays open");
  assert.equal(status["war-2"], "ended");
});

test("without an offer nothing is held", () => {
  const worldNoOffer = {
    polityOverrides: {},
    wars: [{ id: "war-1", status: "active", sideA: ["Prussia"], sideB: ["France"], startedDate: "1800-01-01" }],
  };
  const events = [{
    id: "e1", date: "1800-02-01", title: "Peace of Basel",
    description: "Prussia and France sign a peace.", kind: "military",
    warId: "war-1", combatants: ["Prussia", "France"],
  }];
  const merge = applyWarUpdates({
    world: worldNoOffer,
    updates: decodeWarUpdates("war-1~end~Prussia~~1~Peace signed"),
    events,
    stopDate: "1800-02-01",
    round: 2,
  });
  assert.deepEqual(merge.appliedIds, ["war-1"]);
  assert.deepEqual(merge.withheldIds, []);
  assert.equal(merge.wars[0].status, "ended");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/Game/AI/warLedger.test.js"`
Expected: FAIL, `merge.withheldIds` is `undefined` and `appliedIds` still
contains `"war-1"`.

- [ ] **Step 3: Write the minimal implementation**

In `applyWarUpdates`, declare the held war and the withheld list, and skip a
conflicting record before it reaches the map:

```js
  const nextWorld = normalizeWorldState(world);
  const map = warMapFromWorld(nextWorld);
  const decoded = bindWarUpdatesToEvents(updates, events);
  const appliedIds = [];
  const withheldIds = [];
  // The offer was read from this same world; normalizeWorldState round-trips it,
  // so a held war survives every caller (the turn, advanceLedgerWorld, the GM
  // apply). A record that would close it is held, not dropped as invalid.
  const heldWarId = normalizePeaceOffer(nextWorld.peaceOffer)?.warId || "";

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

Add the `normalizePeaceOffer` import beside the Task 2 import:

```js
import { normalizePeaceOffer, peaceOfferHoldsWarUpdate } from "../../runtime/peaceOffer.js";
```

And extend the return with the new field:

```js
  return { world: { ...nextWorld, wars }, wars, appliedIds, withheldIds };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/Game/AI/warLedger.test.js"`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add src/Game/AI/nativeWarLedger.js src/Game/AI/warLedger.test.js
git commit -m "feat(ai): withhold a closing war record at apply time"
```

---

### Task 4: The turn receipts the hold and the GM apply counts it

**Files:**
- Modify: `src/Game/AI/gameplay.js` (after `worldWithImpacts = warMerge.world;` at ~6974; the GM apply check at ~14529)
- Test: `src/Game/AI/peaceOfferWiringArchitecture.test.js`

**Interfaces:**
- Consumes: `applyWarUpdates`'s `withheldIds` (Task 3).
- Produces: no new export. The turn's receipt carries a `withheld` line per
  held war; the Game Master apply no longer throws on a held record.

- [ ] **Step 1: Write the failing test**

Append to `src/Game/AI/peaceOfferWiringArchitecture.test.js`:

```js
test("the ledger refuses and withholds the offered war", () => {
  const ledger = read("./nativeWarLedger.js");
  assert.match(ledger, /peaceOfferHoldsWarUpdate/);
  assert.match(ledger, /withheldIds/);
  assert.match(ledger, /world\?\.peaceOffer|world\.peaceOffer/);
});

test("the turn receipts a held war and the GM apply counts it", () => {
  assert.match(gameplay, /warMerge\.withheldIds/);
  assert.match(gameplay, /appliedIds\.length \+ warMerge\.withheldIds\.length/);
});
```

Note: the file already defines `read`, `gameplay`, and imports `test` and
`assert`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/Game/AI/peaceOfferWiringArchitecture.test.js"`
Expected: FAIL on both new tests: `gameplay.js` never mentions
`warMerge.withheldIds`.

- [ ] **Step 3: Write the minimal implementation**

In `applySimulationResult`, immediately after `worldWithImpacts = warMerge.world;`
(the merge that currently ends with that assignment), add:

```js
  // A record that would close the player's offered war is held at apply time
  // too, for any path the validator did not reach. It is a deliberate hold, not
  // a drop, so the turn's receipt names it and the action does not fail.
  for (const warId of normalizeArray(warMerge.withheldIds)) {
    if (receipt) {
      noteReceipt(receipt, "withheld", `The war ${warId} is held open by the player's pending peace offer; the engine did not apply the record that would close it.`);
    }
  }
  if (normalizeArray(warMerge.withheldIds).length) {
    logDebugEvent("turn", `Held war operations awaiting the player's peace decision: ${normalizeArray(warMerge.withheldIds).join(", ")}.`);
  }
```

In the Game Master apply, change the integrity check and report a hold. Replace:

```js
    if (warMerge.appliedIds.length !== warUpdatesForApply.length) {
      throw new Error("A canonical war operation failed during the in-memory apply. Nothing was persisted; regenerate the preview.");
    }
```

with:

```js
    if (warMerge.appliedIds.length + warMerge.withheldIds.length !== warUpdatesForApply.length) {
      throw new Error("A canonical war operation failed during the in-memory apply. Nothing was persisted; regenerate the preview.");
    }
    if (warMerge.withheldIds.length) {
      logDebugEvent("turn", `A held war operation was not applied: ${warMerge.withheldIds.join(", ")} awaits the player's peace decision.`);
    }
```

The Game Master merge has an empty-updates fallback with no withheld list, so
give it one. Replace:

```js
      : { world: nextWorld, appliedIds: [] };
```

with:

```js
      : { world: nextWorld, appliedIds: [], withheldIds: [] };
```

Without this the new `warMerge.withheldIds.length` throws on every Game Master
apply that carries no war record.

- [ ] **Step 4: Run the guards and a syntax check**

Run: `node --test "src/Game/AI/peaceOfferWiringArchitecture.test.js"`
Expected: PASS, all tests.

Run: `node --check src/Game/AI/gameplay.js`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/Game/AI/gameplay.js src/Game/AI/peaceOfferWiringArchitecture.test.js
git commit -m "feat(ai): report the held war to the receipt and the GM apply"
```

---

### Task 5: Document the two doors

**Files:**
- Modify: `docs/runtime-services.md` (after the settlement paragraph ending "...accepts optional `weariness` and `resolveRegion`.")

**Interfaces:**
- Consumes: nothing.
- Produces: nothing; documentation only.

- [ ] **Step 1: Add the paragraph**

Insert a new paragraph after the settlement paragraph (the one that ends
"...accepts optional `weariness` and `resolveRegion`."):

```markdown
A due settlement of the player's own war is offered, not applied, so the war
stays active until the player answers. The engine enforces that hold at two
doors. `src/runtime/peaceOffer.js` names the operations that would close it
(`end`, `ceasefire`, `leave`) in an import-free predicate; the turn's validator
(`validateWarLedgerPayload` in `src/Game/AI/nativeWarLedger.js`) refuses such a
record while an offer is pending, so the model rewrites its prose on the
corrective retry, and the existing salvage drops it on the final attempt.
`applyWarUpdates` withholds the same record on its own and reports the ids in
`withheldIds`, so a path with no retry - the Game Master apply, the per-segment
ledger advance - cannot close the war either; the Game Master integrity check
counts the held ids so the operation is reported, never thrown. The turn notes
each held war with a `withheld` receipt line and a debug log.
```

- [ ] **Step 2: Verify the docs gate and the wiki check**

Run: `npm run wiki:check`
Expected: `Wiki is current.` (this paragraph is not generated wiki content).

- [ ] **Step 3: Commit**

```bash
git add docs/runtime-services.md
git commit -m "docs(runtime): note the held peace enforcement"
```

---

### Task 6: Whole-suite gate

**Files:** none; verification only.

**Interfaces:** none.

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: 3000 baseline tests plus the new ones, 0 fail. Baseline before this
increment was 3000 tests, 2998 pass, 0 fail, 2 todo.

- [ ] **Step 2: Run the engine purity and runtime globs**

Run: `node --test "src/engine/*.test.js"`
Expected: PASS (untouched).

Run: `node --test "src/runtime/*.test.js"`
Expected: PASS, including the new predicate tests.

- [ ] **Step 3: Lint the changed files and build**

Run: `npx eslint src/runtime/peaceOffer.js src/Game/AI/nativeWarLedger.js src/Game/AI/gameplay.js src/Game/AI/peaceOfferWiringArchitecture.test.js src/Game/AI/warLedger.test.js src/runtime/peaceOffer.test.js`
Expected: 0 errors on these files (the repo's 18 pre-existing errors live in
`src/Game/Map/*`).

Run: `npm run build`
Expected: exit 0.
