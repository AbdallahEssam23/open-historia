# War Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a declared war a deterministic end: each side declares what it is fighting for, the engine measures goal progress and weariness, and, when the facts compel peace, the engine derives the terms and writes them through the existing transfer, pool and war-ledger doors.

**Architecture:** A new pure core `src/engine/warSettlement.js` turns declared goals, this turn's battle results and accumulated weariness into a settlement (or nothing). A new runtime adapter `src/runtime/warSettlement.js` gathers each war's facts, calls the core, builds the narrated peace event and moves the reparations. The boundary learns one link-free war-ledger op (`goals`) and two optional war fields (`goals`, `weariness`); the turn appends the peace event and an `end` record, applies the impacts, closes the war through the existing `applyWarUpdates`, then pays the reparations. The model declares the WHAT; the engine owns the numbers.

**Tech Stack:** ES modules, `node --test`, no framework, no new dependency.

## Global Constraints

- ASCII only in source and docs. No emoji, no em dash, no middle dot.
- No new `package.json` entry and no new runtime dependency.
- `src/engine/**` must stay free of browser globals and of imports outside the allow list: no `window`, `document`, `localStorage`, `Date.now`, `new Date`, `Math.random`, `fetch`. `src/engine/enginePurity.test.js` enforces this over the whole directory. `src/engine/warSettlement.js` imports only `./economyMath.js` (the shared `clamp`/`roundTo`/`monthsBetweenDates`).
- Every engine function changed here gains an optional argument whose default reproduces current behavior exactly. Do not edit an existing test to accommodate a change.
- Tests are run with a glob, never a bare directory: `node --test "src/engine/*.test.js"`.
- Commit messages are conventional and do NOT include the `Co-authored-by:` trailer. The `prepare-commit-msg` hook adds it.
- `public/wiki/**` is generated and committed. Its source is `wiki/` (not `docs/wiki/`). Regenerate with `npm run build:wiki`; verify with `npm run wiki:check`, which must print exactly `Wiki is current.`.
- The jump schema character budget stays under 29500 (`src/Game/AI/projectOpSchema.test.js`). This increment does not change the jump schema: Task 6 edits the runtime directive text in `gameplay.js`, which is not part of the serialized schema. If that guard fails it is an unrelated regression, not a reason to raise the ceiling.
- The spec for this plan is `docs/specs/2026-10-02-war-settlement-design.md`.

## Resolved Design Details

The spec left five mechanics to the plan. They are decided here and the executor must follow them.

