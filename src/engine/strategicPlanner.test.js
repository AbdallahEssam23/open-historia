import test from "node:test";
import assert from "node:assert/strict";

import { runBalanceScenario } from "./balanceHarness.js";
import {
  MAX_PLAN_STEPS,
  derivePlan,
  describePlan,
  planEconomyInputs,
  scoreGoals,
} from "./strategicPlanner.js";

const RICH = { gdpPerCapita: 30_000, gdpGrowth: 3, publicDebt: 20, unemployment: 3, stability: 80, powerShare: 0.6, activeWars: 0, claims: 0, allies: 3 };
const WARRING = { publicDebt: 140, unemployment: 12, stability: 30, powerShare: 0.08, activeWars: 2, claims: 3, allies: 0 };
const ISOLATED = { publicDebt: 60, unemployment: 8, stability: 60, powerShare: 0.2, activeWars: 0, claims: 0, allies: 0 };

const topGoal = (state, personality) => scoreGoals({ state, personality })[0].goal;
const actionsOf = (plan) => plan.steps.map((step) => step.action);

test("scoreGoals returns every goal, best first", () => {
  const scores = scoreGoals({ state: RICH, personality: { opportunism: 75, patience: 60 } });
  assert.equal(scores.length, 3);
  for (let i = 1; i < scores.length; i += 1) {
    assert.ok(scores[i - 1].score >= scores[i].score, "scores descend");
  }
});

test("scoreGoals breaks a tie by goal id, by code unit", () => {
  // At this state the economic and bloc ladders meet exactly; the id ordering
  // decides, and must not depend on the locale.
  const state = { unemployment: 0, publicDebt: 0, powerShare: 0.35, activeWars: 0, claims: 0, allies: 0 };
  const scores = scoreGoals({ state, personality: { patience: 96.6666 } });
  assert.equal(scores[0].score, scores[1].score, "the top two tie");
  assert.equal(scores[0].goal, "economic_expansion");
  assert.equal(scores[1].goal, "political_bloc");
});

test("a rich, peaceful power prefers economic expansion", () => {
  assert.equal(topGoal(RICH, { opportunism: 75, patience: 60, aggression: 30 }), "economic_expansion");
});

test("a warring, weak, aggrieved power prefers military insurance", () => {
  assert.equal(topGoal(WARRING, { aggression: 80, grievance: 80, patience: 30 }), "military_insurance");
});

test("an isolated, patient, honorable power prefers a political bloc", () => {
  assert.equal(topGoal(ISOLATED, { patience: 80, honor: 75, aggression: 25 }), "political_bloc");
});

test("a plan emits prerequisites before the action that needs them", () => {
  const plan = derivePlan({
    polity: "B",
    state: { publicDebt: 40, unemployment: 5, stability: 65, powerShare: 0.3, activeWars: 0, allies: 1 },
    personality: { opportunism: 80, patience: 70 },
  });
  assert.equal(plan.goal, "economic_expansion");
  assert.deepEqual(actionsOf(plan), ["invest_industry", "expand_output"]);
  assert.ok(plan.totalCost > 0);
});

test("a plan only names options the legal menu offers", () => {
  const without = derivePlan({ polity: "B", state: ISOLATED, personality: { patience: 80, honor: 80 }, menu: { seekPeace: [] } });
  assert.equal(without.goal, "political_bloc");
  assert.equal(actionsOf(without).includes("deescalate"), false);

  const withPeace = derivePlan({ polity: "B", state: ISOLATED, personality: { patience: 80, honor: 80 }, menu: { seekPeace: [{ warId: "w1" }] } });
  assert.equal(actionsOf(withPeace)[0], "deescalate");
});

test("a satisfied prerequisite is not re-emitted", () => {
  const plan = derivePlan({
    polity: "B",
    state: { ...WARRING, mobilization: "partial" },
    personality: { aggression: 85, grievance: 80 },
  });
  assert.equal(plan.goal, "military_insurance");
  assert.equal(actionsOf(plan).includes("mobilize_partial"), false, "already mobilized");
  assert.deepEqual(actionsOf(plan), ["invest_readiness", "fortify_defenses"]);
});

