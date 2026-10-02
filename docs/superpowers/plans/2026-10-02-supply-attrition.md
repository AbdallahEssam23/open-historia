# Supply and Attrition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the derived front lines a cost: classify every placed formation as `supplied`, `strained` or `isolated` by walking the control graph back to held home soil, and apply the per-period attrition that follows through the turn's existing unit seam, before the economy advances.

**Architecture:** A pure core `src/engine/supplyAttrition.js` imports the part-one core `./frontLines.js` for contact roles, builds the supply network per owner, and returns per-unit state, loss and collapse plus a summary. A new adapter `src/runtime/supplyAttrition.js` reads the world and the catalog into the core and maps the result to `strength`/`remove` unit ops. `applySimulationResult` in `src/Game/AI/gameplay.js` applies those ops as a board-only synthetic event immediately after the combat reserve cost and before `advanceWorldEconomy`. Nothing new is stored; no currency is created; no panel, prompt or event field changes.

**Tech Stack:** ES modules, `node --test`, no framework, no new dependency.

## Global Constraints

- ASCII only in source and docs. No emoji, no em dash, no middle dot.
- No new `package.json` entry and no new runtime dependency.
- `src/engine/**` must stay free of browser globals and of imports outside the allow list: no `window`, `document`, `localStorage`, `Date.now`, `new Date`, `Math.random`, `fetch`. `src/engine/enginePurity.test.js` enforces this over the whole directory. The allow list permits sibling imports (`./name.js`), so `src/engine/supplyAttrition.js` may import `./frontLines.js` and nothing else.
- No new `world` field, no normalizer change, no migration, no `ENGINE_VERSION` bump. Supply is derived on demand and never stored.
- The runtime adapter must not import any `src/Game/AI/` module.
- Determinism is by plain code-unit comparison (`a < b`), never `localeCompare`. Case folding is `toLowerCase`, never `toLocaleLowerCase`. Never emit an unordered `Map`/`Set` iteration without sorting first.
- Tests are run with a glob, never a bare directory: `node --test "src/engine/*.test.js"`, `node --test "src/runtime/*.test.js"`.
- Commit messages are conventional and do NOT include the `Co-authored-by:` trailer. The `prepare-commit-msg` hook adds it.
- Do not edit an existing test to accommodate a change. Do not modify `src/engine/frontLines.js` or `src/runtime/frontLines.js`; this increment only reads them.
- The spec for this plan is `docs/specs/2026-10-02-supply-attrition-design.md`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/engine/supplyAttrition.js` (new) | The pure derivation: `deriveSupplyAttrition({ wars, units, regions, months })`. Imports only `./frontLines.js`. Holds the rate table. |
| `src/engine/supplyAttrition.test.js` (new) | The pure core's exhaustive cases (state ladder, network walk, home source, period multiplier, collapse, dedupe, determinism). |
| `src/runtime/supplyAttrition.js` (new) | `readSupplyAttrition(world, catalog, { fromDate, toDate })`: the read-only adapter that maps the core to unit ops. Imports `./regionOwners.js`, `../engine/supplyAttrition.js` and `../engine/economyMath.js`. |
| `src/runtime/supplyAttrition.test.js` (new) | The adapter seam over a composite world and catalog. |
| `src/runtime/supplyAttritionWiringArchitecture.test.js` (new) | Source-text guards: the core's single import, the adapter's no-Game/AI rule, the turn ordering, and the board-only synthetic event. |
| `src/Game/AI/gameplay.js` | Import the adapter; run the attrition step after the combat reserve cost and before the economy. |
| `docs/runtime-services.md` | One section describing the derived layer. |

---

### Task 1: The pure supply core

**Files:**
- Create: `src/engine/supplyAttrition.js`
- Create: `src/engine/supplyAttrition.test.js`

**Interfaces:**
- Consumes: `deriveFrontLines({ wars, units, regions }) -> { edges, contested, byWar, regions }` from `./frontLines.js`, where `regions` is an object keyed by region id and each row has `{ controller, roles, warIds }`.
- Produces:
  - `SUPPLY_ATTRITION_RATES: { supplied: 0, strained: 2, isolated: 10 }` (frozen).
  - `SUPPLY_STATES: ["supplied", "strained", "isolated"]` (frozen).
  - `deriveSupplyAttrition({ wars, units, regions, months }) -> { units, summary }` where each unit row is `{ unitId, ownerCode, regionId, state, belligerent, reachable, contact, loss, nextStrength, destroyed }` and `summary` is `{ supplied, strained, isolated, damaged, destroyed }`.
  - Input shapes: `wars: [{ id, status, sideA: [name], sideB: [name] }]`, `units: [{ id, ownerCode, regionId, strength }]`, `regions: [{ id, controller, home, adjacencies: [regionId] }]`, `months` a non-negative integer.

- [ ] **Step 1: Write the failing test**

Create `src/engine/supplyAttrition.test.js`:

```js
// Run: node --test src/engine/supplyAttrition.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { deriveSupplyAttrition, SUPPLY_ATTRITION_RATES } from "./supplyAttrition.js";

