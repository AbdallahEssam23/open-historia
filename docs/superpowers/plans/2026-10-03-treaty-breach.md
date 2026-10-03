# Treaty Breach and Reputation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the model declare that a bound party breaks its treaty, and let the engine deterministically block the join it would have caused and charge a reputation and relation cost.

**Architecture:** A pure engine function `deriveTreatyBreaches` in the existing `src/engine/treatyObligations.js` shares the bound-side computation with `deriveTreatyObligations`, so the two can never disagree. The runtime adapter `src/runtime/treatyObligations.js` reads declared breaches, and applies the reputation and relation cost, while `nativeDiplomaticDirector.js` keeps ownership of the agreement lifecycle and gains the `breach` operation and the `breached` status. `gameplay.js` runs a pre-pass that records breaches before the obligation step, so a broken pact is no longer `active` when the engine decides which parties a war draws in. A capped digest is printed beside the standing-obligations digest under `[Wars]`.

**Tech Stack:** JavaScript ES modules, `node:test`, `node:assert/strict`. No new dependency.

## Global Constraints

- ASCII only in source and docs. No emoji, no em dash, no middle dot.
- `src/engine/**` stays pure: no browser or `src/Game/AI` import, no `Date.now`, no `new Date`, no `Math.random`. Order with `<`, fold with `toLowerCase`, never `localeCompare` or `toLocaleLowerCase`.
- Engine import whitelist (`src/engine/enginePurity.test.js`): `./name.js`, `../runtime/gameDates.js`, `../runtime/unitMotion.js`. The new export adds no import.
- `src/runtime/treatyObligations.js` imports nothing from `src/Game/AI/`.
- Caps and penalties are engine constants: `BREACH_REPUTATION_PENALTY = 15`, `BREACH_RELATION_PENALTY = 25`, `MAX_TREATY_BREACHES_PER_TURN = 16`; digest caps `TREATY_BREACH_ROW_CAP = 6`, `TREATY_BREACH_CHAR_CAP = 360`.
- `breached` is a terminal agreement status; `breachedBy` is one optional string on an agreement. No migration.
- Every commit carries the trailer `Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>` added by the `prepare-commit-msg` hook: do NOT pass it with `-m`.
- Run tests with quoted globs: `node --test "src/engine/*.test.js"`, `node --test "src/runtime/*.test.js"`, `node --test "src/Game/AI/*.test.js"`. `node --test <dir>` does not work.
- Do not edit an existing test to accommodate a change.
- `src/Game/AI/gameplay.js` is not importable under `node:test` (it imports `./main.jsx`); its verification is a source-text guard plus `node --check`.

---

### Task 1: The pure breach derivation

**Files:**
- Modify: `src/engine/treatyObligations.js`
- Test: `src/engine/treatyObligations.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `MAX_TREATY_BREACHES_PER_TURN` (const 16), `BREACH_REPUTATION_PENALTY` (const 15), `BREACH_RELATION_PENALTY` (const 25).
  - `deriveTreatyBreaches({ wars = [], agreements = [], breaches = [] }) -> { breaches: [{ agreementId, agreementType, polity, warIds, wrongedPolities }], rejected: [{ agreementId, polity, reason }], summary: { declared, accepted, rejected } }`. Reasons: `agreement-missing`, `agreement-inactive`, `not-a-party`, `no-active-obligation`, `cap-reached`.
  - Internal (not exported) helpers `relevantPartiesOf`, `buildSides`, `obligationTargets` shared with `deriveTreatyObligations`.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/treatyObligations.test.js`. First extend the import block (lines 4-9) so it reads:

```js
import {
  MAX_OBLIGATION_PASSES,
  MAX_TREATY_BREACHES_PER_TURN,
  MAX_TREATY_JOINS_PER_STEP,
  MAX_WAR_SIDE,
  deriveTreatyBreaches,
  deriveTreatyObligations,
} from "./treatyObligations.js";
```

The two penalty constants are asserted in the adapter test (Task 2), which imports them; this pure test only needs the cap and the new export, so it stays lint-clean.

Then append:

```js
test("an alliance breach is accepted and names the fighting partner as wronged", () => {
  const out = deriveTreatyBreaches({
    wars: [war()],
    agreements: [agreement({ parties: ["A", "C"] })],
    breaches: [{ agreementId: "a1", polity: "C" }],
  });
  assert.deepEqual(out.breaches, [
    { agreementId: "a1", agreementType: "alliance", polity: "C", warIds: ["w1"], wrongedPolities: ["A"] },
  ]);
  assert.deepEqual(out.rejected, []);
  assert.equal(out.summary.accepted, 1);
});

test("a breach of an agreement that binds no one is rejected no-active-obligation", () => {
  // Z and C are both parties, but neither is on a war side, so the alliance
  // binds C to nothing: there is no join for the breach to block.
  const out = deriveTreatyBreaches({
    wars: [war()],
    agreements: [agreement({ id: "a1", type: "alliance", parties: ["Z", "C"] })],
    breaches: [{ agreementId: "a1", polity: "C" }],
  });
  assert.deepEqual(out.breaches, []);
  assert.deepEqual(out.rejected, [{ agreementId: "a1", polity: "C", reason: "no-active-obligation" }]);
});

test("a breached agreement binds no one in the join derivation", () => {
  // The pre-pass marks the pact breached before the obligation step reads it:
  // the same pact that would have drawn C in now draws nobody.
  const out = deriveTreatyObligations({
    wars: [war()],
    agreements: [agreement({ status: "breached" })],
  });
  assert.deepEqual(out.joins, []);
});

test("a mutual defense breach is accepted only for the victim's protector", () => {
  const defense = deriveTreatyBreaches({
    wars: [war()],
    agreements: [agreement({ type: "mutual_defense", parties: ["B", "C"] })],
    breaches: [{ agreementId: "a1", polity: "C" }],
  });
  assert.deepEqual(defense.breaches, [
    { agreementId: "a1", agreementType: "mutual_defense", polity: "C", warIds: ["w1"], wrongedPolities: ["B"] },
  ]);

  // The aggressor's protector is not a victim, so it has nothing to refuse.
  const aggressor = deriveTreatyBreaches({
    wars: [war()],
    agreements: [agreement({ type: "mutual_defense", parties: ["A", "C"] })],
    breaches: [{ agreementId: "a1", polity: "C" }],
  });
  assert.deepEqual(aggressor.breaches, []);
  assert.deepEqual(aggressor.rejected, [{ agreementId: "a1", polity: "C", reason: "no-active-obligation" }]);
});

test("a guarantee breach names the beneficiary as wronged", () => {
  const out = deriveTreatyBreaches({
    wars: [war()],
    agreements: [agreement({ type: "guarantee", parties: ["B", "G"], guarantor: "G", beneficiary: "B" })],
    breaches: [{ agreementId: "a1", polity: "G" }],
  });
  assert.deepEqual(out.breaches, [
    { agreementId: "a1", agreementType: "guarantee", polity: "G", warIds: ["w1"], wrongedPolities: ["B"] },
  ]);
});

test("a breach with a missing, inactive, or non-party target is rejected", () => {
  const missing = deriveTreatyBreaches({
    wars: [war()],
    agreements: [],
    breaches: [{ agreementId: "a1", polity: "C" }],
  });
  assert.deepEqual(missing.rejected, [{ agreementId: "a1", polity: "C", reason: "agreement-missing" }]);

  const inactive = deriveTreatyBreaches({
    wars: [war()],
    agreements: [agreement({ status: "suspended" })],
    breaches: [{ agreementId: "a1", polity: "C" }],
  });
  assert.deepEqual(inactive.rejected, [{ agreementId: "a1", polity: "C", reason: "agreement-inactive" }]);

  const stranger = deriveTreatyBreaches({
    wars: [war()],
    agreements: [agreement({ parties: ["A", "C"] })],
    breaches: [{ agreementId: "a1", polity: "Z" }],
  });
  assert.deepEqual(stranger.rejected, [{ agreementId: "a1", polity: "Z", reason: "not-a-party" }]);

  const nonObligating = deriveTreatyBreaches({
    wars: [war()],
    agreements: [agreement({ type: "trade_economic", parties: ["A", "C"] })],
    breaches: [{ agreementId: "a1", polity: "C" }],
  });
  assert.deepEqual(nonObligating.rejected, [{ agreementId: "a1", polity: "C", reason: "agreement-missing" }]);
});

test("the per-turn breach cap accepts the limit and rejects the rest cap-reached", () => {
  const wars = [war()];
  const agreements = Array.from({ length: MAX_TREATY_BREACHES_PER_TURN + 2 }, (_, i) => agreement({
    id: `a${String(i).padStart(3, "0")}`,
    parties: ["A", `C${i}`],
  }));
  const breaches = agreements.map((entry) => ({ agreementId: entry.id, polity: entry.parties[1] }));
  const out = deriveTreatyBreaches({ wars, agreements, breaches });
  assert.equal(out.breaches.length, MAX_TREATY_BREACHES_PER_TURN);
  assert.equal(out.rejected.length, 2);
  assert.ok(out.rejected.every((row) => row.reason === "cap-reached"));
});

test("reordering breaches, wars and agreements never changes the breach result", () => {
  const wars = [war({ id: "w1" }), war({ id: "w2", sideA: ["A2"], sideB: ["B2"] })];
  const agreements = [
    agreement({ id: "a1", parties: ["A", "C"] }),
    agreement({ id: "a2", parties: ["A2", "C2"] }),
  ];
  const breaches = [
    { agreementId: "a2", polity: "C2" },
    { agreementId: "a1", polity: "C" },
  ];
  const first = deriveTreatyBreaches({ wars, agreements, breaches });
  const second = deriveTreatyBreaches({
    wars: [...wars].reverse(),
    agreements: [...agreements].reverse().map((entry) => ({ ...entry, parties: [...entry.parties].reverse() })),
    breaches: [...breaches].reverse(),
  });
  assert.deepEqual(second, first);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "src/engine/treatyObligations.test.js"`
Expected: FAIL with `deriveTreatyBreaches is not a function` (and the two constants undefined).

- [ ] **Step 3: Add the constants and the shared helpers**

In `src/engine/treatyObligations.js`, extend the constant block (after `MAX_STANDING_OBLIGATIONS`, line 11) with:

```js
export const MAX_TREATY_BREACHES_PER_TURN = 16;
export const BREACH_REPUTATION_PENALTY = 15;
export const BREACH_RELATION_PENALTY = 25;
```

After `partiesOf` (line 35) add the three shared helpers:

```js
// The parties an agreement actually binds: a guarantee binds its guarantor and
// beneficiary, every other obligating type binds its listed parties. Shared by
// the standing read and the breach read so they agree on who is bound.
const relevantPartiesOf = (agreement) => {
  const parties = partiesOf(agreement);
  return asString(agreement?.type) === "guarantee"
    ? uniqueByKey([asString(agreement?.guarantor) || parties[0], asString(agreement?.beneficiary) || parties[1]])
    : parties;
};

const buildSides = (war) => {
  const sides = { a: new Map(), b: new Map() };
  for (const polity of uniqueByKey(list(war?.sideA))) sides.a.set(keyOf(polity), polity);
  for (const polity of uniqueByKey(list(war?.sideB))) {
    const key = keyOf(polity);
    if (!sides.a.has(key)) sides.b.set(key, polity);
  }
  return sides;
};

// The side each relevant party is obliged to join, given the sides as they
// stand. The single definition of "bound", called by the join derivation and by
// the breach read so the two can never disagree about who was bound.
const obligationTargets = (agreement, sides, defenderSide, originalDefenders) => {
  const type = asString(agreement?.type);
  const parties = partiesOf(agreement);
  const targets = [];
  const seen = new Set();
  const add = (polity, side) => {
    const key = keyOf(polity);
    if (!key || seen.has(key)) return;
    seen.add(key);
    targets.push({ polity: asString(polity), side });
  };
  const sideOf = (name) => {
    const key = keyOf(name);
    if (sides.a.has(key)) return "a";
    if (sides.b.has(key)) return "b";
    return "";
  };
  if (type === "alliance") {
    for (const member of parties) {
      const side = sideOf(member);
      if (!side) continue;
      for (const partner of parties) {
        if (keyOf(partner) === keyOf(member)) continue;
        add(partner, side);
      }
    }
  } else if (type === "mutual_defense") {
    for (const protectedParty of parties) {
      if (!originalDefenders.has(keyOf(protectedParty))) continue;
      for (const protector of parties) {
        if (keyOf(protector) === keyOf(protectedParty)) continue;
        add(protector, defenderSide);
      }
    }
  } else if (type === "guarantee") {
    const beneficiary = asString(agreement?.beneficiary) || parties[1];
    const guarantor = asString(agreement?.guarantor) || parties[0];
    if (originalDefenders.has(keyOf(beneficiary))) add(guarantor, defenderSide);
  }
  return targets;
};
```

- [ ] **Step 4: Re-point `deriveTreatyObligations` at the shared helpers**

Replace the sides construction (lines 64-69) with:

```js
    const sides = buildSides(war);
```

Then delete the now-unused local `sideOf` block (lines 76-82): `obligationTargets`
owns that helper now, and leaving the old one behind is an unused-variable lint
error.

Replace the standing `relevant` computation (lines 90-94) with:

```js
        const type = asString(agreement?.type);
        const relevant = relevantPartiesOf(agreement);
```

Replace the whole agreement dispatch inside the fixed point (lines 121-147) with:

```js
      for (const agreement of sortedAgreements) {
        const agreementId = asString(agreement?.id);
        for (const target of obligationTargets(agreement, sides, defenderSide, originalDefenders)) {
          propose(target.polity, target.side, agreementId);
        }
      }
```

Run: `node --test "src/engine/treatyObligations.test.js"` and `node --test "src/engine/*.test.js"`
Expected: the existing obligation cases still pass unchanged (the refactor is behavior-preserving); the new breach cases still FAIL until Step 5.

- [ ] **Step 5: Implement `deriveTreatyBreaches`**

Add after `deriveTreatyObligations` (before the final line of the file):

```js
// A declared breach is honored only when the named party was actually bound: the
// agreement is active and one of the three obligating types, the party is one of
// its relevant parties, and at least one other relevant party already sits on the
// side it was bound to. Anything else is rejected with a reason and changes
// nothing, so a breach of an agreement that binds no one cannot manufacture a
// cost. The wronged parties are those already on the side the breaker abandoned.
export const deriveTreatyBreaches = ({ wars = [], agreements = [], breaches = [] } = {}) => {
  const sortedWars = list(wars)
    .filter((war) => asString(war?.status) === "active")
    .slice()
    .sort((a, b) => compareText(asString(a?.id), asString(b?.id)));
  const byId = new Map();
  for (const agreement of list(agreements)) {
    if (!OBLIGATION_AGREEMENT_TYPES.includes(asString(agreement?.type))) continue;
    byId.set(asString(agreement?.id), agreement);
  }

  // A total order over declarations: dedupe first, then sort, so the accepted
  // set and the cap cannot depend on how the model wrote the list.
  const declared = [];
  const seen = new Set();
  for (const entry of list(breaches)) {
    const agreementId = asString(entry?.agreementId);
    const polity = asString(entry?.polity);
    const key = keyOf(agreementId) + "\u0000" + keyOf(polity);
    if (!agreementId || !polity || seen.has(key)) continue;
    seen.add(key);
    declared.push({ agreementId, polity });
  }
  declared.sort((a, b) => compareText(a.agreementId, b.agreementId) || comparePolity(a.polity, b.polity));

  const accepted = [];
  const rejected = [];
  for (const declaration of declared) {
    const agreement = byId.get(declaration.agreementId) || null;
    if (!agreement) {
      rejected.push({ ...declaration, reason: "agreement-missing" });
      continue;
    }
    if (asString(agreement?.status) !== "active") {
      rejected.push({ ...declaration, reason: "agreement-inactive" });
      continue;
    }
    const relevant = relevantPartiesOf(agreement);
    if (!relevant.some((polity) => keyOf(polity) === keyOf(declaration.polity))) {
      rejected.push({ ...declaration, reason: "not-a-party" });
      continue;
    }
    const warIds = [];
    const wronged = [];
    for (const war of sortedWars) {
      const sides = buildSides(war);
      const aggressorSide = asString(war?.aggressor) === "b" ? "b" : "a";
      const defenderSide = aggressorSide === "a" ? "b" : "a";
      const originalDefenders = new Set(sides[defenderSide].keys());
      const target = obligationTargets(agreement, sides, defenderSide, originalDefenders)
        .find((candidate) => keyOf(candidate.polity) === keyOf(declaration.polity));
      if (!target) continue;
      const relying = relevant.filter((polity) =>
        keyOf(polity) !== keyOf(declaration.polity) && sides[target.side].has(keyOf(polity)));
      if (!relying.length) continue;
      warIds.push(asString(war?.id));
      for (const polity of relying) {
        if (!wronged.some((name) => keyOf(name) === keyOf(polity))) wronged.push(polity);
      }
    }
    if (!warIds.length) {
      rejected.push({ ...declaration, reason: "no-active-obligation" });
      continue;
    }
    accepted.push({
      agreementId: declaration.agreementId,
      agreementType: asString(agreement?.type),
      polity: declaration.polity,
      warIds,
      wrongedPolities: wronged.slice().sort(comparePolity),
    });
  }

  const kept = accepted.slice(0, MAX_TREATY_BREACHES_PER_TURN);
  for (const overflow of accepted.slice(MAX_TREATY_BREACHES_PER_TURN)) {
    rejected.push({ agreementId: overflow.agreementId, polity: overflow.polity, reason: "cap-reached" });
  }

  return {
    breaches: kept,
    rejected,
    summary: { declared: declared.length, accepted: kept.length, rejected: rejected.length },
  };
};
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test "src/engine/treatyObligations.test.js"`
Expected: all cases pass, including the existing obligation and standing cases.

Run: `node --test "src/engine/*.test.js"`
Expected: 0 fail, including `enginePurity.test.js` over the module.

