# Interactive Peace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer the player the settlement of their own due wars, and let them
accept or decline it, without the engine ever forcing a peace on them.

**Architecture:** The settlement adapter `resolveWarSettlements` steps weariness
for every active war (including the player's) and classifies a due party war as
an `offer` instead of a settlement. A small import-free runtime helper chooses
the one most pressing offer and normalizes it; the turn stores it on
`world.peaceOffer`. Accepting replays the stored terms through the doors an AI
settlement already uses (event, transfers, reparations, ledger end); declining
only clears the offer.

**Tech Stack:** Node.js ESM, `node --test`, React 18 (JSX) for the panel, Vite
for the build.

## Global Constraints

- Pure core `src/engine/**` is unchanged this increment. It must keep importing
  no browser module and using no `Date.now`/`new Date`/`Math.random`
  (`src/engine/enginePurity.test.js` enforces this).
- `src/runtime/**` must never import a `src/Game/AI/**` module. The accept
  arithmetic that calls the war ledger therefore lives in `src/Game/AI/`.
- Only ASCII in every added line. No emoji, no em dash, no middle dot.
- No new dependency in `package.json`. No `ENGINE_VERSION` bump. No migration.
- Every commit is conventional and carries the trailer
  `Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>`. The
  `prepare-commit-msg` hook appends it: never pass it with `-m`.
- Tests run with globs, never a directory: `node --test "src/runtime/*.test.js"`,
  `node --test "src/Game/AI/*.test.js"`, `node --test "src/engine/*.test.js"`.
- Do not weaken an existing test to pass. The one existing adapter expectation
  that changes is named in Task 1 and is justified by the spec.
- `src/Game/AI/gameplay.js` imports `./main.jsx`, so it is never imported by a
  `node --test` file. Its wiring is pinned by a source-text architecture test
  plus `node --check`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/runtime/warSettlement.js` (modify) | Step weariness for all active wars; classify a due party war as an offer. |
| `src/runtime/peaceOffer.js` (create) | Import-free: choose the one offer, normalize a stored offer. |
| `src/runtime/gameState.js` (modify) | `world.peaceOffer` default and normalizer. |
| `src/Game/AI/peaceOffer.js` (create) | Pure accept arithmetic: event, transfers, reparations, ledger end, clear offer. |
| `src/Game/AI/gameplay.js` (modify) | Choose the offer each turn; export accept and decline. |
| `src/Game/AI/gameplayLazy.js` (modify) | Lazy wrappers for accept and decline. |
| `src/Game/GameUI/peaceOffer.jsx` (create) | The offer modal. |
| `src/Game/GameUI/main.jsx` (modify) | Mount the lazy panel when an offer exists. |
| `docs/runtime-services.md` (modify) | Module-map row and one section. |

---

### Task 1: Step weariness for the player's wars and offer a due peace

**Files:**
- Modify: `src/runtime/warSettlement.js` (the loop in `resolveWarSettlements`,
  now at `:93-178`)
- Test: `src/runtime/warSettlement.test.js`

**Interfaces:**
- Produces: `resolveWarSettlements({ world, events, engagements, date, playerPolity })`
  returns `{ settlements, offers, weariness, unresolved }`. An `offers` entry is
  a settlement object (`key, warId, victor, loser, capitulation, white, punitive,
  transfers, reparations`) plus `{ belligerents, side, pressure }`, where `side`
  is `"a"`, `"b"` or `""` and `pressure` is the highest of the two stepped
  weariness values.

- [ ] **Step 1: Write the failing tests**

In `src/runtime/warSettlement.test.js`, replace the existing party-war test
(currently at `:44`) with a not-due case, and add a due case and an unaffected
case. The default fixture war is already due (weariness `0.6` two months on is
`0.68`), so the not-due case must lower the weariness and recent the date.

```js
test("a not-due war the player is a party to stays open with a player reason", () => {
  const out = resolveWarSettlements({
    world: world([war({ weariness: { a: 0.1, b: 0.1, throughDate: "1870-02-01" } })]),
    events: [],
    engagements: [],
    date: "1870-03-01",
    playerPolity: "France",
  });
  assert.deepEqual(out.settlements, []);
  assert.deepEqual(out.offers, []);
  // The weariness is now stepped for a party war, where it used to be skipped.
  assert.equal(out.weariness["war-1"].throughDate, "1870-03-01");
  assert.ok(out.weariness["war-1"].a > 0.1);
  assert.equal(out.unresolved.length, 1);
  assert.match(out.unresolved[0].reason, /player/i);
});

test("a due war the player is a party to is offered, not settled", () => {
  const out = resolveWarSettlements({
    world: world([war()]),
    events: [],
    engagements: [],
    date: "1870-03-01",
    playerPolity: "France",
  });
  assert.deepEqual(out.settlements, []);
  assert.equal(out.offers.length, 1);
  assert.equal(out.offers[0].warId, "war-1");
  assert.equal(out.offers[0].side, "b", "France is side B");
  assert.ok(out.offers[0].pressure >= 0.6);
  assert.deepEqual(out.unresolved, []);
});

test("a non-party war leaves the offers empty", () => {
  const out = resolveWarSettlements({
    world: world([war({ weariness: { a: 0.6, b: 0.6, throughDate: "1870-02-01" } })]),
    events: [],
    engagements: [],
    date: "1870-03-01",
    playerPolity: "",
  });
  assert.equal(out.settlements.length, 1);
  assert.deepEqual(out.offers, []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "src/runtime/warSettlement.test.js"`
Expected: FAIL. `offers` is `undefined` on the return object, so the new tests
throw; the replaced party test also fails because weariness was `{}`.

- [ ] **Step 3: Add the player-side helper**

In `src/runtime/warSettlement.js`, beside `sideIsUnjust` (currently `:52-58`),
add:

```js
// Whether a side counts the player among its declared members, folded through
// the same lowercased canonical key space the party test always used.
const sideHasPlayer = (members, playerKey) => {
  if (!playerKey) return false;
  for (const raw of list(members)) {
    const polity = canonical(raw);
    if (polity && polity.toLowerCase() === playerKey) return true;
  }
  return false;
};
```

- [ ] **Step 4: Replace the party skip with a classification**

At the top of `resolveWarSettlements`, add `const offers = [];` beside
`const settlements = [];` (currently `:82`).

Replace the party check (currently `:103-107`):

```js
    const sides = belligerentsOf(war);
    if (playerKey && sides.some((polity) => polity.toLowerCase() === playerKey)) {
      unresolved.push({ warId, reason: `the player is a party to ${warId}` });
      continue;
    }
```

with:

```js
    const sides = belligerentsOf(war);
    // The player's wars are stepped and settled like any other; only the
    // DECISION is held back, so a due peace becomes an offer, not a fact.
    const sideAHasPlayer = sideHasPlayer(war.sideA, playerKey);
    const sideBHasPlayer = sideHasPlayer(war.sideB, playerKey);
    const party = sideAHasPlayer || sideBHasPlayer;
```

- [ ] **Step 5: Classify the settlement**

Replace the settlement push and the return (currently `:173-177`):

```js
    if (settlement) settlements.push({ ...settlement, belligerents: sides });
  }

  return { settlements, weariness, unresolved };
```

with:

```js
    if (!settlement) {
      // Not due. A player's open war is still reported, as it was when the
      // party check skipped it; a non-party war stays silent as before.
      if (party) unresolved.push({ warId, reason: `the player is a party to ${warId}` });
      continue;
    }
    if (party) {
      offers.push({
        ...settlement,
        belligerents: sides,
        side: sideAHasPlayer ? "a" : "b",
        pressure: Math.max(nextA, nextB),
      });
      continue;
    }
    settlements.push({ ...settlement, belligerents: sides });
  }

  return { settlements, offers, weariness, unresolved };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test "src/runtime/warSettlement.test.js"`
Expected: PASS. Then run the whole runtime glob to be sure nothing else moved:
`node --test "src/runtime/*.test.js"`.

- [ ] **Step 7: Commit**

```bash
git add src/runtime/warSettlement.js src/runtime/warSettlement.test.js
git commit -m "feat(runtime): offer a due peace on the player's wars"
```

---

### Task 2: The import-free offer helper

**Files:**
- Create: `src/runtime/peaceOffer.js`
- Test: `src/runtime/peaceOffer.test.js`

**Interfaces:**
- Consumes: an `offers` array from Task 1.
- Produces: `choosePeaceOffer({ offers, round })` returns one normalized offer
  or `null`; `normalizePeaceOffer(value)` returns a tidied offer or `null`.

- [ ] **Step 1: Write the failing test**

Create `src/runtime/peaceOffer.test.js`:

```js
// Run: node --test src/runtime/peaceOffer.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { choosePeaceOffer, normalizePeaceOffer } from "./peaceOffer.js";

const offer = (over = {}) => ({
  warId: "war-1",
  round: 4,
  side: "a",
  pressure: 0.6,
  victor: "a",
  loser: "b",
  capitulation: false,
  white: false,
  punitive: false,
  transfers: [],
  reparations: { fromCode: "B", toCode: "A", manpower: 0, materiel: 0 },
  belligerents: ["Prussia", "France"],
  ...over,
});

test("no offers is no offer", () => {
  assert.equal(choosePeaceOffer({ offers: [], round: 4 }), null);
  assert.equal(choosePeaceOffer({ offers: [{ pressure: 1 }], round: 4 }), null);
  assert.equal(choosePeaceOffer(), null);
});

test("the most pressing offer wins, ties by the lowest war id, order-independent", () => {
  const picked = choosePeaceOffer({
    offers: [offer({ warId: "war-b", pressure: 0.7 }), offer({ warId: "war-a", pressure: 0.9 })],
    round: 5,
  });
  assert.equal(picked.warId, "war-a");

  const tie = choosePeaceOffer({
    offers: [offer({ warId: "war-c", pressure: 0.5 }), offer({ warId: "war-b", pressure: 0.5 })],
    round: 5,
  });
  assert.equal(tie.warId, "war-b", "the lower war id breaks the tie");

  const reversed = choosePeaceOffer({
    offers: [offer({ warId: "war-b", pressure: 0.5 }), offer({ warId: "war-c", pressure: 0.5 })],
    round: 5,
  });
  assert.equal(reversed.warId, "war-b", "the choice never depends on array order");
});

test("the stored offer carries its round and bounded numbers", () => {
  const picked = choosePeaceOffer({ offers: [offer({ pressure: 4, round: -1 })], round: 7 });
  assert.equal(picked.round, 7, "the turn's round is stamped");
  assert.equal(picked.pressure, 1, "pressure is bounded to 0..1");
});

test("normalize keeps a full offer and rejects an unusable one", () => {
  const kept = normalizePeaceOffer(offer({ warId: " war-1 " }));
  assert.equal(kept.warId, "war-1");
  assert.equal(kept.side, "a");
  assert.deepEqual(kept.transfers, []);
  assert.deepEqual(kept.reparations, { fromCode: "B", toCode: "A", manpower: 0, materiel: 0 });

  assert.equal(normalizePeaceOffer(null), null);
  assert.equal(normalizePeaceOffer({ warId: "" }), null);
  assert.equal(normalizePeaceOffer({ warId: "war-1" }).transfers.length, 0);
  assert.equal(normalizePeaceOffer({ warId: "war-1" }).side, "");
  assert.deepEqual(
    normalizePeaceOffer({ warId: "war-1" }).reparations,
    { fromCode: "", toCode: "", manpower: 0, materiel: 0 },
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/runtime/peaceOffer.test.js"`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the helper**

Create `src/runtime/peaceOffer.js`:

```js
/*! Open Historia - the peace the engine offers the player on their own war (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/runtime/peaceOffer.test.js
//
// The engine settles every AI war on its own. A war the player is a party to is
// held back as an offer instead: the terms are the ones settleWar already
// derived, stored whole because re-deriving them later would need the turn's
// battle inputs. This module chooses the single most pressing offer and tidies
// what a save carries. It imports nothing, so it runs under node --test.

const text = (value) => String(value ?? "").trim();
const whole = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0);
const bound01 = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
};

const normalizeTransfers = (value) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    const regionId = text(entry?.regionId);
    if (!regionId) continue;
    out.push({ regionId, fromCode: text(entry?.fromCode), toCode: text(entry?.toCode) });
  }
  return out;
};

const normalizeReparations = (value) => ({
  fromCode: text(value?.fromCode),
  toCode: text(value?.toCode),
  manpower: Math.max(0, Number(value?.manpower) || 0),
  materiel: Math.max(0, Number(value?.materiel) || 0),
});

const normalizeBelligerents = (value) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const polity = text(raw);
    const key = polity.toLowerCase();
    if (!polity || seen.has(key)) continue;
    seen.add(key);
    out.push(polity);
    if (out.length >= 8) break;
  }
  return out;
};

// A stored offer, or null. A value with no war id is not an offer.
export const normalizePeaceOffer = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const warId = text(value.warId);
  if (!warId) return null;
  const side = text(value.side).toLowerCase();
  return {
    warId,
    round: whole(value.round),
    side: side === "a" || side === "b" ? side : "",
    pressure: bound01(value.pressure),
    victor: text(value.victor),
    loser: text(value.loser),
    capitulation: value.capitulation === true,
    white: value.white === true,
    punitive: value.punitive === true,
    transfers: normalizeTransfers(value.transfers),
    reparations: normalizeReparations(value.reparations),
    belligerents: normalizeBelligerents(value.belligerents),
  };
};

// The one offer worth showing: the most pressing, ties by the lowest war id, so
// the same turn always chooses the same offer whatever the array order.
export const choosePeaceOffer = ({ offers = [], round = 0 } = {}) => {
  const list = (Array.isArray(offers) ? offers : [])
    .map(normalizePeaceOffer)
    .filter(Boolean);
  if (!list.length) return null;
  list.sort((a, b) => {
    if (b.pressure !== a.pressure) return b.pressure - a.pressure;
    return a.warId < b.warId ? -1 : a.warId > b.warId ? 1 : 0;
  });
  return { ...list[0], round: whole(round) };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/runtime/peaceOffer.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/peaceOffer.js src/runtime/peaceOffer.test.js
git commit -m "feat(runtime): choose and normalize the player peace offer"
```

---

### Task 3: The stored offer on the world

**Files:**
- Modify: `src/runtime/gameState.js` (`WORLD_DEFAULTS`, and the
  `normalizeWorldState` return near `:3745`)
- Test: `src/runtime/gameState.interactiveEvents.test.js`

**Interfaces:**
- Consumes: `normalizePeaceOffer` from Task 2.
- Produces: `world.peaceOffer` is `null` or a normalized offer.

- [ ] **Step 1: Write the failing test**

Append to `src/runtime/gameState.interactiveEvents.test.js`:

```js
test("a world carries no peace offer, and a stored one is tidied", () => {
  assert.equal(WORLD_DEFAULTS.peaceOffer, null);
  assert.equal(normalizeWorldState({}).peaceOffer, null);
  const world = normalizeWorldState({
    peaceOffer: { warId: " war-1 ", side: "b", pressure: 2, transfers: [], stray: true },
  });
  assert.equal(world.peaceOffer.warId, "war-1");
  assert.equal(world.peaceOffer.side, "b");
  assert.equal(world.peaceOffer.pressure, 1);
  assert.equal("stray" in world.peaceOffer, false);
  assert.equal(normalizeWorldState({ peaceOffer: { warId: "" } }).peaceOffer, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/runtime/gameState.interactiveEvents.test.js"`
Expected: FAIL, `WORLD_DEFAULTS.peaceOffer` is `undefined`.

- [ ] **Step 3: Add the default, the import and the normalizer**

In `src/runtime/gameState.js`, add the import beside the interactive-offer
import (currently `:16`):

```js
import { normalizePeaceOffer } from "./peaceOffer.js";
```

Add the default in `WORLD_DEFAULTS`, after `lastInteractiveOfferRound` (currently
`:62`):

```js
  // The peace the engine has offered for one of the player's own wars, held for
  // the player's accept or decline; null when none is due (peaceOffer.js).
  peaceOffer: null,
```

Add the normalizer in the `normalizeWorldState` return, after
`lastInteractiveOfferRound` (currently `:3745-3748`):

```js
    peaceOffer: normalizePeaceOffer(nextWorld.peaceOffer),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/runtime/gameState.interactiveEvents.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/gameState.js src/runtime/gameState.interactiveEvents.test.js
git commit -m "feat(runtime): store the player peace offer on the world"
```

---

### Task 4: The accept arithmetic

**Files:**
- Create: `src/Game/AI/peaceOffer.js`
- Test: `src/Game/AI/peaceOffer.test.js`

**Interfaces:**
- Consumes: an offer from Task 2 and 3; `buildSettlementEvent` and
  `applyWarReparations` from `src/runtime/warSettlement.js`;
  `applyEventImpactsToWorld` from `src/runtime/gameState.js`; `applyWarUpdates`
  from `src/Game/AI/nativeWarLedger.js`.
- Produces: `applyPeaceOffer({ world, offer, date, round })` returns
  `{ world, event }` or `null`. The returned world has the transfers applied,
  the reparations paid, the war ended, and `peaceOffer` cleared.

- [ ] **Step 1: Write the failing test**

Create `src/Game/AI/peaceOffer.test.js`:

```js
// Run: node --test src/Game/AI/peaceOffer.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { applyPeaceOffer } from "./peaceOffer.js";

const baseWorld = () => ({
  wars: [{
    id: "war-1",
    status: "active",
    sideA: ["Prussia"],
    sideB: ["France"],
    startedDate: "1870-01-01",
    goals: {
      a: { kind: "annex", targetRegionIds: ["R"], note: "" },
      b: { kind: "status_quo", targetRegionIds: [], note: "" },
    },
    weariness: { a: 0.9, b: 0.2, throughDate: "1870-03-01" },
  }],
  regionOwnershipOverrides: { R: "France" },
  regionSovereigntyOverrides: { R: "France" },
  economyEngine: { pools: { Prussia: { manpower: 0, materiel: 0 }, France: { manpower: 0, materiel: 0 } } },
  peaceOffer: { warId: "war-1", round: 4, side: "a", pressure: 0.9 },
});

const offer = (over = {}) => ({
  warId: "war-1",
  round: 4,
  side: "a",
  pressure: 0.9,
  victor: "a",
  loser: "b",
  capitulation: true,
  white: false,
  punitive: false,
  transfers: [{ regionId: "R", fromCode: "France", toCode: "Prussia" }],
  reparations: { fromCode: "France", toCode: "Prussia", manpower: 0, materiel: 0 },
  belligerents: ["Prussia", "France"],
  ...over,
});

test("accepting applies the transfers, ends the war and clears the offer", () => {
  const out = applyPeaceOffer({ world: baseWorld(), offer: offer(), date: "1870-04-01", round: 5 });
  assert.ok(out);
  assert.equal(out.world.regionOwnershipOverrides.R, "Prussia");
  assert.equal(out.world.wars.find((war) => war.id === "war-1").status, "ended");
  assert.equal(out.world.peaceOffer, null);
  assert.equal(out.event.impacts.regionTransfers[0].regionId, "R");
});

test("a war that no longer exists is no offer to apply", () => {
  const world = { ...baseWorld(), wars: [] };
  const out = applyPeaceOffer({ world, offer: offer(), date: "1870-04-01", round: 5 });
  // applyWarUpdates cannot end a war it does not hold; the transfer still lands.
  assert.equal(out.world.peaceOffer, null);
});

test("no offer is nothing to apply", () => {
  assert.equal(applyPeaceOffer({ world: baseWorld(), offer: null, date: "1870-04-01", round: 5 }), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/Game/AI/peaceOffer.test.js"`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the helper**

Create `src/Game/AI/peaceOffer.js`:

```js
/*! Open Historia - apply the player's accepted peace through the normal doors (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/peaceOffer.test.js
//
// The accepted terms are applied exactly where an AI settlement's are: a
// narrated event through applyEventImpactsToWorld (region transfers), the
// reparations transfer, and the war ledger's end. Lives in Game/AI because the
// ledger is here; src/runtime may not import this layer.
import { applyEventImpactsToWorld } from "../../runtime/gameState.js";
import { applyWarReparations, buildSettlementEvent } from "../../runtime/warSettlement.js";
import { applyWarUpdates } from "./nativeWarLedger.js";

export const applyPeaceOffer = ({ world, offer, date = "", round = 0 } = {}) => {
  if (!offer || !offer.warId) return null;
  const event = buildSettlementEvent(offer, { date, round });
  const applied = applyEventImpactsToWorld({
    colors: {},
    events: [event],
    world,
    motion: { originDate: date, round },
  });
  const paid = applyWarReparations(applied.world, [offer]);
  const merge = applyWarUpdates({
    world: paid,
    updates: [{ eventIds: [event.id], id: offer.warId, op: "end" }],
    events: [event],
    stopDate: date,
    round,
  });
  return { event, world: { ...merge.world, peaceOffer: null } };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/Game/AI/peaceOffer.test.js"`
Expected: PASS. If the fixture's region does not move, check that
`regionOwnershipOverrides` starts at `France` and that the war's `sideA` is
`["Prussia"]`.

- [ ] **Step 5: Commit**

```bash
git add src/Game/AI/peaceOffer.js src/Game/AI/peaceOffer.test.js
git commit -m "feat(ai): apply an accepted player peace"
```

---

### Task 5: Wire the offer into the turn and expose accept and decline

**Files:**
- Modify: `src/Game/AI/gameplay.js` (imports; the settlement block near
  `:6733-6765`; a new block after the interactive-offer block near `:7484`; new
  exports near `declineInteractiveOffer` at `:11911`)
- Modify: `src/Game/AI/gameplayLazy.js`
- Test: `src/Game/AI/peaceOfferWiringArchitecture.test.js`

**Interfaces:**
- Consumes: `resolveWarSettlements` (Task 1), `choosePeaceOffer` (Task 2),
  `world.peaceOffer` (Task 3), `applyPeaceOffer` (Task 4).
- Produces: `acceptPeaceOffer()` and `declinePeaceOffer()` exported from
  `gameplay.js` and wrapped in `gameplayLazy.js`.

- [ ] **Step 1: Write the failing architecture test**

Create `src/Game/AI/peaceOfferWiringArchitecture.test.js`:

```js
// Run: node --test src/Game/AI/peaceOfferWiringArchitecture.test.js
//
// gameplay.js imports main.jsx and cannot be imported by node --test, so its
// wiring is pinned by reading the source. This is the house pattern for the
// other wiring architecture guards.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const gameplay = read("./gameplay.js");
const lazy = read("./gameplayLazy.js");
const adapter = read("../../runtime/warSettlement.js");
const helper = read("../../runtime/peaceOffer.js");

test("the offer is chosen after the settlements are applied", () => {
  const applyAt = gameplay.indexOf("for (const settlement of dueSettlements)");
  const chooseAt = gameplay.indexOf("choosePeaceOffer({ offers: duePeaceOffers");
  assert.ok(applyAt > 0 && chooseAt > applyAt, "the offer is chosen after the settlements are applied");
});

test("the model's own peace is withheld from the offers too", () => {
  const offersAt = gameplay.indexOf("duePeaceOffers = settlementOutcome.offers");
  const filterAt = gameplay.indexOf(".filter((offer) => !modelClosedWarIds.has(normalizeString(offer.warId)))");
  assert.ok(offersAt > 0 && filterAt > offersAt, "the offers are filtered by the model-closed ids");
});

test("accepting routes through the helper", () => {
  const acceptAt = gameplay.indexOf("export const acceptPeaceOffer");
  const callAt = gameplay.indexOf("applyPeaceOffer({", acceptAt);
  assert.ok(acceptAt > 0 && callAt > acceptAt, "acceptPeaceOffer calls applyPeaceOffer");
});

test("accept and decline are lazy-wrapped", () => {
  assert.match(lazy, /export const acceptPeaceOffer/);
  assert.match(lazy, /export const declinePeaceOffer/);
});

test("the runtime peace modules import no Game/AI module", () => {
  assert.doesNotMatch(adapter, /from "\.\.\/Game\/AI\//);
  assert.doesNotMatch(helper, /from "\.\.\/Game\/AI\//);
  assert.doesNotMatch(helper, /^import /m);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/Game/AI/peaceOfferWiringArchitecture.test.js"`
Expected: FAIL, none of the wiring exists yet.

- [ ] **Step 3: Import the helper and filter the offers**

In `src/Game/AI/gameplay.js`, add the import beside the settlement imports
(currently `:29-31`):

```js
import { applyPeaceOffer } from "./peaceOffer.js";
```

and, near the interactive-offer import (currently `:301`):

```js
import { choosePeaceOffer } from "../../runtime/peaceOffer.js";
```

In the settlement block, after `dueSettlements` is built (currently `:6749-6750`),
add:

```js
  const duePeaceOffers = settlementOutcome.offers
    .filter((offer) => !modelClosedWarIds.has(normalizeString(offer.warId)));
```

- [ ] **Step 4: Store the chosen offer each turn**

After the interactive-offer block (currently ends at `:7484`), add a sibling
block that runs on every turn mode:

```js
  // The player's own due peace (runtime/peaceOffer.js): the war is real and its
  // settlement is due, but the decision is the player's, so it is offered
  // rather than applied. Re-derived every turn; declining only clears it.
  const peaceOffer = choosePeaceOffer({ offers: duePeaceOffers, round: nextGame.round });
  worldWithImpacts = { ...worldWithImpacts, peaceOffer };
```

- [ ] **Step 5: Export accept and decline**

Near `declineInteractiveOffer` (currently `:11911`), add:

```js
// Accept the peace the engine offered for one of the player's own wars: the
// stored terms are applied through the same doors an AI settlement uses, and
// the war is ended in the ledger. No request.
export const acceptPeaceOffer = async () => {
  if (isSimulationBusy()) throw new Error("A turn is being generated; wait for it to finish before accepting a peace.");
  const bundle = await readGameStateBundle({ force: true });
  const world = normalizeWorldState(bundle.world);
  const offer = world.peaceOffer;
  if (!offer) throw new Error("There is no peace offer to accept.");
  const result = applyPeaceOffer({
    world,
    offer,
    date: normalizeString(bundle.game?.gameDate),
    round: Number(bundle.game?.round) || 0,
  });
  if (!result) throw new Error("The peace offer is no longer valid.");
  await Promise.all([
    writeWorldState(result.world),
    writeEventsState(normalizeEvents([...normalizeArray(bundle.events), result.event]), { preserveApprovedEvents: true }),
  ]);
  logDebugEvent("turn", `Peace accepted: ${offer.warId} settled at the player's word.`);
  return { peaceOffer: null };
};

// Decline the offered peace: the offer is gone, the war stays open, and the
// next turn re-derives it from the new facts. No request, no penalty.
export const declinePeaceOffer = async () => {
  if (isSimulationBusy()) throw new Error("A turn is being generated; wait for it to finish.");
  const world = normalizeWorldState(await readWorldState({ force: true }));
  if (!world.peaceOffer) return { peaceOffer: null };
  await writeWorldState({ ...world, peaceOffer: null });
  logDebugEvent("turn", "Peace offer declined.");
  return { peaceOffer: null };
};
```

Confirm `readGameStateBundle`, `writeEventsState`, `writeWorldState`,
`readWorldState`, `normalizeEvents`, `normalizeArray`, `normalizeString`,
`logDebugEvent` and `isSimulationBusy` are already imported in `gameplay.js`;
they are used elsewhere in the file, so no new import is needed beyond the two
in Step 3.

- [ ] **Step 6: Add the lazy wrappers**

In `src/Game/AI/gameplayLazy.js`, after the interactive-events block (currently
`:50-55`), add:

```js
// --- Peace offers -----------------------------------------------------------
// A due settlement of the player's own war (AI/peaceOffer.js, runtime/peaceOffer.js):
// offered on the turn, then accepted or declined here. Neither call costs a request.
export const acceptPeaceOffer = async (...args) => (await gameplay()).acceptPeaceOffer(...args);
export const declinePeaceOffer = async (...args) => (await gameplay()).declinePeaceOffer(...args);
```

- [ ] **Step 7: Run the guard and the syntax check**

Run: `node --test "src/Game/AI/peaceOfferWiringArchitecture.test.js"`
Expected: PASS.

Run: `node --check src/Game/AI/gameplay.js && node --check src/Game/AI/peaceOffer.js`
Expected: no output.

- [ ] **Step 8: Run the AI glob**

Run: `node --test "src/Game/AI/*.test.js"`
Expected: PASS, no regressions.

- [ ] **Step 9: Commit**

```bash
git add src/Game/AI/gameplay.js src/Game/AI/gameplayLazy.js src/Game/AI/peaceOfferWiringArchitecture.test.js
git commit -m "feat(ai): offer, accept and decline the player peace"
```

---

### Task 6: The panel

**Files:**
- Create: `src/Game/GameUI/peaceOffer.jsx`
- Modify: `src/Game/GameUI/main.jsx`

**Interfaces:**
- Consumes: `world.peaceOffer` and the lazy `acceptPeaceOffer`/`declinePeaceOffer`.
- Produces: a lazy-mounted modal that renders nothing when there is no offer.

- [ ] **Step 1: Write the panel**

Create `src/Game/GameUI/peaceOffer.jsx`:

```jsx
/*! Open Historia - the peace the engine offers the player (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The terms settleWar derived for one of the player's own wars, shown for a
// plain accept or decline. No narration and no request: the engine decided the
// terms, the player decides whether to take them.
import React, { useState } from "react";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { acceptPeaceOffer, declinePeaceOffer } from "../AI/gameplayLazy.js";

const termsOf = (offer) => {
  if (!offer) return [];
  const others = (offer.belligerents ?? []).filter(Boolean).join(", ");
  const lines = [`The war ${offer.warId} against ${others || "the other side"}:`];
  if (offer.white) lines.push("A white peace: no land and no reparations change hands.");
  for (const transfer of offer.transfers ?? []) {
    lines.push(`${transfer.regionId} passes from ${transfer.fromCode || "the loser"} to ${transfer.toCode || "the victor"}.`);
  }
  const { manpower = 0, materiel = 0 } = offer.reparations ?? {};
  if (manpower || materiel) {
    lines.push(`Reparations of ${manpower} manpower and ${materiel} materiel are paid.`);
  }
  if (offer.punitive && offer.white === false) lines.push("The terms are punitive.");
  return lines;
};

const backdrop = { background: "rgba(0,0,0,0.55)", inset: 0, position: "fixed", zIndex: 10001 };
const panel = {
  background: "rgba(18,18,22,0.97)",
  border: "1px solid rgba(250,204,21,0.38)",
  borderRadius: "16px",
  color: "white",
  fontFamily: "var(--oh-font-ui)",
  left: "50%",
  maxWidth: "34rem",
  padding: "1.1rem 1.2rem",
  position: "fixed",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: "calc(100vw - 2rem)",
  zIndex: 10002,
};
const button = (primary, disabled) => ({
  background: primary ? "#facc15" : "rgba(255,255,255,0.06)",
  border: primary ? "none" : "1px solid rgba(255,255,255,0.16)",
  borderRadius: "10px",
  color: primary ? "#1c1917" : "rgba(255,255,255,0.85)",
  cursor: disabled ? "default" : "pointer",
  fontFamily: "inherit",
  fontSize: "0.82rem",
  fontWeight: 800,
  padding: "0.6rem 1rem",
});

export const PeaceOfferPanel = () => {
  const offer = useRuntimeState("world", (world) => world?.peaceOffer ?? null);
  const [busy, setBusy] = useState("");
  if (!offer) return null;

  const run = async (label, work) => {
    if (busy) return;
    setBusy(label);
    try {
      await work();
    } catch {
      // The offer is re-read from state; a failed action simply leaves it up.
    } finally {
      setBusy("");
    }
  };

  return (
    <div style={backdrop}>
      <div data-no-translate style={panel}>
        <div style={{ fontSize: "0.95rem", fontWeight: 800, marginBottom: "0.5rem" }}>A peace is offered</div>
        <div style={{ fontSize: "0.84rem", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
          {termsOf(offer).join("\n")}
        </div>
        <div style={{ display: "flex", gap: "0.6rem", justifyContent: "flex-end", marginTop: "0.9rem" }}>
          <button style={button(false, Boolean(busy))} disabled={Boolean(busy)} onClick={() => run("decline", declinePeaceOffer)}>
            Decline
          </button>
          <button style={button(true, Boolean(busy))} disabled={Boolean(busy)} onClick={() => run("accept", acceptPeaceOffer)}>
            Accept
          </button>
        </div>
      </div>
    </div>
  );
};

export default PeaceOfferPanel;
```

- [ ] **Step 2: Mount it in main.jsx**

In `src/Game/GameUI/main.jsx`, add the lazy import beside `LazyInteractivePanel`
(currently `:99-101`):

```jsx
// The peace the engine offers on the player's own war (peaceOffer.jsx).
const LazyPeaceOfferPanel = lazy(() =>
  import("./peaceOffer.jsx").then((module) => ({ default: module.PeaceOfferPanel })),
);
```

Add the runtime subscription beside the other state (near `:247`), following
the file's existing hooks, plus the lazy-load latch:

```jsx
  const hasPeaceOffer = useRuntimeState("world", (world) => Boolean(world?.peaceOffer));
  const [shouldLoadPeaceOffer, setShouldLoadPeaceOffer] = useState(false);
```

and an effect that latches it on:

```jsx
  useEffect(() => {
    if (hasPeaceOffer) setShouldLoadPeaceOffer(true);
  }, [hasPeaceOffer]);
```

Add `import { useRuntimeState } from "../../runtime/useRuntimeState.js";` to the
imports if it is not already there, and render beside the interactive panel
(currently `:583-591`):

```jsx
      {shouldLoadPeaceOffer ? (
        <Suspense fallback={null}>
          <Presence open={hasPeaceOffer}>
            <LazyPeaceOfferPanel />
          </Presence>
        </Suspense>
      ) : null}
```

- [ ] **Step 3: Lint the new file**

Run: `npx eslint src/Game/GameUI/peaceOffer.jsx src/Game/GameUI/main.jsx`
Expected: 0 errors. (Warnings that already exist elsewhere are ignored.)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: exit 0 (the only output may be the existing chunk-size warning).

- [ ] **Step 5: Commit**

```bash
git add src/Game/GameUI/peaceOffer.jsx src/Game/GameUI/main.jsx
git commit -m "feat(ui): show the player peace offer"
```

---

### Task 7: Document the layer

**Files:**
- Modify: `docs/runtime-services.md` (module map near `:9-28`; a new section
  after the settlement-reaction section, which ends near `:304`)

**Interfaces:**
- Consumes: the finished increment.
- Produces: a module-map row and one prose section.

- [ ] **Step 1: Add the module-map row**

In the module map at the top of `docs/runtime-services.md`, add a row for
`src/runtime/peaceOffer.js`, in the same column style as its neighbours:

```
| `peaceOffer.js` | Chooses and normalizes the peace the engine offers the player on their own due war (the interactive-peace increment). |
```

- [ ] **Step 2: Add the section**

After the settlement-reaction section, add:

```markdown
---

## The player's own peace, offered

`src/runtime/warSettlement.js` settles every war the model runs, but a war the
player is a party to is held back. Since the fifteenth increment the adapter no
longer skips those wars: it steps their weariness like any other and, when
`settleWar` says the settlement is due, classifies the result as an `offer`
instead of a settlement. The return shape is
`{ settlements, offers, weariness, unresolved }`. This also fixed a quiet gap:
the old party check ran before the weariness step, so a player's wars never
accumulated exhaustion and no settlement could ever fall due for them.

`src/runtime/peaceOffer.js` chooses the single most pressing offer (highest
`pressure`, ties by the lowest `warId`) and normalizes the stored object. It
imports nothing, so it runs under `node --test`. The chosen offer lives on
`world.peaceOffer`, re-derived every turn; declining clears it and the next turn
offers again.

Accepting is deterministic and costs no AI request. `src/Game/AI/peaceOffer.js`
replays the stored terms exactly where an AI settlement's are applied: the peace
event through `applyEventImpactsToWorld` for the region transfers, the
reparations through `applyWarReparations`, and the ledger end through
`applyWarUpdates`. Declining only clears the offer. The player is never forced
to capitulate: a declined offer leaves the war open even at the capitulation
threshold, a deliberate asymmetry in favour of player agency. The panel is
`src/Game/GameUI/peaceOffer.jsx`.
```

- [ ] **Step 3: Check the added lines are ASCII**

Run: `git diff --unified=0 -- docs/runtime-services.md | rg '^\+' | rg '[^\x00-\x7F]'`
Expected: no output.

- [ ] **Step 4: Check the wiki is still current**

Run: `npm run wiki:check`
Expected: `Wiki is current.`

- [ ] **Step 5: Commit**

```bash
git add docs/runtime-services.md
git commit -m "docs(runtime): document the interactive player peace"
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