const war = (id, status, sideA, sideB) => ({ id, status, sideA, sideB });
const unit = (id, ownerCode, regionId, strength = 100) => ({ id, ownerCode, regionId, strength });
const region = (id, controller, home = controller, adjacencies = []) => ({ id, controller, home, adjacencies });

// r1: French home and source. r2: French-held but not French home (conquered),
// reached from r1. r3: German, hostile neighbour of r2 (a front). r4: German,
// behind r3, so a French unit there is cut off.
const GRAPH = [
  region("r1", "France", "France", ["r2"]),
  region("r2", "France", "Germany", ["r1", "r3"]),
  region("r3", "Germany", "Germany", ["r2", "r4"]),
  region("r4", "Germany", "Germany", ["r3"]),
];
const WAR = [war("w1", "active", ["France"], ["Germany"])];

const byId = (result) => Object.fromEntries(result.units.map((row) => [row.unitId, row]));

test("the rate ladder orders supplied below strained below isolated", () => {
  assert.equal(SUPPLY_ATTRITION_RATES.supplied, 0);
  assert.ok(SUPPLY_ATTRITION_RATES.supplied < SUPPLY_ATTRITION_RATES.strained);
  assert.ok(SUPPLY_ATTRITION_RATES.strained < SUPPLY_ATTRITION_RATES.isolated);
});

test("a home formation with no contact is supplied and loses nothing", () => {
  const result = deriveSupplyAttrition({
    wars: WAR, regions: GRAPH, months: 1,
    units: [unit("u1", "France", "r1")],
  });
  const row = byId(result).u1;
  assert.equal(row.state, "supplied");
  assert.equal(row.reachable, true);
  assert.equal(row.contact, false);
  assert.equal(row.loss, 0);
  assert.equal(row.nextStrength, 100);
  assert.equal(row.destroyed, false);
});

test("a formation on a front is strained", () => {
  const result = deriveSupplyAttrition({
    wars: WAR, regions: GRAPH, months: 1,
    units: [unit("u2", "France", "r2")],
  });
  const row = byId(result).u2;
  assert.equal(row.state, "strained");
  assert.equal(row.reachable, true);
  assert.equal(row.contact, true);
  assert.equal(row.loss, SUPPLY_ATTRITION_RATES.strained);
  assert.equal(row.nextStrength, 98);
});

test("a formation outside the network but adjacent to it is strained", () => {
  const result = deriveSupplyAttrition({
    wars: WAR, regions: GRAPH, months: 1,
    units: [unit("u3", "France", "r3")],
  });
  const row = byId(result).u3;
  assert.equal(row.state, "strained");
  assert.equal(row.reachable, false);
  assert.equal(row.contact, true);
  assert.equal(row.loss, SUPPLY_ATTRITION_RATES.strained);
});

test("a formation cut off from every source is isolated", () => {
  const result = deriveSupplyAttrition({
    wars: WAR, regions: GRAPH, months: 1,
    units: [unit("u4", "France", "r4")],
  });
  const row = byId(result).u4;
  assert.equal(row.state, "isolated");
  assert.equal(row.reachable, false);
  assert.equal(row.contact, false);
  assert.equal(row.loss, SUPPLY_ATTRITION_RATES.isolated);
  assert.equal(row.nextStrength, 90);
});

test("a supplied formation standing on a front is strained", () => {
  const regions = [
    region("r1", "France", "France", ["r2"]),
    region("r2", "Germany", "Germany", ["r1"]),
  ];
  const result = deriveSupplyAttrition({
    wars: WAR, regions, months: 1,
    units: [unit("u1", "France", "r1")],
  });
  assert.equal(byId(result).u1.state, "strained");
});

test("an occupied homeland is not a source, so the army is isolated", () => {
  const regions = [
    region("r1", "Germany", "France", ["r2"]),
    region("r2", "France", "Germany", ["r1"]),
  ];
  const result = deriveSupplyAttrition({
    wars: WAR, regions, months: 1,
    units: [unit("u1", "France", "r2")],
  });
  const row = byId(result).u1;
  assert.equal(row.state, "isolated");
  assert.equal(row.reachable, false);
});

test("a non-belligerent cut off loses nothing", () => {
  const result = deriveSupplyAttrition({
    wars: WAR, regions: GRAPH, months: 1,
    units: [unit("u1", "Spain", "r4")],
  });
  const row = byId(result).u1;
  assert.equal(row.state, "isolated");
  assert.equal(row.belligerent, false);
  assert.equal(row.loss, 0);
  assert.equal(row.destroyed, false);
});

test("a war listing one polity on both sides is degenerate and makes no belligerent", () => {
  const result = deriveSupplyAttrition({
    wars: [war("w1", "active", ["France", "Germany"], ["Germany"])],
    regions: GRAPH,
    months: 1,
    units: [unit("u4", "France", "r4")],
  });
  assert.equal(byId(result).u4.belligerent, false);
  assert.equal(byId(result).u4.loss, 0);
});

