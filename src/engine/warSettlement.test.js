import test from "node:test";
import assert from "node:assert/strict";

import {
  MOBILIZATION_WEARINESS_DRAG,
  REPARATION_MANPOWER_CAP,
  REPARATION_SHARE,
  UNJUST_LEGITIMACY_FACTOR,
  UNJUST_REPARATION_SHARE,
  WAR_GOAL_KINDS,
  WEARINESS_CAPITULATION,
  WEARINESS_COMPEL,
  WEARINESS_LOSS_GAIN,
  WEARINESS_MONTHLY_GAIN,
  normalizeWarGoals,
  normalizeWeariness,
  settleWar,
  warGoalScore,
  warPressure,
  wearinessStep,
} from "./warSettlement.js";

const baseWar = (overrides = {}) => ({
  warId: "war-1",
  date: "1915-01-01",
  goalsA: { kind: "annex", targetRegionIds: ["r1"], note: "" },
  goalsB: { kind: "annex", targetRegionIds: ["r2"], note: "" },
  heldRegionIdsA: [],
  heldRegionIdsB: [],
  advantageA: 0,
  advantageB: 0,
  wearinessA: 0,
  wearinessB: 0,
  codeA: "A",
  codeB: "B",
  poolsA: { manpower: 0, materiel: 0 },
  poolsB: { manpower: 0, materiel: 0 },
  ...overrides,
});

test("the goal kinds and weariness constants are the declared closed set", () => {
  assert.deepEqual(WAR_GOAL_KINDS, ["annex", "reparations", "status_quo"]);
  assert.equal(WEARINESS_MONTHLY_GAIN, 0.04);
  assert.equal(WEARINESS_LOSS_GAIN, 0.5);
  assert.equal(REPARATION_SHARE, 0.25);
  assert.equal(REPARATION_MANPOWER_CAP, 1000000);
  assert.equal(MOBILIZATION_WEARINESS_DRAG.peacetime, 0);
  assert.equal(MOBILIZATION_WEARINESS_DRAG.demobilized, 0);
  assert.ok(MOBILIZATION_WEARINESS_DRAG.total > MOBILIZATION_WEARINESS_DRAG.partial);
});

test("normalizeWarGoals treats an absent or unusable value as null and never throws", () => {
  assert.equal(normalizeWarGoals(undefined), null);
  assert.equal(normalizeWarGoals(null), null);
  assert.equal(normalizeWarGoals("annex"), null);
  assert.equal(normalizeWarGoals(42), null);
  assert.equal(normalizeWarGoals([]), null);
  assert.equal(normalizeWarGoals({}), null);
  assert.equal(normalizeWarGoals({ a: { kind: "invade" }, b: { kind: "also-bad" } }), null);
});

test("normalizeWarGoals folds an unknown kind to a null entry", () => {
  const goals = normalizeWarGoals({
    a: { kind: "annex", targetRegionIds: ["Alsace"], note: "east" },
    b: { kind: "conquer" },
  });
  assert.deepEqual(goals.a, { kind: "annex", targetRegionIds: ["Alsace"], note: "east" });
  assert.equal(goals.b, null);
});

test("normalizeWarGoals dedupes target regions, keeps the first order and caps the list", () => {
  const targets = [];
  for (let index = 0; index < 80; index += 1) targets.push(`r${index}`);
  targets.push("r0", "r1");
  const goals = normalizeWarGoals({ a: { kind: "annex", targetRegionIds: targets } });
  assert.equal(goals.a.targetRegionIds.length, 32);
  assert.equal(new Set(goals.a.targetRegionIds).size, 32);
  assert.deepEqual(goals.a.targetRegionIds.slice(0, 3), ["r0", "r1", "r2"]);
  assert.equal(goals.a.note, "");
});

test("normalizeWeariness clamps the pair, keeps the date, and rejects garbage", () => {
  assert.equal(normalizeWeariness(undefined), null);
  assert.equal(normalizeWeariness("x"), null);
  assert.deepEqual(normalizeWeariness({ a: 2, b: -3, throughDate: "1914-08-01" }), {
    a: 1,
    b: 0,
    throughDate: "1914-08-01",
  });
  assert.deepEqual(normalizeWeariness({}), { a: 0, b: 0, throughDate: "" });
});

