# Settlement Reaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a war whose aggressor was recorded as unjust settles, degrade that side's goal score before the victor is chosen and make its defeat pay punitive terms.

**Architecture:** Extend the existing pure core `src/engine/warSettlement.js` with two constants, two optional `settleWar` inputs (`unjustA`/`unjustB`), a legitimacy-scaled score used only to pick the victor, punitive annex/reparations terms and a `punitive` flag on the returned settlement. Extend the existing runtime adapter `src/runtime/warSettlement.js` to derive the two flags from a war's stored `unjustAggressors` and to name a punitive peace in the narrated event. One receipt line in `src/Game/AI/gameplay.js` gains a punitive qualifier. No new file, no new seam, no new stored field, no migration.

**Tech Stack:** JavaScript ES modules, `node:test`, `node:assert/strict`. No new dependency.

## Global Constraints

- ASCII only in source and docs. No emoji, no em dash, no middle dot.
- `src/engine/**` stays pure: no browser or `src/Game/AI` import, no `Date.now`, no `new Date`, no `Math.random`. Order with `<`, fold with `toLowerCase`, never `localeCompare` or `toLocaleLowerCase`.
- Engine import whitelist (`src/engine/enginePurity.test.js`): `./name.js`, `../runtime/gameDates.js`, `../runtime/unitMotion.js`. `src/engine/warSettlement.js` must keep importing only `./economyMath.js`.
- `src/runtime/warSettlement.js` imports nothing from `src/Game/AI/`.
- Constants are engine exports: `UNJUST_LEGITIMACY_FACTOR = 0.75`, `UNJUST_REPARATION_SHARE = 0.5`. The existing `REPARATION_SHARE = 0.25`, `REPARATION_MANPOWER_CAP = 1000000` and `MAX_TARGET_REGIONS = 32` stay unchanged.
- Both flags default to `false`, so a war with no recorded unjust aggressor settles on exactly the terms it did before; no migration and no `ENGINE_VERSION` bump.
- The `achieved` gate reads the raw score; the legitimacy factor scales only the score used to pick the victor.
- Every commit carries the trailer `Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>` added by the `prepare-commit-msg` hook: do NOT pass it with `-m`.
- Run tests with quoted globs: `node --test "src/engine/*.test.js"`, `node --test "src/runtime/*.test.js"`, `node --test "src/Game/AI/*.test.js"`. `node --test <dir>` does not work.
- Do not change an existing test's assertions to accommodate a change; adding imports and appending new tests is allowed.
- `src/Game/AI/gameplay.js` is not importable under `node:test` (it imports `./main.jsx`); its verification is a source-text guard plus `node --check`.

---

### Task 1: The legitimacy and the punitive terms in the pure core

**Files:**
- Modify: `src/engine/warSettlement.js`
- Test: `src/engine/warSettlement.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `UNJUST_LEGITIMACY_FACTOR` (const 0.75), `UNJUST_REPARATION_SHARE` (const 0.5).
  - `settleWar(input)` gains two optional inputs `unjustA = false` and `unjustB = false`. The victor is chosen by `warGoalScore(...) * UNJUST_LEGITIMACY_FACTOR` for an unjust side and by the raw score otherwise; the `achieved` gate still reads the raw score. The returned settlement gains `punitive: boolean`, true exactly when the unjust side lost. A punitive `reparations` victor takes `UNJUST_REPARATION_SHARE`; a punitive `annex` victor takes every declared target, held or not.

- [ ] **Step 1: Write the failing tests**

In `src/engine/warSettlement.test.js`, add the two constants to the existing import block so it reads:

```js
import {
  MOBILIZATION_WEARINESS_DRAG,
  REPARATION_MANPOWER_CAP,
  REPARATION_SHARE,
  UNJUST_LEGITIMACY_FACTOR,
  UNJUST_REPARATION_SHARE,
  WAR_GOAL_KINDS,
  WEARINESS_CAPITULATION,
  WEARINESS_COMPEL,
  WEARINESS_LOSS_GAIN,
  WEARINESS_MONTHLY_GAIN,
  normalizeWarGoals,
  normalizeWeariness,
  settleWar,
  warGoalScore,
  warPressure,
  wearinessStep,
} from "./warSettlement.js";
```

Append these tests to the end of `src/engine/warSettlement.test.js`:

```js
test("the unjust-war constants are the declared values", () => {
  assert.equal(UNJUST_LEGITIMACY_FACTOR, 0.75);
  assert.equal(UNJUST_REPARATION_SHARE, 0.5);
});

