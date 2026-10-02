// Run: node --test src/engine/combat.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  COMBAT_LOSS_MAX,
  COMBAT_LOSS_MIN,
  CONTROL_THRESHOLD,
  MOBILIZATION_COMBAT_MULTIPLIER,
  UNIT_COMBAT_WEIGHT,
  UNIT_DESTRUCTION_THRESHOLD,
  combatLossFraction,
  engagementRoll,
  engagementWinner,
  mobilizationCombatMultiplier,
  resolveEngagement,
  unitCombatPower,
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
