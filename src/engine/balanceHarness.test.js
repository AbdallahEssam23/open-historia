import test from "node:test";
import assert from "node:assert/strict";

import { MAX_STEPS } from "./economyConstants.js";
import { BALANCE_THRESHOLDS, concentrationOf, runBalanceScenario } from "./balanceHarness.js";

// A pinned `jitter` keeps two identically described polities byte-for-byte the
// same, which is what lets the "balanced stays balanced" case be exact.
const polityFixture = (name, overrides = {}) => ({
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
  gdpBreakdown: { agriculture: 10, industry: 35, services: 55 },
  jitter: 0,
  ...overrides,
});

test("concentrationOf reads an empty list as all zero", () => {
  assert.deepEqual(concentrationOf([]), { total: 0, count: 0, topShare: 0, hhi: 0 });
  assert.deepEqual(concentrationOf(), { total: 0, count: 0, topShare: 0, hhi: 0 });
});

test("concentrationOf puts a single value at total concentration", () => {
  assert.deepEqual(concentrationOf([5]), { total: 5, count: 1, topShare: 1, hhi: 1 });
});

test("concentrationOf gives an equal split an even reading", () => {
  const result = concentrationOf([1, 1, 1, 1]);
  assert.equal(result.count, 4);
  assert.equal(result.total, 4);
  assert.equal(result.topShare, 0.25);
  assert.ok(Math.abs(result.hhi - 0.25) < 1e-12, `hhi is ${result.hhi}`);
});

test("concentrationOf reports the leading share", () => {
  const result = concentrationOf([3, 1, 1]);
  assert.equal(result.total, 5);
  assert.equal(result.topShare, 0.6);
});

test("concentrationOf ignores non-finite and negative entries", () => {
  const result = concentrationOf([2, Number.NaN, -3, Number.POSITIVE_INFINITY, 2]);
  assert.equal(result.count, 2);
  assert.equal(result.total, 4);
  assert.equal(result.topShare, 0.5);
});

test("concentrationOf never divides when the total is zero", () => {
  assert.deepEqual(concentrationOf([0, 0, 0]), { total: 0, count: 3, topShare: 0, hhi: 0 });
});

test("a balanced world stays balanced and grows", () => {
  const report = runBalanceScenario({
    polities: ["A", "B", "C", "D"].map((name) => polityFixture(name)),
    months: 120,
    sampleEvery: 12,
  });
  assert.equal(report.months, 120);
  assert.equal(report.samples.length, 11, "opening sample plus one per 12 months");
  assert.equal(report.polities.length, 4);
  assert.equal(report.snowball, false);
  assert.deepEqual(report.collapsed, []);
  assert.equal(report.growthRatio, 1, "identical polities grow at the same rate");
  assert.equal(report.samples[0].topShare, 0.25);
  assert.equal(report.samples[report.samples.length - 1].topShare, 0.25);
  assert.ok(
    report.samples[report.samples.length - 1].totalGdp > report.samples[0].totalGdp,
    "the world economy grows over the span",
  );
  for (const polity of report.polities) {
    assert.ok(polity.growthMultiple > 1, `${polity.name} grew`);
    assert.equal(polity.collapsed, false);
  }
});

test("a structurally advantaged leader snowballs past the field", () => {
  const leader = polityFixture("Leader", {
    gdpBreakdown: { agriculture: 5, industry: 10, services: 85 },
    publicDebt: 15,
    unemployment: 5,
    stability: 75,
  });
  const laggard = {
    gdpBreakdown: { agriculture: 40, industry: 40, services: 20 },
    publicDebt: 45,
    unemployment: 11,
    budgetBalance: -3,
  };
  const report = runBalanceScenario({
    polities: [leader, polityFixture("B", laggard), polityFixture("C", laggard), polityFixture("D", laggard)],
    months: 240,
    sampleEvery: 24,
  });
  assert.equal(report.snowball, true);
  assert.ok(report.growthRatio >= BALANCE_THRESHOLDS.snowballGrowthRatio, `ratio is ${report.growthRatio}`);
  assert.ok(
    report.samples[report.samples.length - 1].topShare > report.samples[0].topShare,
    "the leader's share of world GDP rises",
  );
  assert.deepEqual(report.collapsed, [], "no polity is marked collapsed in this scenario");
});

test("a debt crisis collapses the polity under it", () => {
  const report = runBalanceScenario({
    polities: [polityFixture("A"), polityFixture("B", { publicDebt: 200 })],
    months: 120,
    sampleEvery: 12,
    shocks: [{ kind: "debt_crisis", severity: 3, durationMonths: 120, scope: ["B"] }],
  });
  assert.deepEqual(report.collapsed, ["B"]);
  const struck = report.polities.find((entry) => entry.name === "B");
  assert.ok(struck.collapsed, "the struck polity is collapsed");
  assert.ok(
    struck.maxDebt >= BALANCE_THRESHOLDS.debtCeiling,
    `debt reached the ceiling: ${struck.maxDebt}`,
  );
  const untouched = report.polities.find((entry) => entry.name === "A");
  assert.equal(untouched.collapsed, false);
});

test("the same scenario produces the same report twice", () => {
  const scenario = {
    polities: [polityFixture("A"), polityFixture("B", { gdpBreakdown: { agriculture: 30, industry: 40, services: 30 } })],
    months: 60,
    sampleEvery: 6,
  };
  assert.deepEqual(runBalanceScenario(scenario), runBalanceScenario(scenario));
});

test("the run is capped at the engine's step ceiling", () => {
  const report = runBalanceScenario({
    polities: [polityFixture("A"), polityFixture("B")],
    months: 5_000,
    sampleEvery: 12,
  });
  assert.equal(report.months, MAX_STEPS);
  assert.equal(report.samples.length, Math.ceil(MAX_STEPS / 12) + 1);
});

test("a non-positive sample interval is clamped to one month", () => {
  const report = runBalanceScenario({ polities: [polityFixture("A")], months: 12, sampleEvery: 0 });
  assert.equal(report.samples.length, 13);
});

test("zero months reports only the opening state", () => {
  const report = runBalanceScenario({ polities: [polityFixture("A"), polityFixture("B")], months: 0 });
  assert.equal(report.months, 0);
  assert.equal(report.samples.length, 1);
  assert.equal(report.snowball, false);
  assert.deepEqual(report.collapsed, []);
});