test("a war with no unjust flag settles on exactly the terms it did before", () => {
  const input = baseWar({
    wearinessB: WEARINESS_CAPITULATION,
    goalsA: { kind: "annex", targetRegionIds: ["r1", "r2"], note: "" },
    heldRegionIdsA: ["r1"],
  });
  const absent = settleWar(input);
  const explicit = settleWar({ ...input, unjustA: false, unjustB: false });
  assert.equal(absent.punitive, false);
  assert.equal(JSON.stringify(absent), JSON.stringify(explicit));
  // The pre-existing fields this increment must not move:
  assert.equal(absent.key, "war-1|1915-01-01|a|b");
  assert.equal(absent.victor, "a");
  assert.equal(absent.loser, "b");
  assert.equal(absent.capitulation, true);
  assert.equal(absent.white, false);
  assert.deepEqual(absent.transfers, [
    { regionId: "r1", fromCode: "B", toCode: "A" },
    { regionId: "r2", fromCode: "B", toCode: "A" },
  ]);
});

test("legitimacy flips an even race to the just side", () => {
  const reparations = { kind: "reparations", targetRegionIds: [], note: "" };
  const even = baseWar({
    wearinessA: WEARINESS_COMPEL,
    wearinessB: WEARINESS_COMPEL,
    advantageA: 0.5,
    advantageB: 0.5,
    goalsA: reparations,
    goalsB: reparations,
  });
  assert.equal(settleWar(even).victor, "a", "the tie defaults to side A");
  assert.equal(settleWar({ ...even, unjustA: true }).victor, "b");
  assert.equal(settleWar({ ...even, unjustB: true }).victor, "a");
});

test("legitimacy does not overturn a clear dominance", () => {
  const reparations = { kind: "reparations", targetRegionIds: [], note: "" };
  const out = settleWar(baseWar({
    wearinessA: WEARINESS_COMPEL,
    wearinessB: 0.1,
    advantageA: 0.9,
    advantageB: 0.1,
    goalsA: reparations,
    goalsB: reparations,
    unjustA: true,
  }));
  // 0.9 * 0.75 = 0.675 still beats 0.1.
  assert.equal(out.victor, "a");
  assert.equal(out.punitive, false);
});

test("the achieved gate reads the raw score, so an unjust winner still closes the war", () => {
  const out = settleWar(baseWar({
    goalsA: { kind: "annex", targetRegionIds: ["r1"], note: "" },
    goalsB: { kind: "annex", targetRegionIds: ["r2"], note: "" },
    heldRegionIdsA: ["r1"],
    unjustA: true,
  }));
  assert.ok(out, "the war closes although the factor lowers the winner's effective score");
  assert.equal(out.victor, "a");
  assert.equal(out.punitive, false, "an unjust side that wins is not punished");
  assert.deepEqual(out.transfers, [{ regionId: "r1", fromCode: "B", toCode: "A" }]);
});

test("a punitive defeat takes the unjust share under the unchanged cap", () => {
  const reparations = { kind: "reparations", targetRegionIds: [], note: "" };
  const defeat = baseWar({
    wearinessB: WEARINESS_CAPITULATION,
    goalsA: reparations,
    codeA: "FR",
    codeB: "DE",
    poolsB: { manpower: 4000000, materiel: 100 },
    unjustB: true,
  });
  const punished = settleWar(defeat);
  assert.equal(punished.victor, "a");
  assert.equal(punished.punitive, true);
  assert.deepEqual(punished.reparations, {
    fromCode: "DE",
    toCode: "FR",
    manpower: REPARATION_MANPOWER_CAP,
    materiel: 50,
  });

  const ordinary = settleWar({ ...defeat, unjustB: false });
  assert.equal(ordinary.punitive, false);
  assert.deepEqual(ordinary.reparations, {
    fromCode: "DE",
    toCode: "FR",
    manpower: REPARATION_MANPOWER_CAP,
    materiel: 25,
  });
});

