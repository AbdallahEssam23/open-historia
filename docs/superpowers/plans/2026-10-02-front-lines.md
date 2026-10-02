# Front Lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive the operational shape of the active wars: the hostile borders between adjacent regions and the contested regions where enemy units stand together, as a pure, order-independent read with no stored state and no world mutation.

**Architecture:** A new pure core `src/engine/frontLines.js` turns active wars, effective region control and region adjacency into `edges`, `contested`, `byWar` and a per-region index. A new read-only adapter `src/runtime/frontLines.js` reads the world and the catalog into the core's plain inputs. Because the runtime adapter must not import `src/Game/AI/`, the one definition of effective control (`regionOwnerName`) is first moved to `src/runtime/regionOwners.js` and re-exported by `regionVocab.js`. Nothing is written, nothing is persisted, and no turn, prompt or panel changes.

**Tech Stack:** ES modules, `node --test`, no framework, no new dependency.

## Global Constraints

- ASCII only in source and docs. No emoji, no em dash, no middle dot.
- No new `package.json` entry and no new runtime dependency.
- `src/engine/**` must stay free of browser globals and of imports outside the allow list: no `window`, `document`, `localStorage`, `Date.now`, `new Date`, `Math.random`, `fetch`. `src/engine/enginePurity.test.js` enforces this over the whole directory. `src/engine/frontLines.js` must import nothing at all.
- No new `world` field, no normalizer change, no migration, no `ENGINE_VERSION` bump. The layer is derived on demand and never stored.
- Determinism is by plain code-unit comparison (`a < b`), never `localeCompare`. Never emit an unordered `Map`/`Set` iteration without sorting first.
- Tests are run with a glob, never a bare directory: `node --test "src/engine/*.test.js"`, `node --test "src/runtime/*.test.js"`.
- Commit messages are conventional and do NOT include the `Co-authored-by:` trailer. The `prepare-commit-msg` hook adds it.
- Do not edit an existing test to accommodate a change. `src/Game/AI/regionVocab.test.js` must keep passing unchanged through the Task 1 move.
- The spec for this plan is `docs/specs/2026-10-02-front-lines-design.md`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/runtime/regionOwners.js` (new) | The one definition of effective region control: `regionOwnerName(region, overrides)`. Import-free except `./ownerNames.js`. |
| `src/runtime/regionOwners.test.js` (new) | The dedicated cases for `regionOwnerName` (override, base country, legacy code, null safety). |
| `src/Game/AI/regionVocab.js` | Drops the local `regionOwnerName` definition; imports it from the new module and re-exports it, so `forcePosture.js` and the existing test are unchanged. |
| `src/engine/frontLines.js` (new) | The pure derivation: `deriveFrontLines({ wars, units, regions })`. Imports nothing. |
| `src/engine/frontLines.test.js` (new) | The pure core's exhaustive cases (pairing, wars, contested, ordering, dedupe, determinism). |
| `src/runtime/frontLines.js` (new) | `readFrontLines(world, catalog)`: the read-only adapter. Imports `./regionOwners.js` and `../engine/frontLines.js` only. |
| `src/runtime/frontLines.test.js` (new) | The adapter seam over a composite world and catalog. |
| `docs/runtime-services.md` | One section describing the derived layer. |

---

### Task 1: Extract the shared owner read

**Files:**
- Create: `src/runtime/regionOwners.js`
- Create: `src/runtime/regionOwners.test.js`
- Modify: `src/Game/AI/regionVocab.js` (remove the local definition at lines 42-60; add the import and the re-export)

**Interfaces:**
- Produces: `regionOwnerName(region, overrides) -> string` from `src/runtime/regionOwners.js`. Returns the full country name: an override wins, else the catalog's `country`, else `countryCode`, canonicalized through `toCountryName`; an absent region or a value matching nothing is `""`.
- `src/Game/AI/regionVocab.js` re-exports the same binding, so `import { regionOwnerName } from "./regionVocab.js"` keeps working for `forcePosture.js` and `regionVocab.test.js`.

- [ ] **Step 1: Write the failing test**

Create `src/runtime/regionOwners.test.js`:

```js
// Run: node --test src/runtime/regionOwners.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { regionOwnerName } from "./regionOwners.js";

