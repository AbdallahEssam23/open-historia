// Run: node --test src/engine/combat.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  AIR_EDGE_MAX,
  COMBAT_LOSS_MAX,
  COMBAT_LOSS_MIN,
  CONTROL_THRESHOLD,
  MOBILIZATION_COMBAT_MULTIPLIER,
  NAVAL_SUPPORT_MAX,
  UNIT_COMBAT_WEIGHT,
  UNIT_DOMAIN,
  UNIT_DESTRUCTION_THRESHOLD,
  combatLossFraction,
  engagementRoll,
  engagementWinner,
  mobilizationCombatMultiplier,
  resolveEngagement,
  unitCombatPower,
  unitDomain,
} from "./combat.js";

const side = (polity, posture, units) => ({ polity, posture, units });
const unit = (id, type, strength) => ({ id, type, strength });

test("every unit type has a weight and heavier types weigh more", () => {
  const order = ["garrison", "infantry", "artillery", "armor", "air", "naval"];
  for (const type of order) assert.equal(typeof UNIT_COMBAT_WEIGHT[type], "number", type);
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(UNIT_COMBAT_WEIGHT[order[i]] >= UNIT_COMBAT_WEIGHT[order[i - 1]], order[i]);
  }
});

test("every posture has a multiplier and peacetime is the identity", () => {
  for (const posture of ["demobilized", "peacetime", "partial", "total"]) {
    assert.equal(typeof MOBILIZATION_COMBAT_MULTIPLIER[posture], "number", posture);
  }
  assert.equal(mobilizationCombatMultiplier("peacetime"), 1);
  assert.equal(mobilizationCombatMultiplier("unknown"), 1);
});

test("unit power is the type weight scaled by strength", () => {
  assert.equal(unitCombatPower(unit("u1", "infantry", 100)), 1);
  assert.equal(unitCombatPower(unit("u2", "armor", 50)), UNIT_COMBAT_WEIGHT.armor * 0.5);
  assert.equal(unitCombatPower(unit("u3", "psionics", 100)), UNIT_COMBAT_WEIGHT.infantry);
});

test("the roll is stable for a key and differs across keys", () => {
  const a = engagementRoll("war-x|alsace|1870-07-19|12");
  assert.equal(a, engagementRoll("war-x|alsace|1870-07-19|12"));
  assert.notEqual(a, engagementRoll("war-x|alsace|1870-07-19|13"));
  assert.ok(a >= 0 && a < 1);
});

test("the same engagement key always yields the same adjusted powers", () => {
  const input = {
    warId: "war-a-b", regionId: "alsace", date: "1870-07-19", round: 3,
    controllerPolity: "France",
    sideA: [side("France", "peacetime", [unit("f1", "infantry", 80)])],
    sideB: [side("Prussia", "partial", [unit("p1", "infantry", 80)])],
  };
  const first = resolveEngagement(input);
  const second = resolveEngagement(input);
  assert.deepEqual(first, second);
});

test("a tie is held by the defender, and by the first side with none", () => {
  assert.equal(engagementWinner(2, 1, "b"), "a");
  assert.equal(engagementWinner(1, 2, "a"), "b");
  assert.equal(engagementWinner(1, 1, "b"), "b");
  assert.equal(engagementWinner(1, 1, ""), "a");
});

test("the loss fraction is bounded and larger for the weaker side", () => {
  assert.equal(combatLossFraction(0), COMBAT_LOSS_MIN);
  assert.equal(combatLossFraction(1), COMBAT_LOSS_MAX);
  assert.ok(combatLossFraction(0.9) > combatLossFraction(0.1));
});

test("a broken loser is destroyed and a winner at the same strength is not", () => {
  const result = resolveEngagement({
    warId: "war-a-b", regionId: "alsace", date: "1870-07-19", round: 0,
    controllerPolity: "France",
    // An overwhelming attacker makes the defender's loss fraction hit the cap.
    sideA: [side("Prussia", "total", [unit("p1", "armor", 100), unit("p2", "armor", 100)])],
    sideB: [side("France", "demobilized", [unit("f1", "garrison", 20)])],
  });
  const defender = result.sideB.units[0];
  assert.ok(defender.nextStrength < UNIT_DESTRUCTION_THRESHOLD);
  assert.equal(defender.destroyed, true);
  const winner = result.sideA.units[0];
  assert.ok(winner.nextStrength >= 1);
  assert.equal(winner.destroyed, false);
});

