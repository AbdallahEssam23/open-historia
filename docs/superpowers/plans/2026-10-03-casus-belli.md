# Just Cause and the Cost of an Unjust War Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a power begins a war with no recorded claim against the target and no recorded breach by it, mark that power and charge it a deterministic reputation and relation cost.

**Architecture:** A new pure module `src/engine/casusBelli.js` reads the aggressors, defenders, recorded claims and recorded breaches as plain data and returns, per aggressor, whether a just cause existed. A new runtime adapter `src/runtime/casusBelli.js` reads the world's claims and breached agreements, resolves names into one canonical key space, calls the core, and charges each causeless aggressor through a new shared cost module `src/runtime/diplomaticCost.js` that the treaty-breach cost is refactored onto. One optional war field, `unjustAggressors`, survives both war normalizers. `gameplay.js` runs a pre-pass after the breach pre-pass and before the obligation step, prints a capped digest under `[Wars]`, and builds it in the jump path.

**Tech Stack:** JavaScript ES modules, `node:test`, `node:assert/strict`. No new dependency.

## Global Constraints

- ASCII only in source and docs. No emoji, no em dash, no middle dot.
- `src/engine/**` stays pure: no browser or `src/Game/AI` import, no `Date.now`, no `new Date`, no `Math.random`. Order with `<`, fold with `toLowerCase`, never `localeCompare` or `toLocaleLowerCase`.
- Engine import whitelist (`src/engine/enginePurity.test.js`): `./name.js`, `../runtime/gameDates.js`, `../runtime/unitMotion.js`. `src/engine/casusBelli.js` must add no import.
- `src/runtime/casusBelli.js`, `src/runtime/diplomaticCost.js` and `src/runtime/treatyObligations.js` import nothing from `src/Game/AI/`.
- Penalties and caps are engine constants: `UNJUST_WAR_REPUTATION_PENALTY = 15`, `UNJUST_WAR_RELATION_PENALTY = 25`, `MAX_CASUS_AGGRESSORS = 12`. Digest caps `WAR_CASUS_ROW_CAP = 6`, `WAR_CASUS_CHAR_CAP = 360`.
- `unjustAggressors` is one optional, sorted, deduped, bounded string list on a war. An absent or empty value means not judged or fully justified and costs nothing. No migration, no `ENGINE_VERSION` bump.
- Breach cost stays byte-identical after the refactor: the unchanged `src/runtime/treatyObligations.test.js` is the witness, and a breach-created relation keeps the id prefix `relation-breach`.
- Every commit carries the trailer `Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>` added by the `prepare-commit-msg` hook: do NOT pass it with `-m`.
- Run tests with quoted globs: `node --test "src/engine/*.test.js"`, `node --test "src/runtime/*.test.js"`, `node --test "src/Game/AI/*.test.js"`. `node --test <dir>` does not work.
- Do not edit an existing test to accommodate a change.
- `src/Game/AI/gameplay.js` is not importable under `node:test` (it imports `./main.jsx`); its verification is a source-text guard plus `node --check`.

---

### Task 1: The shared diplomatic cost, and the breach refactor onto it

**Files:**
- Create: `src/runtime/diplomaticCost.js`
- Test: `src/runtime/diplomaticCost.test.js`
- Modify: `src/runtime/treatyObligations.js`

**Interfaces:**
- Consumes: `normalizeWorldState` from `src/runtime/gameState.js`.
- Produces:
  - `applyDiplomaticCost(world, charges, { date = "", round = 0 } = {}) -> world` where `charges = [{ actor, wronged, reputationPenalty, relationPenalty, reason, relationIdPrefix }]`. It returns the same `world` reference for an empty charge list.
  - `applyTreatyBreaches(world, breaches, { date, round })` keeps its exact signature and output; it now delegates its arithmetic to `applyDiplomaticCost`.

- [ ] **Step 1: Write the failing tests**

Create `src/runtime/diplomaticCost.test.js`:

```js
// Run: node --test src/runtime/diplomaticCost.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { applyDiplomaticCost } from "./diplomaticCost.js";
import { normalizeWorldState } from "./gameState.js";

const world = (over = {}) => normalizeWorldState({
  polityOverrides: {
    Italy: { code: "Italy" },
    Russia: { code: "Russia" },
  },
  ...over,
});

const charge = (over = {}) => ({
  actor: "Italy",
  wronged: ["Russia"],
  reputationPenalty: 15,
  relationPenalty: 25,
  reason: "broke a treaty with",
  relationIdPrefix: "relation-breach",
  ...over,
});

test("a charge lowers the actor reputation and its relation with each wronged party", () => {
  const next = applyDiplomaticCost(
    world({ internationalReputation: { Italy: 30 }, relations: [{ a: "Italy", b: "Russia", score: 10 }] }),
    [charge()],
  );
  assert.equal(next.internationalReputation.Italy, 15);
  const relation = next.relations.find((entry) => entry.a === "Italy" && entry.b === "Russia");
  assert.equal(relation.score, -15);
  assert.equal(relation.status, "cautious");
});

test("an unset reputation defaults to 50 before the penalty", () => {
  const next = applyDiplomaticCost(world(), [charge()]);
  assert.equal(next.internationalReputation.Italy, 35);
});

test("the reputation floors at 0 and the relation at -100", () => {
  const next = applyDiplomaticCost(
    world({ internationalReputation: { Italy: 5 }, relations: [{ a: "Italy", b: "Russia", score: -90 }] }),
    [charge()],
  );
  assert.equal(next.internationalReputation.Italy, 0);
  const relation = next.relations.find((entry) => entry.a === "Italy" && entry.b === "Russia");
  assert.equal(relation.score, -100);
});

test("a pair with no relation is created, charged and summarized", () => {
  const next = applyDiplomaticCost(world(), [charge()]);
  const created = next.relations.find((entry) =>
    (entry.a === "Italy" && entry.b === "Russia") || (entry.a === "Russia" && entry.b === "Italy"));
  assert.ok(created, "the charge leaves a pair where none was recorded");
  assert.equal(created.score, -25);
  assert.equal(created.summary, "Italy broke a treaty with Russia.");
  assert.equal(created.id, "relation-breach-italy-russia");
});

test("an empty charge list returns the same world", () => {
  const prior = world();
  assert.equal(applyDiplomaticCost(prior, []), prior);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "src/runtime/diplomaticCost.test.js"`
Expected: FAIL, `Cannot find module './diplomaticCost.js'`.

- [ ] **Step 3: Write the shared cost module**

Create `src/runtime/diplomaticCost.js`:

```js
/*! Open Historia - runtime diplomatic cost: the reputation and relation penalty one act costs (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One definition of what an unjust act costs a polity: a reputation penalty and
// a relation penalty against each wronged party. It lives in runtime rather than
// Game/AI because runtime modules must not import the AI layer, and it is shared
// by the treaty-breach and unjust-war charges so the two can never disagree.

import { normalizeWorldState } from "./gameState.js";

const asString = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const keyLower = (value) => asString(value).toLowerCase();

export const applyDiplomaticCost = (world, charges, { date = "", round = 0 } = {}) => {
  const pending = list(charges).filter((charge) => asString(charge?.actor));
  if (!pending.length) return world;

  const normalized = normalizeWorldState(world);
  const reputation = { ...(normalized?.internationalReputation ?? {}) };
  const relations = list(normalized?.relations).map((relation) => ({ ...relation }));
  const pairKey = (a, b) => [keyLower(a), keyLower(b)].sort().join("\u0000");
  const relationByPair = new Map(relations.map((relation) => [pairKey(relation.a, relation.b), relation]));
  const stamp = asString(date);
  const roundNumber = Math.max(0, Math.trunc(Number(round) || 0));

  for (const charge of pending) {
    const actor = asString(charge.actor);
    const reputationPenalty = Math.max(0, Number(charge.reputationPenalty) || 0);
    const relationPenalty = Math.max(0, Number(charge.relationPenalty) || 0);
    const reason = asString(charge.reason);
    const prefix = asString(charge.relationIdPrefix) || "relation";
    const priorReputation = Number.isFinite(Number(reputation[actor])) ? Number(reputation[actor]) : 50;
    reputation[actor] = Math.max(0, Math.min(100, priorReputation - reputationPenalty));
    for (const wronged of list(charge.wronged).map(asString).filter(Boolean)) {
      if (keyLower(wronged) === keyLower(actor)) continue;
      const key = pairKey(actor, wronged);
      const prior = relationByPair.get(key);
      const score = Math.max(-100, Math.min(100, (Number(prior?.score) || 0) - relationPenalty));
      if (prior) {
        prior.score = score;
        prior.status = "";
        prior.lastUpdatedDate = stamp || prior.lastUpdatedDate;
        prior.updatedRound = roundNumber || prior.updatedRound;
      } else {
        const relation = {
          id: `${prefix}-${keyLower(actor)}-${keyLower(wronged)}`.replace(/\s+/g, "-"),
          a: actor,
          b: wronged,
          score,
          status: "",
          summary: `${actor} ${reason} ${wronged}.`,
          lastUpdatedDate: stamp,
          updatedRound: roundNumber,
        };
        relations.push(relation);
        relationByPair.set(key, relation);
      }
    }
  }

  return normalizeWorldState({ ...normalized, internationalReputation: reputation, relations });
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "src/runtime/diplomaticCost.test.js"`
Expected: PASS, 5 tests.

- [ ] **Step 5: Refactor `applyTreatyBreaches` onto the shared cost**

In `src/runtime/treatyObligations.js`, add the import beside the existing `./gameState.js` import:

```js
import { applyDiplomaticCost } from "./diplomaticCost.js";
```

Replace the whole body of `applyTreatyBreaches` (currently the block that builds `reputation`/`relations` and returns `normalizeWorldState(...)`) with a delegation. The function must keep its exact signature:

```js
export const applyTreatyBreaches = (world, breaches, { date = "", round = 0 } = {}) => {
  const pending = list(breaches).filter((breach) => asString(breach?.polity));
  if (!pending.length) return world;

  return applyDiplomaticCost(
    world,
    pending.map((breach) => ({
      actor: asString(breach.polity),
      wronged: list(breach.wrongedPolities).map(asString).filter(Boolean),
      reputationPenalty: BREACH_REPUTATION_PENALTY,
      relationPenalty: BREACH_RELATION_PENALTY,
      reason: "broke a treaty with",
      relationIdPrefix: "relation-breach",
    })),
    { date, round },
  );
};
```

Now remove the local `pairKey` helper (only `applyTreatyBreaches` used it). `keyLower` is still used by `readRecordedBreaches`, and `normalizeWorldState` is still used by `readTreatyBreaches` and `applyTreatyJoins`, so keep both. Verify with:

Run: `npx eslint src/runtime/treatyObligations.js`
Expected: 0 errors.

- [ ] **Step 6: Run the existing breach tests to prove the refactor is behavior-preserving**

Run: `node --test "src/runtime/treatyObligations.test.js"`
Expected: PASS, all tests unchanged (the breach world, floors, created pair and summary are identical).

- [ ] **Step 7: Commit**

```bash
git add src/runtime/diplomaticCost.js src/runtime/diplomaticCost.test.js src/runtime/treatyObligations.js
git commit -m "refactor(runtime): share the diplomatic cost between charges"
```

---

### Task 2: The pure casus belli core

**Files:**
- Create: `src/engine/casusBelli.js`
- Test: `src/engine/casusBelli.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `UNJUST_WAR_REPUTATION_PENALTY` (const 15), `UNJUST_WAR_RELATION_PENALTY` (const 25), `MAX_CASUS_AGGRESSORS` (const 12).
  - `deriveWarCasus({ aggressors = [], defenders = [], claims = [], breaches = [] }) -> { aggressors: [{ polity, justified, kind, target }], summary: { judged, justified, unjust } }`. `kind` is `"claim"`, `"breach"` or `""`. A claim is `{ regionId, claimant, holder }`; a breach is `{ agreementId, breachedBy, parties }`.

- [ ] **Step 1: Write the failing tests**

Create `src/engine/casusBelli.test.js`:

```js
// Run: node --test src/engine/casusBelli.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_CASUS_AGGRESSORS, deriveWarCasus } from "./casusBelli.js";

const claim = (over = {}) => ({ regionId: "alsace", claimant: "France", holder: "Germany", ...over });
const breach = (over = {}) => ({ agreementId: "pact", breachedBy: "Germany", parties: ["Germany", "France"], ...over });

test("a claim on land a defender holds is a just cause", () => {
  const out = deriveWarCasus({ aggressors: ["France"], defenders: ["Germany"], claims: [claim()] });
  assert.deepEqual(out.aggressors, [{ polity: "France", justified: true, kind: "claim", target: "alsace" }]);
  assert.deepEqual(out.summary, { judged: 1, justified: 1, unjust: 0 });
});

test("a claim on land a third power holds is not a just cause", () => {
  const out = deriveWarCasus({ aggressors: ["France"], defenders: ["Germany"], claims: [claim({ holder: "Italy" })] });
  assert.deepEqual(out.aggressors, [{ polity: "France", justified: false, kind: "", target: "" }]);
  assert.equal(out.summary.unjust, 1);
});