test("warGoalScore reads exactly one input per kind", () => {
  assert.equal(warGoalScore({ kind: "annex", targetRegionIds: ["a", "b", "c"], heldRegionIds: ["a", "c"] }), 2 / 3);
  assert.equal(warGoalScore({ kind: "annex", targetRegionIds: [], heldRegionIds: ["a"] }), 0);
  assert.equal(warGoalScore({ kind: "annex", targetRegionIds: ["a"], heldRegionIds: ["a", "z"] }), 1);
  assert.equal(warGoalScore({ kind: "status_quo" }), 1);
  assert.equal(warGoalScore({ kind: "reparations", advantage: 0.4 }), 0.4);
  assert.equal(warGoalScore({ kind: "reparations", advantage: 9 }), 1);
  assert.equal(warGoalScore({ kind: "reparations", advantage: -1 }), 0);
  assert.equal(warGoalScore({ kind: "surrender", targetRegionIds: ["a"], heldRegionIds: ["a"] }), 0);
});

test("wearinessStep is monotone, bounded, and posture aware", () => {
  assert.equal(wearinessStep({ prior: 0.2, months: 1, lossFraction: 0, mobilization: "peacetime" }), 0.2 + 0.04);
  assert.equal(wearinessStep({ prior: 0, months: 0, lossFraction: 0, mobilization: "peacetime" }), 0);
  assert.equal(wearinessStep({ prior: 0.99, months: 100, lossFraction: 1, mobilization: "total" }), 1);
  assert.ok(
    wearinessStep({ prior: 0.5, months: 2, lossFraction: 0, mobilization: "peacetime" }) >= 0.5,
  );
  assert.ok(
    wearinessStep({ prior: 0.3, months: 1, lossFraction: 0.4, mobilization: "peacetime" })
      > wearinessStep({ prior: 0.3, months: 1, lossFraction: 0.1, mobilization: "peacetime" }),
  );
  assert.equal(wearinessStep({ prior: 0, months: 1, lossFraction: 0, mobilization: "demobilized" }), 0.04);
  assert.equal(wearinessStep({ prior: 0, months: 1, lossFraction: 0, mobilization: "partial" }), 0.04 + 0.05);
  assert.equal(wearinessStep({ prior: 0, months: 1, lossFraction: 0, mobilization: "total" }), 0.04 + 0.1);
});

test("warPressure flags a compelled peace and a higher capitulation", () => {
  assert.deepEqual(warPressure({ wearinessA: WEARINESS_COMPEL, wearinessB: 0 }), {
    compelled: true,
    capitulationA: false,
    capitulationB: false,
  });
  assert.deepEqual(warPressure({ wearinessA: WEARINESS_COMPEL - 0.01, wearinessB: 0 }), {
    compelled: false,
    capitulationA: false,
    capitulationB: false,
  });
  assert.deepEqual(warPressure({ wearinessA: 0, wearinessB: WEARINESS_CAPITULATION }), {
    compelled: true,
    capitulationA: false,
    capitulationB: true,
  });
});

test("settleWar returns nothing until a peace is due", () => {
  assert.equal(settleWar(baseWar()), null);
});

test("a war with no declared goal waits for weariness, never settling on score alone", () => {
  const settlement = settleWar({
    warId: "war-goalless",
    date: "1915-01-01",
    goalsA: null,
    goalsB: null,
    codeA: "A",
    codeB: "B",
  });
  assert.equal(settlement, null);
});

test("settleWar ends once a side has taken every declared target", () => {
  const settlement = settleWar(baseWar({
    goalsA: { kind: "annex", targetRegionIds: ["r1"], note: "" },
    heldRegionIdsA: ["r1"],
  }));
  assert.equal(settlement.capitulation, false);
  assert.equal(settlement.victor, "a");
  assert.deepEqual(settlement.transfers, [{ regionId: "r1", fromCode: "B", toCode: "A" }]);
});

test("settleWar ends with one capitulation and the other side as victor", () => {
  const settlement = settleWar(baseWar({
    wearinessB: WEARINESS_CAPITULATION,
    goalsA: { kind: "annex", targetRegionIds: ["r1"], note: "" },
  }));
  assert.equal(settlement.victor, "a");
  assert.equal(settlement.loser, "b");
  assert.equal(settlement.capitulation, true);
  assert.equal(settlement.key, "war-1|1915-01-01|a|b");
});