test("control changes only when the attacker wins and the defender breaks", () => {
  const result = resolveEngagement({
    warId: "war-a-b", regionId: "alsace", date: "1870-07-19", round: 0,
    controllerPolity: "France",
    sideA: [side("Prussia", "total", [unit("p1", "armor", 100), unit("p2", "armor", 100)])],
    sideB: [side("France", "demobilized", [unit("f1", "garrison", 20)])],
  });
  assert.equal(result.winner, "a");
  assert.equal(result.defenderSide, "b");
  assert.ok(result.sideB.adjustedPower / (result.sideA.adjustedPower + result.sideB.adjustedPower) < CONTROL_THRESHOLD);
  assert.deepEqual(result.controlChange, { toCode: "Prussia" });
});

test("a controller that is not a belligerent forbids a control change", () => {
  const result = resolveEngagement({
    warId: "war-a-b", regionId: "alsace", date: "1870-07-19", round: 0,
    controllerPolity: "Switzerland",
    sideA: [side("Prussia", "total", [unit("p1", "armor", 100), unit("p2", "armor", 100)])],
    sideB: [side("France", "demobilized", [unit("f1", "garrison", 20)])],
  });
  assert.equal(result.defenderSide, "");
  assert.equal(result.controlChange, null);
});

test("every unit type maps to a domain and an unknown type is land", () => {
  for (const type of ["garrison", "infantry", "artillery", "armor"]) {
    assert.equal(unitDomain(unit("u", type, 100)), "land", type);
  }
  assert.equal(unitDomain(unit("u", "air", 100)), "air");
  assert.equal(unitDomain(unit("u", "naval", 100)), "naval");
  assert.equal(unitDomain(unit("u", "psionics", 100)), "land");
  assert.equal(unitDomain({}), "land");
});

test("the domain table covers every declared unit type", () => {
  for (const type of ["garrison", "infantry", "artillery", "armor", "air", "naval"]) {
    assert.equal(typeof UNIT_DOMAIN[type], "string", type);
  }
});

test("a land-only battle is inert to the domain rules", () => {
  const input = {
    warId: "war-a-b", regionId: "alsace", date: "1870-07-19", round: 0,
    controllerPolity: "France",
    sideA: [side("France", "peacetime", [unit("f1", "infantry", 80), unit("f2", "artillery", 60)])],
    sideB: [side("Prussia", "partial", [unit("p1", "infantry", 80)])],
  };
  const result = resolveEngagement(input);
  assert.equal(result.airEdge, 0);
  assert.equal(result.navalEdge, 0);
  assert.equal(result.sideA.airPower, 0);
  assert.equal(result.sideA.navalPower, 0);
  // The naval factor is exactly 1, so the raw power is the plain side score and
  // the loss fractions are the unadjusted fractions.
  assert.equal(
    result.sideA.lossFraction,
    combatLossFraction(result.sideB.adjustedPower / (result.sideA.adjustedPower + result.sideB.adjustedPower)),
  );
});

test("air superiority lowers the holder's losses and raises the other's", () => {
  const base = {
    warId: "war-a-b", regionId: "alsace", date: "1870-07-19", round: 0,
    controllerPolity: "France",
    sideA: [side("France", "peacetime", [unit("f1", "infantry", 80)])],
    sideB: [side("Prussia", "peacetime", [unit("p1", "infantry", 80)])],
  };
  const even = resolveEngagement(base);
  const withAir = resolveEngagement({
    ...base,
    sideA: [side("France", "peacetime", [unit("f1", "infantry", 80), unit("f2", "air", 60)])],
  });
  assert.equal(even.airEdge, 0);
  assert.ok(withAir.airEdge > 0 && withAir.airEdge <= 1);
  assert.ok(withAir.sideA.lossFraction < even.sideA.lossFraction, "the air holder loses less");
  assert.ok(withAir.sideB.lossFraction > even.sideB.lossFraction, "the other loses more");
  for (const fraction of [withAir.sideA.lossFraction, withAir.sideB.lossFraction]) {
    assert.ok(fraction >= COMBAT_LOSS_MIN && fraction <= COMBAT_LOSS_MAX);
  }
});