const CATALOG = [
  { id: "FRA.1_1", name: "Bourgogne", country: "France", countryCode: "FRA" },
  { id: "DEU.1_1", name: "Bayern", country: "Germany", countryCode: "DEU" },
];

test("an override wins over the base country, as the full name", () => {
  assert.equal(regionOwnerName(CATALOG[1], { "DEU.1_1": "FRA" }), "France");
});

test("with no override the base country name is used", () => {
  assert.equal(regionOwnerName(CATALOG[0], {}), "France");
});

test("a missing country falls back to the country code name", () => {
  assert.equal(regionOwnerName({ id: "X", name: "X", countryCode: "ESP" }, {}), "Spain");
});

test("a region with no owner resolves to empty, never a throw", () => {
  assert.equal(regionOwnerName(undefined, {}), "");
  assert.equal(regionOwnerName({ id: "O", name: "Ocean" }, null), "");
});
```

Run: `node --test src/runtime/regionOwners.test.js`
Expected: FAIL (the module does not exist).

- [ ] **Step 2: Create the module with the moved definition**

Create `src/runtime/regionOwners.js`:

```js
// Open Historia - effective region control (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// One definition of who actually controls a region, shared by the prompt
// vocabulary and the derived front-line layer so the two can never disagree.
// It lives in runtime rather than Game/AI because runtime modules must not
// import the AI layer.

import { toCountryName } from "./ownerNames.js";

const norm = (value) => String(value ?? "").trim();

// The in-game owner of a region, ALWAYS as the full country name ("Spain"): an
// explicit override wins, else the base country from the catalog (so stock maps
// report real ownership, not ""). A legacy override still holding a code is
// canonicalised here rather than handed on.
export const regionOwnerName = (region, overrides) => {
  const override = norm(overrides?.[region?.id]);
  if (override) return toCountryName(override);
  return norm(region?.country) || toCountryName(norm(region?.countryCode));
};
```

- [ ] **Step 3: Rewire regionVocab.js**

In `src/Game/AI/regionVocab.js`, replace the `toCountryName` import on line 42 with the import below, then delete only the `regionOwnerName` comment block and const (currently lines 47-60). **Keep the `norm` and `lower` helpers on lines 44-45 and `groupByOwner`** — they are used by the rest of the file and must not be removed. Add the re-export beside the import:

```js
import { regionOwnerName } from "../../runtime/regionOwners.js";

export { regionOwnerName };
```

`groupByOwner` calls `regionOwnerName(region, overrides)` in the same scope, so no other line changes. After the edit the top of the file reads: the single `regionOwnerName` import, the `export { regionOwnerName };` line, `const norm = ...`, `const lower = ...`, then `regionOwnerName` is no longer defined locally.

- [ ] **Step 4: Run the tests**

Run: `node --test src/runtime/regionOwners.test.js`
Expected: PASS.

Run: `node --test src/Game/AI/regionVocab.test.js`
Expected: PASS, with the file unchanged.

Run: `node --test "src/runtime/*.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/regionOwners.js src/runtime/regionOwners.test.js src/Game/AI/regionVocab.js
git commit -m "refactor(runtime): share the effective region owner read"
```

---

### Task 2: The pure front-line core

**Files:**
- Create: `src/engine/frontLines.js`
- Test: `src/engine/frontLines.test.js`

**Interfaces:**
- Consumes: nothing (the module imports nothing).
- Produces: `deriveFrontLines({ wars, units, regions })` where
  - `wars`: `[{ id, status, sideA: [name], sideB: [name] }]`,
  - `units`: `[{ ownerCode, regionId }]`,
  - `regions`: `[{ id, controller, adjacencies: [regionId] }]`,

  returning

  ```
  {
    edges:     [{ regionA, regionB, polityA, polityB, warIds: [warId] }],
    contested: [{ regionId, warId, controller, sideA: [polity], sideB: [polity] }],
    byWar:     [{ warId, sideA: [polity], sideB: [polity], edges: [[regionA, regionB]], contested: [regionId] }],
    regions:   { [regionId]: { controller, roles: ["contested" | "front"], warIds: [warId] } },
  }
  ```

  `edges` is sorted by `(regionA, regionB)` with `regionA < regionB`; `contested` by `(regionId, warId)`; `byWar` by `warId`; `regions[].roles` and `regions[].warIds` are code-unit sorted and deduped. A war that is not `active` contributes nothing. A malformed entry is skipped, never thrown on. An empty input returns `{ edges: [], contested: [], byWar: [], regions: {} }`.

- [ ] **Step 1: Write the failing test**

Create `src/engine/frontLines.test.js`:

```js
// Run: node --test src/engine/frontLines.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { deriveFrontLines } from "./frontLines.js";