test("settleWar breaks a double capitulation by score, then weariness, then side A", () => {
  const byScore = settleWar(baseWar({
    wearinessA: 0.95,
    wearinessB: 0.95,
    goalsA: { kind: "annex", targetRegionIds: ["r1"], note: "" },
    heldRegionIdsA: ["r1"],
  }));
  assert.equal(byScore.capitulation, true);
  assert.equal(byScore.victor, "a");

  const reparations = { kind: "reparations", targetRegionIds: [], note: "" };
  const byWeariness = settleWar(baseWar({
    wearinessA: 0.96,
    wearinessB: 0.91,
    advantageA: 0.5,
    advantageB: 0.5,
    goalsA: reparations,
    goalsB: reparations,
  }));
  assert.equal(byWeariness.victor, "b");

  const bySideA = settleWar(baseWar({
    wearinessA: 0.95,
    wearinessB: 0.95,
    advantageA: 0.5,
    advantageB: 0.5,
    goalsA: reparations,
    goalsB: reparations,
  }));
  assert.equal(bySideA.victor, "a");
});

test("settleWar compels a peace and breaks the tie like a double capitulation", () => {
  const reparations = { kind: "reparations", targetRegionIds: [], note: "" };
  const higherScore = settleWar(baseWar({
    wearinessA: WEARINESS_COMPEL,
    wearinessB: 0.1,
    advantageA: 0.7,
    advantageB: 0.2,
    goalsA: reparations,
    goalsB: reparations,
  }));
  assert.equal(higherScore.capitulation, false);
  assert.equal(higherScore.victor, "a");

  const lowerWeariness = settleWar(baseWar({
    wearinessA: 0.65,
    wearinessB: WEARINESS_COMPEL,
    advantageA: 0.5,
    advantageB: 0.5,
    goalsA: reparations,
    goalsB: reparations,
  }));
  assert.equal(lowerWeariness.victor, "b");
});

test("an annex victor on a compelled peace takes only the targets it holds", () => {
  const settlement = settleWar(baseWar({
    wearinessA: WEARINESS_COMPEL,
    goalsA: { kind: "annex", targetRegionIds: ["r1", "r2"], note: "" },
    heldRegionIdsA: ["r2"],
  }));
  assert.equal(settlement.victor, "a");
  assert.equal(settlement.capitulation, false);
  assert.deepEqual(settlement.transfers, [{ regionId: "r2", fromCode: "B", toCode: "A" }]);
});

test("an annex victor on a capitulation takes every declared target", () => {
  const settlement = settleWar(baseWar({
    wearinessB: WEARINESS_CAPITULATION,
    goalsA: { kind: "annex", targetRegionIds: ["r1", "r2"], note: "" },
    heldRegionIdsA: ["r1"],
  }));
  assert.equal(settlement.capitulation, true);
  assert.deepEqual(settlement.transfers, [
    { regionId: "r1", fromCode: "B", toCode: "A" },
    { regionId: "r2", fromCode: "B", toCode: "A" },
  ]);
  assert.equal(settlement.white, false);
});

test("a reparations victor takes the capped share of the loser's pools", () => {
  const settlement = settleWar(baseWar({
    wearinessB: WEARINESS_CAPITULATION,
    goalsA: { kind: "reparations", targetRegionIds: [], note: "" },
    codeA: "FR",
    codeB: "DE",
    poolsB: { manpower: 5000000, materiel: 100 },
  }));
  assert.deepEqual(settlement.transfers, []);
  assert.deepEqual(settlement.reparations, {
    fromCode: "DE",
    toCode: "FR",
    manpower: REPARATION_MANPOWER_CAP,
    materiel: 25,
  });
  assert.equal(settlement.white, false);
});

test("reparations floor at zero and a reparations win over empty pools is white", () => {
  const settlement = settleWar(baseWar({
    wearinessB: WEARINESS_CAPITULATION,
    goalsA: { kind: "reparations", targetRegionIds: [], note: "" },
  }));
  assert.deepEqual(settlement.reparations, { fromCode: "B", toCode: "A", manpower: 0, materiel: 0 });
  assert.equal(settlement.white, true);
});

