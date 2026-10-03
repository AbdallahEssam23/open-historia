# Treaty Obligations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an active alliance, mutual defense pact or guarantee draw its bound, non-player party into a war the engine already tracks, deterministically, and tell the model it happened.

**Architecture:** A new import-free engine module owns the rule (`src/engine/treatyObligations.js`). A new runtime adapter reads `world.wars` and `world.agreements`, canonicalizes every name into one key space, calls the core, writes joins back as a new normalized world, and formats a capped digest (`src/runtime/treatyObligations.js`). `gameplay.js` runs the adapter once per turn right after its own `warUpdates` land, and hands the digest to the war ledger directive.

**Tech Stack:** JavaScript ESM, `node:test` + `node:assert/strict`, no new dependency.

## Global Constraints

- ASCII only in every file this plan touches: no emoji, no em dash, no middle dot. Comments explain WHY, not what.
- No new entry in `package.json`. No migration. The only stored-state change is one war field, `aggressor`, with a default.
- `src/engine/**` purity (`src/engine/enginePurity.test.js`): no `Date.now`, no `new Date`, no `Math.random`, no browser global, and imports limited to `./<name>.js`, `../runtime/gameDates.js`, `../runtime/unitMotion.js`. The new engine module imports nothing.
- `src/runtime/**` never imports `src/Game/AI/**`. `Runtime` is the only execution authority; `Runtime` never imports `Game/AI`.
- Deterministic ordering uses `<` / `>` (never `localeCompare`) and `toLowerCase` (never `toLocaleLowerCase`).
- `node --test <dir>` does not work here. Run tests with globs: `node --test "src/engine/*.test.js"`, `node --test "src/runtime/*.test.js"`, `node --test "src/Game/AI/*.test.js"`.
- Do not edit an existing passing test to make a change pass, except where this plan states a stored-shape change (the `aggressor` field) intentionally alters an expected value; those cases are called out explicitly.
- Every commit uses a conventional prefix and ends with the trailer `Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>`, which the `prepare-commit-msg` hook adds automatically: never pass that trailer through `-m`.
- `public/wiki/**` is generated but committed and is built from `wiki/` only, so editing `docs/` alone does not require a rebuild; `npm run wiki:check` must still report `Wiki is current.` at acceptance.
- The spec is `docs/specs/2026-10-03-treaty-obligations-design.md`. Read it for the rule's intent.

---

### Task 1: The engine rule

**Files:**
- Create: `src/engine/treatyObligations.js`
- Test: `src/engine/treatyObligations.test.js`

**Interfaces:**
- Consumes: nothing (no imports).
- Produces:
  - `deriveTreatyObligations({ wars = [], agreements = [] }) -> { joins, standing, rejections, summary }`
  - `joins`: `[{ warId, side: "a"|"b", polity, viaAgreementId }]`
  - `standing`: `[{ warId, side, agreementId, agreementType, polities: string[] }]`
  - `rejections`: `[{ warId, side, polity, agreementId, reason: "already-opposed"|"side-full" }]`
  - `summary`: `{ wars, joined, standing, rejected, truncated }`
  - Constants `MAX_WAR_SIDE`, `MAX_TREATY_JOINS_PER_STEP`, `MAX_OBLIGATION_PASSES`, `MAX_STANDING_OBLIGATIONS`, `OBLIGATION_AGREEMENT_TYPES`.

- [ ] **Step 1: Write the failing test**

Create `src/engine/treatyObligations.test.js`:

