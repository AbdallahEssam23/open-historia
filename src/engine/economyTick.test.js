import test from "node:test";
import assert from "node:assert/strict";

import { MAX_STEPS } from "./economyConstants.js";
import { normalizeShocks } from "./economyShocks.js";
import { advanceEconomy, makePolityEconomy, stepPolityMonth } from "./economyTick.js";
import { addGameMonths, gameDateYear } from "../runtime/gameDates.js";

const polityFixture = (overrides = {}) =>
  makePolityEconomy({
    population: 100_000_000,
    gdp: 1_000_000_000_000,
    gdpPerCapita: 10_000,
    gdpGrowth: 2,
    inflation: 4,
    unemployment: 8,
    publicDebt: 90,
    budgetBalance: -4,
    stability: 60,
    gdpBreakdown: { agriculture: 10, industry: 35, services: 55 },
    ...overrides,
  });

const noShock = { population: 1, gdp: 1, inflation: 0, unemployment: 0, stability: 0 };

test("one month of peace moves growth, population and inflation in the right direction", () => {
  const before = polityFixture();
  const after = stepPolityMonth(before, { year: 2026, multipliers: noShock });
  assert.ok(after.population > before.population, "population grows");
  assert.ok(after.gdpPerCapita > before.gdpPerCapita, "output per head grows");
  assert.ok(after.gdpGrowth > 0);
  assert.ok(after.inflation < before.inflation, "inflation reverts toward its target");
});

test("a growth bonus raises the reported annual growth", () => {
  const before = polityFixture();
  const plain = stepPolityMonth(before, { year: 2026, multipliers: noShock });
  const boosted = stepPolityMonth(before, { year: 2026, multipliers: noShock, growthBonus: 0.5 });
  assert.ok(boosted.gdpGrowth > plain.gdpGrowth, "the bonus lifts growth");
  assert.ok(
    Math.abs((boosted.gdpGrowth - plain.gdpGrowth) - 0.5) < 0.001,
    "the bonus is applied as percentage points",
  );
  assert.equal(
    stepPolityMonth(before, { year: 2026, multipliers: noShock, growthBonus: 0 }).gdpGrowth,
    plain.gdpGrowth,
  );
});

test("no term can leave a bound, however hostile the shock", () => {
  const before = polityFixture({ publicDebt: 395, unemployment: 58, inflation: -4, stability: 3 });
  const hostile = { population: 0.99, gdp: 0.5, inflation: 50, unemployment: 20, stability: -30 };
  let next = before;
  for (let i = 0; i < 60; i += 1) next = stepPolityMonth(next, { year: 2026, multipliers: hostile });
  assert.ok(next.population > 0);
  assert.ok(next.gdpPerCapita > 0);
  assert.ok(next.publicDebt <= 400);
  assert.ok(next.unemployment >= 0 && next.unemployment <= 60);
  assert.ok(next.inflation >= -5 && next.inflation <= 2000);
  assert.ok(next.stability >= 0 && next.stability <= 100);
  const sectors = next.gdpBreakdown.agriculture + next.gdpBreakdown.industry + next.gdpBreakdown.services;
  assert.ok(Math.abs(sectors - 100) < 0.001, `sectors sum to ${sectors}`);
});

test("a component ledger is stepped per component and its sum is the polity total", () => {
  const before = polityFixture({
    population: 0,
    gdp: 0,
    components: [
      { geography: "core", group: "core", population: 60_000_000, gdpPerCapita: 12_000 },
      { geography: "island", group: "overseas/dependent", population: 40_000_000, gdpPerCapita: 7_000 },
    ],
  });
  const after = stepPolityMonth(before, { year: 2026, multipliers: noShock });
  assert.equal(after.components.length, 2);
  const summed = after.components.reduce((total, c) => total + c.population * c.gdpPerCapita, 0);
  assert.ok(Math.abs(summed - after.gdp) < 1, "GDP is the ledger sum");
});

test("the advance is idempotent and recomputable", () => {
  const origin = { month: 0, polities: { France: polityFixture() } };
  const once = advanceEconomy(origin, { startDate: "2026-01-01", months: 6, seed: "s" });
  const twice = advanceEconomy(origin, { startDate: "2026-01-01", months: 6, seed: "s" });
  assert.deepEqual(once.state, twice.state, "same inputs, same state");

  const firstThree = advanceEconomy(origin, { startDate: "2026-01-01", months: 3, seed: "s" });
  const threeThenThree = advanceEconomy(firstThree.state, { startDate: "2026-04-01", months: 3, seed: "s" });
  const six = advanceEconomy(origin, { startDate: "2026-01-01", months: 6, seed: "s" });
  assert.deepEqual(threeThenThree.state.polities, six.state.polities, "3 then 3 equals 6 from the origin");
});