1. **The region separator is `|`, not `,`.** The declaration travels on `warUpdates` as `warId~goals~SIDES~~~note`, and `parseWarUpdateRecord` runs the actors field through `parseCsv`, which splits on commas. A region list written with commas would be shredded into bogus "actors". Sides are separated by `;`, and the regions inside one side by `|`: `war-france-germany-1914~goals~France:annex:Alsace|Lorraine;Germany:reparations~~~`. An empty note is three tildes (matching the `w~end~~~` convention); four tildes make the note field the literal `~` and clobber the war's stored note. The spec's illustrative example used commas; the wire format here is the pipe. Task 4 corrects the spec's example to match.
2. **The `goals` op needs no event link.** It is a state declaration, not a narrated transition, so `validateBoundWarBatch` skips the event-link requirement for `goals` alone. `applyWarUpdates` already iterates every decoded record, so a link-free `goals` record still lands on the war.
3. **Weariness persists through `applyWarUpdates`.** `resolveWarSettlements` returns `weariness` keyed by war id; `gameplay.js` passes it to the existing `applyWarUpdates` call, which gains an optional `weariness` argument and writes it in the same pass that owns `world.wars`. There is no second writer and no new op for it.
4. **Goal regions are canonicalized inside `applyWarUpdates`.** The ledger gains an optional `resolveRegion` argument (default identity). Inside `applySimulationResult`, `gameplay.js` builds a resolver from the primed region catalog and passes it to `applyWarUpdates`, so a declared goal region is folded to a known region id at the moment the war is saved. The `resolveCombatRegionIds` call site (~5801) belongs to a different function and is left alone. The runtime adapter never imports from `Game/AI`: because the ledger canonicalizes on write, the adapter only ever reads region ids.
5. **A `reparations` campaign pays only reparations; an `annex` campaign takes only land.** On a capitulation an `annex` victor takes every declared target, including one the loser still controls (the collapse compels the cession); on a compelled peace it takes only the declared regions it already holds. A transfer is a treaty cession, so it always runs `fromCode = codeLoser` to `toCode = codeVictor` - never from the current de-facto controller, or an already-occupied region would transfer to its own holder and the legal owner would keep it. The terms are paid to and from the first named belligerent of a side when a side is a coalition.
6. **A `status_quo` side never forces a peace by its satisfaction alone.** `warGoalScore` returns `1` for `status_quo`, but the peace-due trigger counts an aim as achieved only when `kind !== "status_quo"` and the score is `1`. Otherwise a war with no declared goals would end as a white peace the turn it starts, contradicting the spec's own prose that only weariness closes it. The spec's section 3 rule 3 is corrected to match during Task 1.
7. **A war the turn itself ends or ceasefires is not settled.** The adapter reads the pre-turn world, where such a war is still `active`, so `gameplay.js` withholds the ids the turn's own `warUpdates` ends or ceasefires before the peace events and the reparations are built. The model's negotiated peace stands, and a ceasefire is treated as a war that is not settled, as the spec's open question states.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/engine/warSettlement.js` (new) | The pure settlement model: goal kinds, weariness constants, `normalizeWarGoals`, `normalizeWeariness`, `warGoalScore`, `wearinessStep`, `warPressure`, `settleWar`. |
| `src/runtime/warSettlement.js` (new) | Gather each war's facts, call the core, build the peace event, move the reparations. Reads region ids only; imports no `Game/AI` module. |
| `src/runtime/combatEngagements.js` | Each engagement result gains a compact per-side summary (power, loss fraction) so the settlement adapter can read a war's advantage without recomputing a battle. |
| `src/Game/AI/nativeWarLedger.js` | Learn the `goals` op, preserve `goals`/`weariness` on a war, accept a resolver and a weariness map in `applyWarUpdates`. |
| `src/runtime/gameState.js` | `normalizeWorldWar` preserves the optional `goals` and `weariness` war fields, or `normalizeWorldState` strips them on the next turn and the adapter sees nothing. |
| `src/Game/AI/combatRegionResolution.js` | Export a reusable `buildRegionResolver`; `resolveCombatRegionIds` is refactored to use it. |
| `src/Game/AI/gameplay.js` | Describe the `goals` op in `buildWarLedgerDirective`, build the region resolver, run the adapter after the battles, append the peace event and the `end` record, pass the weariness and resolver to `applyWarUpdates`, pay the reparations. The pregame/GM transport is left unchanged. |
| `src/runtime/warSettlementWiringArchitecture.test.js` (new) | Source-text guard for the turn seams. |
| `docs/specs/2026-10-02-war-settlement-design.md` | Correct the illustrative wire format to the pipe separator. |
| `docs/world-state.md`, `docs/runtime-services.md`, `wiki/systems/projects.md` | Document the goals op, weariness and the settlement rule. |

---

### Task 1: The settlement core

**Files:**
- Create: `src/engine/warSettlement.js`
- Test: `src/engine/warSettlement.test.js`