```js
// Run: node --test src/engine/treatyObligations.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_OBLIGATION_PASSES,
  MAX_TREATY_JOINS_PER_STEP,
  MAX_WAR_SIDE,
  deriveTreatyObligations,
} from "./treatyObligations.js";

const war = (over = {}) => ({
  id: "w1",
  status: "active",
  aggressor: "a",
  sideA: ["A"],
  sideB: ["B"],
  ...over,
});

const agreement = (over = {}) => ({
  id: "a1",
  type: "alliance",
  status: "active",
  parties: ["A", "C"],
  ...over,
});

test("an alliance drags a partner onto the fighting partner's aggressor side", () => {
  const out = deriveTreatyObligations({ wars: [war()], agreements: [agreement()] });
  assert.deepEqual(out.joins, [{ warId: "w1", side: "a", polity: "C", viaAgreementId: "a1" }]);
  assert.equal(out.summary.joined, 1);
});

test("an alliance whose fighting partner is the victim joins the defender side", () => {
  const out = deriveTreatyObligations({
    wars: [war()],
    agreements: [agreement({ parties: ["B", "C"] })],
  });
  assert.deepEqual(out.joins, [{ warId: "w1", side: "b", polity: "C", viaAgreementId: "a1" }]);
});

test("a mutual defense joins only when the protected party was attacked", () => {
  const defender = deriveTreatyObligations({
    wars: [war()],
    agreements: [agreement({ type: "mutual_defense", parties: ["B", "C"] })],
  });
  assert.deepEqual(defender.joins, [{ warId: "w1", side: "b", polity: "C", viaAgreementId: "a1" }]);

  const aggressor = deriveTreatyObligations({
    wars: [war()],
    agreements: [agreement({ type: "mutual_defense", parties: ["A", "C"] })],
  });
  assert.deepEqual(aggressor.joins, [], "a mutual defense does not pull anyone to the aggressor");
});

test("a guarantee pulls the guarantor to the beneficiary's defender side only", () => {
  const helps = deriveTreatyObligations({
    wars: [war()],
    agreements: [agreement({ type: "guarantee", parties: ["B", "G"], guarantor: "G", beneficiary: "B" })],
  });
  assert.deepEqual(helps.joins, [{ warId: "w1", side: "b", polity: "G", viaAgreementId: "a1" }]);

  const selfMade = deriveTreatyObligations({
    wars: [war()],
    agreements: [agreement({ type: "guarantee", parties: ["A", "G"], guarantor: "G", beneficiary: "A" })],
  });
  assert.deepEqual(selfMade.joins, [], "a guarantee does not pull the guarantor to an aggressor");
});

test("alliances chain to a fixed point; a defensive join never propagates defense", () => {
  const chained = deriveTreatyObligations({
    wars: [war()],
    agreements: [
      agreement({ id: "a1", parties: ["A", "C"] }),
      agreement({ id: "a2", parties: ["C", "D"] }),
    ],
  });
  assert.deepEqual(chained.joins.map((join) => join.polity), ["C", "D"]);

  const defensive = deriveTreatyObligations({
    wars: [war()],
    agreements: [
      agreement({ id: "a1", type: "mutual_defense", parties: ["B", "C"] }),
      agreement({ id: "a2", type: "mutual_defense", parties: ["C", "D"] }),
    ],
  });
  assert.deepEqual(defensive.joins.map((join) => join.polity), ["C"], "a defensive join must not become a new victim");
});

test("a party on the opposing side is rejected, and a party already on the side is a no-op", () => {
  const opposed = deriveTreatyObligations({
    wars: [war()],
    agreements: [agreement({ parties: ["A", "B"] })],
  });
  assert.deepEqual(opposed.joins, []);
  assert.deepEqual(
    opposed.rejections.map((row) => [row.polity, row.side, row.reason]),
    [["A", "b", "already-opposed"], ["B", "a", "already-opposed"]],
  );

  const honored = deriveTreatyObligations({
    wars: [war({ sideA: ["A", "C"] })],
    agreements: [agreement({ parties: ["A", "C", "D"] })],
  });
  assert.deepEqual(honored.rejections, []);
  assert.deepEqual(honored.joins.map((join) => join.polity), ["D"]);
});

test("a side at the cap rejects the next join with side-full", () => {
  const fill = Array.from({ length: MAX_WAR_SIDE - 1 }, (_, i) => `S${i}`);
  const out = deriveTreatyObligations({
    wars: [war({ sideA: ["A", ...fill] })],
    agreements: [agreement({ parties: ["A", "C"] })],
  });
  assert.deepEqual(out.joins, []);
  assert.deepEqual(out.rejections, [{ warId: "w1", side: "a", polity: "C", agreementId: "a1", reason: "side-full" }]);
});

test("the per-step join cap truncates the derivation and reports it", () => {
  const wars = [1, 2, 3].map((n) => war({ id: `w${n}`, sideA: [`A${n}`], sideB: [`B${n}`] }));
  const agreements = wars.map((w, index) => agreement({
    id: `a${index + 1}`,
    parties: [w.sideA[0], ...Array.from({ length: 12 }, (_, i) => `P${index}-${i}`)],
  }));
  const out = deriveTreatyObligations({ wars, agreements });
  assert.equal(out.joins.length, MAX_TREATY_JOINS_PER_STEP);
  assert.equal(out.summary.truncated, true);
});

test("the pass cap bounds an alliance chain", () => {
  const agreements = [];
  let previous = "A";
  for (let i = 1; i <= 9; i += 1) {
    const next = `C${i}`;
    agreements.push(agreement({ id: `a${i}`, parties: [previous, next] }));
    previous = next;
  }
  const out = deriveTreatyObligations({ wars: [war()], agreements });
  assert.equal(out.joins.length, MAX_OBLIGATION_PASSES);
  assert.equal(out.joins.some((join) => join.polity === "C9"), false);
});

test("a ceasefire war and a suspended agreement bind no one", () => {
  const cease = deriveTreatyObligations({ wars: [war({ status: "ceasefire" })], agreements: [agreement()] });
  assert.deepEqual(cease.joins, []);
  assert.equal(cease.summary.wars, 0);

  const suspended = deriveTreatyObligations({ wars: [war()], agreements: [agreement({ status: "suspended" })] });
  assert.deepEqual(suspended.joins, []);
});

test("standing reports the agreement links the world already realizes", () => {
  const out = deriveTreatyObligations({
    wars: [war({ sideA: ["A", "C"] })],
    agreements: [agreement({ parties: ["A", "C"] })],
  });
  assert.deepEqual(out.standing, [
    { warId: "w1", side: "a", agreementId: "a1", agreementType: "alliance", polities: ["A", "C"] },
  ]);
  assert.deepEqual(out.joins, [], "an honored alliance proposes nobody new");
});

test("reordering wars, agreements and parties never changes the result", () => {
  const wars = [war({ id: "w1" }), war({ id: "w2", sideA: ["A2"], sideB: ["B2"] })];
  const agreements = [
    agreement({ id: "a1", parties: ["A", "C"] }),
    agreement({ id: "a2", type: "guarantee", parties: ["B2", "G2"], guarantor: "G2", beneficiary: "B2" }),
  ];
  const first = deriveTreatyObligations({ wars, agreements });
  const second = deriveTreatyObligations({
    wars: [...wars].reverse(),
    agreements: [...agreements].reverse().map((entry) => ({ ...entry, parties: [...entry.parties].reverse() })),
  });
  assert.deepEqual(second, first);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/engine/treatyObligations.test.js"`
Expected: FAIL with `Cannot find module .../treatyObligations.js`.

- [ ] **Step 3: Write the engine module**

Create `src/engine/treatyObligations.js`:

```js
/*! Open Historia - engine treaty obligations: the treaty clause a war triggers (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Which recorded promise a war calls in, as a pure function over plain data. An
// alliance is offensive and defensive; a mutual defense and a guarantee are
// defensive only, so the war must carry which side began it. No imports: the
// engine purity guard allows none, so the obligating type names are repeated
// here and a test pins them to the runtime enum.

export const MAX_WAR_SIDE = 12;
export const MAX_TREATY_JOINS_PER_STEP = 32;
export const MAX_OBLIGATION_PASSES = 8;
export const MAX_STANDING_OBLIGATIONS = 128;
export const OBLIGATION_AGREEMENT_TYPES = Object.freeze(["alliance", "mutual_defense", "guarantee"]);

const asString = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const keyOf = (value) => asString(value).toLowerCase();
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const comparePolity = (a, b) => compareText(keyOf(a), keyOf(b)) || compareText(asString(a), asString(b));

const uniqueByKey = (values) => {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const name = asString(value);
    const key = keyOf(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
};

// Parties in a total order that does not depend on how they were written, so
// reordering an agreement's parties can never change the derivation.
const partiesOf = (agreement) => uniqueByKey(list(agreement?.parties).slice().sort(comparePolity));

const compareAgreements = (a, b) =>
  compareText(asString(a?.id), asString(b?.id))
  || compareText(partiesOf(a).join(","), partiesOf(b).join(","));

export const deriveTreatyObligations = ({ wars = [], agreements = [] } = {}) => {
  const sortedWars = list(wars)
    .filter((war) => asString(war?.status) === "active")
    .slice()
    .sort((a, b) => compareText(asString(a?.id), asString(b?.id)));
  const sortedAgreements = list(agreements)
    .filter((agreement) =>
      OBLIGATION_AGREEMENT_TYPES.includes(asString(agreement?.type))
      && asString(agreement?.status) === "active")
    .slice()
    .sort(compareAgreements);

  const joins = [];
  const rejections = [];
  const standing = [];
  let truncated = false;

  for (const war of sortedWars) {
    const warId = asString(war?.id);
    const sides = { a: new Map(), b: new Map() };
    for (const polity of uniqueByKey(list(war?.sideA))) sides.a.set(keyOf(polity), polity);
    for (const polity of uniqueByKey(list(war?.sideB))) {
      const key = keyOf(polity);
      if (!sides.a.has(key)) sides.b.set(key, polity);
    }
    const aggressorSide = asString(war?.aggressor) === "b" ? "b" : "a";
    const defenderSide = aggressorSide === "a" ? "b" : "a";
    // The victim test reads this snapshot, not the live sides: a polity that
    // joins during the fixed point is a belligerent but not a victim, so a
    // defensive join cannot trigger the next one.
    const originalDefenders = new Set(sides[defenderSide].keys());
    const sideOf = (polity) => {
      const key = keyOf(polity);
      if (!key) return "";
      if (sides.a.has(key)) return "a";
      if (sides.b.has(key)) return "b";
      return "";
    };

    for (const side of ["a", "b"]) {
      const memberKeys = new Set(sides[side].keys());
      for (const agreement of sortedAgreements) {
        const type = asString(agreement?.type);
        const parties = partiesOf(agreement);
        const relevant = type === "guarantee"
          ? uniqueByKey([asString(agreement?.guarantor) || parties[0], asString(agreement?.beneficiary) || parties[1]])
          : parties;
        const onSide = relevant.filter((polity) => memberKeys.has(keyOf(polity)));
        if (onSide.length >= 2) {
          standing.push({
            warId,
            side,
            agreementId: asString(agreement?.id),
            agreementType: type,
            polities: onSide,
          });
          if (standing.length >= MAX_STANDING_OBLIGATIONS) break;
        }
      }
      if (standing.length >= MAX_STANDING_OBLIGATIONS) break;
    }
    if (standing.length >= MAX_STANDING_OBLIGATIONS) break;

    let pass = 0;
    while (pass < MAX_OBLIGATION_PASSES) {
      pass += 1;
      const proposals = [];
      const proposed = new Set();
      const propose = (polity, side, agreementId) => {
        const name = asString(polity);
        const key = keyOf(name);
        if (!key || proposed.has(key)) return;
        proposed.add(key);
        proposals.push({ polity: name, side, agreementId });
      };

      for (const agreement of sortedAgreements) {
        const agreementId = asString(agreement?.id);
        const type = asString(agreement?.type);
        const parties = partiesOf(agreement);
        if (type === "alliance") {
          for (const member of parties) {
            const side = sideOf(member);
            if (!side) continue;
            for (const partner of parties) {
              if (keyOf(partner) === keyOf(member)) continue;
              propose(partner, side, agreementId);
            }
          }
        } else if (type === "mutual_defense") {
          for (const protectedParty of parties) {
            if (!originalDefenders.has(keyOf(protectedParty))) continue;
            for (const protector of parties) {
              if (keyOf(protector) === keyOf(protectedParty)) continue;
              propose(protector, defenderSide, agreementId);
            }
          }
        } else if (type === "guarantee") {
          const beneficiary = asString(agreement?.beneficiary) || parties[1];
          const guarantor = asString(agreement?.guarantor) || parties[0];
          if (originalDefenders.has(keyOf(beneficiary))) propose(guarantor, defenderSide, agreementId);
        }
      }

      proposals.sort((a, b) => compareText(keyOf(a.polity), keyOf(b.polity)));
      const applied = [];
      for (const proposal of proposals) {
        if (joins.length + applied.length >= MAX_TREATY_JOINS_PER_STEP) {
          truncated = true;
          break;
        }
        const key = keyOf(proposal.polity);
        const other = proposal.side === "a" ? "b" : "a";
        if (sides[proposal.side].has(key)) continue;
        if (sides[other].has(key)) {
          rejections.push({ warId, side: proposal.side, polity: proposal.polity, agreementId: proposal.agreementId, reason: "already-opposed" });
          continue;
        }
        if (sides[proposal.side].size >= MAX_WAR_SIDE) {
          rejections.push({ warId, side: proposal.side, polity: proposal.polity, agreementId: proposal.agreementId, reason: "side-full" });
          continue;
        }
        sides[proposal.side].set(key, proposal.polity);
        applied.push({ warId, side: proposal.side, polity: proposal.polity, viaAgreementId: proposal.agreementId });
      }
      joins.push(...applied);
      if (!applied.length || truncated) break;
    }
  }

  return {
    joins,
    standing,
    rejections,
    summary: {
      wars: sortedWars.length,
      joined: joins.length,
      standing: standing.length,
      rejected: rejections.length,
      truncated,
    },
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/engine/treatyObligations.test.js"`
Expected: PASS, all tests.