test("an unjust victor takes its ordinary terms", () => {
  const reparations = { kind: "reparations", targetRegionIds: [], note: "" };
  const out = settleWar(baseWar({
    wearinessB: WEARINESS_CAPITULATION,
    goalsA: reparations,
    codeA: "FR",
    codeB: "DE",
    poolsB: { manpower: 4000000, materiel: 100 },
    unjustA: true,
  }));
  assert.equal(out.victor, "a");
  assert.equal(out.punitive, false);
  assert.deepEqual(out.reparations, {
    fromCode: "DE",
    toCode: "FR",
    manpower: REPARATION_MANPOWER_CAP,
    materiel: 25,
  });
});

test("a punitive annex takes every declared target, held or not", () => {
  const goalsA = { kind: "annex", targetRegionIds: ["r1", "r2"], note: "" };
  const goalsB = { kind: "annex", targetRegionIds: ["r9"], note: "" };
  const compelled = baseWar({
    wearinessA: WEARINESS_COMPEL,
    wearinessB: 0.1,
    goalsA,
    goalsB,
    heldRegionIdsA: ["r2"],
  });
  assert.deepEqual(settleWar(compelled).transfers, [
    { regionId: "r2", fromCode: "B", toCode: "A" },
  ]);
  assert.deepEqual(settleWar({ ...compelled, unjustB: true }).transfers, [
    { regionId: "r1", fromCode: "B", toCode: "A" },
    { regionId: "r2", fromCode: "B", toCode: "A" },
  ]);
});