const region = (id, controller, adjacencies = []) => ({ id, controller, adjacencies });
const war = (id, status, sideA, sideB) => ({ id, status, sideA, sideB });
const unit = (ownerCode, regionId) => ({ ownerCode, regionId });

test("an empty input returns the empty shape, not a throw", () => {
  assert.deepEqual(deriveFrontLines(), { edges: [], contested: [], byWar: [], regions: {} });
  assert.deepEqual(deriveFrontLines({}), { edges: [], contested: [], byWar: [], regions: {} });
});

test("one hostile border between two adjacent regions", () => {
  const result = deriveFrontLines({
    wars: [war("w1", "active", ["France"], ["Germany"])],
    units: [],
    regions: [region("r1", "France", ["r2"]), region("r2", "Germany", ["r1"])],
  });
  assert.deepEqual(result.edges, [
    { regionA: "r1", regionB: "r2", polityA: "France", polityB: "Germany", warIds: ["w1"] },
  ]);
});

test("two polities on the same side are not enemies", () => {
  const result = deriveFrontLines({
    wars: [war("w1", "active", ["France", "Britain"], ["Germany"])],
    units: [],
    regions: [region("r1", "France", ["r2"]), region("r2", "Britain", ["r1"])],
  });
  assert.deepEqual(result.edges, []);
});

test("a ceasefire or an ended war makes no front", () => {
  for (const status of ["ceasefire", "ended"]) {
    const result = deriveFrontLines({
      wars: [war("w1", status, ["France"], ["Germany"])],
      units: [],
      regions: [region("r1", "France", ["r2"]), region("r2", "Germany", ["r1"])],
    });
    assert.deepEqual(result.edges, [], `${status} still made an edge`);
  }
});

test("two active wars hostile across one pair carry both ids, sorted", () => {
  const result = deriveFrontLines({
    wars: [
      war("w2", "active", ["France"], ["Germany"]),
      war("w1", "active", ["France"], ["Germany"]),
    ],
    units: [],
    regions: [region("r1", "France", ["r2"]), region("r2", "Germany", ["r1"])],
  });
  assert.deepEqual(result.edges[0].warIds, ["w1", "w2"]);
});

test("a third polity on a neighbouring region is not a front", () => {
  const result = deriveFrontLines({
    wars: [war("w1", "active", ["France"], ["Germany"])],
    units: [],
    regions: [
      region("r1", "France", ["r2"]),
      region("r2", "Spain", ["r1", "r3"]),
      region("r3", "Germany", ["r2"]),
    ],
  });
  assert.deepEqual(result.edges, []);
});

test("a region with units of two enemies is contested", () => {
  const result = deriveFrontLines({
    wars: [war("w1", "active", ["France"], ["Germany"])],
    units: [unit("France", "r1"), unit("Germany", "r1")],
    regions: [region("r1", "Germany")],
  });
  assert.deepEqual(result.contested, [
    { regionId: "r1", warId: "w1", controller: "Germany", sideA: ["France"], sideB: ["Germany"] },
  ]);
});

test("units of one side only do not contest a region", () => {
  const result = deriveFrontLines({
    wars: [war("w1", "active", ["France"], ["Germany"])],
    units: [unit("France", "r1"), unit("France", "r1")],
    regions: [region("r1", "France")],
  });
  assert.deepEqual(result.contested, []);
});

test("a region that is both a front and contested carries both roles", () => {
  const result = deriveFrontLines({
    wars: [war("w1", "active", ["France"], ["Germany"])],
    units: [unit("France", "r2"), unit("Germany", "r2")],
    regions: [region("r1", "France", ["r2"]), region("r2", "Germany", ["r1"])],
  });
  assert.deepEqual(result.edges.map((edge) => [edge.regionA, edge.regionB]), [["r1", "r2"]]);
  assert.equal(result.regions.r2.controller, "Germany");
  assert.deepEqual(result.regions.r2.roles, ["contested", "front"]);
  assert.deepEqual(result.regions.r2.warIds, ["w1"]);
});