test("a recorded breach by a defender against a party is a just cause", () => {
  const out = deriveWarCasus({ aggressors: ["France"], defenders: ["Germany"], breaches: [breach()] });
  assert.deepEqual(out.aggressors, [{ polity: "France", justified: true, kind: "breach", target: "pact" }]);
});

test("a breach by the aggressor itself is not a warrant for its own war", () => {
  const out = deriveWarCasus({
    aggressors: ["France"],
    defenders: ["Germany"],
    breaches: [breach({ breachedBy: "France", parties: ["France", "Germany"] })],
  });
  assert.deepEqual(out.aggressors, [{ polity: "France", justified: false, kind: "", target: "" }]);
});

test("a breach the aggressor is not a party to is not a warrant", () => {
  const out = deriveWarCasus({
    aggressors: ["France"],
    defenders: ["Germany"],
    breaches: [breach({ parties: ["Germany", "Italy"] })],
  });
  assert.deepEqual(out.aggressors, [{ polity: "France", justified: false, kind: "", target: "" }]);
});

test("a claim decides before a breach when both exist", () => {
  const out = deriveWarCasus({ aggressors: ["France"], defenders: ["Germany"], claims: [claim()], breaches: [breach()] });
  assert.deepEqual(out.aggressors, [{ polity: "France", justified: true, kind: "claim", target: "alsace" }]);
});

test("a coalition's justified member is spared while its causeless member is not", () => {
  const out = deriveWarCasus({ aggressors: ["Italy", "France"], defenders: ["Germany"], claims: [claim()] });
  assert.deepEqual(out.aggressors, [
    { polity: "France", justified: true, kind: "claim", target: "alsace" },
    { polity: "Italy", justified: false, kind: "", target: "" },
  ]);
  assert.deepEqual(out.summary, { judged: 2, justified: 1, unjust: 1 });
});

test("the verdict is a function of the sets, not the input order", () => {
  const base = {
    aggressors: ["Italy", "France"],
    defenders: ["Germany"],
    claims: [claim({ regionId: "lorraine" }), claim({ regionId: "alsace" })],
    breaches: [breach({ agreementId: "b" }), breach({ agreementId: "a", breachedBy: "Italy" })],
  };
  const reordered = {
    aggressors: [...base.aggressors].reverse(),
    defenders: [...base.defenders].reverse(),
    claims: [...base.claims].reverse(),
    breaches: [...base.breaches].reverse(),
  };
  assert.deepEqual(deriveWarCasus(reordered), deriveWarCasus(base));
});

test("conflicting claim rows with the same key cannot change the verdict", () => {
  const claims = [claim({ holder: "Italy" }), claim({ holder: "Germany" })];
  const forward = deriveWarCasus({ aggressors: ["France"], defenders: ["Germany"], claims });
  const backward = deriveWarCasus({ aggressors: ["France"], defenders: ["Germany"], claims: [...claims].reverse() });
  assert.deepEqual(forward, backward);
  assert.deepEqual(forward.aggressors, [{ polity: "France", justified: true, kind: "claim", target: "alsace" }]);
});

test("conflicting breach rows with the same key cannot change the verdict", () => {
  const breaches = [
    breach({ parties: ["Germany", "Italy"] }),
    breach({ parties: ["Germany", "France"] }),
  ];
  const forward = deriveWarCasus({ aggressors: ["France"], defenders: ["Germany"], breaches });
  const backward = deriveWarCasus({ aggressors: ["France"], defenders: ["Germany"], breaches: [...breaches].reverse() });
  assert.deepEqual(forward, backward);
  assert.deepEqual(forward.aggressors, [{ polity: "France", justified: true, kind: "breach", target: "pact" }]);
});

test("an aggressor written in two cases dedupes to one deterministic spelling", () => {
  const forward = deriveWarCasus({ aggressors: ["France", "france"], defenders: ["Germany"] });
  const backward = deriveWarCasus({ aggressors: ["france", "France"], defenders: ["Germany"] });
  assert.deepEqual(forward, backward);
  assert.deepEqual(forward.aggressors, [{ polity: "France", justified: false, kind: "", target: "" }]);
});