Run: `npx eslint src/engine/treatyObligations.js src/engine/treatyObligations.test.js`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/engine/treatyObligations.js src/engine/treatyObligations.test.js
git commit -m "feat(engine): derive the treaty breaches a war calls in"
```

---

### Task 2: The runtime breach adapter and digest

**Files:**
- Modify: `src/runtime/treatyObligations.js`
- Modify: `src/runtime/gameState.js`
- Test: `src/runtime/treatyObligations.test.js`
- Test: `src/runtime/gameState.ledgers.test.js`

**Interfaces:**
- Consumes: `deriveTreatyBreaches`, `BREACH_REPUTATION_PENALTY`, `BREACH_RELATION_PENALTY`, `MAX_TREATY_BREACHES_PER_TURN` from Task 1.
- Produces:
  - a stored agreement `status` that accepts and preserves `"breached"`, and a
    preserved optional `breachedBy` field, so `readRecordedBreaches` can see a
    broken pact after a normalize round trip.
  - `TREATY_BREACH_ROW_CAP = 6`, `TREATY_BREACH_CHAR_CAP = 360`.
  - `readTreatyBreaches(world, { breaches = [] }) -> { breaches, rejected, summary }` with display names.
  - `readRecordedBreaches(world) -> [{ agreementId, agreementType, breachedBy, polities }]`.
  - `applyTreatyBreaches(world, breaches, { date = "", round = 0 }) -> world`.
  - `buildTreatyBreachDigest({ breaches = [], cap = 6, charCap = 360 }) -> string`.

The normalizer change lives here rather than in Task 3 because
`readRecordedBreaches` reads `status === "breached"` from a normalized world:
without this step its own test cannot pass.

- [ ] **Step 1: Write the failing tests**

Append to `src/runtime/treatyObligations.test.js`. Extend the import (lines 5-9):

```js
import {
  applyTreatyBreaches,
  applyTreatyJoins,
  buildTreatyBreachDigest,
  buildTreatyObligationDigest,
  readRecordedBreaches,
  readTreatyBreaches,
  readTreatyObligations,
} from "./treatyObligations.js";
```

Extend the engine import (line 10):

```js
import { BREACH_RELATION_PENALTY, BREACH_REPUTATION_PENALTY, OBLIGATION_AGREEMENT_TYPES } from "../engine/treatyObligations.js";
```

Append:

```js
test("the adapter reads a declared breach and names the wronged party", () => {
  const stored = world({
    wars: [{ id: "w1", status: "active", aggressor: "a", sideA: ["Germany"], sideB: ["France"], startedDate: "1914-08-03" }],
    agreements: [{ id: "central", type: "alliance", status: "active", parties: ["Germany", "Italy"] }],
  });
  const out = readTreatyBreaches(stored, { breaches: [{ agreementId: "central", polity: "Italy" }] });
  assert.deepEqual(out.breaches, [
    { agreementId: "central", agreementType: "alliance", polity: "Italy", warIds: ["w1"], wrongedPolities: ["Germany"] },
  ]);
});

test("applyTreatyBreaches charges reputation and the relation and clamps", () => {
  const stored = world({
    wars: [{ id: "w1", status: "active", aggressor: "a", sideA: ["Germany"], sideB: ["France"], startedDate: "1914-08-03" }],
    internationalReputation: { Italy: 30 },
    relations: [{ id: "r1", a: "Germany", b: "Italy", score: 10, status: "neutral" }],
  });
  const next = applyTreatyBreaches(stored, [
    { agreementId: "central", agreementType: "alliance", polity: "Italy", warIds: ["w1"], wrongedPolities: ["Germany"] },
  ], { date: "1914-09-01", round: 4 });
  assert.equal(next.internationalReputation.Italy, 30 - BREACH_REPUTATION_PENALTY);
  const relation = next.relations.find((entry) => (entry.a === "Germany" && entry.b === "Italy") || (entry.a === "Italy" && entry.b === "Germany"));
  assert.equal(relation.score, 10 - BREACH_RELATION_PENALTY);
  assert.equal(applyTreatyBreaches(stored, [], { date: "1914-09-01", round: 4 }), stored, "a quiet turn copies nothing");
});

test("applyTreatyBreaches creates a relation where none was recorded and floors it", () => {
  const stored = world({
    wars: [{ id: "w1", status: "active", aggressor: "a", sideA: ["Germany"], sideB: ["France"], startedDate: "1914-08-03" }],
    internationalReputation: { Italy: 5 },
    relations: [{ id: "r1", a: "Germany", b: "Italy", score: -95, status: "rival" }],
  });
  const next = applyTreatyBreaches(stored, [
    { agreementId: "central", agreementType: "alliance", polity: "Italy", warIds: ["w1"], wrongedPolities: ["Germany", "Russia"] },
  ], { date: "1914-09-01", round: 4 });
  assert.equal(next.internationalReputation.Italy, 0, "reputation floors at 0");
  const pair = next.relations.find((entry) => (entry.a === "Germany" && entry.b === "Italy") || (entry.a === "Italy" && entry.b === "Germany"));
  assert.equal(pair.score, -100, "relation floors at -100");
  const created = next.relations.find((entry) => (entry.a === "Italy" && entry.b === "Russia") || (entry.a === "Russia" && entry.b === "Italy"));
  assert.ok(created, "a breach leaves a pair where none was recorded");
  assert.equal(created.score, -BREACH_RELATION_PENALTY);
});

test("readRecordedBreaches returns the agreements the world already broke", () => {
  const stored = world({
    agreements: [
      { id: "broken", type: "alliance", status: "breached", parties: ["Germany", "Italy"], breachedBy: "Italy" },
      { id: "whole", type: "alliance", status: "active", parties: ["Germany", "Russia"] },
    ],
  });
  const rows = readRecordedBreaches(stored);
  assert.deepEqual(rows, [
    { agreementId: "broken", agreementType: "alliance", breachedBy: "Italy", polities: ["Germany", "Italy"] },
  ]);
});