**Interfaces:**
- Consumes: `clamp`, `roundTo` from `./economyMath.js`.
- Produces:
  - `WAR_GOAL_KINDS = ["annex", "reparations", "status_quo"]`
  - `WEARINESS_COMPEL = 0.6`, `WEARINESS_CAPITULATION = 0.9`, `WEARINESS_MONTHLY_GAIN = 0.04`, `WEARINESS_LOSS_GAIN = 0.5`, `MOBILIZATION_WEARINESS_DRAG = { demobilized: 0, peacetime: 0, partial: 0.05, total: 0.1 }`
  - `REPARATION_SHARE = 0.25`, `REPARATION_MANPOWER_CAP = 1000000`
  - `normalizeWarGoals(value) -> { a, b } | null`
  - `normalizeWeariness(value) -> { a, b, throughDate } | null`
  - `warGoalScore({ kind, targetRegionIds, heldRegionIds, advantage }) -> number` in `0..1`
  - `wearinessStep({ prior, months, lossFraction, mobilization }) -> number` in `0..1`
  - `warPressure({ wearinessA, wearinessB }) -> { compelled, capitulationA, capitulationB }`
  - `settleWar(input) -> null | settlement`

  `settleWar` input:

  ```
  {
    warId, date,
    goalsA, goalsB,                       // normalized {kind,targetRegionIds,note}
    heldRegionIdsA = [], heldRegionIdsB = [],
    advantageA = 0, advantageB = 0,
    wearinessA = 0, wearinessB = 0,
    codeA = "", codeB = "",
    poolsA = { manpower: 0, materiel: 0 }, poolsB = { manpower: 0, materiel: 0 },
  }
  ```

  The returned settlement:

  ```
  {
    key, warId, victor: "a" | "b", loser: "a" | "b",
    capitulation: boolean, white: boolean,
    transfers: [{ regionId, fromCode, toCode }],
    reparations: { fromCode, toCode, manpower, materiel },
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `src/engine/warSettlement.test.js` covering, at minimum:

- `normalizeWarGoals` folds an unknown kind to `null` entry, dedupes and caps `targetRegionIds`, treats an absent value as `null`, and never throws on garbage.
- `warGoalScore`: `annex` is the held share of the declared targets (`0` when none declared); `status_quo` is `1`; `reparations` is the clamped `advantage`; an unknown kind is `0`.
- `wearinessStep` is monotone, clamped to `0..1`, adds nothing for `peacetime` beyond time, and adds the `total` posture drag.
- `warPressure` sets `compelled` at `WEARINESS_COMPEL` and a capitulation at `WEARINESS_CAPITULATION`.
- `settleWar`: `null` before a peace is due; one capitulation; both capitulation broken by score, then lower weariness, then side A; compelled peace broken the same way.
- Terms per kind: `annex` transfers declared targets held by the victor (all declared targets on a capitulation), each from the loser to the victor; `reparations` moves the capped share of the loser's pools; `status_quo` is a white peace.
- Determinism: the same input yields `JSON.stringify`-identical output.

Run: `node --test src/engine/warSettlement.test.js`
Expected: FAIL (the module does not exist).

- [ ] **Step 2: Implement the core**

Create `src/engine/warSettlement.js`. Import only `{ clamp, roundTo }` from `./economyMath.js`. `settleWar` computes `scoreA`/`scoreB` internally with `warGoalScore`, so the adapter never re-derives them. The victim's terms come from `goals[victor].kind` and nothing else. `key` is `` `${warId}|${date}|${victor}|${loser}` ``. `white` is true when there are no transfers and both reparation figures are zero. A `status_quo` win, or a `reparations` win whose loser has empty pools, is white.

- [ ] **Step 3: Run the test and the engine suite**

Run: `node --test src/engine/warSettlement.test.js`
Expected: PASS.

Run: `node --test "src/engine/*.test.js"`
Expected: PASS, including the untouched purity guard.

- [ ] **Step 4: Commit**

```bash
git add src/engine/warSettlement.js src/engine/warSettlement.test.js
git commit -m "feat(engine): derive a deterministic war settlement"
```

---

### Task 2: Per-side battle summaries

**Files:**
- Modify: `src/runtime/combatEngagements.js` (the `results.push` shape in `resolveEventEngagements`)
- Test: `src/runtime/combatEngagements.test.js` (extend)

**Interfaces:**
- Produces: each entry of `resolveEventEngagements(...).results` gains
  `sideA: { power, adjustedPower, lossFraction }` and
  `sideB: { power, adjustedPower, lossFraction }`, copied from the core's
  `sideA`/`sideB` summary. No existing field changes and no arithmetic changes.

- [ ] **Step 1: Write the failing assertion**

Extend `src/runtime/combatEngagements.test.js` with a test that resolves a
declared battle and asserts each result carries a numeric `sideA.lossFraction`
and `sideB.lossFraction` in `0..1`, and that `sideA.power + sideB.power > 0`.

Run: `node --test src/runtime/combatEngagements.test.js`
Expected: FAIL (the fields are absent).

- [ ] **Step 2: Add the summary**

In the `results.push({...})` inside `resolveEventEngagements`, add:

```js
      sideA: { adjustedPower: outcome.sideA.adjustedPower, lossFraction: outcome.sideA.lossFraction, power: outcome.sideA.power },
      sideB: { adjustedPower: outcome.sideB.adjustedPower, lossFraction: outcome.sideB.lossFraction, power: outcome.sideB.power },
```

Copy the exact field names the core returns; do not recompute anything.

- [ ] **Step 3: Run the test and the runtime suite**

Run: `node --test src/runtime/combatEngagements.test.js`
Expected: PASS.

Run: `node --test "src/runtime/*.test.js"`
Expected: PASS, no regression.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/combatEngagements.js src/runtime/combatEngagements.test.js
git commit -m "feat(runtime): expose per-side battle summaries"
```

---

### Task 3: The settlement adapter

**Files:**
- Create: `src/runtime/warSettlement.js`
- Test: `src/runtime/warSettlement.test.js`

**Interfaces:**
- Consumes: `settleWar`, `normalizeWeariness`, `warGoalScore`, `wearinessStep` from `../engine/warSettlement.js`; `monthsBetweenDates`, `roundTo` from `../engine/economyMath.js`; `normalizePools` from `../engine/forcePools.js`; `applyCountryStatPatchToWorld`, `normalizeWorldState` from `./gameState.js`; `toCountryName` from `./ownerNames.js`.
- Produces:
  - `resolveWarSettlements({ world, events, engagements, date, playerPolity = "" }) -> { settlements, weariness, unresolved }`
  - `buildSettlementEvent(settlement, { date, round }) -> event`
  - `applyWarReparations(world, settlements) -> world`

  `settlements` is at most one per war. `weariness` is `{ [warId]: { a, b, throughDate } }`. `unresolved` entries are `{ warId, reason }`.