test("the step count is capped and the journal says so", () => {
  const origin = { month: 0, polities: { France: polityFixture() } };
  const { journal } = advanceEconomy(origin, { startDate: "2026-01-01", months: 10_000, seed: "s" });
  assert.equal(journal.steps, MAX_STEPS);
  assert.equal(journal.capped, true);
});

test("a shock is visible while it runs and gone afterwards", () => {
  const origin = { month: 0, polities: { France: polityFixture() } };
  const { valid } = normalizeShocks([{ kind: "sanctions", severity: 3, durationMonths: 3 }]);
  const { state, journal } = advanceEconomy(origin, {
    startDate: "2026-01-01",
    months: 6,
    seed: "s",
    shocks: valid,
  });
  assert.equal(journal.shockedMonths, 3);
  assert.ok(state.polities.France.gdpGrowth < origin.polities.France.gdpGrowth);
});

test("the trade field lifts growth and stability, and only for the named polity", () => {
  const origin = { month: 0, polities: { France: polityFixture(), Spain: polityFixture() } };
  const trade = { France: { population: 1, gdp: 1.1, inflation: 0, unemployment: 0, stability: 0.2 } };
  const plain = advanceEconomy(origin, { startDate: "2026-01-01", months: 6, seed: "s" });
  const withTrade = advanceEconomy(origin, { startDate: "2026-01-01", months: 6, seed: "s", trade });
  assert.ok(withTrade.state.polities.France.gdpGrowth > plain.state.polities.France.gdpGrowth);
  assert.ok(withTrade.state.polities.France.stability > plain.state.polities.France.stability);
  assert.deepEqual(withTrade.state.polities.Spain, plain.state.polities.Spain, "a polity absent from the field is untouched");
});

test("an empty trade field is byte-for-byte the pre-change advance", () => {
  const origin = { month: 0, polities: { France: polityFixture() } };
  const absent = advanceEconomy(origin, { startDate: "2026-01-01", months: 6, seed: "s" });
  const empty = advanceEconomy(origin, { startDate: "2026-01-01", months: 6, seed: "s", trade: {} });
  assert.deepEqual(empty.state, absent.state);
});

test("the pools ride the same clock as the economy", () => {
  const origin = { month: 0, polities: { France: polityFixture() } };
  const { state } = advanceEconomy(origin, {
    startDate: "2026-01-01",
    months: 3,
    seed: "s",
    upkeep: { France: { manpower: 10_000, materiel: 5 } },
  });
  assert.ok(state.pools.France.manpower > 0);
  assert.ok(state.shortfall.France.manpower === 0);
});

test("with no upkeep and no posture the economy is byte-identical to before", () => {
  const origin = { month: 0, polities: { France: polityFixture() } };
  const withPools = advanceEconomy(origin, { startDate: "2026-01-01", months: 6, seed: "s" });

  // Baseline: the same six per-polity steps driven directly, without the pools
  // path, on the identity shock multipliers. If the default posture or the
  // shortfall composition ever stopped being the identity, this would diverge.
  let expected = origin.polities.France;
  for (let step = 1; step <= 6; step += 1) {
    const year = gameDateYear(addGameMonths("2026-01-01", step));
    expected = stepPolityMonth(expected, { year, multipliers: noShock });
  }
  assert.deepEqual(withPools.state.polities, { France: expected });
});

test("a carried shortfall drags stability, and the posture drags output", () => {
  const origin = {
    month: 0,
    polities: { France: polityFixture() },
    shortfall: { France: { manpower: 1_000_000, materiel: 0 } },
  };
  const upkeep = { France: { manpower: 1_000_000, materiel: 0 } };
  const base = advanceEconomy(origin, { startDate: "2026-01-01", months: 1, seed: "s", upkeep });
  const war = advanceEconomy(
    { ...origin },
    { startDate: "2026-01-01", months: 1, seed: "s", upkeep, posture: { France: "total" } },
  );
  assert.ok(war.state.polities.France.stability < base.state.polities.France.stability);
  assert.ok(war.state.polities.France.gdpGrowth < base.state.polities.France.gdpGrowth);
});

const clockState = () => ({
  month: 0,
  polities: {
    France: {
      population: 60_000_000,
      gdp: 2e12,
      gdpPerCapita: 33_000,
      gdpGrowth: 0,
      inflation: 2,
      unemployment: 8,
      publicDebt: 90,
      budgetBalance: 0,
      stability: 60,
      gdpBreakdown: { agriculture: 5, industry: 40, services: 55 },
      components: [],
      jitter: 0,
    },
  },
  pools: { France: { manpower: 5_000_000, materiel: 50_000 } },
  shortfall: {},
});

test("no orders leaves the economy advance additive", () => {
  const withField = advanceEconomy(clockState(), { startDate: "2026-01-01", months: 3 });
  assert.deepEqual(withField.state.production, {});
  assert.deepEqual(withField.completions, []);
  assert.deepEqual(withField.rejectedProduction, []);
});