test("the returned aggressors are capped", () => {
  const aggressors = Array.from({ length: MAX_CASUS_AGGRESSORS + 3 }, (_, i) => `P${String(i).padStart(2, "0")}`);
  const out = deriveWarCasus({ aggressors, defenders: ["Germany"] });
  assert.equal(out.aggressors.length, MAX_CASUS_AGGRESSORS);
  assert.equal(out.summary.judged, MAX_CASUS_AGGRESSORS);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "src/engine/casusBelli.test.js"`
Expected: FAIL, `Cannot find module './casusBelli.js'`.

- [ ] **Step 3: Write the core**

Create `src/engine/casusBelli.js`:

```js
/*! Open Historia - engine casus belli: the warrant a war needs and the cost of one without (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Whether the power that began a war held a reason the world already records: an
// unresolved claim on land a defender holds, or an unredressed breach by a
// defender against a party. Pure over plain data with no imports, so it passes
// the engine purity guard.

export const UNJUST_WAR_REPUTATION_PENALTY = 15;
export const UNJUST_WAR_RELATION_PENALTY = 25;
export const MAX_CASUS_AGGRESSORS = 12;

const asString = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const keyOf = (value) => asString(value).toLowerCase();
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const comparePolity = (a, b) => compareText(keyOf(a), keyOf(b)) || compareText(asString(a), asString(b));

const uniqueByKey = (values, keyOfValue) => {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = keyOfValue(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
};

export const deriveWarCasus = ({ aggressors = [], defenders = [], claims = [], breaches = [] } = {}) => {
  const defenderKeys = new Set(list(defenders).map(keyOf).filter(Boolean));

  const claimRows = uniqueByKey(
    list(claims)
      .map((claim) => ({
        regionId: asString(claim?.regionId),
        claimant: asString(claim?.claimant),
        holder: asString(claim?.holder),
      }))
      .filter((claim) => claim.regionId && claim.claimant && claim.holder),
    (claim) => [keyOf(claim.claimant), keyOf(claim.regionId), keyOf(claim.holder)].join("\u0000"),
  ).sort((a, b) =>
    compareText(a.regionId, b.regionId)
    || comparePolity(a.claimant, b.claimant)
    || comparePolity(a.holder, b.holder));

  const breachRows = uniqueByKey(
    list(breaches)
      .map((breach) => ({
        agreementId: asString(breach?.agreementId),
        breachedBy: asString(breach?.breachedBy),
        parties: uniqueByKey(list(breach?.parties).map(asString).filter(Boolean), keyOf)
          .sort(comparePolity),
      }))
      .filter((breach) => breach.agreementId && breach.breachedBy && breach.parties.length),
    (breach) => [keyOf(breach.agreementId), keyOf(breach.breachedBy), breach.parties.map(keyOf).join("\u0001")].join("\u0000"),
  ).sort((a, b) =>
    compareText(a.agreementId, b.agreementId)
    || comparePolity(a.breachedBy, b.breachedBy)
    || compareText(a.parties.map(keyOf).join("\u0001"), b.parties.map(keyOf).join("\u0001")));

  // Sort before deduping so which case-variant spelling survives is chosen by
  // content, not by the order the model wrote the list in.
  const declared = uniqueByKey(list(aggressors).map(asString).filter(Boolean).sort(comparePolity), keyOf)
    .slice(0, MAX_CASUS_AGGRESSORS);

  const rows = declared.map((polity) => {
    const actorKey = keyOf(polity);
    const claim = claimRows.find((row) =>
      keyOf(row.claimant) === actorKey && defenderKeys.has(keyOf(row.holder)));
    if (claim) return { polity, justified: true, kind: "claim", target: claim.regionId };
    const breach = breachRows.find((row) =>
      defenderKeys.has(keyOf(row.breachedBy))
      && keyOf(row.breachedBy) !== actorKey
      && row.parties.some((party) => keyOf(party) === actorKey));
    if (breach) return { polity, justified: true, kind: "breach", target: breach.agreementId };
    return { polity, justified: false, kind: "", target: "" };
  });

  const justified = rows.filter((row) => row.justified).length;
  return {
    aggressors: rows,
    summary: { judged: rows.length, justified, unjust: rows.length - justified },
  };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "src/engine/casusBelli.test.js"`
Expected: PASS, 12 tests.

- [ ] **Step 5: Verify the purity guard and lint**

Run: `node --test "src/engine/enginePurity.test.js"`
Expected: PASS (the new module has no import).

Run: `npx eslint src/engine/casusBelli.js src/engine/casusBelli.test.js`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/engine/casusBelli.js src/engine/casusBelli.test.js
git commit -m "feat(engine): derive the just cause a war needs"
```

---

### Task 3: Preserve `unjustAggressors` through both war normalizers

**Files:**
- Modify: `src/runtime/gameState.js` (`normalizeWorldWar`, around line 3353)
- Modify: `src/Game/AI/nativeWarLedger.js` (`normalizeWar`, around line 71)
- Test: `src/runtime/gameState.ledgers.test.js`
- Test: `src/Game/AI/warLedger.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: a stored war with `unjustAggressors: [names]`, canonicalized through `toCountryName`, deduped case-insensitively, sorted by plain comparison, and capped at 12. An absent value normalizes to `[]`. The field survives `normalizeWorldState` and an `applyWarUpdates` merge.

- [ ] **Step 1: Write the failing state test**

Append to `src/runtime/gameState.ledgers.test.js`:

```js
test("a war's unjust aggressors survive a normalizeWorldState round trip", () => {
  const world = normalizeWorldState({
    polityOverrides: { Italy: { code: "Italy" }, Ethiopia: { code: "Ethiopia" } },
    wars: [
      {
        id: "w1",
        status: "active",
        aggressor: "a",
        sideA: ["Italy"],
        sideB: ["Ethiopia"],
        startedDate: "1935-10-03",
        unjustAggressors: ["ITA", "italy"],
      },
    ],
  });
  const war = world.wars.find((entry) => entry.id === "w1");
  assert.deepEqual(war.unjustAggressors, ["Italy"]);
});

test("a war without unjust aggressors normalizes to an empty list", () => {
  const world = normalizeWorldState({
    polityOverrides: { Italy: { code: "Italy" }, Ethiopia: { code: "Ethiopia" } },
    wars: [{ id: "w1", status: "active", sideA: ["Italy"], sideB: ["Ethiopia"], startedDate: "1935-10-03" }],
  });
  const war = world.wars.find((entry) => entry.id === "w1");
  assert.deepEqual(war.unjustAggressors, []);
});
```

- [ ] **Step 2: Write the failing ledger test**

Append to `src/Game/AI/warLedger.test.js`:

```js
test("an unrelated war update preserves a war's unjust aggressors", () => {
  const events = [{
    id: "e1",
    date: "1935-10-03",
    title: "Italy invades Ethiopia",
    description: "Italian forces cross the border.",
    kind: "diplomacy",
    warId: "war-ethiopia-1935",
  }];
  const started = applyWarUpdates({
    world: { polityOverrides: {}, wars: [] },
    updates: "war-ethiopia-1935~start~Italy~Ethiopia~1~invasion",
    events,
    stopDate: "1935-10-03",
    round: 1,
  });
  const marked = {
    ...started.world,
    wars: started.world.wars.map((war) => ({ ...war, unjustAggressors: ["Italy"] })),
  };
  const merged = applyWarUpdates({
    world: marked,
    updates: "war-ethiopia-1935~goals~Italy:annex:eritrea~~~",
    events,
    stopDate: "1935-10-04",
    round: 2,
  });
  const war = merged.wars.find((entry) => entry.id === "war-ethiopia-1935");
  assert.deepEqual(war.unjustAggressors, ["Italy"]);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test "src/runtime/gameState.ledgers.test.js"`
Expected: FAIL, `war.unjustAggressors` is `undefined`.

Run: `node --test "src/Game/AI/warLedger.test.js"`
Expected: FAIL, the merged war carries no `unjustAggressors`.

- [ ] **Step 4: Add the field to `normalizeWorldWar`**

In `src/runtime/gameState.js`, inside `normalizeWorldWar`, add to the returned object beside `weariness`:

```js
    unjustAggressors: uniquePolities(entry.unjustAggressors)
      .slice()
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
```

`uniquePolities` already canonicalizes through `toCountryName`, dedupes case-insensitively and caps at 12.

- [ ] **Step 5: Add the field to the war ledger's `normalizeWar`**

In `src/Game/AI/nativeWarLedger.js`, inside `normalizeWar`, add to the `war` object beside `weariness`:

```js
    unjustAggressors: uniquePolities(entry.unjustAggressors)
      .slice()
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test "src/runtime/gameState.ledgers.test.js"`
Expected: PASS.

Run: `node --test "src/Game/AI/warLedger.test.js"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/runtime/gameState.js src/Game/AI/nativeWarLedger.js src/runtime/gameState.ledgers.test.js src/Game/AI/warLedger.test.js
git commit -m "feat(war-ledger): keep a war's unjust aggressors"
```

---

### Task 4: The runtime casus belli adapter and digest

**Files:**
- Create: `src/runtime/casusBelli.js`
- Test: `src/runtime/casusBelli.test.js`

**Interfaces:**
- Consumes: `deriveWarCasus`, `MAX_CASUS_AGGRESSORS`, `UNJUST_WAR_REPUTATION_PENALTY`, `UNJUST_WAR_RELATION_PENALTY` (Task 2); `applyDiplomaticCost` (Task 1); the stored `unjustAggressors` field (Task 3).
- Produces:
  - `readWarCasus(world, { starts = [], catalog = [] } = {}) -> { wars: [{ warId, aggressors: [{ polity, justified, kind, target }], wronged: [names] }], rejected: [{ warId, reason }], summary: { judged, justified, unjust } }`. Reasons: `war-missing`, `war-inactive`. A `start` is `{ warId, aggressors: [names], defenders: [names] }`.
  - `applyWarCasus(world, wars, { date = "", round = 0 } = {}) -> world`. It returns the same `world` reference when no war has an unjust aggressor.
  - `readRecordedUnjustWars(world) -> [{ warId, aggressor, wronged }]`, sorted by `(warId, aggressor)`.
  - `buildWarCasusDigest({ wars = [], cap = 6, charCap = 360 }) -> string`.
  - `WAR_CASUS_ROW_CAP` (6), `WAR_CASUS_CHAR_CAP` (360).

- [ ] **Step 1: Write the failing tests**

Create `src/runtime/casusBelli.test.js`:

```js
// Run: node --test src/runtime/casusBelli.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyWarCasus,
  buildWarCasusDigest,
  readRecordedUnjustWars,
  readWarCasus,
} from "./casusBelli.js";
import { normalizeWorldState } from "./gameState.js";

const world = (over = {}) => normalizeWorldState({
  polityOverrides: {
    France: { code: "France" },
    Germany: { code: "Germany" },
    Italy: { code: "Italy" },
    Ethiopia: { code: "Ethiopia" },
  },
  ...over,
});

const catalog = [
  { id: "alsace", name: "Alsace", country: "Germany" },
  { id: "eritrea", name: "Eritrea", country: "Ethiopia" },
];

test("a claim on a defender's region is a just cause read from the world", () => {
  const stored = world({
    regionClaimants: { alsace: ["France"] },
    regionOwnershipOverrides: { alsace: "Germany" },
    wars: [{ id: "w1", status: "active", aggressor: "a", sideA: ["France"], sideB: ["Germany"], startedDate: "1914-08-03" }],
  });
  const out = readWarCasus(stored, {
    starts: [{ warId: "w1", aggressors: ["France"], defenders: ["Germany"] }],
    catalog,
  });
  assert.deepEqual(out.wars, [{
    warId: "w1",
    aggressors: [{ polity: "France", justified: true, kind: "claim", target: "alsace" }],
    wronged: ["Germany"],
  }]);
  assert.deepEqual(out.summary, { judged: 1, justified: 1, unjust: 0 });
});

test("a recorded breach by the defender is a just cause read from the world", () => {
  const stored = world({
    agreements: [{ id: "pact", type: "alliance", status: "breached", parties: ["Germany", "France"], breachedBy: "Germany" }],
    wars: [{ id: "w1", status: "active", aggressor: "a", sideA: ["France"], sideB: ["Germany"], startedDate: "1914-08-03" }],
  });
  const out = readWarCasus(stored, {
    starts: [{ warId: "w1", aggressors: ["France"], defenders: ["Germany"] }],
    catalog,
  });
  assert.deepEqual(out.wars[0].aggressors, [{ polity: "France", justified: true, kind: "breach", target: "pact" }]);
});

test("a start whose war is missing or inactive is dropped with a reason", () => {
  const stored = world({
    wars: [{ id: "w2", status: "ended", sideA: ["France"], sideB: ["Germany"], startedDate: "1914-08-03" }],
  });
  const out = readWarCasus(stored, {
    starts: [
      { warId: "nope", aggressors: ["France"], defenders: ["Germany"] },
      { warId: "w2", aggressors: ["France"], defenders: ["Germany"] },
    ],
    catalog,
  });
  assert.deepEqual(out.rejected, [
    { warId: "nope", reason: "war-missing" },
    { warId: "w2", reason: "war-inactive" },
  ]);
  assert.deepEqual(out.wars, []);
});

test("an unjust war is charged and marked", () => {
  const stored = world({
    internationalReputation: { Italy: 50 },
    wars: [{ id: "w1", status: "active", aggressor: "a", sideA: ["Italy"], sideB: ["Ethiopia"], startedDate: "1935-10-03" }],
  });
  const next = applyWarCasus(stored, [{
    warId: "w1",
    aggressors: [{ polity: "Italy", justified: false, kind: "", target: "" }],
    wronged: ["Ethiopia"],
  }], { date: "1935-10-03", round: 1 });

  assert.equal(next.internationalReputation.Italy, 35);
  const relation = next.relations.find((entry) =>
    (entry.a === "Italy" && entry.b === "Ethiopia") || (entry.a === "Ethiopia" && entry.b === "Italy"));
  assert.ok(relation, "an unjust war leaves a relation with the wronged");
  assert.equal(relation.score, -25);
  assert.equal(relation.summary, "Italy began an unjust war on Ethiopia.");
  const war = next.wars.find((entry) => entry.id === "w1");
  assert.deepEqual(war.unjustAggressors, ["Italy"]);
});

test("a fully justified war is neither charged nor marked", () => {
  const stored = world({
    wars: [{ id: "w1", status: "active", aggressor: "a", sideA: ["Italy"], sideB: ["Ethiopia"], startedDate: "1935-10-03" }],
  });
  const next = applyWarCasus(stored, [{
    warId: "w1",
    aggressors: [{ polity: "Italy", justified: true, kind: "claim", target: "eritrea" }],
    wronged: ["Ethiopia"],
  }]);
  assert.equal(next, stored);
});

test("readRecordedUnjustWars names each unjust aggressor", () => {
  const stored = world({
    wars: [{
      id: "w1",
      status: "active",
      aggressor: "a",
      sideA: ["Italy"],
      sideB: ["Ethiopia"],
      startedDate: "1935-10-03",
      unjustAggressors: ["Italy"],
    }],
  });
  assert.deepEqual(readRecordedUnjustWars(stored), [{ warId: "w1", aggressor: "Italy", wronged: ["Ethiopia"] }]);
});

test("the digest orders rows, caps them and reports the overflow", () => {
  const wars = Array.from({ length: 8 }, (_, i) => ({
    warId: `w${i}`,
    aggressor: "Italy",
    wronged: ["Ethiopia"],
  }));
  const block = buildWarCasusDigest({ wars, cap: 6, charCap: 1000 });
  assert.match(block, /^\[Wars Begun Without Just Cause, as simulated\]/);
  assert.equal(block.split("\n").length, 8, "a header, six rows and one overflow line");
  assert.match(block, /\+2 more\./);
  assert.equal(buildWarCasusDigest({ wars: [] }), "");
});

test("the digest a jump builds from the recorded wars is not empty", () => {
  const stored = world({
    wars: [{
      id: "war-ethiopia-1935",
      status: "active",
      aggressor: "a",
      sideA: ["Italy"],
      sideB: ["Ethiopia"],
      startedDate: "1935-10-03",
      unjustAggressors: ["Italy"],
    }],
  });
  // The jump wires readRecordedUnjustWars straight into buildWarCasusDigest;
  // this bridges the two shapes so a silent empty block cannot slip through.
  const block = buildWarCasusDigest({ wars: readRecordedUnjustWars(stored) });
  assert.match(block, /^\[Wars Begun Without Just Cause, as simulated\]/);
  assert.match(block, /- Italy began war-ethiopia-1935 without just cause; wronged Ethiopia\./);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "src/runtime/casusBelli.test.js"`
Expected: FAIL, `Cannot find module './casusBelli.js'`.

- [ ] **Step 3: Write the adapter**

Create `src/runtime/casusBelli.js`:

```js
/*! Open Historia - runtime casus belli: judge a war's aggressor and charge an unjust one (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The adapter between the stored world and the pure casus core. It reads the
// claims, the breached agreements and the wars started this turn, resolves every
// name into one canonical key space, calls the engine, and charges each unjust
// aggressor. It never imports the Game/AI layer.

import {
  MAX_CASUS_AGGRESSORS,
  UNJUST_WAR_RELATION_PENALTY,
  UNJUST_WAR_REPUTATION_PENALTY,
  deriveWarCasus,
} from "../engine/casusBelli.js";
import { applyDiplomaticCost } from "./diplomaticCost.js";
import { normalizeWorldState } from "./gameState.js";
import { buildOwnerAliasMap, createOwnerResolver, toCountryName } from "./ownerNames.js";
import { regionOwnerName } from "./regionOwners.js";

export const WAR_CASUS_ROW_CAP = 6;
export const WAR_CASUS_CHAR_CAP = 360;

const asString = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const keyLower = (value) => asString(value).toLowerCase();
const canonical = (value) => {
  const raw = asString(value);
  return toCountryName(raw) || raw;
};

const readerFor = (world) => {
  const resolveOwner = createOwnerResolver(buildOwnerAliasMap(world?.polityOverrides));
  return (value) => resolveOwner(asString(value)) || canonical(value);
};

const uniqueNames = (values) => {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const name = asString(value);
    const key = keyLower(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
};

// One claim row per (regionId, claimant). The holder is the region's current
// owner: the override wins, else the catalog base country, folded through the
// same canonical key space as every other name.
const claimRowsOf = (normalized, readPolity, catalog) => {
  const catalogById = new Map(list(catalog).map((region) => [asString(region?.id), region]));
  const overrides = normalized?.regionOwnershipOverrides ?? {};
  const rows = [];
  for (const [regionId, claimants] of Object.entries(normalized?.regionClaimants ?? {})) {
    const holder = readPolity(regionOwnerName(catalogById.get(asString(regionId)), overrides));
    if (!holder) continue;
    for (const claimant of list(claimants)) {
      const name = readPolity(claimant);
      if (!name) continue;
      rows.push({ regionId: asString(regionId), claimant: name, holder });
    }
  }
  return rows;
};

const breachRowsOf = (normalized, readPolity) => list(normalized?.agreements)
  .filter((agreement) => asString(agreement?.status) === "breached")
  .map((agreement) => ({
    agreementId: asString(agreement?.id),
    breachedBy: readPolity(agreement?.breachedBy),
    parties: list(agreement?.parties).map(readPolity).filter(Boolean),
  }))
  .filter((row) => row.agreementId && row.breachedBy && row.parties.length);

export const readWarCasus = (world, { starts = [], catalog = [] } = {}) => {
  const normalized = normalizeWorldState(world);
  const readPolity = readerFor(normalized);
  const claims = claimRowsOf(normalized, readPolity, catalog);
  const breaches = breachRowsOf(normalized, readPolity);
  const byId = new Map(list(normalized?.wars).map((war) => [asString(war?.id), war]));

  const wars = [];
  const rejected = [];
  const summary = { judged: 0, justified: 0, unjust: 0 };

  for (const start of list(starts)) {
    const warId = asString(start?.warId);
    if (!warId) continue;
    const war = byId.get(warId);
    if (!war) {
      rejected.push({ warId, reason: "war-missing" });
      continue;
    }
    if (asString(war?.status) !== "active") {
      rejected.push({ warId, reason: "war-inactive" });
      continue;
    }
    const aggressors = uniqueNames(list(start?.aggressors).map(readPolity).filter(Boolean));
    const defenders = uniqueNames(list(start?.defenders).map(readPolity).filter(Boolean));
    if (!aggressors.length || !defenders.length) continue;
    const verdict = deriveWarCasus({ aggressors, defenders, claims, breaches });
    if (!verdict.aggressors.length) continue;
    const wronged = defenders.slice().sort((a, b) => compareText(keyLower(a), keyLower(b)) || compareText(a, b));
    wars.push({ warId, aggressors: verdict.aggressors, wronged });
    summary.judged += verdict.summary.judged;
    summary.justified += verdict.summary.justified;
    summary.unjust += verdict.summary.unjust;
  }

  return { wars, rejected, summary };
};

export const applyWarCasus = (world, wars, { date = "", round = 0 } = {}) => {
  const charges = [];
  const marks = new Map();

  for (const judgment of list(wars)) {
    const warId = asString(judgment?.warId);
    if (!warId) continue;
    const unjust = uniqueNames(
      list(judgment?.aggressors)
        .filter((row) => asString(row?.polity) && row?.justified === false)
        .map((row) => row.polity),
    ).slice(0, MAX_CASUS_AGGRESSORS).sort((a, b) => compareText(keyLower(a), keyLower(b)) || compareText(a, b));
    if (!unjust.length) continue;
    const wronged = uniqueNames(list(judgment?.wronged));
    marks.set(warId, unjust);
    for (const actor of unjust) {
      charges.push({
        actor,
        wronged,
        reputationPenalty: UNJUST_WAR_REPUTATION_PENALTY,
        relationPenalty: UNJUST_WAR_RELATION_PENALTY,
        reason: "began an unjust war on",
        relationIdPrefix: "relation-unjust-war",
      });
    }
  }
  if (!marks.size) return world;

  const charged = normalizeWorldState(applyDiplomaticCost(world, charges, { date, round }));
  const wars2 = list(charged?.wars).map((war) => {
    const mark = marks.get(asString(war?.id));
    return mark ? { ...war, unjustAggressors: mark } : war;
  });
  return normalizeWorldState({ ...charged, wars: wars2 });
};

export const readRecordedUnjustWars = (world) => {
  const normalized = normalizeWorldState(world);
  const rows = [];
  for (const war of list(normalized?.wars)) {
    const unjust = uniqueNames(list(war?.unjustAggressors));
    if (!unjust.length) continue;
    const sideA = list(war?.sideA).map(asString);
    const sideAKeys = new Set(sideA.map(keyLower));
    const aggressorSide = unjust.some((name) => sideAKeys.has(keyLower(name))) ? "sideA" : "sideB";
    const wronged = uniqueNames(aggressorSide === "sideA" ? list(war?.sideB) : list(war?.sideA));
    for (const aggressor of unjust) {
      rows.push({ warId: asString(war?.id), aggressor, wronged });
    }
  }
  return rows.sort((a, b) => compareText(a.warId, b.warId) || compareText(a.aggressor, b.aggressor));
};

export const buildWarCasusDigest = ({
  wars = [],
  cap = WAR_CASUS_ROW_CAP,
  charCap = WAR_CASUS_CHAR_CAP,
} = {}) => {
  const rows = list(wars)
    .filter((row) => row && typeof row === "object" && asString(row.warId) && asString(row.aggressor))
    .slice()
    .sort((a, b) =>
      compareText(asString(a.warId), asString(b.warId))
      || compareText(asString(a.aggressor), asString(b.aggressor)));
  if (!rows.length) return "";

  const limit = Math.max(0, Math.round(Number(cap) || 0));
  const budget = Math.max(0, Math.round(Number(charCap) || 0));
  const shown = rows.slice(0, limit);
  const fixed = "[Wars Begun Without Just Cause, as simulated]";
  const overflow = rows.length > shown.length ? `+${rows.length - shown.length} more.` : "";

  let used = fixed.length + (overflow ? overflow.length + 1 : 0);
  const kept = [];
  for (const row of shown) {
    const wronged = list(row.wronged).map(asString).filter(Boolean).join(", ");
    const line = `- ${asString(row.aggressor)} began ${asString(row.warId)} without just cause; wronged ${wronged}.`;
    if (used + line.length + 1 > budget) break;
    kept.push(line);
    used += line.length + 1;
  }
  return [fixed, ...kept, overflow].filter(Boolean).join("\n");
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "src/runtime/casusBelli.test.js"`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the runtime glob and lint**

Run: `node --test "src/runtime/*.test.js"`
Expected: 0 fail.

Run: `npx eslint src/runtime/casusBelli.js src/runtime/casusBelli.test.js`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/casusBelli.js src/runtime/casusBelli.test.js
git commit -m "feat(runtime): read, charge and digest unjust wars"
```

---

### Task 5: The turn pre-pass and the model directive

**Files:**
- Modify: `src/Game/AI/gameplay.js`
- Test: `src/Game/AI/casusBelliWiringArchitecture.test.js` (new)

**Interfaces:**
- Consumes: `readWarCasus`, `applyWarCasus`, `readRecordedUnjustWars`, `buildWarCasusDigest` (Task 4).
- Produces: the casus pre-pass runs after the breach charge and before the obligation read; `variables.warCasus` is printed under `[Wars]` after the breach digest and built in the jump path.

- [ ] **Step 1: Write the failing wiring guard**

Create `src/Game/AI/casusBelliWiringArchitecture.test.js`:

```js
// Run: node --test src/Game/AI/casusBelliWiringArchitecture.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");

test("the turn judges a war's just cause after the breach charge and before the obligations", () => {
  const breachApplyAt = gameplay.indexOf("applyTreatyBreaches(");
  const casusReadAt = gameplay.indexOf("readWarCasus(worldWithImpacts");
  const casusApplyAt = gameplay.indexOf("applyWarCasus(worldWithImpacts");
  const obligationReadAt = gameplay.indexOf("readTreatyObligations(worldWithImpacts");
  assert.ok(breachApplyAt > 0, "the breach cost must be charged");
  assert.ok(casusReadAt > breachApplyAt, "the casus pre-pass reads after the breach charge");
  assert.ok(casusApplyAt > casusReadAt, "the casus cost is charged after it is read");
  assert.ok(obligationReadAt > casusApplyAt, "the casus pre-pass runs before the obligation step");
});

test("the war directive prints the casus digest the jump prompt builds", () => {
  const start = gameplay.indexOf("const buildWarLedgerDirective = (variables) => {");
  assert.ok(start > 0, "the war directive builder is missing");
  const end = gameplay.indexOf("\n};", start);
  const body = gameplay.slice(start, end);
  assert.match(body, /warCasus/, "the directive does not read the casus digest");
  assert.ok(gameplay.indexOf("variables.warCasus =") > 0, "the jump prompt never sets variables.warCasus");
});
```

- [ ] **Step 2: Run the guard to verify it fails**

Run: `node --test "src/Game/AI/casusBelliWiringArchitecture.test.js"`
Expected: FAIL, the pre-pass and the digest are absent.

- [ ] **Step 3: Extend the imports and the directive**

In `src/Game/AI/gameplay.js`, add the runtime import beside the existing `../../runtime/treatyObligations.js` import (keep the file's import grouping and sorting):

```js
import {
  applyWarCasus,
  buildWarCasusDigest,
  readRecordedUnjustWars,
  readWarCasus,
} from "../../runtime/casusBelli.js";
```

In `buildWarLedgerDirective`, read the casus block beside the breach block:

```js
  const treatyBreach = normalizeString(variables?.treatyBreach);
  const warCasus = normalizeString(variables?.warCasus);
```

and print it after the breach interpolation:

```js
${canonicalWarContext || "No wars are recorded."}${treatyObligations ? `\n${treatyObligations}` : ""}${treatyBreach ? `\n${treatyBreach}` : ""}${warCasus ? `\n${warCasus}` : ""}
```

Add one sentence to the war preamble, directly after the existing treaty sentence that begins `A treaty is not narrative:`:

```
A power that begins a war with no recorded claim against the target and no recorded breach by it is marked as an unjust aggressor, so a war you mean to fight should rest on a reason the world can see.
```

- [ ] **Step 4: Add the pre-pass**

In `applySimulationResult`, immediately after the breach pre-pass `try/catch` closes and before the obligation comment, insert:

```js
  // A war begun this turn is judged for a recorded warrant: a claim on land a
  // defender holds, or a breach by a defender against the aggressor. It runs
  // after the breach pre-pass, so a promise broken this turn justifies a war
  // begun this turn, and before the obligation step. Reading the start records,
  // not the war records, is what keeps a later joiner from being judged an
  // aggressor. A failure here must never lose a completed turn.
  try {
    const casusStarts = warUpdates
      .filter((update) => normalizeString(update?.op).toLowerCase() === "start")
      .map((update) => ({
        warId: normalizeString(update?.id),
        aggressors: normalizeArray(update?.actors),
        defenders: normalizeArray(update?.opponents),
      }))
      .filter((start) => start.warId);
    if (casusStarts.length) {
      const casusOutcome = readWarCasus(worldWithImpacts, {
        starts: casusStarts,
        catalog: getPrimedScenarioRegionCatalog() ?? [],
      });
      if (casusOutcome.wars.length) {
        worldWithImpacts = applyWarCasus(worldWithImpacts, casusOutcome.wars, {
          date: nextGame.gameDate,
          round: nextGame.round,
        });
      }
      // Log even when every aggressor held a warrant, so the judgement is on the
      // trail whether or not a cost fell.
      if (casusOutcome.summary.judged) {
        logDebugEvent("turn", `Wars judged for just cause: ${casusOutcome.summary.unjust} unjust of ${casusOutcome.summary.judged}.`, {
          unjust: casusOutcome.summary.unjust,
          justified: casusOutcome.summary.justified,
        });
      }
    }
  } catch (error) {
    console.warn("[engine] the casus belli step failed; the completed turn is preserved.", error);
  }
```

- [ ] **Step 5: Build the jump digest**

In `simulateTimelineJump`, beside the `variables.treatyBreach = ...` block, add:

```js
      variables.warCasus = buildWarCasusDigest({
        wars: readRecordedUnjustWars(bundle.world),
      });
```

- [ ] **Step 6: Verify**

Run: `node --test "src/Game/AI/casusBelliWiringArchitecture.test.js"`
Expected: 2 pass.

Run: `node --check src/Game/AI/gameplay.js`
Expected: no output (syntax ok).

Run: `node --test "src/Game/AI/*.test.js"`
Expected: 0 fail.

Run: `npx eslint src/Game/AI/gameplay.js src/Game/AI/casusBelliWiringArchitecture.test.js`
Expected: 0 errors (existing warnings are acceptable).

- [ ] **Step 7: Commit**

```bash
git add src/Game/AI/gameplay.js src/Game/AI/casusBelliWiringArchitecture.test.js
git commit -m "feat(ai): judge a war's just cause and tell the model"
```

---

### Task 6: Document the casus belli layer

**Files:**
- Modify: `docs/runtime-services.md`

**Interfaces:**
- Consumes: the shipped code from Tasks 1-5.
- Produces: one new documentation section; no code.

- [ ] **Step 1: Add the section**

In `docs/runtime-services.md`, immediately after the "Treaty breaches" section, add a section in the same style (`---` separator, `##` heading):

```markdown
---

## Just cause and the cost of an unjust war

`src/engine/casusBelli.js` exports `deriveWarCasus`, the third branch of the
mechanical diplomacy layer. The model does not declare a `casus belli`; the
engine infers one from the board when a `start` record opens a war. For each
aggressor in the start record's `actors`, it accepts the war only when the world
already records a warrant against one of the start record's `opponents`: an
unresolved claim on a region a defender currently holds (`world.regionClaimants`,
with the holder read through `regionOwnerName`), or a recorded breach by a
defender against a party the aggressor belongs to (`status: "breached"`,
`breachedBy`, and the aggressor is not the breaker itself). The claim is checked
before the breach, so the kind is a total function of the sets. A declared but
false warrant is indistinguishable from no warrant: the engine asks only whether
a true warrant exists.

The runtime adapter (`src/runtime/casusBelli.js`) adds `readWarCasus` (read the
world, canonicalize, call the engine), `applyWarCasus` (charge and mark),
`readRecordedUnjustWars` (the wars the world already marks) and
`buildWarCasusDigest` (a capped 6/360 block). Each causeless aggressor pays
`UNJUST_WAR_REPUTATION_PENALTY` 15 off its `internationalReputation` (treated as
50 when unset), and `UNJUST_WAR_RELATION_PENALTY` 25 off its relation with each
wronged defender (created at 0 when absent), both clamped, through the shared
`src/runtime/diplomaticCost.js:applyDiplomaticCost` that the treaty-breach cost
also uses. The war stores the unjust aggressors in `unjustAggressors`, a sorted,
deduped, bounded list that survives both war normalizers (a coalition's
justified member is spared while its causeless member is marked).

The turn (`gameplay.js`, `applySimulationResult`) runs the judgement in a pre-pass
between the breach pre-pass and the obligation step, on the world the war ledger
just merged, so a war begun this turn is judged the same turn and a breach
declared this turn can justify it. The jump prompt (`simulateTimelineJump`) builds
`variables.warCasus` from `readRecordedUnjustWars(bundle.world)`, and
`buildWarLedgerDirective` prints it under `[Wars]` after the breach block. The
interactive path is deferred, as it was for the standing obligations and the
breach digest.
```

- [ ] **Step 2: Fact-check and verify**

Read `src/engine/casusBelli.js`, `src/runtime/casusBelli.js` and the `gameplay.js`
wiring and confirm every name, cap and default in the section matches the code.
Fix any mismatch.

Run: `npm run wiki:check`
Expected: `Wiki is current.` (the wiki is generated from `wiki/` only, so a
`docs/` edit needs no rebuild).

Run: `rg -nP "[^\x00-\x7F]" docs/runtime-services.md`
Expected: no new non-ASCII line in the added section.

- [ ] **Step 3: Commit**

```bash
git add docs/runtime-services.md
git commit -m "docs(runtime): document the casus belli layer"
```

---

### Task 7: Acceptance gate

**Files:** none new. This task proves the increment and touches nothing.

- [ ] **Step 1: Run the gate**

```bash
npm test
node --test "src/engine/*.test.js"
node --test "src/runtime/*.test.js"
node --test "src/Game/AI/*.test.js"
npx eslint .
npm run wiki:check
npm run build
```

Expected: the whole suite passes with zero failures, the three globs pass, eslint
has 0 errors in the new and changed files (the pre-existing `src/Game/Map/*`
errors are unrelated), `wiki:check` prints `Wiki is current.`, and `build` exits
0. Note the known `server/appUpdate.test.js` network flake: a failure there is
unrelated to this increment.

- [ ] **Step 2: Audit the branch**

```bash
git log --format='%h|%s|%(trailers:key=Co-authored-by,valueonly)' 729ec5c..HEAD
```

Expected: every commit in the slice carries the `Co-authored-by` trailer.

- [ ] **Step 3: Report**

Record the gate output in `.superpowers/sdd/progress.md` and hand the slice to
the whole-branch review.
