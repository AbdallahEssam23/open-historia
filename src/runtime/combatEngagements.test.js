// Run: node --test src/runtime/combatEngagements.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  COMBAT_POOL_FACTOR,
  applyCombatReserveCost,
  mergeEngagementResults,
  resolveEventEngagements,
} from "./combatEngagements.js";

const world = () => ({
  wars: [{
    id: "war-prussia-france-18700719",
    status: "active",
    sideA: ["Prussia"],
    sideB: ["France"],
  }],
  units: [
    { id: "p1", ownerCode: "Prussia", type: "armor", strength: 100, regionId: "ALSACE" },
    { id: "p2", ownerCode: "Prussia", type: "armor", strength: 100, regionId: "ALSACE" },
    { id: "f1", ownerCode: "France", type: "garrison", strength: 20, regionId: "ALSACE" },
    { id: "f2", ownerCode: "France", type: "infantry", strength: 100, regionId: "LORRAINE" },
  ],
  economyEngine: { mobilization: { Prussia: "total", France: "demobilized" } },
  regionOwnershipOverrides: { ALSACE: "France" },
  countryStats: { France: { forces: { manpower: 500, materiel: 20, mobilization: "demobilized" } } },
});

const battle = () => ({
  id: "e1",
  warId: "war-prussia-france-18700719",
  combatants: ["Prussia", "France"],
  combatRegion: "ALSACE",
  date: "1870-07-19",
});

test("a battle resolves into unit ops and a control op", () => {
  const out = resolveEventEngagements([battle()], world(), { round: 7 });
  assert.equal(out.unresolved.length, 0);
  assert.equal(out.results.length, 1);
  const result = out.results[0];
  assert.equal(result.eventIndex, 0);
  assert.ok(result.unitOps.some((op) => op.unitId === "f1"));
  assert.equal(result.controlRegionId, "ALSACE");
  assert.equal(result.controlToCode, "Prussia");
  assert.deepEqual(result.regionControlOps, [{
    op: "control",
    regionId: "ALSACE",
    fromCode: "France",
    toCode: "Prussia",
    note: "engine-resolved engagement",
  }]);
});

test("a unit outside the region never fights", () => {
  const out = resolveEventEngagements([battle()], world(), { round: 7 });
  const ids = out.results[0].unitOps.map((op) => op.unitId);
  assert.equal(ids.includes("f2"), false);
});

test("a side with no unit in the region resolves nothing", () => {
  const w = world();
  w.units = w.units.filter((unit) => unit.ownerCode !== "France");
  const out = resolveEventEngagements([battle()], w, { round: 7 });
  assert.equal(out.results.length, 0);
  assert.equal(out.unresolved.length, 1);
  assert.match(out.unresolved[0].reason, /France/);
});

test("the reserve cost is charged to the owner and is floored at zero", () => {
  const w = world();
  w.countryStats.France.forces.manpower = 0;
  const out = resolveEventEngagements([battle()], w, { round: 7 });
  assert.ok(out.reserveCost.Prussia.manpower > 0);
  assert.ok(out.reserveCost.France.materiel > 0);
  assert.equal(COMBAT_POOL_FACTOR, 10);
  const charged = applyCombatReserveCost(w, out.reserveCost);
  assert.equal(charged.economyEngine.pools.France.manpower, 0);
  assert.equal(charged.countryStats.France.forces.manpower, 0);
});

test("the same battle key resolves byte for byte the same twice", () => {
  const a = resolveEventEngagements([battle()], world(), { round: 7 });
  const b = resolveEventEngagements([battle()], world(), { round: 7 });
  assert.deepEqual(a.results, b.results);
  assert.deepEqual(a.reserveCost, b.reserveCost);
});

test("merging replaces the model's numbers and its claim on the region", () => {
  const event = {
    ...battle(),
    impacts: {
      unitOps: [
        { op: "move", unitId: "p1", toLng: 1, toLat: 1 },
        { op: "strength", unitId: "f1", strength: 99 },
      ],
      regionControlOps: [{ op: "control", regionId: "ALSACE", fromCode: "France", toCode: "France" }],
      regionTransfers: [{ regionId: "ALSACE", toCode: "France" }],
    },
  };
  const out = resolveEventEngagements([event], world(), { round: 7 });
  const merged = mergeEngagementResults([event], out.results);
  assert.equal(merged, 1);
  assert.ok(event.impacts.unitOps.some((op) => op.op === "move" && op.unitId === "p1"), "the move is kept");
  assert.equal(event.impacts.unitOps.some((op) => op.op === "strength" && op.unitId === "f1"), false, "the model's strength op is dropped");
  assert.equal(event.impacts.regionTransfers.length, 0, "the model's claim on the region is dropped");
  assert.deepEqual(event.impacts.regionControlOps, out.results[0].regionControlOps);
});
