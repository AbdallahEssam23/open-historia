// Run: node --test src/runtime/warSettlement.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  applyWarReparations,
  buildSettlementEvent,
  resolveWarSettlements,
} from "./warSettlement.js";

const war = (over = {}) => ({
  id: "war-1",
  status: "active",
  sideA: ["Prussia"],
  sideB: ["France"],
  startedDate: "1870-01-01",
  goals: {
    a: { kind: "status_quo", targetRegionIds: [], note: "" },
    b: { kind: "status_quo", targetRegionIds: [], note: "" },
  },
  weariness: { a: 0.6, b: 0.6, throughDate: "1870-01-01" },
  ...over,
});

const world = (wars, over = {}) => ({
  wars,
  regionOwnershipOverrides: {},
  economyEngine: { mobilization: {}, pools: {} },
  ...over,
});

const battle = (eventIndex, sideA, sideB) => ({
  eventIndex,
  winner: "a",
  controlRegionId: "R",
  controlToCode: "Prussia",
  casualtyCount: 0,
  destroyedCount: 0,
  sideA,
  sideB,
});

test("a war the player is a party to is withheld with a player reason", () => {
  const out = resolveWarSettlements({
    world: world([war()]),
    events: [],
    engagements: [],
    date: "1870-03-01",
    playerPolity: "France",
  });
  assert.deepEqual(out.settlements, []);
  assert.deepEqual(out.weariness, {});
  assert.equal(out.unresolved.length, 1);
  assert.equal(out.unresolved[0].warId, "war-1");
  assert.match(out.unresolved[0].reason, /player/i);
});

test("a ceasefire, an ended war and a war started this date are skipped silently", () => {
  const out = resolveWarSettlements({
    world: world([
      war({ id: "war-ceasefire", status: "ceasefire" }),
      war({ id: "war-ended", status: "ended" }),
      war({ id: "war-today", startedDate: "1870-03-01" }),
    ]),
    events: [],
    engagements: [],
    date: "1870-03-01",
    playerPolity: "",
  });
  assert.deepEqual(out.settlements, []);
  assert.deepEqual(out.unresolved, []);
  assert.deepEqual(out.weariness, {});
});

test("a war driven to weariness settles and returns weariness through the date", () => {
  const input = {
    world: world([war({ weariness: { a: 0.6, b: 0.6, throughDate: "1870-02-01" } })]),
    events: [],
    engagements: [],
    date: "1870-03-01",
    playerPolity: "",
  };
  const out = resolveWarSettlements(input);
  assert.equal(out.settlements.length, 1);
  assert.equal(out.settlements[0].warId, "war-1");
  assert.deepEqual(out.weariness["war-1"], { a: 0.6, b: 0.6, throughDate: "1870-03-01" });

  const again = resolveWarSettlements(input);
  assert.equal(JSON.stringify(again.settlements), JSON.stringify(out.settlements));
  assert.equal(JSON.stringify(again.weariness), JSON.stringify(out.weariness));
});

test("a war below the weariness bar returns weariness without a settlement", () => {
  const out = resolveWarSettlements({
    world: world([war({ weariness: { a: 0, b: 0, throughDate: "1870-03-01" } })]),
    events: [],
    engagements: [],
    date: "1870-03-01",
    playerPolity: "",
  });
  assert.deepEqual(out.settlements, []);
  assert.deepEqual(out.weariness["war-1"], { a: 0, b: 0, throughDate: "1870-03-01" });
});

test("two battle results naming one war yield one settlement", () => {
  const out = resolveWarSettlements({
    world: world([war({ weariness: { a: 0.6, b: 0.6, throughDate: "1870-02-01" } })]),
    events: [{ warId: "war-1" }, { warId: "war-1" }],
    engagements: [
      battle(0, { adjustedPower: 30, lossFraction: 0.2 }, { adjustedPower: 10, lossFraction: 0.1 }),
      battle(1, { adjustedPower: 20, lossFraction: 0.3 }, { adjustedPower: 20, lossFraction: 0.1 }),
    ],
    date: "1870-03-01",
    playerPolity: "",
  });
  assert.equal(out.settlements.length, 1);
});