test("the breach digest orders rows, caps them and reports the overflow", () => {
  const breaches = Array.from({ length: 8 }, (_, i) => ({
    agreementId: `a${i}`,
    agreementType: "alliance",
    polity: "Italy",
    wrongedPolities: ["Germany"],
  }));
  const block = buildTreatyBreachDigest({ breaches, cap: 6, charCap: 1000 });
  assert.match(block, /^\[Treaty Breaches, as simulated\]/);
  assert.equal(block.split("\n").length, 8, "a header, six rows and one overflow line");
  assert.match(block, /\+2 more\./);
  assert.equal(buildTreatyBreachDigest({ breaches: [] }), "");
});
```

In `src/runtime/gameState.ledgers.test.js`, append (`normalizeWorldState` is
already imported there):

```js
test("a breached status and its breachedBy survive a normalize round trip", () => {
  const world = normalizeWorldState({
    agreements: [
      { id: "a1", type: "alliance", status: "breached", parties: ["France", "Russia"], breachedBy: "Russia", endedDate: "1914-09-01" },
    ],
  });
  assert.equal(world.agreements[0].status, "breached");
  assert.equal(world.agreements[0].breachedBy, "Russia");
  assert.equal(world.agreements[0].endedDate, "1914-09-01");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "src/runtime/treatyObligations.test.js" "src/runtime/gameState.ledgers.test.js"`
Expected: FAIL with the new adapter functions undefined, and the `breached`
status reset to `active` with `breachedBy` and `endedDate` dropped.

- [ ] **Step 3: Implement the adapter additions**

In `src/runtime/treatyObligations.js`, extend the import from the engine (line 7):

```js
import { BREACH_RELATION_PENALTY, BREACH_REPUTATION_PENALTY, deriveTreatyBreaches, deriveTreatyObligations } from "../engine/treatyObligations.js";
```

Add the digest constants beside the existing ones:

```js
export const TREATY_BREACH_ROW_CAP = 6;
export const TREATY_BREACH_CHAR_CAP = 360;
```

Add the reader that maps a stored world into the engine's canonical shape, reusing the existing `readerFor`:

```js
const canonicalWars = (normalized, readPolity) => list(normalized?.wars)
  .filter((war) => asString(war?.status) === "active")
  .map((war) => ({
    id: asString(war?.id),
    status: "active",
    aggressor: asString(war?.aggressor) === "b" ? "b" : "a",
    sideA: list(war?.sideA).map(readPolity).filter(Boolean),
    sideB: list(war?.sideB).map(readPolity).filter(Boolean),
  }));

const canonicalAgreements = (normalized, readPolity) => list(normalized?.agreements).map((agreement) => ({
  id: asString(agreement?.id),
  type: asString(agreement?.type),
  status: asString(agreement?.status),
  parties: list(agreement?.parties).map(readPolity).filter(Boolean),
  guarantor: asString(agreement?.guarantor) ? readPolity(agreement.guarantor) : "",
  beneficiary: asString(agreement?.beneficiary) ? readPolity(agreement.beneficiary) : "",
}));
```

Then add the three functions after `readTreatyObligations`:

```js
export const readTreatyBreaches = (world, { breaches = [] } = {}) => {
  const normalized = normalizeWorldState(world);
  const readPolity = readerFor(normalized);
  const declared = list(breaches)
    .map((entry) => ({
      agreementId: asString(entry?.agreementId),
      polity: readPolity(entry?.polity),
    }))
    .filter((entry) => entry.agreementId && entry.polity);
  const derived = deriveTreatyBreaches({
    wars: canonicalWars(normalized, readPolity),
    agreements: canonicalAgreements(normalized, readPolity),
    breaches: declared,
  });
  return derived;
};

export const readRecordedBreaches = (world) => {
  const normalized = normalizeWorldState(world);
  return list(normalized?.agreements)
    .filter((agreement) => asString(agreement?.status) === "breached")
    .map((agreement) => ({
      agreementId: asString(agreement?.id),
      agreementType: asString(agreement?.type),
      breachedBy: asString(agreement?.breachedBy),
      polities: list(agreement?.parties).map(asString).filter(Boolean),
    }))
    .sort((a, b) => compareText(a.agreementId, b.agreementId) || compareText(a.breachedBy, b.breachedBy));
};

export const applyTreatyBreaches = (world, breaches, { date = "", round = 0 } = {}) => {
  const pending = list(breaches).filter((breach) => asString(breach?.polity));
  if (!pending.length) return world;

  const normalized = normalizeWorldState(world);
  const reputation = { ...(normalized?.internationalReputation ?? {}) };
  const relations = list(normalized?.relations).map((relation) => ({ ...relation }));
  const pairKey = (a, b) => [keyLower(a), keyLower(b)].sort().join("\u0000");
  const relationByPair = new Map(relations.map((relation) => [pairKey(relation.a, relation.b), relation]));
  const stamp = asString(date);
  const roundNumber = Math.max(0, Math.trunc(Number(round) || 0));

  for (const breach of pending) {
    const breaker = asString(breach.polity);
    const priorReputation = Number.isFinite(Number(reputation[breaker])) ? Number(reputation[breaker]) : 50;
    reputation[breaker] = Math.max(0, Math.min(100, priorReputation - BREACH_REPUTATION_PENALTY));
    for (const wronged of list(breach.wrongedPolities).map(asString).filter(Boolean)) {
      if (keyLower(wronged) === keyLower(breaker)) continue;
      const key = pairKey(breaker, wronged);
      const prior = relationByPair.get(key);
      const score = Math.max(-100, Math.min(100, (Number(prior?.score) || 0) - BREACH_RELATION_PENALTY));
      if (prior) {
        prior.score = score;
        prior.status = "";
        prior.lastUpdatedDate = stamp || prior.lastUpdatedDate;
        prior.updatedRound = roundNumber || prior.updatedRound;
      } else {
        const relation = {
          id: `relation-breach-${keyLower(breaker)}-${keyLower(wronged)}`.replace(/\s+/g, "-"),
          a: breaker,
          b: wronged,
          score,
          status: "",
          summary: `${breaker} broke a treaty with ${wronged}.`,
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

export const buildTreatyBreachDigest = ({
  breaches = [],
  cap = TREATY_BREACH_ROW_CAP,
  charCap = TREATY_BREACH_CHAR_CAP,
} = {}) => {
  const rows = list(breaches)
    .filter((row) => row && typeof row === "object" && asString(row.agreementId) && asString(row.polity))
    .slice()
    .sort((a, b) =>
      compareText(asString(a.agreementId), asString(b.agreementId))
      || compareText(asString(a.polity), asString(b.polity)));
  if (!rows.length) return "";

  const limit = Math.max(0, Math.round(Number(cap) || 0));
  const budget = Math.max(0, Math.round(Number(charCap) || 0));
  const shown = rows.slice(0, limit);
  const fixed = "[Treaty Breaches, as simulated]";
  const overflow = rows.length > shown.length ? `+${rows.length - shown.length} more.` : "";

  let used = fixed.length + (overflow ? overflow.length + 1 : 0);
  const kept = [];
  for (const row of shown) {
    const wronged = list(row.wrongedPolities).map(asString).filter(Boolean).join(", ");
    const line = `- ${asString(row.polity)} broke ${asString(row.agreementId)} (${asString(row.agreementType)}); wronged ${wronged}.`;
    if (used + line.length + 1 > budget) break;
    kept.push(line);
    used += line.length + 1;
  }
  return [fixed, ...kept, overflow].filter(Boolean).join("\n");
};
```

Add the small helper beside `compareText` at the top of the file:

```js
const keyLower = (value) => asString(value).toLowerCase();
```

Note: `readTreatyObligations` already builds the same `wars`/`agreements` shape inline; leave it as is in this task (a later cleanup is out of scope), or, if you prefer, re-point it at `canonicalWars`/`canonicalAgreements` and confirm the runtime suite stays green. Do not change its observable output either way.

Then teach the normalizer the stored status. In `src/runtime/gameState.js`,
change the status set (line 345) to:

```js
const WORLD_AGREEMENT_STATUS_SET = new Set(["active", "suspended", "ended", "expired", "breached"]);
```

In `normalizeWorldAgreement`, resolve the field beside `guarantor`/`beneficiary`
(after line 3474), widen the `endedDate` guard (line 3482) so a broken
instrument keeps its death date, and return the field beside the guarantor
spread (after line 3487):

```js
  const breachedBy = status === "breached"
    ? resolveWorldDiplomaticPolity(entry.breachedBy, identityWorld, identityIndex)
    : "";
```

```js
    endedDate: ["ended", "expired", "breached"].includes(status)
      ? canonicalizeDateString(entry.endedDate || entry.lastUpdatedDate)
      : "",
```

```js
    ...(breachedBy ? { breachedBy } : {}),
```

The normalizer's own `statusRank` (line 3501) needs no edit: it sorts an unknown
status last with `?? 9`, which already puts `breached` after `expired`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "src/runtime/treatyObligations.test.js" "src/runtime/gameState.ledgers.test.js"`
Expected: all cases pass.

Run: `node --test "src/runtime/*.test.js"`
Expected: 0 fail.

Run: `npx eslint src/runtime/treatyObligations.js src/runtime/treatyObligations.test.js src/runtime/gameState.js src/runtime/gameState.ledgers.test.js`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/treatyObligations.js src/runtime/treatyObligations.test.js src/runtime/gameState.js src/runtime/gameState.ledgers.test.js
git commit -m "feat(runtime): read, apply and digest treaty breaches"
```

---

### Task 3: The `breach` operation in the diplomatic director

**Files:**
- Modify: `src/Game/AI/nativeDiplomaticDirector.js`
- Test: `src/Game/AI/diplomaticLedger.test.js`

**Interfaces:**
- Consumes: the `breached` status the normalizer learned in Task 2.
- Produces:
  - `AGREEMENT_STATUS_VALUES` includes `"breached"`.
  - the `breach` operation is accepted by both the salvage pass and the strict validator.
  - `applyAgreementUpdates` accepts `op === "breach"` and marks the agreement `breached` with `breachedBy`, keeping its recorded parties.

- [ ] **Step 1: Write the failing tests**

In `src/Game/AI/diplomaticLedger.test.js`, add `applyAgreementUpdates` to the
existing director import block (it currently imports `applyDiplomaticUpdates`,
`validateDiplomaticLedgerPayload` and others) and add
`import { normalizeWorldState } from "../../runtime/gameState.js";`. Then append:

```js
test("a breach marks the agreement breached and keeps its parties", () => {
  const world = normalizeWorldState({
    agreements: [{ id: "a1", title: "The Pact", type: "alliance", status: "active", parties: ["France", "Russia"] }],
  });
  const event = { id: "e1", date: "1914-09-01", title: "Russia stays home", description: "Russia refuses to honor the pact." };
  const out = applyAgreementUpdates({
    world,
    updates: [{ id: "a1", op: "breach", type: "", parties: ["Russia"], eventIds: ["e1"], title: "", terms: "" }],
    events: [event],
    stopDate: "1914-09-01",
    round: 4,
  });
  const broken = out.agreements.find((entry) => entry.id === "a1");
  assert.equal(broken.status, "breached");
  assert.equal(broken.breachedBy, "Russia");
  assert.deepEqual(broken.parties, ["France", "Russia"], "a breach names the breaker, it does not rewrite the parties");
});

test("validation rejects a breach whose agreement does not exist", () => {
  const error = validateDiplomaticLedgerPayload({
    relationUpdates: [],
    agreementUpdates: [{ id: "missing", op: "breach", parties: ["Russia"], eventIds: ["e1"] }],
  }, { world: normalizeWorldState({}), events: [{ id: "e1", date: "1914-09-01", title: "x" }] });
  assert.match(error, /breach|does not exist/);
});

test("validation rejects a breach of a terminal agreement", () => {
  const terminal = normalizeWorldState({
    agreements: [{ id: "gone", title: "Old Pact", type: "alliance", status: "ended", parties: ["France", "Russia"] }],
  });
  const error = validateDiplomaticLedgerPayload({
    relationUpdates: [],
    agreementUpdates: [{ id: "gone", op: "breach", parties: ["Russia"], eventIds: ["e1"] }],
  }, { world: terminal, events: [{ id: "e1", date: "1914-09-01", title: "x" }] });
  assert.match(error, /terminal|breach/);
});

test("validation rejects a breach that names more than one party", () => {
  const active = normalizeWorldState({
    agreements: [{ id: "a1", title: "The Pact", type: "alliance", status: "active", parties: ["France", "Russia"] }],
  });
  const error = validateDiplomaticLedgerPayload({
    relationUpdates: [],
    agreementUpdates: [{ id: "a1", op: "breach", parties: ["France", "Russia"], eventIds: ["e1"] }],
  }, { world: active, events: [{ id: "e1", date: "1914-09-01", title: "x" }] });
  assert.match(error, /exactly one party|breach/);
});
```

`salvageDiplomaticLedgerPayload` runs before validation on the salvage-first
pass, so it must also know `breach` (Step 4): the salvage test file already
imports it, and an unwhitelisted `breach` row would be silently stripped there
before validation ever sees it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "src/Game/AI/diplomaticLedger.test.js"`
Expected: FAIL, the director tests reject the unknown `breach` op.

- [ ] **Step 3: Add the status enum value**

In `src/Game/AI/nativeDiplomaticDirector.js`, add `"breached"` to `AGREEMENT_STATUS_VALUES` (lines 54-59):

```js
export const AGREEMENT_STATUS_VALUES = Object.freeze([
  "active",
  "suspended",
  "ended",
  "expired",
  "breached",
]);
```

- [ ] **Step 4: Add the `breach` operation to both the salvage pass and the validator**

Two op whitelists gate an agreement record. `salvageDiplomaticLedgerPayload`
(line 1058) runs first on the salvage-first turn path and silently drops an
unknown op; `validateDiplomaticLedgerPayload` (line 1134) is the strict gate.
Both must learn `breach`, or the row is stripped before the engine ever sees it.

In `salvageDiplomaticLedgerPayload`, extend the op list (line 1058) and add the
breach structural rules into the `why` chain:

```js
    else if (!["start", "update", "suspend", "resume", "end", "expire", "breach"].includes(op)) why = `"${op}" is not an agreement operation`;
    else if (op === "start") {
      const prior = existing.get(id);
      if (prior && !["ended", "expired"].includes(prior.status)) why = "it already exists - update, suspend, resume or end it instead";
      else if (canonicalizeParties(update.parties, world).length < 2) why = "fewer than two of its parties are polities on this map";
      else if (!clean(update.title)) why = "it has no title";
    } else if (op === "breach" && canonicalizeParties(update.parties, world).length !== 1) why = "a breach names exactly one party (the breaker)";
    else if (!existing.has(id)) why = `no agreement "${id}" exists to ${op}`;
    else if (op === "breach" && ["ended", "expired", "breached"].includes(existing.get(id)?.status)) why = `the agreement "${id}" is already terminal`;
```

In `validateDiplomaticLedgerPayload`, replace the `if (!["start", ...].includes(update.op))` guard (line 1134) with:

```js
    if (!["start", "update", "suspend", "resume", "end", "expire", "breach"].includes(update.op)) {
      return `Agreement ${update.id} has unsupported operation "${update.op}".`;
    }
    if (update.op === "breach" && update.parties.length !== 1) {
      return `Agreement ${update.id} breach requires exactly one party (the breaker).`;
    }
```

and add the terminal rule to the non-start branch (line 1144), so the strict pass
names it rather than relying on the engine to drop it:

```js
    } else if (!existing.has(update.id)) {
      return `Agreement ${update.id} does not exist; ${update.op} cannot occur before start.`;
    } else if (update.op === "breach" && ["ended", "expired", "breached"].includes(existing.get(update.id)?.status)) {
      return `Agreement ${update.id} is already terminal; it cannot be breached.`;
    }
```

In `applyAgreementUpdates`, add the breach status branch beside the others (lines 1318-1322):

```js
    let status = prior.status;
    if (update.op === "suspend") status = "suspended";
    else if (update.op === "resume") status = "active";
    else if (update.op === "end") status = "ended";
    else if (update.op === "expire") status = "expired";
    else if (update.op === "breach") status = "breached";
```

Keep the agreement's recorded parties for a breach. Replace the parties line (line 1316) with:

```js
    const parties = update.op === "breach"
      ? array(prior.parties)
      : (update.parties.length ? canonicalizeParties(update.parties, nextWorld) : array(prior.parties));
```

Set `breachedBy` on the produced agreement. Compute it once beside `status`:

```js
    const breachedBy = update.op === "breach"
      ? (canonicalizeParties(update.parties, nextWorld)[0] || clean(update.parties[0]) || "")
      : "";
```

Then spread it into the agreement object after the `updatedRound` line:

```js
      ...(status === "breached" && breachedBy ? { breachedBy } : {}),
```

and, beside the existing `delete agreement.guarantor` cleanup (line 1344-1347),
add `if (status !== "breached") delete agreement.breachedBy;` so a stale field
spread from `prior` cannot linger on a non-breached record.

Also make `endedDate` apply to `breached` like the other terminal statuses. Replace the `endedDate` line (line 1335) with:

```js
      endedDate: ["ended", "expired", "breached"].includes(status) ? (date || prior.endedDate) : "",
```

Finally, add `breached` to the sort rank (line 1352):

```js
  const statusRank = { active: 0, suspended: 1, ended: 2, expired: 3, breached: 4 };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test "src/Game/AI/diplomaticLedger.test.js"`
Expected: all cases pass.

Run: `node --test "src/Game/AI/*.test.js"`
Expected: 0 fail.

Run: `npx eslint src/Game/AI/nativeDiplomaticDirector.js src/Game/AI/diplomaticLedger.test.js`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/Game/AI/nativeDiplomaticDirector.js src/Game/AI/diplomaticLedger.test.js
git commit -m "feat(diplomacy): record a breached agreement status"
```

---

### Task 4: The turn pre-pass and the model directive

**Files:**
- Modify: `src/Game/AI/gameplay.js`
- Test: `src/Game/AI/treatyObligationsWiringArchitecture.test.js`

**Interfaces:**
- Consumes: `readTreatyBreaches`, `applyTreatyBreaches`, `readRecordedBreaches`, `buildTreatyBreachDigest` (Task 2); the `breach` op (Task 3).
- Produces: the breach is recorded before the obligation step, and `variables.treatyBreach` is printed under `[Wars]`.

- [ ] **Step 1: Write the failing guard test**

Append to `src/Game/AI/treatyObligationsWiringArchitecture.test.js`:

```js
test("the turn resolves declared breaches before the treaty obligations", () => {
  const breachReadAt = gameplay.indexOf("readTreatyBreaches(worldWithImpacts");
  // The cost runs on the world the agreement merge returned, not on
  // worldWithImpacts directly, so the guard only pins the order of the calls.
  const breachApplyAt = gameplay.indexOf("applyTreatyBreaches(");
  const obligationReadAt = gameplay.indexOf("readTreatyObligations(worldWithImpacts");
  assert.ok(breachReadAt > 0, "the pre-pass must read the declared breaches");
  assert.ok(breachApplyAt > breachReadAt, "the turn must charge the breach cost after reading it");
  assert.ok(obligationReadAt > breachApplyAt, "the breach pre-pass must run before the obligation step");
});

test("the war directive prints the breach digest the jump prompt builds", () => {
  const start = gameplay.indexOf("const buildWarLedgerDirective = (variables) => {");
  const end = gameplay.indexOf("\n};", start);
  const body = gameplay.slice(start, end);
  assert.match(body, /treatyBreach/, "the directive does not read the breach digest");
  assert.ok(gameplay.indexOf("variables.treatyBreach =") > 0, "the jump prompt never sets variables.treatyBreach");
});
```

- [ ] **Step 2: Run the guard to verify it fails**

Run: `node --test "src/Game/AI/treatyObligationsWiringArchitecture.test.js"`
Expected: FAIL, the pre-pass and the digest are absent.

- [ ] **Step 3: Extend the imports and the directive**

Extend the runtime import (around lines 36-39) to include the breach functions:

```js
import {
  applyTreatyBreaches,
  applyTreatyJoins,
  buildTreatyBreachDigest,
  buildTreatyObligationDigest,
  readRecordedBreaches,
  readTreatyBreaches,
  readTreatyObligations,
} from "../../runtime/treatyObligations.js";
```

Keep the import sorted as the file does today; only add the new names.

In `buildWarLedgerDirective`, read the breach block beside the obligations block (line 582):

```js
  const treatyObligations = normalizeString(variables?.treatyObligations);
  const treatyBreach = normalizeString(variables?.treatyBreach);
```

and print it after the obligations line (line 584):

```js
${canonicalWarContext || "No wars are recorded."}${treatyObligations ? `\n${treatyObligations}` : ""}${treatyBreach ? `\n${treatyBreach}` : ""}
```

- [ ] **Step 4: Add the pre-pass**

In `applySimulationResult`, immediately before the war merge (line 6941) add the split:

```js
  // A declared breach is resolved before the obligation step so the broken pact
  // is already non-active when the engine decides which parties a war draws in:
  // this is what makes a breach block the join it would otherwise have caused.
  const breachUpdates = agreementUpdates.filter((update) => update?.op === "breach");
  const otherAgreementUpdates = agreementUpdates.filter((update) => update?.op !== "breach");
```

Then, between `worldWithImpacts = warMerge.world;` (line 6950) and the obligation `try` (line 6956), insert:

```js
  try {
    const breachOutcome = readTreatyBreaches(worldWithImpacts, {
      breaches: breachUpdates
        .map((update) => ({ agreementId: update?.id, polity: normalizeString(update?.parties?.[0]) }))
        .filter((entry) => entry.agreementId && entry.polity),
    });
    if (breachOutcome.breaches.length) {
      const acceptedUpdates = breachUpdates.filter((update) =>
        breachOutcome.breaches.some((breach) => breach.agreementId === update.id));
      const breachMerge = applyDiplomaticUpdates({
        world: worldWithImpacts,
        relationUpdates: [],
        agreementUpdates: acceptedUpdates,
        events: freshEvents,
        stopDate: nextGame.gameDate,
        round: nextGame.round,
      });
      worldWithImpacts = applyTreatyBreaches(breachMerge.world, breachOutcome.breaches, {
        date: nextGame.gameDate,
        round: nextGame.round,
      });
    }
    // Log even when every declaration was rejected, so a silently dropped
    // breach leaves a reason in the debug trail rather than vanishing.
    if (breachOutcome.summary.declared) {
      logDebugEvent("turn", `Treaty breaches resolved: ${breachOutcome.summary.accepted} accepted, ${breachOutcome.summary.rejected} rejected.`, {
        accepted: breachOutcome.summary.accepted,
        rejected: breachOutcome.summary.rejected,
      });
    }
  } catch (error) {
    console.warn("[engine] the treaty breach step failed; the completed turn is preserved.", error);
  }
```

Then change the later diplomatic merge (line 7081) from `agreementUpdates,` to `agreementUpdates: otherAgreementUpdates,` so a breach is never applied twice.

- [ ] **Step 5: Build the jump digest**

In `simulateTimelineJump`, beside the obligations digest (lines 13100-13102), add:

```js
      variables.treatyBreach = buildTreatyBreachDigest({
        breaches: readRecordedBreaches(bundle.world),
      });
```

- [ ] **Step 6: Verify**

Run: `node --test "src/Game/AI/treatyObligationsWiringArchitecture.test.js"`
Expected: 4 pass.

Run: `node --check src/Game/AI/gameplay.js`
Expected: no output (syntax ok).

Run: `node --test "src/Game/AI/*.test.js"`
Expected: 0 fail.

Run: `npx eslint src/Game/AI/gameplay.js src/Game/AI/treatyObligationsWiringArchitecture.test.js`
Expected: 0 errors (existing warnings are acceptable).

- [ ] **Step 7: Commit**

```bash
git add src/Game/AI/gameplay.js src/Game/AI/treatyObligationsWiringArchitecture.test.js
git commit -m "feat(ai): record treaty breaches before the obligations and tell the model"
```

---

### Task 5: Document the breach layer

**Files:**
- Modify: `docs/runtime-services.md`

**Interfaces:**
- Consumes: the shipped code from Tasks 1-4.
- Produces: one new documentation section; no code.

- [ ] **Step 1: Add the section**

In `docs/runtime-services.md`, immediately after the "Treaty obligations" section, add a section in the same style (`---` separator, `##` heading):

```markdown
---

## Treaty breaches

`src/engine/treatyObligations.js` also exports `deriveTreatyBreaches`, the same "who is bound" computation read in the other direction: the model declares, through the `breach` operation in `agreementUpdates` (one record, one party, the breaker), that a bound party refuses to honor its obligation, and the engine accepts it only when the breaking party would actually have been drawn in. A declaration whose agreement is missing, not active, of a non-obligating type, whose party is not a party to it, or which binds the party to no side is rejected with a reason and changes nothing; the shared `obligationTargets` helper is the one definition of "bound", so the join rule and the breach rule can never disagree. The wronged parties are those already on the side the breaker abandoned.

The runtime adapter (`src/runtime/treatyObligations.js`) adds `readTreatyBreaches` (read the world, canonicalize, call the engine), `readRecordedBreaches` (the agreements the world already holds as `breached`), `applyTreatyBreaches` (charge the cost) and `buildTreatyBreachDigest` (a capped 6/360 block). A breach is terminal: `nativeDiplomaticDirector.js` marks the agreement `breached`, records who broke it in `breachedBy`, and keeps the recorded parties. The cost is deterministic arithmetic on existing stores: `BREACH_REPUTATION_PENALTY` 15 off the breaker's `internationalReputation` (treated as 50 when unset), and `BREACH_RELATION_PENALTY` 25 off its relation with each wronged party (created at 0 when absent), both clamped, with the relation status re-derived from the new score. `MAX_TREATY_BREACHES_PER_TURN` 16 bounds a turn.

The turn (`gameplay.js`, `applySimulationResult`) resolves breaches in a pre-pass between the war merge and the obligation step, so a broken pact is already `breached` and no longer `active` when the engine decides the joins: the breach blocks the join it would have caused. The jump prompt (`simulateTimelineJump`) builds `variables.treatyBreach` from `readRecordedBreaches(bundle.world)`, and `buildWarLedgerDirective` prints it under `[Wars]` after the standing-obligations block. The interactive path is deferred, as it was for the standing obligations; the breach still lands in the ledger and the events.
```

- [ ] **Step 2: Fact-check and verify**

Read `src/engine/treatyObligations.js`, `src/runtime/treatyObligations.js` and the `gameplay.js` wiring and confirm every name, cap and default in the section matches the code. Fix any mismatch.

Run: `npm run wiki:check`
Expected: `Wiki is current.` (the wiki is generated from `wiki/` only, so a `docs/` edit needs no rebuild).

Run: `grep -nP "[^\x00-\x7F]" docs/runtime-services.md`
Expected: the existing file is ASCII; the new section must add no non-ASCII line.

- [ ] **Step 3: Commit**

```bash
git add docs/runtime-services.md
git commit -m "docs(runtime): document treaty breaches"
```

---

### Task 6: Acceptance gate

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

Expected: the whole suite passes with zero failures, the three globs pass, eslint has 0 errors in the new and changed files (the pre-existing `src/Game/Map/*` errors are unrelated), `wiki:check` prints `Wiki is current.`, and `build` exits 0. Note the known `server/appUpdate.test.js` network flake: a failure there is unrelated to this increment.

- [ ] **Step 2: Audit the branch**

```bash
git log --format='%h|%s|%(trailers:key=Co-authored-by,valueonly)' <spec-commit>..HEAD
```

Expected: every commit in the slice carries the `Co-authored-by` trailer.

- [ ] **Step 3: Report**

Record the gate output in `.superpowers/sdd/progress.md` and hand the slice to the whole-branch review.