test("a blank strength defaults to full and is not destroyed by accident", () => {
  const result = deriveSupplyAttrition({
    wars: WAR, regions: GRAPH, months: 1,
    units: [{ id: "u4", ownerCode: "France", regionId: "r4", strength: "" }],
  });
  const row = byId(result).u4;
  assert.equal(row.nextStrength, 90);
  assert.equal(row.destroyed, false);
});

test("a region id that collides with Object.prototype is safe", () => {
  const regions = [
    region("__proto__", "France", "France", ["r1"]),
    region("r1", "France", "France", ["__proto__"]),
  ];
  const result = deriveSupplyAttrition({
    wars: [], regions, months: 1,
    units: [unit("u1", "France", "__proto__")],
  });
  assert.equal(byId(result).u1.state, "supplied");
});

test("a contested region is contact, and the summary counts the damage", () => {
  const regions = [
    region("r1", "France", "France", ["r2"]),
    region("r2", "Germany", "Germany", ["r1"]),
  ];
  const result = deriveSupplyAttrition({
    wars: WAR, regions, months: 1,
    units: [unit("u1", "France", "r2"), unit("u2", "Germany", "r2")],
  });
  assert.equal(byId(result).u1.contact, true);
  assert.equal(byId(result).u1.state, "strained");
  assert.equal(result.summary.damaged, 2);
});

test("the period multiplies the loss, and zero months costs nothing", () => {
  const at = (months) => byId(deriveSupplyAttrition({
    wars: WAR, regions: GRAPH, months,
    units: [unit("u4", "France", "r4")],
  })).u4;
  assert.equal(at(0).loss, 0);
  assert.equal(at(0).nextStrength, 100);
  assert.equal(at(3).loss, SUPPLY_ATTRITION_RATES.isolated * 3);
  assert.equal(at(3).nextStrength, 70);
});

test("a formation whose strength reaches zero collapses", () => {
  const result = deriveSupplyAttrition({
    wars: WAR, regions: GRAPH, months: 3,
    units: [unit("u4", "France", "r4", 15)],
  });
  const row = byId(result).u4;
  assert.equal(row.loss, 30);
  assert.equal(row.nextStrength, 0);
  assert.equal(row.destroyed, true);
  assert.equal(result.summary.destroyed, 1);
});

test("adjacency listed one way still walks both ways, and a self-adjacency is ignored", () => {
  const regions = [
    region("r1", "France", "France", ["r2", "r1"]),
    // r2 is not a home source (its base owner is Germany); it can only be
    // reached through r1's one-way adjacency, which the walk must mirror.
    region("r2", "France", "Germany", []),
  ];
  const result = deriveSupplyAttrition({
    wars: [], regions, months: 1,
    units: [unit("u1", "France", "r2")],
  });
  assert.equal(byId(result).u1.state, "supplied");
});

test("duplicate unit rows fold by id, first spelling winning", () => {
  const result = deriveSupplyAttrition({
    wars: WAR, regions: GRAPH, months: 1,
    units: [unit("u1", "France", "r4"), unit("u1", "france", "r4")],
  });
  assert.equal(result.units.length, 1);
  assert.equal(result.units[0].ownerCode, "France");
});

test("a unit with no id, owner or known region is skipped", () => {
  const result = deriveSupplyAttrition({
    wars: WAR, regions: GRAPH, months: 1,
    units: [
      unit("", "France", "r1"),
      unit("u1", "", "r1"),
      unit("u2", "France", "unknown"),
      unit("u3", "France", ""),
    ],
  });
  assert.deepEqual(result.units, []);
});

test("empty inputs yield the empty shape, not a throw", () => {
  assert.deepEqual(deriveSupplyAttrition(), {
    units: [],
    summary: { supplied: 0, strained: 0, isolated: 0, damaged: 0, destroyed: 0 },
  });
});

test("the result is order-independent and identical twice", () => {
  const units = [unit("u1", "France", "r1"), unit("u4", "France", "r4"), unit("u3", "France", "r3")];
  const a = deriveSupplyAttrition({ wars: WAR, regions: GRAPH, units, months: 2 });
  const b = deriveSupplyAttrition({ wars: WAR, regions: GRAPH, units, months: 2 });
  assert.deepEqual(a, b);
  const reordered = deriveSupplyAttrition({
    wars: [...WAR].reverse(),
    regions: [...GRAPH].reverse(),
    units: [...units].reverse(),
    months: 2,
  });
  assert.deepEqual(reordered, a);
  assert.deepEqual(a.units.map((row) => row.unitId), ["u1", "u3", "u4"]);
});
```

Run: `node --test src/engine/supplyAttrition.test.js`
Expected: FAIL (the module does not exist).

- [ ] **Step 2: Create the core**

Create `src/engine/supplyAttrition.js`:

```js
// Open Historia - derived supply and attrition (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// A pure read of the map as a graph: for every placed formation, whether a path
// of its own side's ground runs home, and what standing there costs it this
// period. It reads the front-line core for contact roles so a front line and a
// front-line loss can never disagree. It writes nothing and stores nothing.