test("naval support raises the fleet holder's power", () => {
  const base = {
    warId: "war-a-b", regionId: "alsace", date: "1870-07-19", round: 0,
    controllerPolity: "France",
    sideA: [side("France", "peacetime", [unit("f1", "infantry", 80)])],
    sideB: [side("Prussia", "peacetime", [unit("p1", "infantry", 80)])],
  };
  const even = resolveEngagement(base);
  const withFleet = resolveEngagement({
    ...base,
    sideA: [side("France", "peacetime", [unit("f1", "infantry", 80), unit("f2", "naval", 60)])],
  });
  assert.equal(even.navalEdge, 0);
  assert.equal(withFleet.navalEdge, 1);
  assert.ok(withFleet.sideA.power > even.sideA.power, "shore support adds to raw power");
  // Uncontested naval support multiplies the raw power by exactly the bound.
  const rawA = unitCombatPower(unit("f1", "infantry", 80))
    + unitCombatPower(unit("f2", "naval", 60));
  assert.equal(withFleet.sideA.power, rawA * (1 + NAVAL_SUPPORT_MAX));
});

test("a land-only winner cannot destroy an air or naval unit", () => {
  const result = resolveEngagement({
    warId: "war-a-b", regionId: "alsace", date: "1870-07-19", round: 0,
    controllerPolity: "France",
    // An overwhelming land attacker breaks the defender's air and naval wing,
    // but has no means to finish either off.
    sideA: [side("Prussia", "total", [unit("p1", "armor", 100), unit("p2", "armor", 100)])],
    sideB: [side("France", "demobilized", [unit("f1", "air", 20), unit("f2", "naval", 20)])],
  });
  assert.equal(result.winner, "a");
  for (const defender of result.sideB.units) {
    assert.equal(defender.destroyed, false, defender.id);
    assert.ok(defender.nextStrength >= 1, defender.id);
  }
});

test("an air-capable winner can destroy air and naval, a fleet can destroy naval", () => {
  const withAir = resolveEngagement({
    warId: "war-a-b", regionId: "alsace", date: "1870-07-19", round: 0,
    controllerPolity: "France",
    sideA: [side("Prussia", "total", [unit("p1", "air", 100), unit("p2", "armor", 100)])],
    sideB: [side("France", "demobilized", [unit("f1", "air", 20), unit("f2", "naval", 20)])],
  });
  assert.equal(withAir.sideB.units[0].destroyed, true, "air destroys air");
  assert.equal(withAir.sideB.units[1].destroyed, true, "air destroys naval");

  const withFleet = resolveEngagement({
    warId: "war-a-b", regionId: "alsace", date: "1870-07-19", round: 0,
    controllerPolity: "France",
    sideA: [side("Prussia", "total", [unit("p1", "naval", 100), unit("p2", "armor", 100)])],
    sideB: [side("France", "demobilized", [unit("f1", "naval", 20)])],
  });
  assert.equal(withFleet.sideB.units[0].destroyed, true, "a fleet destroys a fleet");
});

test("a pure air or naval winner cannot take a province", () => {
  const result = resolveEngagement({
    warId: "war-a-b", regionId: "alsace", date: "1870-07-19", round: 0,
    controllerPolity: "France",
    sideA: [side("Prussia", "total", [unit("p1", "naval", 100), unit("p2", "naval", 100)])],
    sideB: [side("France", "demobilized", [unit("f1", "garrison", 20)])],
  });
  assert.equal(result.winner, "a");
  assert.equal(result.defenderSide, "b");
  assert.equal(result.controlChange, null, "a fleet cannot occupy");
});

test("every domain case is deterministic", () => {
  const input = {
    warId: "war-a-b", regionId: "alsace", date: "1870-07-19", round: 2,
    controllerPolity: "France",
    sideA: [side("France", "partial", [unit("f1", "infantry", 70), unit("f2", "air", 50), unit("f3", "naval", 40)])],
    sideB: [side("Prussia", "total", [unit("p1", "armor", 90), unit("p2", "naval", 60)])],
  };
  assert.deepEqual(resolveEngagement(input), resolveEngagement(input));
});