test("punitive is true exactly when the unjust side lost", () => {
  const reparations = { kind: "reparations", targetRegionIds: [], note: "" };
  const loses = settleWar(baseWar({
    wearinessB: WEARINESS_CAPITULATION,
    goalsA: reparations,
    unjustB: true,
  }));
  assert.equal(loses.punitive, true);
  const wins = settleWar(baseWar({
    wearinessB: WEARINESS_CAPITULATION,
    goalsA: reparations,
    unjustA: true,
  }));
  assert.equal(wins.punitive, false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "src/engine/warSettlement.test.js"`
Expected: FAIL, `UNJUST_LEGITIMACY_FACTOR` is not exported and `settleWar(...).punitive` is `undefined`.

- [ ] **Step 3: Add the constants and the legitimacy helper**

In `src/engine/warSettlement.js`, directly below `export const REPARATION_MANPOWER_CAP = 1000000;`, add:

```js
export const UNJUST_LEGITIMACY_FACTOR = 0.75;
export const UNJUST_REPARATION_SHARE = 0.5;
```

Below the `pickVictor` definition, add:

```js
// A side that began the war without a recorded warrant scores at a discount: its
// raw progress is scaled before the victor is chosen, so it loses an otherwise
// even race. An absent flag is a just side.
const legitimacy = (unjust) => (Boolean(unjust) ? UNJUST_LEGITIMACY_FACTOR : 1);
```

- [ ] **Step 4: Read the raw score for the gate and the scaled score for the victor**

In `settleWar`, add the two inputs to the destructuring, directly after `poolsB = {},`:

```js
    unjustA = false,
    unjustB = false,
```

Replace the two `warGoalScore` calls and the `achieved` lines with:

```js
  const rawScoreA = warGoalScore({
    kind: goals.a.kind,
    targetRegionIds: goals.a.targetRegionIds,
    heldRegionIds: heldRegionIdsA,
    advantage: advantageA,
  });
  const rawScoreB = warGoalScore({
    kind: goals.b.kind,
    targetRegionIds: goals.b.targetRegionIds,
    heldRegionIds: heldRegionIdsB,
    advantage: advantageB,
  });
  // The gate reads the raw score, so a war a side has won on the map still
  // closes; only the choice of victor weighs legitimacy.
  const scoreA = rawScoreA * legitimacy(unjustA);
  const scoreB = rawScoreB * legitimacy(unjustB);
```

and change the two `achieved` lines to read the raw scores:

```js
  const achievedA = goals.a.kind !== "status_quo" && rawScoreA >= 1;
  const achievedB = goals.b.kind !== "status_quo" && rawScoreB >= 1;
```

The two `pickVictor(scoreA, scoreB, wa, wb)` calls are unchanged: they now read the scaled scores.

- [ ] **Step 5: Compute `punitive` and apply the punitive terms**

Directly after `const loser = victor === "a" ? "b" : "a";`, add:

```js
  // The unjust side is the mark the casus layer wrote; only its defeat is punished.
  const punitive = Boolean(loser === "a" ? unjustA : unjustB);
```

In the `annex` transfer condition, replace `if (capitulation || heldVictor.has(regionId)) {` with:

```js
      if (capitulation || punitive || heldVictor.has(regionId)) {
```

In the `reparations` block, replace the two `REPARATION_SHARE` multiplications with a `share` that reads the punitive constant:

```js
    const share = punitive ? UNJUST_REPARATION_SHARE : REPARATION_SHARE;
    const manpower = Math.min(
      REPARATION_MANPOWER_CAP,
      Math.max(0, roundTo(Math.max(0, Number(pools.manpower) || 0) * share, 0)),
    );
    const materiel = Math.max(
      0,
      roundTo(Math.max(0, Number(pools.materiel) || 0) * share, 2),
    );
```

In the returned object, add `punitive,` directly after the `white` line:

```js
    white: transfers.length === 0 && reparations.manpower === 0 && reparations.materiel === 0,
    punitive,
    transfers,
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test "src/engine/warSettlement.test.js"`
Expected: PASS, all tests including the 8 new ones.

- [ ] **Step 7: Verify the purity guard and lint**

Run: `node --test "src/engine/enginePurity.test.js"`
Expected: PASS (no import was added).

Run: `npx eslint src/engine/warSettlement.js src/engine/warSettlement.test.js`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/engine/warSettlement.js src/engine/warSettlement.test.js
git commit -m "feat(engine): weigh an unjust side at the peace"
```

---

### Task 2: The runtime adapter derives the flags and names a punitive peace

**Files:**
- Modify: `src/runtime/warSettlement.js`
- Test: `src/runtime/warSettlement.test.js`

**Interfaces:**
- Consumes: `settleWar` with `unjustA`/`unjustB` and the `punitive` field (Task 1); the stored `unjustAggressors` field.
- Produces:
  - `resolveWarSettlements` derives `unjustA`/`unjustB` per war from `war.unjustAggressors` folded through `canonical` (`toCountryName`) and the same lowercased key space, and passes them to `settleWar`. The returned settlements carry the core's `punitive`.
  - `buildSettlementEvent` appends a punitive clause to the peace description when `settlement.punitive` is true.

- [ ] **Step 1: Write the failing tests**

Append these tests to `src/runtime/warSettlement.test.js` (the existing `war` and `world` helpers at the top of the file already supply the goals, weariness and overrides):

```js
test("a recorded unjust aggressor flips an even race to the other side", () => {
  const annex = (target) => ({ kind: "annex", targetRegionIds: [target], note: "" });
  const input = (mark) => ({
    world: world([war({
      sideA: ["Germany"],
      sideB: ["France"],
      goals: { a: annex("r1"), b: annex("r2") },
      ...(mark ? { unjustAggressors: mark } : {}),
    })], { regionOwnershipOverrides: { r1: "Germany", r2: "France" } }),
    events: [],
    engagements: [],
    date: "1870-03-01",
    playerPolity: "",
  });
  const plain = resolveWarSettlements(input());
  assert.equal(plain.settlements[0].victor, "a", "the even race defaults to side A");
  assert.equal(plain.settlements[0].punitive, false);

  // DEU folds to Germany through toCountryName, the canonical key space.
  const marked = resolveWarSettlements(input(["DEU"]));
  assert.equal(marked.settlements[0].victor, "b");
  assert.equal(marked.settlements[0].punitive, true);
});

test("the mark is symmetric and can fall on side B", () => {
  const annex = (target) => ({ kind: "annex", targetRegionIds: [target], note: "" });
  const out = resolveWarSettlements({
    world: world([war({
      sideA: ["Germany"],
      sideB: ["France"],
      goals: { a: annex("r1"), b: annex("r2") },
      unjustAggressors: ["France"],
    })], { regionOwnershipOverrides: { r1: "Germany", r2: "France" } }),
    events: [],
    engagements: [],
    date: "1870-03-01",
    playerPolity: "",
  });
  assert.equal(out.settlements[0].victor, "a");
  assert.equal(out.settlements[0].loser, "b");
  assert.equal(out.settlements[0].punitive, true);
});

test("a punitive settlement is named in the peace event", () => {
  const event = buildSettlementEvent(
    { warId: "war-1", punitive: true, transfers: [], belligerents: ["Germany", "France"] },
    { date: "1870-03-01" },
  );
  assert.match(event.description, /punitive/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "src/runtime/warSettlement.test.js"`
Expected: FAIL, the settlements carry no `punitive` and the description names no punitive terms.

- [ ] **Step 3: Derive the two flags**

In `src/runtime/warSettlement.js`, below the `canonicalKeys` helper, add:

```js
// A side carries the mark when any of its declared members was recorded as an
// unjust aggressor of this war, compared in the same lowercased canonical key
// space as every other name in this module.
const sideIsUnjust = (members, unjustKeys) => {
  for (const raw of list(members)) {
    const polity = canonical(raw);
    if (polity && unjustKeys.has(polity.toLowerCase())) return true;
  }
  return false;
};
```

In `resolveWarSettlements`, directly after `const heldB = heldRegions(goalsB, canonicalKeys(war.sideB), overrides);`, add:

```js
    const unjustKeys = canonicalKeys(war.unjustAggressors);
    const unjustA = sideIsUnjust(war.sideA, unjustKeys);
    const unjustB = sideIsUnjust(war.sideB, unjustKeys);
```

and add the two flags to the `settleWar` call, directly after `poolsB: pools[leadB] ?? {},`:

```js
      unjustA,
      unjustB,
```

- [ ] **Step 4: Name a punitive peace in the event**

In `buildSettlementEvent`, replace the `event` object's fixed `description` with a computed one. Add above the `const event = {` line:

```js
  const description = settlement?.punitive
    ? `The war ${warId} is settled on punitive terms; the unjust aggressor's defeat is paid for on ${eventDate}.`
    : `The war ${warId} is settled; the terms take effect on ${eventDate}.`;
```

and change the object's `description` property to:

```js
    description,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test "src/runtime/warSettlement.test.js"`
Expected: PASS, all tests including the 3 new ones.

- [ ] **Step 6: Run the runtime glob and lint**

Run: `node --test "src/runtime/*.test.js"`
Expected: 0 fail.

Run: `npx eslint src/runtime/warSettlement.js src/runtime/warSettlement.test.js`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/runtime/warSettlement.js src/runtime/warSettlement.test.js
git commit -m "feat(runtime): mark an unjust peace and name it"
```

---

### Task 3: The turn's receipt names the punitive settlement

**Files:**
- Modify: `src/Game/AI/gameplay.js` (the peace receipt, around line 6757)
- Test: `src/runtime/warSettlementWiringArchitecture.test.js`

**Interfaces:**
- Consumes: the `punitive` field on due settlements (Task 2).
- Produces: the receipt line that already reports a closed war gains a punitive qualifier beside the white-peace/settlement wording. The adapter reads the flags and passes them (source-text guard).

- [ ] **Step 1: Write the failing guard**

Append these tests to `src/runtime/warSettlementWiringArchitecture.test.js` (the `gameplay` and `adapter` source constants are already defined at the top of the file):

```js
test("the adapter reads a war's recorded unjust aggressors", () => {
  assert.match(adapter, /war\.unjustAggressors/);
  assert.match(adapter, /unjustA/);
  assert.match(adapter, /unjustB/);
});

test("the turn's peace receipt names a punitive settlement", () => {
  assert.match(gameplay, /settlement\.punitive/);
});
```

- [ ] **Step 2: Run the guard to verify it fails**

Run: `node --test "src/runtime/warSettlementWiringArchitecture.test.js"`
Expected: FAIL, the receipt does not mention `settlement.punitive`.

- [ ] **Step 3: Add the qualifier to the receipt**

In `src/Game/AI/gameplay.js`, in `applySimulationResult`, replace the receipt note inside the `for (const settlement of dueSettlements)` loop:

```js
      noteReceipt(receipt, "adjusted",
        `The war ${settlement.warId} closed: ${settlement.white ? "white peace" : "settlement"}`
        + ` (${settlement.transfers.length} region(s) moved).`);
```

with:

```js
      noteReceipt(receipt, "adjusted",
        `The war ${settlement.warId} closed: ${settlement.white ? "white peace" : "settlement"}`
        + `${settlement.punitive ? " on punitive terms" : ""}`
        + ` (${settlement.transfers.length} region(s) moved).`);
```

- [ ] **Step 4: Verify**

Run: `node --test "src/runtime/warSettlementWiringArchitecture.test.js"`
Expected: PASS.

Run: `node --check src/Game/AI/gameplay.js`
Expected: no output (syntax ok).

Run: `node --test "src/Game/AI/*.test.js"`
Expected: 0 fail.

Run: `npx eslint src/Game/AI/gameplay.js`
Expected: 0 errors (the pre-existing `src/Game/Map/*` errors are in other files).

- [ ] **Step 5: Commit**

```bash
git add src/Game/AI/gameplay.js src/runtime/warSettlementWiringArchitecture.test.js
git commit -m "feat(ai): name a punitive settlement on the receipt"
```

---

### Task 4: Document the settlement reaction

**Files:**
- Modify: `docs/runtime-services.md`

**Interfaces:**
- Consumes: the shipped code from Tasks 1-3.
- Produces: one new documentation section; no code.

- [ ] **Step 1: Add the section**

In `docs/runtime-services.md`, immediately after the "Just cause and the cost of an unjust war" section (the paragraph ending "the breach digest.") and before the `---` that precedes "Library store", add:

```markdown
---

## The reaction to an unjust war at the peace

`src/engine/warSettlement.js` exports `settleWar`, and the fourteenth increment
makes it read the record the casus layer wrote: a side is **unjust** when any of
its declared members is one of the war's `unjustAggressors`. Two constants set
the price - `UNJUST_LEGITIMACY_FACTOR` (`0.75`) and `UNJUST_REPARATION_SHARE`
(`0.5`) - and `settleWar` takes two optional flags, `unjustA` and `unjustB`.

Legitimacy only decides *who wins* a close peace. Each side's raw `warGoalScore`
is scaled by the factor when that side is unjust, and the victor is chosen from
the scaled scores, tie broken by the lower weariness and then by side A as
before. The `achieved` gate still reads the *raw* score, so a war a side has
already won on the map still closes; the factor decides the peace rather than
stalling the war. A dominance large enough to survive the factor is still a
victory.

`punitive` is true exactly when the unjust side lost, and it makes the victor's
ordinary terms harsher: a `reparations` victor takes `UNJUST_REPARATION_SHARE`
of the loser's pools instead of `REPARATION_SHARE` (the manpower cap is
unchanged), and an `annex` victor takes every declared target, held or not,
exactly as a capitulation would. An unjust side that wins takes its declared
kind's ordinary terms.

The runtime adapter (`src/runtime/warSettlement.js`) derives the two flags from
the stored `unjustAggressors`, folded through the same `toCountryName` canonical
key space as every other name, and passes them to the core.
`buildSettlementEvent` appends a punitive clause to the peace description when
`settlement.punitive` is true, and the turn's receipt line (`gameplay.js`,
`applySimulationResult`) names the punitive settlement beside the white-peace
wording. The reputation and relation cost the casus layer already charged at the
declaration is untouched, and a war the player is a party to is still withheld
from settlement.
```

- [ ] **Step 2: Verify the wiki is still current and the added text is ASCII**

Run: `npm run wiki:check`
Expected: `Wiki is current.`

Run: `node -e "const s=require('fs').readFileSync('docs/runtime-services.md','utf8'); process.exit(/[^\x00-\x7F]/.test(s)?1:0)"`
Expected: exit 0, no output (the whole file is ASCII).

- [ ] **Step 3: Commit**

```bash
git add docs/runtime-services.md
git commit -m "docs(runtime): document the settlement reaction"
```

---

## Acceptance

1. `npm test` passes with zero failures.
2. `node --test "src/engine/*.test.js"`, `node --test "src/runtime/*.test.js"` and `node --test "src/Game/AI/*.test.js"` pass.
3. `npx eslint .` reports no new errors (the pre-existing `src/Game/Map/*` errors are unrelated).
4. `npm run wiki:check` reports `Wiki is current.`
5. `npm run build` exits 0.
6. Every commit in the increment carries the `Co-authored-by` trailer.
7. The extended core still passes `src/engine/enginePurity.test.js`.