import { deriveFrontLines } from "./frontLines.js";

const name = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
// Locale-independent, matching frontLines.js: the derivation must be
// byte-identical across machines, unlike the ledger's locale-sensitive fold.
const foldKey = (value) => name(value).toLowerCase();
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Strength points lost per whole month, by supply state. First-draft
// calibration: the tests assert ordering and the period multiplier, never a
// magnitude, exactly as forcePools.js states for its own constants.
export const SUPPLY_ATTRITION_RATES = Object.freeze({
  supplied: 0,
  strained: 2,
  isolated: 10,
});

export const SUPPLY_STATES = Object.freeze(["supplied", "strained", "isolated"]);

const rateFor = (state) => SUPPLY_ATTRITION_RATES[state] ?? 0;

export const deriveSupplyAttrition = ({ wars = [], units = [], regions = [], months = 0 } = {}) => {
  const period = Math.max(0, Math.trunc(Number(months)) || 0);

  // Effective controller and base (home) owner per region, and the undirected
  // neighbourhood. An ownerless row is skipped, matching frontLines.js.
  const controllerOf = new Map();
  const homeOf = new Map();
  for (const region of list(regions)) {
    const id = name(region?.id);
    const controller = name(region?.controller);
    if (!id || !controller) continue;
    controllerOf.set(id, controller);
    homeOf.set(id, name(region?.home));
  }
  const neighbours = new Map();
  for (const id of controllerOf.keys()) neighbours.set(id, new Set());
  for (const region of list(regions)) {
    const id = name(region?.id);
    if (!id || !controllerOf.has(id)) continue;
    for (const raw of list(region?.adjacencies)) {
      const other = name(raw);
      if (!other || other === id || !controllerOf.has(other)) continue;
      neighbours.get(id).add(other);
      neighbours.get(other).add(id);
    }
  }

  // Contact roles are the one front-line derivation over the same graph, so a
  // front line and a front-line loss can never disagree about where contact is.
  const fronts = deriveFrontLines({
    wars,
    units: list(units).map((unit) => ({
      ownerCode: name(unit?.ownerCode),
      regionId: name(unit?.regionId),
    })),
    regions: list(regions).map((region) => ({
      id: name(region?.id),
      controller: name(region?.controller),
      adjacencies: list(region?.adjacencies).map(name).filter(Boolean),
    })),
  });
  const inContact = (regionId) => {
    // fronts.regions is keyed with Object.fromEntries, so an interior region id
    // that collides with Object.prototype ("__proto__", "constructor") would
    // otherwise resolve to an inherited member; an own-property check is the
    // same guard frontLines.js applies when it builds the index.
    if (!Object.hasOwn(fronts.regions, regionId)) return false;
    const row = fronts.regions[regionId];
    return row.roles.includes("front") || row.roles.includes("contested");
  };

  // Belligerents: a polity on a side of at least one active war. A ceasefire or
  // ended war makes none, matching the ledger and the combat adapter. A war
  // that lists one polity on both sides is degenerate: it makes no enemy pair
  // in frontLines and contributes no belligerent here.
  const belligerents = new Set();
  for (const war of list(wars)) {
    if (!war || foldKey(war?.status) !== "active") continue;
    const sideA = list(war?.sideA).map(foldKey).filter(Boolean);
    const sideB = list(war?.sideB).map(foldKey).filter(Boolean);
    if (sideA.some((key) => sideB.includes(key))) continue;
    for (const key of [...sideA, ...sideB]) belligerents.add(key);
  }

  // The supplied network of one owner: the regions it controls reachable from a
  // region it still holds as home. No home source means no network. Cached per
  // owner; the walk is a membership question, so no Set order leaks into output.
  const networkCache = new Map();
  const networkFor = (ownerKey) => {
    if (networkCache.has(ownerKey)) return networkCache.get(ownerKey);
    const reachable = new Set();
    const queue = [];
    for (const [id, controller] of controllerOf) {
      if (foldKey(controller) !== ownerKey) continue;
      if (foldKey(homeOf.get(id)) !== ownerKey) continue;
      reachable.add(id);
      queue.push(id);
    }
    while (queue.length) {
      const id = queue.shift();
      for (const next of neighbours.get(id) ?? []) {
        if (reachable.has(next)) continue;
        if (foldKey(controllerOf.get(next)) !== ownerKey) continue;
        reachable.add(next);
        queue.push(next);
      }
    }
    networkCache.set(ownerKey, reachable);
    return reachable;
  };

  const seenIds = new Set();
  const results = [];
  for (const raw of list(units)) {
    const unitId = name(raw?.id);
    const owner = name(raw?.ownerCode);
    const regionId = name(raw?.regionId);
    if (!unitId || !owner || !regionId) continue;
    if (!controllerOf.has(regionId)) continue;
    if (seenIds.has(unitId)) continue;
    seenIds.add(unitId);

    const ownerKey = foldKey(owner);
    const network = networkFor(ownerKey);
    const reachable = network.has(regionId);
    const contact = inContact(regionId);
    const adjacentToNetwork = !reachable
      && [...(neighbours.get(regionId) ?? [])].some((other) => network.has(other));

    let state = "isolated";
    if (reachable && !contact) state = "supplied";
    else if (reachable || adjacentToNetwork) state = "strained";

    // A unit in the world carries a clamped 0-100 strength. A missing, blank or
    // unparseable value defaults to full, so a malformed row is never destroyed
    // by accident.
    const rawStrength = raw?.strength;
    const parsedStrength = rawStrength === null || rawStrength === undefined || rawStrength === ""
      ? NaN
      : Number(rawStrength);
    const strength = Number.isFinite(parsedStrength) ? Math.max(0, Math.min(100, parsedStrength)) : 100;
    const belligerent = belligerents.has(ownerKey);
    const loss = belligerent ? rateFor(state) * period : 0;
    const nextStrength = Math.max(0, strength - loss);

    results.push({
      unitId,
      ownerCode: owner,
      regionId,
      state,
      belligerent,
      reachable,
      contact,
      loss,
      nextStrength,
      destroyed: loss > 0 && nextStrength <= 0,
    });
  }
  results.sort((a, b) => compare(a.unitId, b.unitId));

  return {
    units: results,
    summary: {
      supplied: results.filter((row) => row.state === "supplied").length,
      strained: results.filter((row) => row.state === "strained").length,
      isolated: results.filter((row) => row.state === "isolated").length,
      damaged: results.filter((row) => row.loss > 0).length,
      destroyed: results.filter((row) => row.destroyed).length,
    },
  };
};
```

- [ ] **Step 3: Run the core test to verify it passes**

Run: `node --test src/engine/supplyAttrition.test.js`
Expected: PASS, every test green.

- [ ] **Step 4: Run the engine group to prove purity still holds**

Run: `node --test "src/engine/*.test.js"`
Expected: PASS, including `enginePurity.test.js` (the new file imports only `./frontLines.js`).

- [ ] **Step 5: Commit**

```bash
git add src/engine/supplyAttrition.js src/engine/supplyAttrition.test.js
git commit -m "feat(engine): derive supply state and attrition from the front graph"
```

---

### Task 2: The runtime adapter

**Files:**
- Create: `src/runtime/supplyAttrition.js`
- Create: `src/runtime/supplyAttrition.test.js`

**Interfaces:**
- Consumes: `deriveSupplyAttrition` from `../engine/supplyAttrition.js`; `monthsBetweenDates(fromDate, toDate) -> integer` from `../engine/economyMath.js`; `regionOwnerName(region, overrides) -> string` from `./regionOwners.js`.
- Produces: `readSupplyAttrition(world, catalog, { fromDate, toDate }) -> { units, ops, summary }` where `ops` is a list of `{ op: "strength", unitId, strength }` or `{ op: "remove", unitId }`, and `summary` is the core's summary plus `opCount`.

- [ ] **Step 1: Write the failing test**

Create `src/runtime/supplyAttrition.test.js`:

```js
// Run: node --test src/runtime/supplyAttrition.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readSupplyAttrition } from "./supplyAttrition.js";