test("a status quo win is a white peace", () => {
  const settlement = settleWar(baseWar({
    wearinessA: WEARINESS_COMPEL,
    goalsA: { kind: "status_quo", targetRegionIds: [], note: "" },
  }));
  assert.equal(settlement.victor, "a");
  assert.equal(settlement.white, true);
  assert.deepEqual(settlement.transfers, []);
  assert.deepEqual(settlement.reparations, { fromCode: "", toCode: "", manpower: 0, materiel: 0 });
});

test("a just status quo side out-scores an unjust side at full raw aim", () => {
  // status_quo scores 1 and a just side keeps it in full, so an unjust
  // opponent holding every declared target (raw 1) is capped at 0.75 and
  // loses. The victor wants nothing, so the punitive defeat is a white peace.
  const input = baseWar({
    wearinessA: WEARINESS_COMPEL,
    goalsA: { kind: "status_quo", targetRegionIds: [], note: "" },
    goalsB: { kind: "annex", targetRegionIds: ["r9"], note: "" },
    heldRegionIdsB: ["r9"],
  });
  const unjust = settleWar({ ...input, unjustB: true });
  assert.equal(unjust.victor, "a");
  assert.equal(unjust.loser, "b");
  assert.equal(unjust.punitive, true);
  assert.equal(unjust.white, true);

  // Without the mark the same full annex ties and wins on lower weariness.
  assert.equal(settleWar(input).victor, "b");
});

test("settleWar is deterministic: the same input is byte-identical", () => {
  const input = baseWar({
    wearinessB: WEARINESS_CAPITULATION,
    goalsA: { kind: "annex", targetRegionIds: ["r1", "r2", "r1"], note: "" },
    heldRegionIdsA: ["r2"],
  });
  assert.equal(JSON.stringify(settleWar(input)), JSON.stringify(settleWar(input)));
  assert.deepEqual(settleWar(input).transfers, [
    { regionId: "r1", fromCode: "B", toCode: "A" },
    { regionId: "r2", fromCode: "B", toCode: "A" },
  ]);
});

test("the unjust-war constants are the declared values", () => {
  assert.equal(UNJUST_LEGITIMACY_FACTOR, 0.75);
  assert.equal(UNJUST_REPARATION_SHARE, 0.5);
});

test("a war with no unjust flag settles on exactly the terms it did before", () => {
  const input = baseWar({
    wearinessB: WEARINESS_CAPITULATION,
    goalsA: { kind: "annex", targetRegionIds: ["r1", "r2"], note: "" },
    heldRegionIdsA: ["r1"],
  });
  const absent = settleWar(input);
  const explicit = settleWar({ ...input, unjustA: false, unjustB: false });
  assert.equal(absent.punitive, false);
  assert.equal(JSON.stringify(absent), JSON.stringify(explicit));
  // The pre-existing fields this increment must not move:
  assert.equal(absent.key, "war-1|1915-01-01|a|b");
  assert.equal(absent.victor, "a");
  assert.equal(absent.loser, "b");
  assert.equal(absent.capitulation, true);
  assert.equal(absent.white, false);
  assert.deepEqual(absent.transfers, [
    { regionId: "r1", fromCode: "B", toCode: "A" },
    { regionId: "r2", fromCode: "B", toCode: "A" },
  ]);
});

test("legitimacy flips an even race to the just side", () => {
  const reparations = { kind: "reparations", targetRegionIds: [], note: "" };
  const even = baseWar({
    wearinessA: WEARINESS_COMPEL,
    wearinessB: WEARINESS_COMPEL,
    advantageA: 0.5,
    advantageB: 0.5,
    goalsA: reparations,
    goalsB: reparations,
  });
  assert.equal(settleWar(even).victor, "a", "the tie defaults to side A");
  assert.equal(settleWar({ ...even, unjustA: true }).victor, "b");
  assert.equal(settleWar({ ...even, unjustB: true }).victor, "a");
});

