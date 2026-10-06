// Run: node --test src/runtime/combatEngagements.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  COMBAT_POOL_FACTOR,
  applyCombatReserveCost,
  buildEngagement,
  describeEngagementTactics,
  mergeEngagementResults,
  regionCoastal,
  resolveEventEngagements,
} from "./combatEngagements.js";
import { UNIT_DOMAIN } from "../engine/combat.js";
import { UNIT_TYPES } from "./gameState.js";

test("every runtime unit type has a declared combat domain", () => {
  for (const type of UNIT_TYPES) {
    assert.equal(typeof UNIT_DOMAIN[type], "string", `${type} has no combat domain`);
  }
  // The engine may know a type the runtime does not; the reverse is the failure
  // this pins, because an unknown type silently becomes land.
  assert.equal(Object.keys(UNIT_DOMAIN).length, UNIT_TYPES.length);
});

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

test("each result carries the core's per-side summary", () => {
  const out = resolveEventEngagements([battle()], world(), { round: 7 });
  assert.equal(out.results.length, 1);
  const { sideA, sideB } = out.results[0];
  for (const loss of [sideA.lossFraction, sideB.lossFraction]) {
    assert.equal(typeof loss, "number");
    assert.ok(loss >= 0 && loss <= 1, `lossFraction ${loss} is in 0..1`);
  }
  assert.equal(typeof sideA.adjustedPower, "number");
  assert.equal(typeof sideB.adjustedPower, "number");
  assert.ok(sideA.power + sideB.power > 0);
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

test("the control target follows the war's declared side order", () => {
  const w = world();
  w.wars[0].sideA = ["Alpha", "Beta"];
  w.wars[0].sideB = ["France"];
  // Beta is listed on the roster before Alpha, but the war declares Alpha first.
  w.units = [
    { id: "b1", ownerCode: "Beta", type: "armor", strength: 100, regionId: "ALSACE" },
    { id: "a1", ownerCode: "Alpha", type: "armor", strength: 100, regionId: "ALSACE" },
    { id: "f1", ownerCode: "France", type: "garrison", strength: 10, regionId: "ALSACE" },
  ];
  const out = resolveEventEngagements([battle()], w, { round: 7 });
  assert.equal(out.unresolved.length, 0);
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].winner, "a");
  assert.equal(out.results[0].controlToCode, "Alpha");
  assert.equal(out.results[0].regionControlOps[0].fromCode, "France");
});

test("a declared side matches the roster owner case-insensitively", () => {
  const w = world();
  // The war declares "France" but the roster spells the owner "france".
  w.wars[0].sideB = ["France"];
  w.units = [
    { id: "p1", ownerCode: "Prussia", type: "armor", strength: 100, regionId: "ALSACE" },
    { id: "f1", ownerCode: "france", type: "garrison", strength: 20, regionId: "ALSACE" },
  ];
  const input = buildEngagement(battle(), w, { round: 7 });
  assert.equal(input.sideB.length, 1);
  assert.equal(input.sideB[0].units.length, 1);
  assert.equal(input.sideB[0].units[0].id, "f1");
  const out = resolveEventEngagements([battle()], w, { round: 7 });
  assert.equal(out.unresolved.length, 0);
  assert.equal(out.results.length, 1);
});

test("an active-war declaration with no region draws an unresolved note", () => {
  const event = { ...battle() };
  delete event.combatRegion;
  const out = resolveEventEngagements([event], world(), { round: 7 });
  assert.equal(out.results.length, 0);
  assert.equal(out.unresolved.length, 1);
  assert.match(out.unresolved[0].reason, /region/i);
});

test("regionCoastal reads the declared terrain as a tri-state", () => {
  const catalog = [
    { id: "COAST", type: "coastal" },
    { id: "INLAND", type: "land" },
  ];
  assert.equal(regionCoastal("COAST", catalog), true);
  assert.equal(regionCoastal("INLAND", catalog), false);
  // A world with no coastal region anywhere carries no coastal data to apply.
  assert.equal(regionCoastal("INLAND", []), undefined);
  assert.equal(regionCoastal("INLAND", [{ id: "X", type: "land" }]), undefined);
  // An unknown id, or an empty one, is unknown terrain.
  assert.equal(regionCoastal("MISSING", catalog), undefined);
  assert.equal(regionCoastal("", catalog), undefined);
});