const CATALOG = [
  { id: "r1", name: "Ile-de-France", country: "France", countryCode: "FRA", adjacencies: ["r2", "r3"] },
  { id: "r2", name: "Rheinland", country: "Germany", countryCode: "DEU", adjacencies: ["r1"] },
  { id: "r3", name: "Normandie", country: "France", countryCode: "FRA", adjacencies: ["r1"] },
];

const WORLD = {
  wars: [{ id: "w1", status: "active", sideA: ["France"], sideB: ["Germany"] }],
  units: [
    { id: "u1", ownerCode: "France", regionId: "r1", strength: 100 },
    { id: "u2", ownerCode: "France", regionId: "r3", strength: 100 },
    { id: "u3", ownerCode: "France", regionId: "", strength: 100 },
  ],
};

const byId = (result) => Object.fromEntries(result.units.map((row) => [row.unitId, row]));

test("a one-month span strains the front formation and spares the rear one", () => {
  const result = readSupplyAttrition(WORLD, CATALOG, { fromDate: "2000-01-01", toDate: "2000-01-31" });
  assert.equal(byId(result).u1.state, "strained");
  assert.equal(byId(result).u2.state, "supplied");
  assert.deepEqual(result.ops, [{ op: "strength", unitId: "u1", strength: 98 }]);
  assert.deepEqual(result.summary, {
    supplied: 1, strained: 1, isolated: 0, damaged: 1, destroyed: 0, opCount: 1,
  });
});

test("a zero-month span yields no ops", () => {
  const result = readSupplyAttrition(WORLD, CATALOG, { fromDate: "2000-01-01", toDate: "2000-01-01" });
  assert.deepEqual(result.ops, []);
  assert.equal(result.summary.opCount, 0);
});