test("legitimacy does not overturn a clear dominance", () => {
  const reparations = { kind: "reparations", targetRegionIds: [], note: "" };
  const out = settleWar(baseWar({
    wearinessA: WEARINESS_COMPEL,
    wearinessB: 0.1,
    advantageA: 0.9,
    advantageB: 0.1,
    goalsA: reparations,
    goalsB: reparations,
    unjustA: true,
  }));
  // 0.9 * 0.75 = 0.675 still beats 0.1.
  assert.equal(out.victor, "a");
  assert.equal(out.punitive, false);
});

test("the achieved gate reads the raw score, so an unjust winner still closes the war", () => {
  const out = settleWar(baseWar({
    goalsA: { kind: "annex", targetRegionIds: ["r1"], note: "" },
    goalsB: { kind: "annex", targetRegionIds: ["r2"], note: "" },
    heldRegionIdsA: ["r1"],
    unjustA: true,
  }));
  assert.ok(out, "the war closes although the factor lowers the winner's effective score");
  assert.equal(out.victor, "a");
  assert.equal(out.punitive, false, "an unjust side that wins is not punished");
  assert.deepEqual(out.transfers, [{ regionId: "r1", fromCode: "B", toCode: "A" }]);
});

test("a punitive defeat takes the unjust share under the unchanged cap", () => {
  const reparations = { kind: "reparations", targetRegionIds: [], note: "" };
  const defeat = baseWar({
    wearinessB: WEARINESS_CAPITULATION,
    goalsA: reparations,
    codeA: "FR",
    codeB: "DE",
    poolsB: { manpower: 4000000, materiel: 100 },
    unjustB: true,
  });
  const punished = settleWar(defeat);
  assert.equal(punished.victor, "a");
  assert.equal(punished.punitive, true);
  assert.deepEqual(punished.reparations, {
    fromCode: "DE",
    toCode: "FR",
    manpower: REPARATION_MANPOWER_CAP,
    materiel: 50,
  });

  const ordinary = settleWar({ ...defeat, unjustB: false });
  assert.equal(ordinary.punitive, false);
  assert.deepEqual(ordinary.reparations, {
    fromCode: "DE",
    toCode: "FR",
    manpower: REPARATION_MANPOWER_CAP,
    materiel: 25,
  });
});

test("an unjust victor takes its ordinary terms", () => {
  const reparations = { kind: "reparations", targetRegionIds: [], note: "" };
  const out = settleWar(baseWar({
    wearinessB: WEARINESS_CAPITULATION,
    goalsA: reparations,
    codeA: "FR",
    codeB: "DE",
    poolsB: { manpower: 4000000, materiel: 100 },
    unjustA: true,
  }));
  assert.equal(out.victor, "a");
  assert.equal(out.punitive, false);
  assert.deepEqual(out.reparations, {
    fromCode: "DE",
    toCode: "FR",
    manpower: REPARATION_MANPOWER_CAP,
    materiel: 25,
  });
});

test("a punitive annex takes every declared target, held or not", () => {
  const goalsA = { kind: "annex", targetRegionIds: ["r1", "r2"], note: "" };
  const goalsB = { kind: "annex", targetRegionIds: ["r9"], note: "" };
  const compelled = baseWar({
    wearinessA: WEARINESS_COMPEL,
    wearinessB: 0.1,
    goalsA,
    goalsB,
    heldRegionIdsA: ["r2"],
  });
  assert.deepEqual(settleWar(compelled).transfers, [
    { regionId: "r2", fromCode: "B", toCode: "A" },
  ]);
  assert.deepEqual(settleWar({ ...compelled, unjustB: true }).transfers, [
    { regionId: "r1", fromCode: "B", toCode: "A" },
    { regionId: "r2", fromCode: "B", toCode: "A" },
  ]);
});

test("punitive is true exactly when the unjust side lost", () => {
  const reparations = { kind: "reparations", targetRegionIds: [], note: "" };
  const loses = settleWar(baseWar({
    wearinessB: WEARINESS_CAPITULATION,
    goalsA: reparations,
    unjustB: true,
  }));
  assert.equal(loses.punitive, true);
  const wins = settleWar(baseWar({
    wearinessB: WEARINESS_CAPITULATION,
    goalsA: reparations,
    unjustA: true,
  }));
  assert.equal(wins.punitive, false);
});