test("adjacency is symmetric and a self-adjacency is ignored", () => {
  const result = deriveFrontLines({
    wars: [war("w1", "active", ["France"], ["Germany"])],
    units: [],
    regions: [region("r1", "France", ["r1"]), region("r2", "Germany", ["r1"])],
  });
  assert.deepEqual(result.edges, [
    { regionA: "r1", regionB: "r2", polityA: "France", polityB: "Germany", warIds: ["w1"] },
  ]);
});

test("duplicate adjacency, unit and war entries are deduped", () => {
  const result = deriveFrontLines({
    wars: [
      war("w1", "active", ["France"], ["Germany"]),
      war("w1", "active", ["France"], ["Germany"]),
    ],
    units: [unit("France", "r1"), unit("France", "r1")],
    regions: [region("r1", "France", ["r2", "r2"]), region("r2", "Germany", ["r1"])],
  });
  assert.deepEqual(result.edges[0].warIds, ["w1"]);
  assert.deepEqual(result.byWar.map((entry) => entry.warId), ["w1"]);
});

test("a unit with no region never contests a region", () => {
  const result = deriveFrontLines({
    wars: [war("w1", "active", ["France"], ["Germany"])],
    units: [unit("France", ""), unit("Germany", "")],
    regions: [region("r1", "France")],
  });
  assert.deepEqual(result.contested, []);
});

test("the derivation is byte-for-byte deterministic and order-independent", () => {
  const input = {
    wars: [war("w1", "active", ["France"], ["Germany"])],
    units: [unit("France", "r2"), unit("Germany", "r2"), unit("France", "r1")],
    regions: [
      region("r1", "France", ["r2"]),
      region("r2", "Germany", ["r1", "r3"]),
      region("r3", "Spain", ["r2"]),
    ],
  };
  const reversed = {
    wars: [...input.wars].reverse(),
    units: [...input.units].reverse(),
    regions: [...input.regions].reverse(),
  };
  assert.equal(JSON.stringify(deriveFrontLines(input)), JSON.stringify(deriveFrontLines(input)));
  assert.equal(JSON.stringify(deriveFrontLines(input)), JSON.stringify(deriveFrontLines(reversed)));
});
```

Run: `node --test src/engine/frontLines.test.js`
Expected: FAIL (the module does not exist).

- [ ] **Step 2: Implement the core**

Create `src/engine/frontLines.js`:

```js
// Open Historia - derived front lines (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// A pure read of the map as a graph: which adjacent regions are held by two
// enemies in an active war, and where enemy units stand together. It computes
// no losses and writes nothing; it exists so the attrition and supply work has
// one definition of "contact" to read. Imports nothing, so enginePurity holds.

const name = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
// The same folded membership key the war ledger and the combat adapter use.
const foldKey = (value) => name(value).toLocaleLowerCase();
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const dedupe = (values) => {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = foldKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
};