test("the engagement carries the battle's terrain from the catalog", () => {
  const coastalCatalog = [{ id: "ALSACE", type: "coastal" }];
  const inlandCatalog = [{ id: "ALSACE", type: "land" }, { id: "COAST", type: "coastal" }];
  assert.equal(buildEngagement(battle(), world(), { round: 7, regionCatalog: coastalCatalog }).coastal, true);
  assert.equal(buildEngagement(battle(), world(), { round: 7, regionCatalog: inlandCatalog }).coastal, false);
  assert.equal(buildEngagement(battle(), world(), { round: 7 }).coastal, undefined);
});

test("an inland region withholds naval shore support from the resolved battle", () => {
  const w = world();
  // A Prussian fleet joins the two armoured formations; only a coastal province
  // lets it add shore support.
  w.units.push({ id: "p3", ownerCode: "Prussia", type: "naval", strength: 80, regionId: "ALSACE" });
  const coastal = resolveEventEngagements([battle()], w, {
    round: 7,
    regionCatalog: [{ id: "ALSACE", type: "coastal" }],
  });
  const inland = resolveEventEngagements([battle()], w, {
    round: 7,
    regionCatalog: [{ id: "ALSACE", type: "land" }, { id: "COAST", type: "coastal" }],
  });
  assert.ok(
    coastal.results[0].sideA.power > inland.results[0].sideA.power,
    "shore support raises the fleet holder's power only on the coast",
  );
});

// A battle between the given Prussian (side A) and French (side B) units, at a
// fixed key. Explicit lists so every tactic edge is exactly attributable.
const duel = (unitsA, unitsB, regionCatalog = []) => {
  const w = world();
  w.units = [
    ...unitsA.map((unit, i) => ({ ownerCode: "Prussia", regionId: "ALSACE", id: `a${i}`, ...unit })),
    ...unitsB.map((unit, i) => ({ ownerCode: "France", regionId: "ALSACE", id: `b${i}`, ...unit })),
  ];
  return resolveEventEngagements([battle()], w, { round: 7, regionCatalog }).results[0];
};

const INF = { type: "infantry", strength: 80 };

test("a resolved battle forwards the tactic breakdown and each side's polity", () => {
  const result = duel([INF, { type: "air", strength: 60 }], [INF]);
  for (const field of ["airEdge", "navalEdge", "antiEdge", "coastal"]) {
    assert.ok(field in result, `the result carries ${field}`);
  }
  assert.equal(result.sideA.polity, "Prussia");
  assert.equal(result.sideB.polity, "France");
  for (const side of [result.sideA, result.sideB]) {
    for (const field of ["airPower", "navalPower", "antiPower"]) {
      assert.equal(typeof side[field], "number", field);
    }
  }
});

test("describeEngagementTactics names the side that held the air", () => {
  const result = duel([INF, { type: "air", strength: 60 }], [INF]);
  assert.ok(result.airEdge > 0);
  const clause = describeEngagementTactics(result);
  assert.match(clause, /Prussia held the air/);
  assert.doesNotMatch(clause, /France held the air/);
});

test("describeEngagementTactics names the sea holder on a coast and withholds it inland", () => {
  const coastalCatalog = [{ id: "ALSACE", type: "coastal" }];
  const inlandCatalog = [{ id: "ALSACE", type: "land" }, { id: "COAST", type: "coastal" }];
  const coastal = duel([INF, { type: "naval", strength: 60 }], [INF], coastalCatalog);
  assert.match(describeEngagementTactics(coastal), /Prussia held the sea/);

  const inland = duel([INF, { type: "naval", strength: 60 }], [INF], inlandCatalog);
  const inlandClause = describeEngagementTactics(inland);
  assert.match(inlandClause, /shore support was withheld \(the region is inland\)/);
  assert.doesNotMatch(inlandClause, /held the sea/);
});

test("describeEngagementTactics names the counter edge", () => {
  const result = duel([{ type: "artillery", strength: 80 }], [{ type: "armor", strength: 80 }]);
  assert.ok(result.antiEdge > 0);
  assert.match(describeEngagementTactics(result), /Prussia had the counter edge/);
});

test("describeEngagementTactics says nothing about a plain battle", () => {
  const result = duel([INF], [INF]);
  assert.equal(result.airEdge, 0);
  assert.equal(result.navalEdge, 0);
  assert.equal(result.antiEdge, 0);
  assert.equal(describeEngagementTactics(result), "");
});

test("describeEngagementTactics is deterministic", () => {
  const result = duel([INF, { type: "air", strength: 60 }, { type: "naval", strength: 40 }],
    [INF, { type: "artillery", strength: 70 }], [{ id: "ALSACE", type: "coastal" }]);
  assert.equal(describeEngagementTactics(result), describeEngagementTactics(result));
});