test("a plan is capped and deterministic", () => {
  const input = { polity: "B", state: WARRING, personality: { aggression: 85, grievance: 80 } };
  const first = derivePlan(input);
  assert.ok(first.steps.length <= MAX_PLAN_STEPS);
  assert.deepEqual(first, derivePlan(input));
});

test("an empty plan yields empty economy inputs", () => {
  assert.deepEqual(planEconomyInputs(null, { polity: "B" }), { posture: {}, researchEffects: {}, trade: {} });
  assert.deepEqual(planEconomyInputs({ steps: [] }, { polity: "B" }), { posture: {}, researchEffects: {}, trade: {} });
});

test("a mobilization plan sets a posture", () => {
  const plan = derivePlan({ polity: "B", state: WARRING, personality: { aggression: 85, grievance: 80 } });
  const inputs = planEconomyInputs(plan, { polity: "B" });
  assert.equal(inputs.posture.B, "partial");
  assert.equal(inputs.researchEffects.B.pools, 2);
});

test("investment research is summed and capped", () => {
  const plan = {
    polity: "B",
    steps: [
      { action: "a", economy: { research: { economy: 5 } } },
      { action: "b", economy: { research: { economy: 5 } } },
    ],
  };
  const inputs = planEconomyInputs(plan, { polity: "B" });
  assert.equal(inputs.researchEffects.B.economy, 6, "capped at MAX_RESEARCH_EFFECT_POINTS");
});

test("a bloc plan emits a positive trade vector", () => {
  const plan = derivePlan({ polity: "B", state: ISOLATED, personality: { patience: 80, honor: 80 } });
  const inputs = planEconomyInputs(plan, { polity: "B" });
  assert.ok(inputs.trade.B, "a trade vector is present");
  assert.ok(inputs.trade.B.gdp > 1, "gdp is lifted");
  assert.equal(inputs.trade.B.population, 1);
});

test("describePlan is one bounded line and deterministic", () => {
  const plan = derivePlan({ polity: "B", state: WARRING, personality: { aggression: 85, grievance: 80 } });
  const line = describePlan(plan);
  assert.equal(line.includes("\n"), false);
  assert.ok(line.length <= 200);
  assert.equal(line, describePlan(plan));
});

// The requirement that a plan be inspectable through the balance harness: run
// the same scenario with and without each plan's economy inputs and confirm the
// steered polity moves in the expected direction.
test("a plan steers the balance harness in the expected direction", () => {
  const fixture = (name) => ({
    name,
    population: 100_000_000,
    gdp: 1_000_000_000_000,
    gdpPerCapita: 10_000,
    gdpGrowth: 2,
    inflation: 4,
    unemployment: 8,
    publicDebt: 60,
    budgetBalance: -2,
    stability: 60,
    gdpBreakdown: { agriculture: 20, industry: 40, services: 40 },
    jitter: 0,
  });
  const scenario = { polities: [fixture("A"), fixture("B")], months: 240, sampleEvery: 24 };
  const growthOf = (inputs) => {
    const report = runBalanceScenario({ ...scenario, ...inputs });
    return report.polities.find((entry) => entry.name === "B").growthMultiple;
  };
  const baseline = growthOf({});

  const econ = derivePlan({ polity: "B", state: { publicDebt: 40, unemployment: 5, stability: 65, powerShare: 0.3 }, personality: { opportunism: 80, patience: 70 } });
  assert.equal(econ.goal, "economic_expansion");
  assert.ok(growthOf(planEconomyInputs(econ, { polity: "B" })) > baseline, "economic expansion raises growth");

  const mil = derivePlan({ polity: "B", state: WARRING, personality: { aggression: 85, grievance: 80 } });
  assert.equal(mil.goal, "military_insurance");
  assert.ok(growthOf(planEconomyInputs(mil, { polity: "B" })) < baseline, "mobilization drags growth");

  const bloc = derivePlan({ polity: "B", state: ISOLATED, personality: { patience: 80, honor: 80 } });
  assert.equal(bloc.goal, "political_bloc");
  assert.ok(growthOf(planEconomyInputs(bloc, { polity: "B" })) > baseline, "the bloc lifts trade");
});