export const deriveFrontLines = ({ wars = [], units = [], regions = [] } = {}) => {
  // Effective controller per region, and the undirected neighbourhood.
  const controllerOf = new Map();
  for (const region of list(regions)) {
    const id = name(region?.id);
    if (id) controllerOf.set(id, name(region?.controller));
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

  // Active wars, and for each polity the active wars it stands in on each side.
  const activeWars = [];
  const sideOfPolity = new Map();
  const bucket = (key, side) => {
    let entry = sideOfPolity.get(key);
    if (!entry) {
      entry = { a: new Set(), b: new Set() };
      sideOfPolity.set(key, entry);
    }
    return entry[side];
  };
  const seenWars = new Set();
  for (const war of list(wars)) {
    const id = name(war?.id);
    if (!id || seenWars.has(id) || foldKey(war?.status) !== "active") continue;
    seenWars.add(id);
    const sideA = dedupe(list(war?.sideA).map(name).filter(Boolean));
    const sideB = dedupe(list(war?.sideB).map(name).filter(Boolean));
    activeWars.push({ id, sideA, sideB });
    for (const polity of sideA) bucket(foldKey(polity), "a").add(id);
    for (const polity of sideB) bucket(foldKey(polity), "b").add(id);
  }
  activeWars.sort((a, b) => compare(a.id, b.id));

  // The active wars in which two controllers are enemies.
  const hostileWars = (a, b) => {
    const ka = foldKey(a);
    const kb = foldKey(b);
    if (!ka || !kb || ka === kb) return [];
    const ea = sideOfPolity.get(ka);
    const eb = sideOfPolity.get(kb);
    if (!ea || !eb) return [];
    const out = new Set();
    for (const id of ea.a) if (eb.b.has(id)) out.add(id);
    for (const id of ea.b) if (eb.a.has(id)) out.add(id);
    return [...out].sort(compare);
  };

  const edges = [];
  for (const regionA of [...controllerOf.keys()].sort(compare)) {
    for (const regionB of neighbours.get(regionA)) {
      if (compare(regionA, regionB) >= 0) continue;
      const polityA = controllerOf.get(regionA);
      const polityB = controllerOf.get(regionB);
      const warIds = hostileWars(polityA, polityB);
      if (!warIds.length) continue;
      edges.push({ regionA, regionB, polityA, polityB, warIds });
    }
  }
  edges.sort((a, b) => compare(a.regionA, b.regionA) || compare(a.regionB, b.regionB));

  // Units by region, deduped to one display spelling per owner.
  const ownersInRegion = new Map();
  for (const unit of list(units)) {
    const regionId = name(unit?.regionId);
    const owner = name(unit?.ownerCode);
    if (!regionId || !owner || !controllerOf.has(regionId)) continue;
    let owners = ownersInRegion.get(regionId);
    if (!owners) {
      owners = new Map();
      ownersInRegion.set(regionId, owners);
    }
    const key = foldKey(owner);
    if (!owners.has(key)) owners.set(key, owner);
  }
  const presentSide = (declared, owners) =>
    declared.map((polity) => owners.get(foldKey(polity))).filter(Boolean);

  const contested = [];
  for (const war of activeWars) {
    for (const [regionId, owners] of ownersInRegion) {
      const sideA = presentSide(war.sideA, owners);
      const sideB = presentSide(war.sideB, owners);
      if (!sideA.length || !sideB.length) continue;
      contested.push({
        regionId,
        warId: war.id,
        controller: controllerOf.get(regionId) ?? "",
        sideA,
        sideB,
      });
    }
  }
  contested.sort((a, b) => compare(a.regionId, b.regionId) || compare(a.warId, b.warId));

  const byWar = [];
  for (const war of activeWars) {
    const warEdges = edges
      .filter((edge) => edge.warIds.includes(war.id))
      .map((edge) => [edge.regionA, edge.regionB]);
    const warContested = contested
      .filter((entry) => entry.warId === war.id)
      .map((entry) => entry.regionId);
    if (!warEdges.length && !warContested.length) continue;
    byWar.push({ warId: war.id, sideA: [...war.sideA], sideB: [...war.sideB], edges: warEdges, contested: warContested });
  }
  byWar.sort((a, b) => compare(a.warId, b.warId));

  const regionsIndex = {};
  const addRole = (regionId, role, warIds) => {
    let row = regionsIndex[regionId];
    if (!row) {
      row = { controller: controllerOf.get(regionId) ?? "", roles: [], warIds: [] };
      regionsIndex[regionId] = row;
    }
    if (!row.roles.includes(role)) row.roles.push(role);
    for (const id of warIds) if (!row.warIds.includes(id)) row.warIds.push(id);
  };
  for (const edge of edges) {
    addRole(edge.regionA, "front", edge.warIds);
    addRole(edge.regionB, "front", edge.warIds);
  }
  for (const entry of contested) addRole(entry.regionId, "contested", [entry.warId]);
  for (const row of Object.values(regionsIndex)) {
    row.roles.sort(compare);
    row.warIds.sort(compare);
  }

  return { edges, contested, byWar, regions: regionsIndex };
};
```

- [ ] **Step 3: Run the test and the engine suite**

Run: `node --test src/engine/frontLines.test.js`
Expected: PASS.

Run: `node --test "src/engine/*.test.js"`
Expected: PASS, including the untouched purity guard.

- [ ] **Step 4: Commit**

```bash
git add src/engine/frontLines.js src/engine/frontLines.test.js
git commit -m "feat(engine): derive front lines from control and adjacency"
```

---

### Task 3: The read-only adapter

**Files:**
- Create: `src/runtime/frontLines.js`
- Test: `src/runtime/frontLines.test.js`

**Interfaces:**
- Consumes: `deriveFrontLines` from `../engine/frontLines.js` (Task 2); `regionOwnerName` from `./regionOwners.js` (Task 1).
- Produces: `readFrontLines(world, catalog) -> { edges, contested, byWar, regions }` (the core's shape), a pure read that never mutates its arguments and never imports anything under `src/Game/AI/`.

- [ ] **Step 1: Write the failing test**

Create `src/runtime/frontLines.test.js`:

```js
// Run: node --test src/runtime/frontLines.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFrontLines } from "./frontLines.js";

const CATALOG = [
  { id: "r1", name: "Ile-de-France", country: "France", countryCode: "FRA", adjacencies: ["r2"] },
  { id: "r2", name: "Rheinland", country: "Germany", countryCode: "DEU", adjacencies: ["r1", "r3"] },
  { id: "r3", name: "Malopolska", country: "Poland", countryCode: "POL", adjacencies: ["r2"] },
  { id: "r4", name: "Tirol", country: "Austria", countryCode: "AUT", adjacencies: [] },
];

const WORLD = {
  wars: [
    { id: "w1", status: "active", sideA: ["France"], sideB: ["Germany"] },
    { id: "w2", status: "active", sideA: ["France"], sideB: ["Poland"] },
    { id: "w3", status: "ended", sideA: ["France"], sideB: ["Austria"] },
  ],
  units: [
    { id: "u1", ownerCode: "France", regionId: "r1" },
    { id: "u2", ownerCode: "Germany", regionId: "r2" },
    { id: "u3", ownerCode: "France", regionId: "r2" },
    { id: "u4", ownerCode: "Poland", regionId: "r3" },
    { id: "u5", ownerCode: "France", regionId: "" },
  ],
  regionOwnershipOverrides: {},
};

test("the adapter derives the fronts of a composite world", () => {
  const result = readFrontLines(WORLD, CATALOG);
  assert.deepEqual(result.edges, [
    { regionA: "r1", regionB: "r2", polityA: "France", polityB: "Germany", warIds: ["w1"] },
  ]);
  assert.deepEqual(result.contested, [
    { regionId: "r2", warId: "w1", controller: "Germany", sideA: ["France"], sideB: ["Germany"] },
  ]);
  assert.deepEqual(result.byWar, [
    {
      warId: "w1",
      sideA: ["France"],
      sideB: ["Germany"],
      edges: [["r1", "r2"]],
      contested: ["r2"],
    },
  ]);
  assert.deepEqual(result.regions.r2, { controller: "Germany", roles: ["contested", "front"], warIds: ["w1"] });
});

test("an ownership override changes the effective controller", () => {
  const world = { ...WORLD, regionOwnershipOverrides: { r3: "Germany" } };
  const result = readFrontLines(world, CATALOG);
  // r2 Germany now borders r3 Germany (same owner, no edge), and r1 France still
  // borders r2 Germany. The override moved Poland's region to Germany and left
  // the one front unchanged.
  assert.deepEqual(result.edges.map((edge) => [edge.regionA, edge.regionB]), [["r1", "r2"]]);
  assert.equal(result.regions.r3, undefined);
});

test("the adapter does not mutate the world or the catalog", () => {
  const worldCopy = JSON.parse(JSON.stringify(WORLD));
  const catalogCopy = JSON.parse(JSON.stringify(CATALOG));
  readFrontLines(WORLD, CATALOG);
  assert.deepEqual(WORLD, worldCopy);
  assert.deepEqual(CATALOG, catalogCopy);
});

test("an empty world is an empty derivation, not a throw", () => {
  assert.deepEqual(readFrontLines(undefined, undefined), { edges: [], contested: [], byWar: [], regions: {} });
  assert.deepEqual(readFrontLines({}, []), { edges: [], contested: [], byWar: [], regions: {} });
});
```

Run: `node --test src/runtime/frontLines.test.js`
Expected: FAIL (the module does not exist).

- [ ] **Step 2: Implement the adapter**

Create `src/runtime/frontLines.js`:

```js
// Open Historia - the front-line adapter (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// Reads the world and the catalog into the pure core's plain inputs and returns
// the derivation. Read-only: it writes nothing, and it imports no Game/AI
// module, so the derivation cannot depend on the prompt layer.

import { deriveFrontLines } from "../engine/frontLines.js";
import { regionOwnerName } from "./regionOwners.js";

const name = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);