- [ ] **Step 1: Write the failing test**

Create `src/runtime/warSettlement.test.js` covering:

- A war whose player is a party is skipped and appears in `unresolved` with `reason` containing `player`.
- A `ceasefire` or `ended` war and a war whose `startedDate` is the current date are skipped silently.
- A war driven to weariness returns a settlement and a `weariness` entry whose `throughDate` is the turn date; a second call with the same inputs returns the same settlement.
- The adapter returns at most one settlement per war when two battle results name the same war id.
- `buildSettlementEvent` sets `warId`, `combatants`, `impacts.regionTransfers` and carries no `combatRegion`.
- `applyWarReparations` moves the capped amount, floors at zero, and returns the same world when there is nothing to pay.

Run: `node --test src/runtime/warSettlement.test.js`
Expected: FAIL (the module does not exist).

- [ ] **Step 2: Implement the adapter**

Create `src/runtime/warSettlement.js`.

- `resolveWarSettlements` reads active wars from the world it is given (the
  pre-turn world), maps `events[i].warId` to each engagement result, and
  aggregates per war: `advantageA` is side A's share of the war's summed
  adjusted power (`0` when both sides sum to zero), `lossFractionA` is the
  maximum side A loss fraction across the war's battles (`0` when none), and
  likewise for B. `heldA`/`heldB` are the declared target regions the side
  currently owns in `world.regionOwnershipOverrides`. Weariness steps from
  `war.weariness` with `months = monthsBetweenDates(war.weariness?.throughDate || war.startedDate, date)` (`0` when either date is missing), the loss fraction above and the side's mobilization from `world.economyEngine?.mobilization`.
- The lead polity of a side is its first named belligerent; reparations and
  transfers use it.
- `buildSettlementEvent` returns a `military` event whose title matches none of
  the ledger's war-transition regexes (use `Peace settlement: ${warId}`), whose
  description mentions no battlefield verb, carrying `warId`, the two sides'
  belligerents in `combatants`, and `impacts.regionTransfers` copied from the
  settlement's transfers. It carries no `combatRegion`.
- `applyWarReparations` mirrors `applyCombatReserveCost`: normalize once, read
  `economyEngine.pools`, move the manpower and materiel with an absolute zero
  floor, then refresh each touched polity's forces mirror with
  `applyCountryStatPatchToWorld(..., { replaceComponents: true, engineSourced: true })`.

- [ ] **Step 3: Run the test and the runtime suite**

Run: `node --test src/runtime/warSettlement.test.js`
Expected: PASS.

Run: `node --test "src/runtime/*.test.js"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/warSettlement.js src/runtime/warSettlement.test.js
git commit -m "feat(runtime): resolve war settlements and move the reparations"
```

---

### Task 4: The ledger learns `goals` and `weariness`

**Files:**
- Modify: `src/Game/AI/nativeWarLedger.js`
- Modify: `src/runtime/gameState.js` (`normalizeWorldWar`)
- Test: `src/Game/AI/warLedger.test.js` (extend; this is the existing ledger suite, it imports `./nativeWarLedger.js`)
- Modify: `docs/specs/2026-10-02-war-settlement-design.md` (correct the example)

**Interfaces:**
- Consumes: `normalizeWarGoals`, `normalizeWeariness` from `../../engine/warSettlement.js`.
- Produces:
  - `parseWarGoals(actors, war, resolveRegion) -> {a,b} | null` (module-private is fine; export only if a test needs it)
  - The `goals` op on `warUpdates`, storing `war.goals`
  - `normalizeWar` preserves optional `goals` and `weariness`
  - `normalizeWorldWar` (in `src/runtime/gameState.js`) preserves optional `goals` and `weariness`
  - `applyWarUpdates({ ..., weariness = {}, resolveRegion })` writes the weariness map onto the wars it saves

- [ ] **Step 1: Write the failing test**

Add tests that:

- `decodeWarUpdates("war-x~goals~France:annex:Alsace|Lorraine;Germany:reparations~~~")` returns one record with `op === "goals"`.
- A `goals` record does not overwrite `war.note`: applying a goals line to a war stored with a note keeps the note.
- `applyWarUpdates` with a `start` then a link-free `goals` record and no events stores `war.goals.a.kind === "annex"` with `targetRegionIds` resolved through a stub `resolveRegion` (a pipe list arrives as two ids).
- A `goals` record naming an unknown war is dropped with a warning and does not throw.
- An old war saved without `goals`/`weariness` still normalizes; `applyWarUpdates` with a `weariness` map writes `war.weariness` and preserves it through a later `end` save.
- `normalizeWorldState` round-trips a war carrying `goals` and `weariness` without dropping either (the runtime normalizer is the writer of the persisted world; without this, the next turn's adapter sees a war with no goals).
- `validateWarLedgerPayload` accepts a payload whose only war record is a link-free `goals` op.

Run: `node --test src/Game/AI/warLedger.test.js`
Expected: FAIL.

- [ ] **Step 2: Implement the op and the fields**

In `src/Game/AI/nativeWarLedger.js`:

- Import `{ normalizeWarGoals, normalizeWeariness }` from `../../engine/warSettlement.js`.
- Add `parseWarGoals(actors, war, resolveRegion)`: join `actors` with `;`, split
  on `;`, then each entry on `:`. Match the polity to a side with the existing
  `polityKey`, fold the kind to `WAR_GOAL_KINDS`, split `region|region` on `|`
  and map each through `resolveRegion` (default `(value) => value`). Return
  `normalizeWarGoals(...)`.
- In `applyUpdateToWarMap`, after the `if (!prior)` guard, add the `goals`
  branch: require `prior.status === "active"`, parse, and `save({ ...prior, goals })`.
  Thread `resolveRegion` through the destructured arguments.
- In `normalizeWar`, add `goals: normalizeWarGoals(entry.goals)` and
  `weariness: normalizeWeariness(entry.weariness)` to the saved object.
- In `src/runtime/gameState.js`, import `normalizeWarGoals` and
  `normalizeWeariness` from `../engine/warSettlement.js` and add the same two
  fields to the object `normalizeWorldWar` returns, so a normalized world keeps
  them. This is the only edit to `gameState.js`; do not touch its war status
  logic.
- In `applyWarUpdates`, accept `weariness = {}` and `resolveRegion`, pass
  `resolveRegion` into each `applyUpdateToWarMap`, and after the map is built
  write each `normalizeWeariness(weariness[war.id])` onto the matching war
  before the final sort.
- In `validateWarLedgerPayload`, add `"goals"` to the allowed op list. In
  `validateBoundWarBatch`, skip both event-link checks when the op is `goals`.

- [ ] **Step 3: Correct the spec example**

In `docs/specs/2026-10-02-war-settlement-design.md`, change the illustrative
line's commas to pipes and add one sentence that a comma cannot appear inside
the actors field because the transport is comma-delimited. Do not change the
design, only the example and the reason.

- [ ] **Step 4: Run the tests**

Run: `node --test src/Game/AI/warLedger.test.js`
Expected: PASS.

Run: `node --test "src/Game/AI/*.test.js"`
Expected: PASS, no regression.

- [ ] **Step 5: Commit**

```bash
git add src/Game/AI/nativeWarLedger.js src/runtime/gameState.js src/Game/AI/warLedger.test.js docs/specs/2026-10-02-war-settlement-design.md
git commit -m "feat(ai): declare war goals and persist weariness in the ledger"
```

---

### Task 5: Canonicalize a declared goal region

**Files:**
- Modify: `src/Game/AI/combatRegionResolution.js`
- Test: `src/Game/AI/combatRegionResolution.test.js` (extend)

**Interfaces:**
- Produces: `buildRegionResolver(catalog) -> { resolve(value), size }`, where
  `resolve` returns a known region id for an id or a folded name and `""`
  otherwise. `resolveCombatRegionIds(containers, catalog)` keeps its exact
  signature and behavior; it is refactored to build its resolver through the new
  helper.

- [ ] **Step 1: Write the failing test**

Extend `src/Game/AI/combatRegionResolution.test.js`:

- `buildRegionResolver` resolves an exact id, folds a friendly name, and returns
  `""` for an unknown value.
- `resolveCombatRegionIds` still resolves the same counts as before against the
  raw catalog.

Run: `node --test src/Game/AI/combatRegionResolution.test.js`
Expected: FAIL.

- [ ] **Step 2: Implement the resolver**

Extract the `byId`/`byName` construction into `buildRegionResolver(catalog)` and
have `resolveCombatRegionIds` build one and walk the containers exactly as
today. Do not change the `resolveCombatRegionIds` signature.

- [ ] **Step 3: Run the test**

Run: `node --test src/Game/AI/combatRegionResolution.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/Game/AI/combatRegionResolution.js src/Game/AI/combatRegionResolution.test.js
git commit -m "feat(ai): share one region resolver for combat and goal regions"
```

---

### Task 6: Describe the `goals` op to the model

**Files:**
- Modify: `src/Game/AI/gameplay.js` (`buildWarLedgerDirective`, the war-ledger paragraph at ~line 572)
- Test: `src/Game/AI/jumpPromptCraft.test.js` (extend; it already reads `gameplay.js` as source text because `gameplay.js` pulls in `./main.jsx` and cannot be imported)
- Test: `src/Game/AI/projectOpSchema.test.js` (must stay green)

**Interfaces:**
- Produces: the jump prompt names `goals` in the `warUpdates` op list and gives
  the pipe-separated shape in one short clause.

Scope note: the pregame/GM structured channel (`NATIVE_GAME_MASTER_PROMPT` in
`gameplayPrompts.js`, `GAME_MASTER_SCHEMA`, `buildPregameBootstrapDirective`, and
the op allowlist in `validatePregameCanonicalBootstrap`) is deliberately NOT
extended. A goal region is canonicalized only in the turn's ledger pass (Tasks 5
and 7), so advertising `goals` on the pregame channel would let the model emit a
record that the bootstrap validator rejects and a region the settlement cannot
match. Do not touch those surfaces.

