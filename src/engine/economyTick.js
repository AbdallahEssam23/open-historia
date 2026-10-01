/*! Open Historia - deterministic economy: the month step (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The engine's whole behavior is these two functions. `stepPolityMonth` is the
// economy; `advanceEconomy` is the clock, and it is deliberately dumb: it walks
// whole months, asks the shock table what is running, and hands each polity to
// the step. Nothing here reads the wall clock, and nothing is stored between
// calls except the state it returns, so re-running a span is exact.

import { addGameMonths, gameDateYear } from "../runtime/gameDates.js";
import { ECONOMY_STEP, MAX_STEPS, eraBandFor } from "./economyConstants.js";
import { clamp, roundTo, stableOrder } from "./economyMath.js";
import { activeMultipliers, shockAppliesTo } from "./economyShocks.js";

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

// `components` is the arithmetic authority when present: the polity totals are
// derived from it, never carried alongside it. `jitter` is stamped here rather
// than in the step so a polity's character cannot change between months.
export const makePolityEconomy = (input = {}) => {
  const components = Array.isArray(input.components)
    ? input.components
      .filter((c) => c && Number.isFinite(Number(c.population)) && Number.isFinite(Number(c.gdpPerCapita)))
      .map((c) => ({
        geography: String(c.geography ?? ""),
        group: String(c.group ?? "core"),
        population: Math.max(0, num(c.population)),
        gdpPerCapita: Math.max(0, num(c.gdpPerCapita)),
      }))
    : [];
  const breakdown = input.gdpBreakdown && typeof input.gdpBreakdown === "object" ? input.gdpBreakdown : {};
  return {
    population: Math.max(0, num(input.population)),
    gdp: Math.max(0, num(input.gdp)),
    gdpPerCapita: Math.max(0, num(input.gdpPerCapita)),
    gdpGrowth: num(input.gdpGrowth),
    inflation: num(input.inflation),
    unemployment: Math.max(0, num(input.unemployment)),
    publicDebt: Math.max(0, num(input.publicDebt)),
    budgetBalance: num(input.budgetBalance),
    stability: clamp(num(input.stability, 50), 0, 100),
    gdpBreakdown: {
      agriculture: Math.max(0, num(breakdown.agriculture)),
      industry: Math.max(0, num(breakdown.industry)),
      services: Math.max(0, num(breakdown.services)),
    },
    components,
    jitter: num(input.jitter),
  };
};

export const stepPolityMonth = (polity, { year, multipliers }) => {
  const band = eraBandFor(year);
  const inputComponents = Array.isArray(polity.components) ? polity.components : [];
  const total = inputComponents.length
    ? inputComponents.reduce((sum, c) => sum + c.population, 0)
    : polity.population;
  const stabilityFactor = 0.5 + clamp(total > 0 ? polity.stability : 50, 0, 100) / 100;

  // One component, one month. Population and output per head move; the
  // component is the unit the ledger aggregates, so writing the totals here
  // would be the same mistake mergeCountryStatPatch exists to prevent.
  const stepOneComponent = (component) => {
    const population = Math.max(1, component.population);
    const growth = band.populationMonthly * stabilityFactor * multipliers.population;
    return { ...component, population: population * (1 + growth) };
  };

  const structure = (polity.gdpBreakdown.industry + polity.gdpBreakdown.services) / 100;
  const debtDrag = 1
    - ECONOMY_STEP.DEBT_DRAG_MAX
    * clamp((polity.publicDebt - ECONOMY_STEP.DEBT_DRAG_START) / 100, 0, 1);
  const unempDrag = 1
    - ECONOMY_STEP.UNEMP_DRAG
    * clamp((polity.unemployment - ECONOMY_STEP.NATURAL_UNEMPLOYMENT) / 100, 0, 1);
  const character = 1
    + ECONOMY_STEP.CHARACTER_AMPLITUDE
    * clamp(polity.jitter * ECONOMY_STEP.CHARACTER_SCALE * 2, -1, 1);
  const gpcGrowth = band.productivityMonthly
    * (1 + ECONOMY_STEP.SECTOR_LIFT * structure)
    * debtDrag * unempDrag * character * multipliers.gdp;

  const stepPerHead = (component) => ({
    ...component,
    gdpPerCapita: Math.max(0.0001, component.gdpPerCapita * (1 + gpcGrowth)),
  });

  let components = inputComponents;
  let population;
  if (inputComponents.length) {
    components = inputComponents
      .map((component) => stepPerHead(stepOneComponent(component)))
      .sort((a, b) => (a.geography < b.geography ? -1 : a.geography > b.geography ? 1 : 0));
    population = components.reduce((sum, c) => sum + c.population, 0);
  } else {
    population = stepOneComponent({ population: polity.population, gdpPerCapita: polity.gdpPerCapita }).population;
  }

  const gdpPerCapita = components.length
    ? components.reduce((sum, c) => sum + c.population * c.gdpPerCapita, 0) / Math.max(1, population)
    : stepPerHead({ gdpPerCapita: polity.gdpPerCapita }).gdpPerCapita;

  const annualGrowth = gpcGrowth * 12 * 100;

  let inflation = polity.inflation
    + ECONOMY_STEP.INFLATION_REVERSION
    * (
      ECONOMY_STEP.INFLATION_TARGET
      + ECONOMY_STEP.DEFICIT_INFLATION
        * clamp(-polity.budgetBalance - ECONOMY_STEP.DEFICIT_THRESHOLD, 0, 40)
      - polity.inflation
    )
    + multipliers.inflation;
  inflation = clamp(inflation, ECONOMY_STEP.INFLATION_MIN, ECONOMY_STEP.INFLATION_MAX);

  const gap = annualGrowth - ECONOMY_STEP.TREND_GROWTH;
  let unemployment = polity.unemployment
    - (ECONOMY_STEP.OKUN * gap) / 12
    + ECONOMY_STEP.UNEMP_REVERSION * (ECONOMY_STEP.NATURAL_UNEMPLOYMENT - polity.unemployment)
    + multipliers.unemployment;
  unemployment = clamp(unemployment, 0, ECONOMY_STEP.UNEMP_MAX);

  const revenue = ECONOMY_STEP.REVENUE_PER_GDP * (1 + structure * 0.15);
  const spending = ECONOMY_STEP.SPENDING_PER_GDP
    + ECONOMY_STEP.MILITARY_PER_GDP * clamp(multipliers.gdp > 1 ? 1.5 : 1, 1, 1.5);
  const budgetBalance = clamp((revenue - spending) * 100, -60, 30);

  const realGrowth = annualGrowth / 100;
  const interest = (polity.publicDebt * ECONOMY_STEP.RATE_MONTHLY * 12) / 100;
  let publicDebt = polity.publicDebt * (1 + (interest - realGrowth) / 12) - budgetBalance / 12;
  publicDebt = clamp(publicDebt, 0, ECONOMY_STEP.DEBT_MAX);

  const equilibrium = ECONOMY_STEP.STABILITY_BASE
    + ECONOMY_STEP.STAB_GROWTH * annualGrowth
    - ECONOMY_STEP.STAB_INFLATION * inflation
    - ECONOMY_STEP.STAB_UNEMP * (unemployment - ECONOMY_STEP.NATURAL_UNEMPLOYMENT);
  const stability = clamp(
    polity.stability + ECONOMY_STEP.STAB_REVERSION * (equilibrium - polity.stability) + multipliers.stability,
    0,
    100,
  );

  const sectorTotal = polity.gdpBreakdown.agriculture
    + polity.gdpBreakdown.industry
    + polity.gdpBreakdown.services;
  const gdpBreakdown = sectorTotal > 0
    ? {
      agriculture: roundTo((polity.gdpBreakdown.agriculture / sectorTotal) * 100, 4),
      industry: roundTo((polity.gdpBreakdown.industry / sectorTotal) * 100, 4),
      services: roundTo((polity.gdpBreakdown.services / sectorTotal) * 100, 4),
    }
    : polity.gdpBreakdown;

  // Store the rounded ledger rows first, then sum THOSE: the polity GDP must be
  // exactly the sum a reader gets by adding the component table up, not a
  // separately rounded total that disagrees with it in the last digits.
  const storedComponents = components.map((c) => ({
    ...c,
    population: Math.round(c.population),
    gdpPerCapita: roundTo(c.gdpPerCapita, 4),
  }));
  const nextPopulation = Math.max(1, Math.round(population));
  const nextGdp = storedComponents.length
    ? storedComponents.reduce((sum, c) => sum + c.population * c.gdpPerCapita, 0)
    : nextPopulation * gdpPerCapita;

  return {
    ...polity,
    population: nextPopulation,
    gdp: roundTo(nextGdp, 2),
    gdpPerCapita: roundTo(gdpPerCapita, 4),
    gdpGrowth: roundTo(annualGrowth, 4),
    inflation: roundTo(inflation, 4),
    unemployment: roundTo(unemployment, 4),
    publicDebt: roundTo(publicDebt, 4),
    budgetBalance: roundTo(budgetBalance, 4),
    stability: roundTo(stability, 4),
    gdpBreakdown,
    components: storedComponents,
  };
};

export const advanceEconomy = (state, { startDate, months, shocks = [], seed = "" } = {}) => {
  const requested = Math.trunc(Number(months)) || 0;
  const steps = Math.max(0, Math.min(MAX_STEPS, requested));
  const capped = requested > steps;
  const origin = state?.month ?? 0;
  let polities = { ...(state?.polities ?? {}) };
  let shockedMonths = 0;

  // Shock spans are relative to the moment they were declared, so they are
  // shifted once onto the absolute clock rather than re-based every step.
  const running = (Array.isArray(shocks) ? shocks : []).map((shock) => ({
    ...shock,
    startMonth: shock.startMonth + origin,
    endMonth: shock.endMonth + origin,
  }));

  for (let step = 1; step <= steps; step += 1) {
    // The month being simulated out of `origin` is `origin` itself: month 0 is
    // the span from origin to origin+1. Using `origin + step` would skip the
    // opening month of every shock span.
    const month = origin + step - 1;
    const year = gameDateYear(addGameMonths(startDate, step));
    if (running.some((shock) => month >= shock.startMonth && month < shock.endMonth)) shockedMonths += 1;

    const next = {};
    for (const name of stableOrder(Object.keys(polities))) {
      const own = running.filter((shock) => shockAppliesTo(shock, name));
      next[name] = stepPolityMonth(polities[name], {
        year,
        multipliers: activeMultipliers(own, month),
      });
    }
    polities = next;
  }

  return {
    state: { month: origin + steps, polities },
    journal: { steps, capped, shockedMonths, seed },
  };
};