export const readFrontLines = (world, catalog) => {
  const overrides = world?.regionOwnershipOverrides;
  const wars = list(world?.wars).map((war) => ({
    id: name(war?.id),
    status: name(war?.status),
    sideA: list(war?.sideA).map(name).filter(Boolean),
    sideB: list(war?.sideB).map(name).filter(Boolean),
  }));
  const units = list(world?.units)
    .map((unit) => ({ ownerCode: name(unit?.ownerCode), regionId: name(unit?.regionId) }))
    .filter((unit) => unit.ownerCode && unit.regionId);
  const regions = list(catalog)
    .map((row) => ({
      id: name(row?.id),
      controller: regionOwnerName(row, overrides),
      adjacencies: list(row?.adjacencies).map(name).filter(Boolean),
    }))
    .filter((region) => region.id);
  return deriveFrontLines({ wars, units, regions });
};
```

- [ ] **Step 3: Run the tests**

Run: `node --test src/runtime/frontLines.test.js`
Expected: PASS.

Run: `node --test "src/runtime/*.test.js"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/frontLines.js src/runtime/frontLines.test.js
git commit -m "feat(runtime): read derived front lines from the world"
```

---

### Task 4: Document the derived layer

**Files:**
- Modify: `docs/runtime-services.md` (add one section after `## The deterministic economy layer`, before `## Library store`)