- [ ] **Step 1: Write the failing source-text test**

Add to `src/Game/AI/jumpPromptCraft.test.js` (it already holds `gameplaySource`):

```js
test("the war directive teaches the goals declaration", () => {
  assert.match(gameplaySource, /leave, ceasefire, resume, end or goals; for start/);
  assert.match(gameplaySource, /warId~goals~polity:kind/);
});
```

The anchor binds to the in-turn directive; the GM prompt uses a `war:start`
vocabulary and cannot satisfy it. Run:
`node --test src/Game/AI/jumpPromptCraft.test.js`
Expected: FAIL.

- [ ] **Step 2: Edit the prompt**

Extend the op enumeration to include `goals` and append one clause:

```
goals declares war aims: warId~goals~polity:kind[:region|region];polity:kind~~~, kind annex, reparations or status_quo.
```

Keep it on the existing paragraph; do not add a new paragraph or a new field.

- [ ] **Step 3: Run the schema test**

Run: `node --test src/Game/AI/jumpPromptCraft.test.js`
Expected: PASS.

Run: `node --test src/Game/AI/projectOpSchema.test.js`
Expected: PASS (the schema is untouched; this is a no-regression check, not a
budget check).

- [ ] **Step 4: Commit**

```bash
git add src/Game/AI/gameplay.js src/Game/AI/jumpPromptCraft.test.js
git commit -m "docs(ai): tell the model how to declare war goals"
```

---

### Task 7: Settle wars inside the turn

**Files:**
- Modify: `src/Game/AI/gameplay.js` (the seams at ~5801, ~6664-6689 and ~6800)
- Test: an integration assertion in `src/runtime/warSettlement.test.js`

**Interfaces:**
- Consumes: `buildRegionResolver` from `./combatRegionResolution.js`; `resolveWarSettlements`, `buildSettlementEvent`, `applyWarReparations` from `../../runtime/warSettlement.js`.
- Produces: a turn that, after the battles resolve, steps each war's weariness,
  appends a peace event to `freshEvents` and an `end` record to `warUpdates` when
  a peace is due, closes the war through `applyWarUpdates`, and pays the
  reparations after the impacts land.

- [ ] **Step 1: Add the imports**

Add to the runtime import block:

```js
import {
  applyWarReparations,
  buildSettlementEvent,
  resolveWarSettlements,
} from "../../runtime/warSettlement.js";
```

Extend the `./combatRegionResolution.js` import to include `buildRegionResolver`.

- [ ] **Step 2: Build one region resolver inside the turn**

The `resolveCombatRegionIds` call site (~5801) is in a different function and
must not change. Inside `applySimulationResult`, immediately below
`const baseWorldNormalized = normalizeWorldState(baseWorld);` (~6664), add:

```js
  // One resolver for this turn's goal declarations, built from the same primed
  // catalog the combat-region resolver uses, so a declared goal region is
  // canonicalized at the moment the ledger saves it.
  const regionResolver = buildRegionResolver(getPrimedScenarioRegionCatalog() ?? []);
```

`getPrimedScenarioRegionCatalog` is a module-level import, so it is in scope
here. Do not rebuild the resolver per event or per war.

- [ ] **Step 3: Run the adapter after the battles and before the impacts**

Immediately after the engagement loop that ends at ~6688, and before
`const impactMerge = applyEventImpactsToWorld({`, insert:

```js
  // War settlement runs once, on the pre-turn world and this turn's battle
  // results, before the impacts land: the peace event it writes must travel
  // through the same door every other territorial change uses, and the war must
  // still be active when the ledger closes it below.
  const settlementOutcome = resolveWarSettlements({
    world: baseWorldNormalized,
    events: freshEvents,
    engagements: engagementOutcome.results,
    date: nextGame.gameDate,
    playerPolity: normalizeString(baseGame.country),
  });
  // The adapter reads the pre-turn world, so a war this same turn's warUpdates
  // already ends or ceasefires is still "active" there. The model's own peace
  // must stand, and a ceasefire is not a settlement, so withhold those ids.
  const modelClosedWarIds = new Set(
    warUpdates
      .filter((update) => ["end", "ceasefire"].includes(normalizeString(update.op)))
      .map((update) => normalizeString(update.id))
      .filter(Boolean),
  );
  const dueSettlements = settlementOutcome.settlements
    .filter((settlement) => !modelClosedWarIds.has(normalizeString(settlement.warId)));
  for (const settlement of dueSettlements) {
    const event = buildSettlementEvent(settlement, { date: nextGame.gameDate, round: nextGame.round });
    if (!event) continue;
    freshEvents.push(normalizeEventEntry(event, freshEvents.length));
    warUpdates.push({ eventIds: [event.id], id: settlement.warId, op: "end" });
    if (receipt) {
      noteReceipt(receipt, "adjusted",
        `The war ${settlement.warId} closed: ${settlement.white ? "white peace" : "settlement"}`
        + ` (${settlement.transfers.length} region(s) moved).`);
    }
  }
  for (const entry of settlementOutcome.unresolved) {
    if (receipt) noteReceipt(receipt, "withheld", `The war ${entry.warId} was left open: ${entry.reason}.`);
  }
```

Use the event id the built event actually carries for `eventIds`; do not invent
one. `warUpdates` is the `const` array created earlier in the function, so
`push` mutates it in place.

- [ ] **Step 4: Pass the weariness and the resolver to the ledger**

At the `applyWarUpdates` call (~6800), add:

```js
    weariness: settlementOutcome.weariness,
    resolveRegion: regionResolver.resolve,
```

- [ ] **Step 5: Pay the reparations after the impacts**

Immediately after `worldWithImpacts = warMerge.world;` (~6805), insert:

```js
  // Reparations move real reserves, so they are paid once the war is closed and
  // the peace event's transfers have already landed.
  worldWithImpacts = applyWarReparations(worldWithImpacts, dueSettlements);
```

- [ ] **Step 6: Add the integration assertion**

In `src/runtime/warSettlement.test.js`, add a test that a `resolveWarSettlements`
result's `weariness` map, fed to `applyWarUpdates`, persists the weariness and
closes the war when the appended `end` record is present. Keep it pure (no
gameplay import, which pulls in `./main.jsx`).

- [ ] **Step 7: Run the tests**

Run: `node --test src/runtime/warSettlement.test.js`
Expected: PASS.

Run: `node --test "src/runtime/*.test.js"` and `node --test "src/Game/AI/*.test.js"`
Expected: PASS, no regression.

- [ ] **Step 8: Commit**

```bash
git add src/Game/AI/gameplay.js src/runtime/warSettlement.test.js
git commit -m "feat(ai): settle and close wars inside the turn"
```

---

### Task 8: The wiring guard

**Files:**
- Create: `src/runtime/warSettlementWiringArchitecture.test.js`

**Interfaces:**
- Consumes: the source text of `src/Game/AI/gameplay.js`, `src/runtime/warSettlement.js`, `src/engine/warSettlement.js` and `src/Game/AI/nativeWarLedger.js`.
- Produces: a guard that fails if the seams are unwired, in the style of `combatWiringArchitecture.test.js`.

- [ ] **Step 1: Write the guard test**

Create `src/runtime/warSettlementWiringArchitecture.test.js`:

```js
// Run: node --test src/runtime/warSettlementWiringArchitecture.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
const adapter = readFileSync(new URL("./warSettlement.js", import.meta.url), "utf8");
const core = readFileSync(new URL("../engine/warSettlement.js", import.meta.url), "utf8");

test("the settlement core imports only the shared math", () => {
  const specifiers = [...core.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(specifiers, ["./economyMath.js"]);
});

test("the turn settles after the battles and before the impacts", () => {
  const battlesAt = gameplay.indexOf("resolveEventEngagements(freshEvents");
  const settleAt = gameplay.indexOf("resolveWarSettlements({");
  const applyAt = gameplay.indexOf("const impactMerge = applyEventImpactsToWorld(");
  const reparationAt = gameplay.indexOf("applyWarReparations(worldWithImpacts");
  const warMergeAt = gameplay.indexOf("worldWithImpacts = warMerge.world;");
  assert.ok(battlesAt > 0 && settleAt > 0 && applyAt > 0, "a settlement seam is missing");
  assert.ok(battlesAt < settleAt, "settlement must run after the battles resolve");
  assert.ok(settleAt < applyAt, "settlement must run before the impacts are applied");
  assert.ok(warMergeAt > 0 && reparationAt > warMergeAt, "reparations must be paid after the war closes");
});

test("the adapter never writes the war ledger or a combat region", () => {
  assert.equal(/applyWarUpdates\s*\(/.test(adapter), false);
  assert.match(adapter, /impacts\.regionTransfers/);
  assert.equal(/combatRegion\s*:/.test(adapter), false);
});

test("the turn passes the weariness and the resolver to the war ledger", () => {
  const mergeAt = gameplay.indexOf("weariness: settlementOutcome.weariness");
  assert.ok(mergeAt > 0, "the ledger is not handed the weariness");
  assert.ok(gameplay.indexOf("resolveRegion: regionResolver.resolve") > 0, "the ledger is not handed the resolver");
});

test("the turn withholds a war it closes itself from settlement", () => {
  const closedAt = gameplay.indexOf("const modelClosedWarIds = new Set(");
  const dueAt = gameplay.indexOf("const dueSettlements = settlementOutcome.settlements");
  const filterAt = gameplay.indexOf(
    ".filter((settlement) => !modelClosedWarIds.has(normalizeString(settlement.warId)))",
  );
  const reparationAt = gameplay.indexOf("applyWarReparations(worldWithImpacts, dueSettlements)");
  assert.ok(closedAt > 0 && dueAt > closedAt, "the model-closed wars are not withheld");
  assert.ok(filterAt > dueAt, "the settlements are not filtered by the model-closed ids");
  assert.ok(reparationAt > 0, "reparations are paid from the unfiltered settlement set");
});
```

Adjust the exact anchors to the final source if formatting differs, but keep the
ordering assertions and the `> 0` guards.

- [ ] **Step 2: Run the guard**

Run: `node --test src/runtime/warSettlementWiringArchitecture.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/runtime/warSettlementWiringArchitecture.test.js
git commit -m "test(runtime): guard the war settlement seams"
```

---

### Task 9: Document the rule

**Files:**
- Modify: `docs/world-state.md` (the `wars` entry)
- Modify: `docs/runtime-services.md` (the war ledger / settlement service)
- Modify: `wiki/systems/projects.md` (the war systems section)
- Regenerate: `public/wiki/**`

**Interfaces:**
- Produces: prose that names the `goals` op, the `goals`/`weariness` war fields
  and the settlement rule, and a regenerated wiki that matches its source.

- [ ] **Step 1: Document the state**

In `docs/world-state.md`, on the `world.wars` entry, record that a war may carry
`goals` (one closed kind per side, plus declared target regions) and `weariness`
(`{a,b,throughDate}`); both optional, neither migrated, and a war without goals
settles as `status_quo`.

- [ ] **Step 2: Document the runtime**

In `docs/runtime-services.md`, describe `src/engine/warSettlement.js` and
`src/runtime/warSettlement.js`: who computes progress and weariness, who derives
the terms, that `src/runtime/` is the only executor, and that a player's war is
left open.

- [ ] **Step 3: Document the wiki**

In `wiki/systems/projects.md`, add the settlement to the war systems prose in the
same voice as the surrounding entries.

- [ ] **Step 4: Regenerate and verify the wiki**

```bash
npm run build:wiki
npm run wiki:check
```

Expected: `Wiki is current.`

- [ ] **Step 5: Commit**

```bash
git add docs/world-state.md docs/runtime-services.md wiki/systems/projects.md public/wiki
git commit -m "docs: record war goals, weariness and settlement"
```

---

### Task 10: The acceptance pass

**Files:** none new. This task proves the increment.

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: zero failures. If the only failure is the known network flake in
`server/appUpdate.test.js` ("the manifest tells the page which of the two updates
it can offer"), re-run it alone to confirm it is the flake and not a regression.

- [ ] **Step 2: Lint the changed files**

Run: `npx eslint src/engine/warSettlement.js src/engine/warSettlement.test.js src/runtime/warSettlement.js src/runtime/warSettlement.test.js src/runtime/warSettlementWiringArchitecture.test.js src/runtime/combatEngagements.js src/Game/AI/nativeWarLedger.js src/Game/AI/combatRegionResolution.js src/Game/AI/gameplay.js src/Game/AI/gameplayPrompts.js`
Expected: 0 errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Trailer audit**

Confirm every commit on the branch since the spec commit carries exactly one
`Co-authored-by` trailer added by the hook, and that no commit message passed it
explicitly.

- [ ] **Step 5: Push to the fork only**

```bash
git push origin 261001-feat-combat-engagements
```

Expected: pushed to the user's fork. Do not push to the upstream
`Open-Historia/open-historia` and do not open a PR.