test("held declared targets follow the lead polity through the owner canonicalization", () => {
  const out = resolveWarSettlements({
    world: world([
      war({
        sideA: ["Germany"],
        sideB: ["France"],
        weariness: { a: 0.6, b: 0, throughDate: "1870-02-01" },
        goals: {
          a: { kind: "annex", targetRegionIds: ["DEU.1_1", "FRA.1_1"], note: "" },
          b: { kind: "annex", targetRegionIds: [], note: "" },
        },
      }),
    ], { regionOwnershipOverrides: { "DEU.1_1": "DEU" } }),
    events: [],
    engagements: [],
    date: "1870-03-01",
    playerPolity: "",
  });
  assert.equal(out.settlements.length, 1);
  assert.equal(out.settlements[0].victor, "a");
  assert.deepEqual(out.settlements[0].transfers, [
    { regionId: "DEU.1_1", fromCode: "France", toCode: "Germany" },
  ]);
});

test("buildSettlementEvent carries the war, the belligerents and the transfers", () => {
  const settlement = {
    warId: "war-1",
    transfers: [{ regionId: "ALSACE", fromCode: "France", toCode: "Prussia", note: "capitulation" }],
    belligerents: ["Prussia", "France"],
  };
  const event = buildSettlementEvent(settlement, { date: "1870-03-01", round: 4 });
  assert.equal(event.kind, "military");
  assert.equal(event.warId, "war-1");
  assert.equal(event.date, "1870-03-01");
  assert.equal(event.title, "Peace settlement: war-1");
  assert.deepEqual(event.combatants, ["Prussia", "France"]);
  assert.deepEqual(event.impacts.regionTransfers, [
    { regionId: "ALSACE", fromCode: "France", toCode: "Prussia" },
  ]);
  assert.equal(event.combatRegion, undefined);
  assert.doesNotMatch(event.description, /\b(battle|attack|offensive|siege|capture|liberation|raid)\b/i);
});

test("buildSettlementEvent caps the combatants at eight", () => {
  const names = Array.from({ length: 12 }, (_, index) => `polity-${index}`);
  const event = buildSettlementEvent({ warId: "war-2", transfers: [], belligerents: names }, { date: "1870-03-01" });
  assert.deepEqual(event.combatants, names.slice(0, 8));
});

test("applyWarReparations moves the capped amount and floors the loser at zero", () => {
  const before = {
    economyEngine: {
      seed: "turn-1",
      version: 1,
      pools: { France: { manpower: 100, materiel: 5 }, Prussia: { manpower: 10, materiel: 1 } },
    },
    countryStats: {
      France: { forces: { manpower: 100, materiel: 5, mobilization: "partial" } },
      Prussia: { forces: { manpower: 10, materiel: 1, mobilization: "total" } },
    },
  };
  const out = applyWarReparations(before, [{
    reparations: { fromCode: "France", toCode: "Prussia", manpower: 500, materiel: 3 },
  }]);
  assert.deepEqual(out.economyEngine.pools.France, { manpower: 0, materiel: 2 });
  assert.deepEqual(out.economyEngine.pools.Prussia, { manpower: 110, materiel: 4 });
  assert.equal(out.countryStats.France.forces.manpower, 0);
  assert.equal(out.countryStats.Prussia.forces.manpower, 110);
  assert.equal(out.countryStats.France.forces.materiel, 2);
  assert.equal(out.countryStats.Prussia.forces.materiel, 4);
});

test("applyWarReparations returns the same world when nothing is owed", () => {
  const empty = { economyEngine: { pools: {} } };
  assert.equal(applyWarReparations(empty, []), empty);
  assert.equal(
    applyWarReparations(empty, [{ reparations: { fromCode: "A", toCode: "B", manpower: 0, materiel: 0 } }]),
    empty,
  );
  const broke = {
    economyEngine: {
      seed: "turn-1",
      version: 1,
      pools: { France: { manpower: 0, materiel: 0 }, Prussia: { manpower: 5, materiel: 5 } },
    },
  };
  assert.equal(
    applyWarReparations(broke, [{
      reparations: { fromCode: "France", toCode: "Prussia", manpower: 100, materiel: 1 },
    }]),
    broke,
  );
});