test("an ownership override changes control and therefore the state", () => {
  const world = { ...WORLD, regionOwnershipOverrides: { r2: "France" } };
  const result = readSupplyAttrition(world, CATALOG, { fromDate: "2000-01-01", toDate: "2000-01-31" });
  assert.equal(byId(result).u1.state, "supplied");
  assert.deepEqual(result.ops, []);
});

test("a collapsed formation becomes a remove op", () => {
  const world = {
    ...WORLD,
    units: [{ id: "u1", ownerCode: "France", regionId: "r1", strength: 4 }],
  };
  const result = readSupplyAttrition(world, CATALOG, { fromDate: "2000-01-01", toDate: "2000-03-31" });
  assert.deepEqual(result.ops, [{ op: "remove", unitId: "u1" }]);
  assert.equal(result.summary.destroyed, 1);
});

test("the adapter leaves the world and the catalog unmodified", () => {
  const world = structuredClone(WORLD);
  const catalog = structuredClone(CATALOG);
  readSupplyAttrition(world, catalog, { fromDate: "2000-01-01", toDate: "2000-03-31" });
  assert.deepEqual(world, WORLD);
  assert.deepEqual(catalog, CATALOG);
});
```

Run: `node --test src/runtime/supplyAttrition.test.js`
Expected: FAIL (the module does not exist).

- [ ] **Step 2: Create the adapter**

Create `src/runtime/supplyAttrition.js`:

```js
// Open Historia - the supply and attrition adapter (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// Reads the world and the catalog into the pure core's plain inputs and maps
// the result to the unit ops the turn already applies. Read-only: it writes
// nothing, charges no reserve, and imports no Game/AI module.

import { deriveSupplyAttrition } from "../engine/supplyAttrition.js";
import { monthsBetweenDates } from "../engine/economyMath.js";
import { regionOwnerName } from "./regionOwners.js";

const name = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);

export const readSupplyAttrition = (world, catalog, { fromDate = "", toDate = "" } = {}) => {
  const overrides = world?.regionOwnershipOverrides;
  const wars = list(world?.wars).map((war) => ({
    id: name(war?.id),
    status: name(war?.status),
    sideA: list(war?.sideA).map(name).filter(Boolean),
    sideB: list(war?.sideB).map(name).filter(Boolean),
  }));
  const units = list(world?.units).map((unit) => ({
    id: name(unit?.id),
    ownerCode: name(unit?.ownerCode),
    regionId: name(unit?.regionId),
    // Passed through raw: the core owns the 0-100 clamp and the full-strength
    // default, so a blank or missing value is not read as zero here.
    strength: unit?.strength,
  }));
  const regions = list(catalog)
    .map((row) => ({
      id: name(row?.id),
      controller: regionOwnerName(row, overrides),
      // The home owner ignores overrides: supply flows from soil the polity
      // still holds as its own, not from whatever it happens to occupy.
      home: regionOwnerName(row, {}),
      adjacencies: list(row?.adjacencies).map(name).filter(Boolean),
    }))
    .filter((region) => region.id);

  const result = deriveSupplyAttrition({
    wars,
    units,
    regions,
    // The same whole-month step the economy uses, so a one-day turn is a
    // zero-month turn and a time skip wears a pocket down month by month.
    months: Math.max(0, monthsBetweenDates(fromDate, toDate)),
  });

  const ops = [];
  for (const unit of result.units) {
    if (unit.destroyed) ops.push({ op: "remove", unitId: unit.unitId });
    else if (unit.loss > 0) ops.push({ op: "strength", unitId: unit.unitId, strength: unit.nextStrength });
  }

  return { units: result.units, ops, summary: { ...result.summary, opCount: ops.length } };
};
```

- [ ] **Step 3: Run the adapter test to verify it passes**

Run: `node --test src/runtime/supplyAttrition.test.js`
Expected: PASS, every test green.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/supplyAttrition.js src/runtime/supplyAttrition.test.js
git commit -m "feat(runtime): read supply attrition from the world"
```

---

### Task 3: Wire the attrition step into the turn

**Files:**
- Modify: `src/Game/AI/gameplay.js` (add the adapter import beside the other `runtime/` imports near line 32; add the event-id constant near `RESEARCH_EVENT_ID` at line 1418; insert the step after `applyCombatReserveCost(impactedWorld, engagementOutcome.reserveCost);` at line 6781)
- Create: `src/runtime/supplyAttritionWiringArchitecture.test.js`

**Interfaces:**
- Consumes: `readSupplyAttrition(world, catalog, { fromDate, toDate })` from Task 2; the existing `applyEventImpactsToWorld({ colors, events, world, engineSourced, boardOnlyEventIds })` and `logDebugEvent(category, message, detail)` already imported by `gameplay.js`; `getPrimedScenarioRegionCatalog()` already imported (line 168).
- Produces: no exported symbol; the turn now applies attrition unit ops.

- [ ] **Step 1: Write the failing wiring test**

Create `src/runtime/supplyAttritionWiringArchitecture.test.js`:

```js
// Run: node --test src/runtime/supplyAttritionWiringArchitecture.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
const adapter = readFileSync(new URL("./supplyAttrition.js", import.meta.url), "utf8");
const core = readFileSync(new URL("../engine/supplyAttrition.js", import.meta.url), "utf8");

test("the supply core imports only the front-line sibling", () => {
  const specifiers = [...core.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(specifiers, ["./frontLines.js"]);
});

test("the adapter imports no Game/AI module", () => {
  const specifiers = [...adapter.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(specifiers.some((specifier) => specifier.includes("Game/AI")), false);
});

test("the turn attrits after the battles and before the economy", () => {
  const reserveAt = gameplay.indexOf("applyCombatReserveCost(impactedWorld");
  const supplyAt = gameplay.indexOf("readSupplyAttrition(impactedWorld");
  const economyAt = gameplay.indexOf("advanceWorldEconomy(nextWorld");
  assert.ok(reserveAt > 0 && supplyAt > 0 && economyAt > 0, "a supply seam is missing");
  assert.ok(reserveAt < supplyAt, "attrition must run after the combat reserve cost");
  assert.ok(supplyAt < economyAt, "attrition must run before the economy advances");
});

test("the turn applies the attrition ops as a board-only synthetic event", () => {
  assert.ok(gameplay.indexOf("SUPPLY_ATTRITION_EVENT_ID") > 0, "the event id is missing");
  assert.match(gameplay, /boardOnlyEventIds: \[SUPPLY_ATTRITION_EVENT_ID\]/);
  assert.match(gameplay, /impacts: \{ unitOps: supply\.ops \}/);
});
```

Run: `node --test src/runtime/supplyAttritionWiringArchitecture.test.js`
Expected: FAIL (the wiring is not present).

- [ ] **Step 2: Add the adapter import**

In `src/Game/AI/gameplay.js`, immediately after the `warSettlement.js` import block (which ends with `} from "../../runtime/warSettlement.js";` near line 32), add:

```js
import { readSupplyAttrition } from "../../runtime/supplyAttrition.js";
```

- [ ] **Step 3: Add the event id constant**

In `src/Game/AI/gameplay.js`, next to `const RESEARCH_EVENT_ID = "engine-research";` (line 1418), add:

```js
// The board-only carrier for supply attrition, beside the research carrier.
const SUPPLY_ATTRITION_EVENT_ID = "engine-supply-attrition";
```

- [ ] **Step 4: Insert the attrition step**

In `src/Game/AI/gameplay.js`, find these three consecutive lines (near line 6779):

```js
  let nextColors = impactMerge.colors;
  let impactedWorld = impactMerge.world;
  impactedWorld = applyCombatReserveCost(impactedWorld, engagementOutcome.reserveCost);
```

Insert the block below immediately after the `applyCombatReserveCost` line:

```js
  // Supply attrition: a formation worn down by standing on a front or cut off
  // behind one. It runs on the world the battles have already reshaped and
  // BEFORE the economy, so this period's readiness loss is in the roster the
  // economy reads. The ops travel the one unit path as a board-only synthetic
  // event, exactly as the production completions do: the engine owns the loss,
  // the map shows it, and no narrative event is written. A failure here must
  // never lose a completed turn; a skipped period is lost, not repaired later.
  try {
    const supply = readSupplyAttrition(impactedWorld, getPrimedScenarioRegionCatalog() ?? [], {
      fromDate: baseGame.gameDate || "",
      toDate: nextGame.gameDate || "",
    });
    if (supply.ops.length) {
      const applied = applyEventImpactsToWorld({
        colors: nextColors,
        events: [{
          id: SUPPLY_ATTRITION_EVENT_ID,
          date: nextGame.gameDate || "",
          title: "Supply attrition",
          description: "",
          impacts: { unitOps: supply.ops },
        }],
        world: impactedWorld,
        engineSourced: true,
        boardOnlyEventIds: [SUPPLY_ATTRITION_EVENT_ID],
      });
      impactedWorld = applied.world;
      nextColors = applied.colors;
      logDebugEvent("turn", `Supply attrition wore down ${supply.summary.damaged} formation(s), ${supply.summary.destroyed} lost.`, {
        supplied: supply.summary.supplied,
        strained: supply.summary.strained,
        isolated: supply.summary.isolated,
      });
    }
  } catch (error) {
    console.warn("[engine] the supply attrition step failed; the completed turn is preserved.", error);
  }
```

- [ ] **Step 5: Run the wiring test to verify it passes**

Run: `node --test src/runtime/supplyAttritionWiringArchitecture.test.js`
Expected: PASS, all four tests green.

- [ ] **Step 6: Prove the module still parses and the runtime group is green**

Run: `node --check src/Game/AI/gameplay.js`
Expected: no output (it parses).

Run: `node --test "src/runtime/*.test.js"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/Game/AI/gameplay.js src/runtime/supplyAttritionWiringArchitecture.test.js
git commit -m "feat(runtime): apply supply attrition in the turn"
```

---

### Task 4: Document the layer