test("an order is paid before the first month and completes on its month step", () => {
  const result = advanceEconomy(clockState(), {
    startDate: "2026-01-01",
    months: 3,
    orders: [{ polity: "France", kind: "unit", type: "garrison", count: 1 }],
  });
  // 3000 manpower and 3 materiel were drawn from the opening pool.
  assert.ok(result.completions.length === 1);
  assert.equal(result.completions[0].polity, "France");
  assert.equal(result.completions[0].type, "garrison");
  assert.equal(result.completions[0].monthOffset, 1);
  assert.deepEqual(result.state.production, {});
});

test("a line that cannot finish in the span is persisted for the next span", () => {
  const first = advanceEconomy(clockState(), {
    startDate: "2026-01-01",
    months: 1,
    orders: [{ polity: "France", kind: "building", type: "industrial_plant", count: 1, at: "Lyon" }],
  });
  assert.equal(first.completions.length, 0);
  assert.equal(first.state.production.France.active.monthsDone, 1);
  assert.equal(first.state.production.France.active.monthsTotal, 8);

  const second = advanceEconomy(
    { ...clockState(), production: first.state.production, pools: first.state.pools },
    { startDate: "2026-02-01", months: 7 },
  );
  assert.equal(second.completions.length, 1);
  assert.equal(second.completions[0].type, "industrial_plant");
  assert.equal(second.completions[0].at, "Lyon");
});

test("an order the pool cannot pay is rejected and never enters the line", () => {
  const result = advanceEconomy(
    { ...clockState(), pools: { France: { manpower: 5_000_000, materiel: 1_000 } } },
    {
      startDate: "2026-01-01",
      months: 3,
      orders: [{ polity: "France", kind: "unit", type: "naval", count: 20 }],
    },
  );
  assert.equal(result.completions.length, 0);
  assert.equal(result.rejectedProduction.length, 1);
  assert.match(result.rejectedProduction[0].reason, /cannot afford/);
});

test("research advances the same number of months as the economy", () => {
  const state = {
    month: 0,
    polities: { France: makePolityEconomy({ population: 50000000, gdp: 1000, gdpPerCapita: 20 }) },
    pools: {},
    shortfall: {},
    research: {
      France: {
        points: 12,
        programmes: [{ id: "r1", domain: "industrial", scale: "small", points: 0, priority: "high", startedAt: "", status: "active" }],
      },
    },
  };
  const out = advanceEconomy(state, { startDate: "2000-01-01", months: 3, seed: "s" });
  // 12 points a month for 3 months is 36; a small industrial programme costs 24,
  // so it completes, and the run is exactly 3 months for both.
  assert.equal(out.journal.steps, 3);
  assert.equal(out.state.research.France.programmes[0].accumulated, 24);
  assert.equal(out.researchCompletions.length, 1);
  assert.equal(out.researchCompletions[0].id, "r1");
  assert.equal(out.researchCompletions[0].polity, "France");
});

test("a polity with no research state is untouched and collects nothing", () => {
  const state = {
    month: 0,
    polities: { France: makePolityEconomy({ population: 1000000, gdp: 10, gdpPerCapita: 10 }) },
    pools: {}, shortfall: {},
  };
  const out = advanceEconomy(state, { startDate: "2000-01-01", months: 2, seed: "s" });
  assert.deepEqual(out.researchCompletions, []);
});

test("research effects reach the line, the pools and the growth", () => {
  const state = {
    month: 0,
    polities: { France: polityFixture() },
    pools: { France: { manpower: 100000, materiel: 1000 } },
  };
  const orders = [{ polity: "France", type: "naval", count: 1 }];
  const plain = advanceEconomy(state, { startDate: "2026-01-01", months: 1, seed: "s", orders });
  const boosted = advanceEconomy(state, {
    startDate: "2026-01-01",
    months: 1,
    seed: "s",
    orders,
    researchEffects: { France: { production: 6, pools: 6, economy: 6 } },
  });
  assert.equal(plain.state.production.France.active.monthsTotal, 6);
  assert.equal(boosted.state.production.France.active.monthsTotal, 5);
  assert.ok(boosted.state.pools.France.manpower > plain.state.pools.France.manpower);
  assert.ok(boosted.state.polities.France.gdpGrowth > plain.state.polities.France.gdpGrowth);
});

test("no research effects leaves the advance unchanged", () => {
  const state = { month: 0, polities: { France: polityFixture() } };
  const absent = advanceEconomy(state, { startDate: "2026-01-01", months: 3, seed: "s" });
  const empty = advanceEconomy(state, { startDate: "2026-01-01", months: 3, seed: "s", researchEffects: {} });
  assert.deepEqual(absent.state, empty.state);
});