**Interfaces:**
- Consumes: the finished adapter's name and signature (Task 3).
- Produces: no code; the doc records what the layer is and, explicitly, that it is derived and not stored.

- [ ] **Step 1: Add the section**

Insert after the deterministic economy layer section:

```markdown
## Front lines - `src/runtime/frontLines.js`

`readFrontLines(world, catalog)` derives the operational shape of the active
wars as a pure read, with no stored state:

- **Effective control** is `regionOwnershipOverrides[id] ?? region.country`,
  canonicalized to the full country name by `regionOwnerName`
  (`src/runtime/regionOwners.js`, also re-exported by `Game/AI/regionVocab.js`).
- **A front edge** is an adjacent pair of regions whose controllers are enemies
  in one `active` war (one on `sideA`, the other on `sideB`, compared
  case-insensitively). It carries the pair and the sorted list of wars that make
  it hostile.
- **A contested region** is a region where units of two enemy polities are both
  present (read from `unit.regionId`), reported once per region and per war.

The result is `{ edges, contested, byWar, regions }`, every list totally
ordered by code-unit comparison. It is computed on demand and never written to
`world`: there is no field, no normalizer and no migration, and asking twice
gives the same answer. The pure core is `src/engine/frontLines.js`; the adapter
only reads the world and the catalog into its plain inputs.
```

- [ ] **Step 2: Commit**

```bash
git add docs/runtime-services.md
git commit -m "docs(runtime): record the derived front-line layer"
```

---

### Task 5: Acceptance gate

**Files:**
- No source change. This task verifies the whole increment and touches nothing.

**Interfaces:**
- Consumes: every earlier task.
- Produces: the evidence that the increment is complete and safe to push.

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: the whole suite passes with `fail 0`. The known network flake in `server/appUpdate.test.js` ("the manifest tells the page which of the two updates it can offer"), if it appears, is not a regression from this work and may be re-run alone.

- [ ] **Step 2: Run the focused suites and lint**

Run: `node --test "src/engine/*.test.js"`
Expected: PASS, including `enginePurity.test.js`.

Run: `node --test "src/runtime/*.test.js"`
Expected: PASS.

Run: `npx eslint src/engine/frontLines.js src/engine/frontLines.test.js src/runtime/frontLines.js src/runtime/frontLines.test.js src/runtime/regionOwners.js src/runtime/regionOwners.test.js src/Game/AI/regionVocab.js`
Expected: `0 errors`. Any `warning` must match the file's pre-existing warnings, not new ones.

- [ ] **Step 3: Build and freshness**

Run: `npm run build`
Expected: exit 0.

Run: `npm run wiki:check`
Expected: `Wiki is current.` (this increment changes no `wiki/` source, so no regeneration is needed; if it reports stale, regenerate with `npm run build:wiki` and commit the regenerated `public/wiki/**`).

- [ ] **Step 4: Push the branch**

```bash
git push origin 261001-feat-combat-engagements
```

Expected: the branch advances on the fork (`AbdallahEssam23/open-historia`). No pull request is created, and the upstream repository is not touched.