**Files:**
- Modify: `docs/runtime-services.md` (add a section after the `## Front lines` section at line 54-76, before the `---` and `## Library store` at line 79)

**Interfaces:**
- Consumes: nothing at runtime; written from the shipped code of Tasks 1-3.
- Produces: prose only.

- [ ] **Step 1: Add the section**

Insert the block below after the Front lines section (after the line ending "into its plain inputs."). Keep it ASCII and match the surrounding prose style (no ASCII bullet lists):

```markdown
## Supply and attrition - `src/runtime/supplyAttrition.js`

`readSupplyAttrition(world, catalog, { fromDate, toDate })` derives which
formations are in supply and the attrition they take this period, as a pure read
that is then applied through the turn's existing unit-op seam. It reads the
front-line derivation of part one (`src/engine/frontLines.js`) for contact, so a
front line and a front-line loss can never disagree. The pure core is
`src/engine/supplyAttrition.js`.

- **The supplied network** of a polity is the set of regions it controls that
  can be reached from a region it still holds as its own home (the catalog's
  base owner, ignoring overrides, that the polity still controls). A polity
  whose homeland is entirely occupied has no source, so no network.
- **The state ladder** assigns each placed formation exactly one state:
  `supplied` when its region is in the network and in no contact; `strained`
  when it is in the network and on a front or contested region, or when it is
  outside the network but adjacent to it; `isolated` otherwise.
- **Attrition** is a rate per whole month, applied only to a belligerent (a
  polity on a side of an `active` war): `supplied` loses nothing, `strained`
  loses `SUPPLY_ATTRITION_RATES.strained` points, and `isolated` loses
  `SUPPLY_ATTRITION_RATES.isolated`. The period is the same whole-month step the
  economy uses, so a one-day turn costs nothing and a time skip costs a long
  siege. A formation whose strength reaches zero is removed.
- **The turn** applies the losses in `applySimulationResult`, after the combat
  reserve cost and before `advanceWorldEconomy`, as a board-only synthetic
  event: the engine owns the loss, the map shows it, and no narrative event is
  written. Supply is derived on demand and never stored, so there is no `world`
  field, no normalizer and no migration.
```

- [ ] **Step 2: Verify the wiki is still current**

`public/wiki/**` is generated from `wiki/**` only (`scripts/build-wiki.mjs` never
reads `docs/`), so this service-doc increment adds no wiki page. This matches the
front-lines precedent dfa64c0, which also changed `docs/runtime-services.md`
alone.

Run: `npm run build:wiki`
Expected: completes; no `public/wiki/**` diff (a verified no-op).

Run: `npm run wiki:check`
Expected: `Wiki is current.`

- [ ] **Step 3: Commit**

```bash
git add docs/runtime-services.md
git commit -m "docs(runtime): record the supply and attrition layer"
```

---

### Task 5: Acceptance gate

**Files:**
- No source change. This task verifies Tasks 1-4 as a whole and reports.

**Interfaces:**
- Consumes: the whole branch.
- Produces: a pass/fail report; no commit unless a gate fails and needs a fix.

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: zero failures. There are two known `todo` entries; that is expected.

- [ ] **Step 2: Run the focused groups**

Run: `node --test "src/engine/*.test.js"`
Expected: PASS, including `enginePurity.test.js`.

Run: `node --test "src/runtime/*.test.js"`
Expected: PASS, including the new adapter and wiring guards.

- [ ] **Step 3: Lint the changed files**

Run: `npx eslint src/engine/supplyAttrition.js src/engine/supplyAttrition.test.js src/runtime/supplyAttrition.js src/runtime/supplyAttrition.test.js src/runtime/supplyAttritionWiringArchitecture.test.js src/Game/AI/gameplay.js`
Expected: 0 errors. Pre-existing warnings in `gameplay.js` unrelated to this change are acceptable; report them if present.

- [ ] **Step 4: Build and wiki currency**

Run: `npm run build`
Expected: exit 0.

Run: `npm run wiki:check`
Expected: `Wiki is current.`

- [ ] **Step 5: Verify the slice**

Confirm each of the following and report the evidence:

- `git log --oneline -4` lists exactly the four slice commits, in order: `feat(engine): derive supply state and attrition from the front graph`, `feat(runtime): read supply attrition from the world`, `feat(runtime): apply supply attrition in the turn`, `docs(runtime): record the supply and attrition layer`.
- Every slice commit carries the `Co-authored-by: monkeycode-ai` trailer added by the hook.
- No new `world` field, no `ENGINE_VERSION` change and no `package.json` change: `git diff HEAD~4..HEAD -- src/runtime/gameState.js package.json` is empty.
- `src/engine/supplyAttrition.js` has exactly one import (`./frontLines.js`).
- `src/runtime/supplyAttrition.js` contains no `Game/AI` reference.

- [ ] **Step 6: Report**

Write a short pass/fail report to `.superpowers/sdd/slice-7b-gate.md` (the ignored SDD directory, so the gate adds no slice commit) with the exact commands, counts and any pre-existing warnings. Do not commit this report.