- [ ] **Step 5: Run the whole engine suite and the purity guard**

Run: `node --test "src/engine/*.test.js"`
Expected: PASS, including `enginePurity.test.js` over the new module.

- [ ] **Step 6: Commit**

```bash
git add src/engine/treatyObligations.js src/engine/treatyObligations.test.js
git commit -m "feat(engine): derive treaty obligations from wars and agreements"
```

---

### Task 2: The war aggressor field

**Files:**
- Modify: `src/runtime/gameState.js` (the `normalizeWorldWar` return, around line 3353)
- Modify: `src/Game/AI/nativeWarLedger.js` (the `normalizeWar` return around line 71, the `start` op around line 300, and `WAR_LEDGER_VERSION` around line 17)
- Test: `src/runtime/gameState.ledgers.test.js`
- Test: `src/Game/AI/warLedger.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: every normalized war carries `aggressor: "a" | "b"`, defaulting to `"a"`. Task 3 and Task 5 read `war.aggressor`.

- [ ] **Step 1: Write the failing tests**

Append to `src/runtime/gameState.ledgers.test.js`:

```js
test("a war carries an aggressor that defaults to side A and survives a round trip", () => {
  const world = normalizeWorldState({
    wars: [
      { id: "w1", status: "active", sideA: ["Germany"], sideB: ["France"], startedDate: "1914-08-03" },
      { id: "w2", status: "active", aggressor: "b", sideA: ["Italy"], sideB: ["Austria"], startedDate: "1915-05-23" },
    ],
  });
  assert.equal(world.wars.find((war) => war.id === "w1").aggressor, "a", "a war with no field defaults to the declarer");
  assert.equal(world.wars.find((war) => war.id === "w2").aggressor, "b", "an explicit aggressor is kept");

  const again = normalizeWorldState(world);
  assert.deepEqual(again.wars, world.wars);
});
```

Append to `src/Game/AI/warLedger.test.js`:

```js
test("a started war records side A as the aggressor and keeps an explicit one", () => {
  const events = [{
    id: "e1",
    date: "1914-08-03",
    title: "Germany declares war on France",
    warId: "war-france-germany-1914",
  }];
  const started = applyWarUpdates({
    world: { polityOverrides: {}, wars: [] },
    updates: decodeWarUpdates("war-france-germany-1914~start~Germany~France~1~Declaration of war"),
    events,
    stopDate: "1914-08-31",
    round: 2,
  });
  assert.equal(started.wars[0].aggressor, "a");

  const kept = applyWarUpdates({
    world: {
      polityOverrides: {},
      wars: [{ id: "w", status: "active", aggressor: "b", sideA: ["A"], sideB: ["B"], startedDate: "1900-01-01" }],
    },
    updates: [],
    events: [],
    stopDate: "1901-01-01",
    round: 2,
  });
  assert.equal(kept.wars[0].aggressor, "b");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "src/runtime/gameState.ledgers.test.js"` and `node --test "src/Game/AI/warLedger.test.js"`
Expected: FAIL, `aggressor` is `undefined`.

- [ ] **Step 3: Add the field to the runtime normalizer**

In `src/runtime/gameState.js`, inside `normalizeWorldWar`, change the returned object's `status`/`sideA` boundary:

old:
```js
    status,
    sideA,
```
new:
```js
    status,
    aggressor: entry.aggressor === "b" ? "b" : "a",
    sideA,
```

- [ ] **Step 4: Add the field to the war ledger normalizer and the start op**

In `src/Game/AI/nativeWarLedger.js`, inside `normalizeWar`, change:

old:
```js
    status,
    sideA,
```
new:
```js
    status,
    aggressor: entry.aggressor === "b" ? "b" : "a",
    sideA,
```

In the same file, inside the `start` op `save({ ... })` call, change:

old:
```js
    return save({
      id,
      status: "active",
      sideA,
```
new:
```js
    return save({
      id,
      status: "active",
      aggressor: "a",
      sideA,
```

In the same file, bump the version:

old:
```js
export const WAR_LEDGER_VERSION = "0.1.4-adversarial-war-start";
```
new:
```js
export const WAR_LEDGER_VERSION = "0.1.5-treaty-obligations";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test "src/runtime/gameState.ledgers.test.js"` and `node --test "src/Game/AI/warLedger.test.js"`
Expected: PASS.

- [ ] **Step 6: Run the runtime and AI suites for regressions**

Run: `node --test "src/runtime/*.test.js"` and `node --test "src/Game/AI/*.test.js"`
Expected: PASS. A war-record `deepEqual` test that predated the field now fails because the stored shape intentionally changed; update only that assertion to include `aggressor: "a"` and note it in the commit. Nothing else is edited.

- [ ] **Step 7: Commit**

```bash
git add src/runtime/gameState.js src/Game/AI/nativeWarLedger.js src/runtime/gameState.ledgers.test.js src/Game/AI/warLedger.test.js
git commit -m "feat(war-ledger): record which side began a war"
```

---

### Task 3: The runtime adapter and the digest

**Files:**
- Create: `src/runtime/treatyObligations.js`
- Test: `src/runtime/treatyObligations.test.js`

**Interfaces:**
- Consumes: `deriveTreatyObligations`, `OBLIGATION_AGREEMENT_TYPES` from Task 1; `war.aggressor` from Task 2.
- Produces:
  - `readTreatyObligations(world, { playerPolity = "" }) -> { joins, standing, rejections, summary }` with `joins` filtered to non-player polities and `summary.joined` matching the filtered length.
  - `applyTreatyJoins(world, joins, { date = "", round = 0 }) -> world` (a new normalized world, or the same argument when there is nothing to apply).
  - `buildTreatyObligationDigest({ standing = [], cap = 6, charCap = 360 }) -> string`.
  - Constants `TREATY_ROW_CAP`, `TREATY_CHAR_CAP`.

- [ ] **Step 1: Write the failing test**

Create `src/runtime/treatyObligations.test.js`:

```js
// Run: node --test src/runtime/treatyObligations.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyTreatyJoins,
  buildTreatyObligationDigest,
  readTreatyObligations,
} from "./treatyObligations.js";
import { OBLIGATION_AGREEMENT_TYPES } from "../engine/treatyObligations.js";
import { normalizeWorldState } from "./gameState.js";

const world = (over = {}) => normalizeWorldState({
  polityOverrides: {
    France: { code: "France" },
    Germany: { code: "Germany" },
    Russia: { code: "Russia" },
    Italy: { code: "Italy" },
  },
  ...over,
});

test("the adapter reads an alliance out of the stored world", () => {
  const stored = world({
    wars: [{ id: "w1", status: "active", aggressor: "a", sideA: ["Germany"], sideB: ["France"], startedDate: "1914-08-03" }],
    agreements: [{ id: "central", type: "alliance", status: "active", parties: ["Germany", "Italy"] }],
  });
  const out = readTreatyObligations(stored, { playerPolity: "France" });
  assert.deepEqual(out.joins, [{ warId: "w1", side: "a", polity: "Italy", viaAgreementId: "central" }]);
});

test("the adapter never joins the player's own polity", () => {
  const stored = world({
    wars: [{ id: "w1", status: "active", aggressor: "a", sideA: ["Germany"], sideB: ["France"], startedDate: "1914-08-03" }],
    agreements: [{ id: "central", type: "alliance", status: "active", parties: ["Germany", "Italy"] }],
  });
  const out = readTreatyObligations(stored, { playerPolity: "Italy" });
  assert.deepEqual(out.joins, []);
  assert.equal(out.summary.joined, 0);
});

test("applyTreatyJoins grows the named side and stamps the date and round", () => {
  const stored = world({
    wars: [{ id: "w1", status: "active", aggressor: "a", sideA: ["Germany"], sideB: ["France"], startedDate: "1914-08-03" }],
  });
  const next = applyTreatyJoins(stored, [{ warId: "w1", side: "a", polity: "Italy" }], { date: "1914-08-10", round: 3 });
  assert.deepEqual(next.wars[0].sideA, ["Germany", "Italy"]);
  assert.equal(next.wars[0].lastUpdatedDate, "1914-08-10");
  assert.equal(next.wars[0].updatedRound, 3);
  assert.equal(applyTreatyJoins(stored, [], { date: "1914-08-10", round: 3 }), stored, "a quiet turn copies nothing");
});

test("the digest orders rows, caps them and reports the overflow", () => {
  const standing = Array.from({ length: 8 }, (_, i) => ({
    warId: "w1",
    side: "a",
    agreementId: `a${i}`,
    agreementType: "alliance",
    polities: ["Germany", "Italy"],
  }));
  // A generous character cap here, so this test pins the ROW cap and the
  // overflow line; the character clamp is exercised by the runtime default.
  const block = buildTreatyObligationDigest({ standing, cap: 6, charCap: 1000 });
  assert.match(block, /^\[Treaty Obligations, as simulated\]/);
  assert.equal(block.split("\n").length, 8, "a header, six rows and one overflow line");
  assert.match(block, /\+2 more\./);
  assert.equal(buildTreatyObligationDigest({ standing: [] }), "");
});

test("every obligating type is one the world normalizer recognizes", () => {
  for (const type of OBLIGATION_AGREEMENT_TYPES) {
    const stored = world({ agreements: [{ id: "x", type, parties: ["Germany", "Italy"] }] });
    assert.equal(stored.agreements[0].type, type, `${type} is not a world agreement type`);
  }
});

test("the adapter imports no Game/AI module", () => {
  const source = readFileSync(new URL("./treatyObligations.js", import.meta.url), "utf8");
  const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(specifiers.some((specifier) => specifier.includes("Game/AI")), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/runtime/treatyObligations.test.js"`
Expected: FAIL with `Cannot find module .../treatyObligations.js`.

- [ ] **Step 3: Write the adapter and the digest**

Create `src/runtime/treatyObligations.js`:

```js
/*! Open Historia - runtime treaty obligations: read the ledgers, apply the joins (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The adapter between the stored world and the pure obligation core. It reads
// the world, resolves every war polity and agreement party into one canonical
// key space, calls the engine, and turns the joins into a new normalized world.
// It never imports the Game/AI layer and writes nothing but world.wars.

import { deriveTreatyObligations } from "../engine/treatyObligations.js";
import { normalizeWorldState } from "./gameState.js";
import { buildOwnerAliasMap, createOwnerResolver, toCountryName } from "./ownerNames.js";

export const TREATY_ROW_CAP = 6;
export const TREATY_CHAR_CAP = 360;

const asString = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const canonical = (value) => {
  const raw = asString(value);
  return toCountryName(raw) || raw;
};

const readerFor = (world) => {
  const resolveOwner = createOwnerResolver(buildOwnerAliasMap(world?.polityOverrides));
  return (value) => resolveOwner(asString(value)) || canonical(value);
};

export const readTreatyObligations = (world, { playerPolity = "" } = {}) => {
  const normalized = normalizeWorldState(world);
  const readPolity = readerFor(normalized);
  const playerKey = asString(playerPolity) ? readPolity(playerPolity).toLowerCase() : "";

  const wars = list(normalized?.wars)
    .filter((war) => asString(war?.status) === "active")
    .map((war) => ({
      id: asString(war?.id),
      status: "active",
      aggressor: asString(war?.aggressor) === "b" ? "b" : "a",
      sideA: list(war?.sideA).map(readPolity).filter(Boolean),
      sideB: list(war?.sideB).map(readPolity).filter(Boolean),
    }));
  const agreements = list(normalized?.agreements).map((agreement) => ({
    id: asString(agreement?.id),
    type: asString(agreement?.type),
    status: asString(agreement?.status),
    parties: list(agreement?.parties).map(readPolity).filter(Boolean),
    guarantor: asString(agreement?.guarantor) ? readPolity(agreement.guarantor) : "",
    beneficiary: asString(agreement?.beneficiary) ? readPolity(agreement.beneficiary) : "",
  }));

  const derived = deriveTreatyObligations({ wars, agreements });
  const joins = playerKey
    ? derived.joins.filter((join) => asString(join.polity).toLowerCase() !== playerKey)
    : derived.joins;
  return { ...derived, joins, summary: { ...derived.summary, joined: joins.length } };
};

export const applyTreatyJoins = (world, joins, { date = "", round = 0 } = {}) => {
  const pending = list(joins).filter((join) => asString(join?.warId) && asString(join?.polity));
  if (!pending.length) return world;

  const normalized = normalizeWorldState(world);
  const byId = new Map(list(normalized?.wars).map((war) => [asString(war?.id), { ...war }]));
  let touched = false;
  for (const join of pending) {
    const war = byId.get(asString(join.warId));
    if (!war) continue;
    const field = asString(join.side) === "b" ? "sideB" : "sideA";
    const polity = asString(join.polity);
    if (list(war[field]).some((name) => asString(name).toLowerCase() === polity.toLowerCase())) continue;
    war[field] = [...list(war[field]), polity];
    war.lastUpdatedDate = asString(date) || war.lastUpdatedDate;
    war.updatedRound = Math.max(0, Math.trunc(Number(round) || 0)) || war.updatedRound;
    touched = true;
  }
  if (!touched) return world;
  return normalizeWorldState({ ...normalized, wars: [...byId.values()] });
};

export const buildTreatyObligationDigest = ({
  standing = [],
  cap = TREATY_ROW_CAP,
  charCap = TREATY_CHAR_CAP,
} = {}) => {
  const rows = list(standing)
    .filter((row) => row && typeof row === "object" && asString(row.warId) && asString(row.agreementId))
    .slice()
    .sort((a, b) =>
      compareText(asString(a.warId), asString(b.warId))
      || compareText(asString(a.side), asString(b.side))
      || compareText(asString(a.agreementId), asString(b.agreementId)));
  if (!rows.length) return "";

  const limit = Math.max(0, Math.round(Number(cap) || 0));
  const budget = Math.max(0, Math.round(Number(charCap) || 0));
  const shown = rows.slice(0, limit);
  const fixed = "[Treaty Obligations, as simulated]";
  const overflow = rows.length > shown.length ? `+${rows.length - shown.length} more.` : "";

  // A line that would overflow the cap is dropped whole rather than truncated,
  // so the model is never handed half a fact, like the operations digest.
  let used = fixed.length + (overflow ? overflow.length + 1 : 0);
  const kept = [];
  for (const row of shown) {
    const polities = list(row.polities).map(asString).filter(Boolean).join(", ");
    const line = `- Under ${asString(row.agreementId)} (${asString(row.agreementType)}), ${polities} hold side ${asString(row.side).toUpperCase()} of ${asString(row.warId)}.`;
    if (used + line.length + 1 > budget) break;
    kept.push(line);
    used += line.length + 1;
  }
  return [fixed, ...kept, overflow].filter(Boolean).join("\n");
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/runtime/treatyObligations.test.js"`
Expected: PASS.

- [ ] **Step 5: Run the runtime suite for regressions**

Run: `node --test "src/runtime/*.test.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/treatyObligations.js src/runtime/treatyObligations.test.js
git commit -m "feat(runtime): read, apply and digest treaty obligations"
```

---

### Task 4: Enforce obligations in the turn

**Files:**
- Modify: `src/Game/AI/gameplay.js` (the import block around line 34, and `applySimulationResult` around line 6943)
- Test: `src/Game/AI/treatyObligationsWiringArchitecture.test.js`

**Interfaces:**
- Consumes: `readTreatyObligations`, `applyTreatyJoins` from Task 3.
- Produces: a turn that, right after the war ledger merges, applies every obligation join to `world.wars` before the reparations. Task 5 consumes the same import line.

- [ ] **Step 1: Write the failing guard test**

Create `src/Game/AI/treatyObligationsWiringArchitecture.test.js`:

```js
// Run: node --test src/Game/AI/treatyObligationsWiringArchitecture.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");

test("the turn enforces obligations right after the war ledger merges", () => {
  const warMergeAt = gameplay.indexOf("worldWithImpacts = warMerge.world;");
  const readAt = gameplay.indexOf("readTreatyObligations(worldWithImpacts");
  const applyAt = gameplay.indexOf("applyTreatyJoins(worldWithImpacts");
  const reparationAt = gameplay.indexOf("applyWarReparations(worldWithImpacts");
  assert.ok(warMergeAt > 0 && readAt > warMergeAt, "obligations must be read after the war merge");
  assert.ok(applyAt > readAt, "the joins must be applied after they are read");
  assert.ok(reparationAt > applyAt, "the joins must land before the reparations");
});
```

- [ ] **Step 2: Run the guard to verify it fails**

Run: `node --test "src/Game/AI/treatyObligationsWiringArchitecture.test.js"`
Expected: FAIL, `readTreatyObligations(worldWithImpacts` is not found.

- [ ] **Step 3: Add the import**

In `src/Game/AI/gameplay.js`, after:

```js
import { readReinforcement, readReinforcementPolicies } from "../../runtime/reinforcement.js";
```

add:

```js
import { applyTreatyJoins, readTreatyObligations } from "../../runtime/treatyObligations.js";
```

- [ ] **Step 4: Add the turn step**

In `src/Game/AI/gameplay.js`, change:

old:
```js
  worldWithImpacts = warMerge.world;
  // Reparations move real reserves, so they are paid once the war is closed and
  // the peace event's transfers have already landed.
  worldWithImpacts = applyWarReparations(worldWithImpacts, dueSettlements);
```
new:
```js
  worldWithImpacts = warMerge.world;
  // Treaty obligations: an active alliance, mutual defense or guarantee draws a
  // non-player party into a war the engine already tracks. It runs on the world
  // this turn's warUpdates just produced, so a war opened now drags its allies
  // now, and before the reparations so the join is visible to everything later
  // in the turn. A failure here must never lose a completed turn.
  try {
    const obligationOutcome = readTreatyObligations(worldWithImpacts, {
      playerPolity: normalizeString(baseGame.country),
    });
    if (obligationOutcome.joins.length) {
      worldWithImpacts = applyTreatyJoins(worldWithImpacts, obligationOutcome.joins, {
        date: nextGame.gameDate,
        round: nextGame.round,
      });
      logDebugEvent("turn", `Treaty obligations drew ${obligationOutcome.summary.joined} polity(ies) into active war(s).`, {
        joined: obligationOutcome.summary.joined,
        rejected: obligationOutcome.summary.rejected,
      });
    }
  } catch (error) {
    console.warn("[engine] the treaty obligation step failed; the completed turn is preserved.", error);
  }
  // Reparations move real reserves, so they are paid once the war is closed and
  // the peace event's transfers have already landed.
  worldWithImpacts = applyWarReparations(worldWithImpacts, dueSettlements);
```

- [ ] **Step 5: Run the guard to verify it passes**

Run: `node --test "src/Game/AI/treatyObligationsWiringArchitecture.test.js"`
Expected: PASS.

- [ ] **Step 6: Run the AI suite and lint the changed files**

Run: `node --test "src/Game/AI/*.test.js"` and `npx eslint src/Game/AI/gameplay.js`
Expected: PASS and no new lint error.

- [ ] **Step 7: Commit**

```bash
git add src/Game/AI/gameplay.js src/Game/AI/treatyObligationsWiringArchitecture.test.js
git commit -m "feat(ai): enforce treaty obligations when the war ledger merges"
```

---

### Task 5: Tell the model

**Files:**
- Modify: `src/Game/AI/gameplay.js` (the import line from Task 4, `buildWarLedgerDirective` around line 568, and the jump digest block around line 13063)
- Test: `src/Game/AI/treatyObligationsWiringArchitecture.test.js`

**Interfaces:**
- Consumes: `buildTreatyObligationDigest` from Task 3; the import line from Task 4.
- Produces: `variables.treatyObligations` set at jump time, and a `buildWarLedgerDirective` that prints it and states the engine obeys the promise.

- [ ] **Step 1: Write the failing guard test**

Append to `src/Game/AI/treatyObligationsWiringArchitecture.test.js`:

```js
test("the war directive prints the obligations digest the jump prompt builds", () => {
  const start = gameplay.indexOf("const buildWarLedgerDirective = (variables) => {");
  assert.ok(start > 0, "the war directive builder is missing");
  const end = gameplay.indexOf("\n};", start);
  const body = gameplay.slice(start, end);
  assert.match(body, /treatyObligations/, "the directive does not read the obligations");
  assert.ok(gameplay.indexOf("variables.treatyObligations =") > 0, "the jump prompt never sets variables.treatyObligations");
});
```

- [ ] **Step 2: Run the guard to verify it fails**

Run: `node --test "src/Game/AI/treatyObligationsWiringArchitecture.test.js"`
Expected: FAIL, the directive does not mention `treatyObligations`.

- [ ] **Step 3: Extend the import**

In `src/Game/AI/gameplay.js`, change:

old:
```js
import { applyTreatyJoins, readTreatyObligations } from "../../runtime/treatyObligations.js";
```
new:
```js
import {
  applyTreatyJoins,
  buildTreatyObligationDigest,
  readTreatyObligations,
} from "../../runtime/treatyObligations.js";
```

- [ ] **Step 4: Print the block in the war directive**

In `src/Game/AI/gameplay.js`, inside `buildWarLedgerDirective`, change:

old:
```js
  const canonicalWarContext = normalizeString(variables?.canonicalWarContext);
  return `[Wars]
${canonicalWarContext || "No wars are recorded."}
```
new:
```js
  const canonicalWarContext = normalizeString(variables?.canonicalWarContext);
  const treatyObligations = normalizeString(variables?.treatyObligations);
  return `[Wars]
${canonicalWarContext || "No wars are recorded."}${treatyObligations ? `\n${treatyObligations}` : ""}
```

In the same function, add one rule sentence. The existing rule paragraph is a
single very long template-literal line, so do not try to edit inside it: insert a
new line inside the same template literal, immediately before the line that
begins `warUpdates is one string,`. The inserted line must be exactly:

```js
A treaty is not narrative: a party bound by an active alliance, mutual defense or guarantee is drawn into the war by the engine, so when an ally appears in a war it was not fighting, narrate its entry rather than re-declaring the join or writing it out.
```

- [ ] **Step 5: Build the digest at jump time**

In `src/Game/AI/gameplay.js`, inside `simulateTimelineJump`, immediately after the `variables.operationsDigest = buildOperationsDigest({ ... });` statement (around line 13063), add:

```js
      // The treaty links the world already realizes, so the model narrates an
      // ally's entry instead of inventing or contradicting it. Capped and
      // built from the same world the turn reads.
      variables.treatyObligations = buildTreatyObligationDigest({
        standing: readTreatyObligations(bundle.world, { playerPolity }).standing,
      });
```

- [ ] **Step 6: Run the guard to verify it passes**

Run: `node --test "src/Game/AI/treatyObligationsWiringArchitecture.test.js"`
Expected: PASS, both tests.

- [ ] **Step 7: Run the AI suite and lint the changed file**

Run: `node --test "src/Game/AI/*.test.js"` and `npx eslint src/Game/AI/gameplay.js`
Expected: PASS and no new lint error.

- [ ] **Step 8: Commit**

```bash
git add src/Game/AI/gameplay.js src/Game/AI/treatyObligationsWiringArchitecture.test.js
git commit -m "feat(ai): tell the model which treaty obligations stand"
```

---

### Task 6: Document the layer

**Files:**
- Modify: `docs/runtime-services.md` (after the operations digest section, around line 162)

**Interfaces:**
- Consumes: the module names and caps from Task 1 and Task 3.
- Produces: a reader-facing section; no code.

- [ ] **Step 1: Add the section**

In `docs/runtime-services.md`, change:

old:
```md
digest. Nothing is stored and no engine rule changes: the model is shown what
the engine already computed.
```
new:
```md
digest. Nothing is stored and no engine rule changes: the model is shown what
the engine already computed.

---

## Treaty obligations - `src/runtime/treatyObligations.js`

`readTreatyObligations(world, { playerPolity })` reads `world.wars` and
`world.agreements`, resolves every war polity and agreement party into one
canonical key space, and calls the pure core
`src/engine/treatyObligations.js` (`deriveTreatyObligations`). An active
`alliance` drags a party onto the side of any fighting partner, offensive or
defensive; an active `mutual_defense` or `guarantee` pulls the protector in only
when the protected party was a victim of a war it did not begin. A war records
which side began it in `aggressor` (`"a"` or `"b"`, default `"a"`, set by the
`start` op in `nativeWarLedger.js`), because a mutual defense cannot tell an
attack from an aggression without it. Joins are applied to the fixed point:
alliances chain, defensive joins do not. Every cap is explicit -
`MAX_WAR_SIDE` (12), `MAX_TREATY_JOINS_PER_STEP` (32), `MAX_OBLIGATION_PASSES`
(8) - and a refused join is recorded with a reason (`already-opposed` or
`side-full`) rather than dropped silently.

`applyTreatyJoins(world, joins, { date, round })` writes the admitted joins back
as a new normalized world, growing the named side and stamping the date and
round; it returns the same world for an empty join list. The turn runs both in
`src/Game/AI/gameplay.js` (`applySimulationResult`) immediately after its own
`warUpdates` merge and before the reparations, so a war opened this turn drags
its allies this turn. The player's own polity is never joined; another power's
alliance with the player, or against the player, still fires.

`buildTreatyObligationDigest({ standing, cap, charCap })` renders the links the
world already realizes as one capped ASCII block the jump prompt shows through
`buildWarLedgerDirective`. The row cap is `TREATY_ROW_CAP` (6) and the character
cap `TREATY_CHAR_CAP` (360), mirroring the economy and operations digests.
Nothing is stored beyond `aggressor`, and no declaration schema changes: the
model narrates what the engine enforced.
```

- [ ] **Step 2: Verify the wiki is still current**

Run: `npm run wiki:check`
Expected: `Wiki is current.` (the wiki is built from `wiki/`, so a `docs/` edit needs no rebuild).

- [ ] **Step 3: Commit**

```bash
git add docs/runtime-services.md
git commit -m "docs(runtime): document treaty obligations"
```

---

## Final gate (not a task)

After Task 6, run the whole acceptance the spec names:

```bash
npm test
node --test "src/engine/*.test.js"
node --test "src/runtime/*.test.js"
node --test "src/Game/AI/*.test.js"
npx eslint .
npm run wiki:check
npm run build
```

Expected: `npm test` reports zero failures (the known `server/appUpdate.test.js` network flake is not a regression); ESLint is clean on the new and changed files; `Wiki is current.`; the build succeeds; `package.json` and `src/engine` show no change except the new module; every commit carries the co-author trailer.
