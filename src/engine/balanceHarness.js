/*! Open Historia - deterministic economy: the headless balance harness (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/engine/balanceHarness.test.js
//
// The turn engines are pure, so they already run headless. This module is the
// long-horizon driver the roadmap asks for: it composes the existing
// `advanceEconomy` clock over many polities and months and reports two readings
// a balance pass cares about, snowballing (how concentrated the world economy
// has become) and collapse (which polities hit a floor). It adds no phase and
// changes no constant; it only measures what the engine already does. It
// imports only engine modules, so enginePurity.test.js covers it.

import { addGameMonths } from "../runtime/gameDates.js";
import { ECONOMY_STEP, MAX_STEPS } from "./economyConstants.js";
import { advanceEconomy, makePolityEconomy } from "./economyTick.js";
import { jitterFor, stableOrder } from "./economyMath.js";

// One frozen table of readings, so "why did the harness say that" is answered by
// reading this rather than by tracing the loop. The numbers are first-draft:
// the tests pin the shape and the direction, not a specific magnitude.
export const BALANCE_THRESHOLDS = Object.freeze({
  // A scenario snowballs when the last sample's leading share of world GDP
  // exceeds the first sample's by at least this much, or when the fastest
  // growing polity outgrows the slowest by at least this ratio. The economy's
  // drags and reversion keep share drift modest, so the growth ratio is the
  // more sensitive of the two readings.
  snowballTopShareDelta: 0.008,
  snowballGrowthRatio: 1.04,
  // A polity collapses when stability reaches this floor ...
  collapseStabilityFloor: 1,
  // ... or debt reaches the engine ceiling (the debt clamp) ...
  debtCeiling: ECONOMY_STEP.DEBT_MAX - 0.5,
  // ... or real GDP falls to this fraction of where it started.
  collapseGdpDropFraction: 0.5,
});

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

// The snowballing reading: how concentrated a list of values is. Only finite,
// non-negative entries count, so a missing or corrupt figure is skipped rather
// than ranked as zero. `topShare` is the largest share, `hhi` the sum of squared
// shares; both rise as one value pulls away from the field. With no usable
// values, or a total of zero, every share is zero and nothing divides.
export const concentrationOf = (values = []) => {
  const usable = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const total = usable.reduce((sum, value) => sum + value, 0);
  if (!usable.length || total <= 0) return { total: 0, count: usable.length, topShare: 0, hhi: 0 };
  let top = 0;
  let hhi = 0;
  for (const value of usable) {
    const share = value / total;
    if (share > top) top = share;
    hhi += share * share;
  }
  return { total, count: usable.length, topShare: top, hhi };
};

const normalizePolities = (polities) => {
  const entries = Array.isArray(polities)
    ? polities.map((entry) => ({ name: String(entry?.name ?? "").trim(), input: entry ?? {} }))
    : Object.entries(polities ?? {}).map(([name, input]) => ({ name: String(name).trim(), input: input ?? {} }));
  return entries
    .filter((entry) => entry.name)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
};

const economyOf = (state, name) => state?.polities?.[name] ?? null;

// Drive the pure economy clock over a scenario in one-month steps and sample it
// every `sampleEvery` months. A month owns its own call so the year the era band
// reads advances with the cursor, and one call owns the orders, so they are paid
// and enqueued once at the span opening rather than every month.
export const runBalanceScenario = ({
  polities = [],
  months = 120,
  startDate = "2000-01-01",
  sampleEvery = 12,
  shocks = [],
  trade = {},
  posture = {},
  upkeep = {},
  researchEffects = {},
  orders = [],
  seed = "balance",
} = {}) => {
  const requested = Math.trunc(num(months));
  const steps = Math.max(0, Math.min(MAX_STEPS, requested));
  const every = Math.max(1, Math.trunc(num(sampleEvery, 1)));
  const entries = normalizePolities(polities);
  const names = stableOrder(entries.map((entry) => entry.name));

  let state = { month: 0, polities: {}, pools: {}, shortfall: {}, production: {}, research: {} };
  for (const { name, input } of entries) {
    // A pinned jitter is honoured so two identical fixtures stay identical; a
    // missing one gets the same reproducible per-polity character the game uses.
    state.polities[name] = makePolityEconomy({
      ...input,
      jitter: Number.isFinite(Number(input?.jitter)) ? Number(input.jitter) : jitterFor(seed, name),
    });
  }

  const track = {};
  for (const name of names) {
    const opening = economyOf(state, name);
    track[name] = {
      startGdp: opening?.gdp ?? 0,
      endGdp: opening?.gdp ?? 0,
      endPopulation: opening?.population ?? 0,
      minStability: opening?.stability ?? 0,
      maxDebt: opening?.publicDebt ?? 0,
    };
  }

  const sample = (month) => {
    const gdps = names.map((name) => economyOf(state, name)?.gdp ?? 0);
    const concentration = concentrationOf(gdps);
    const stabilities = names.map((name) => num(economyOf(state, name)?.stability));
    const debts = names.map((name) => num(economyOf(state, name)?.publicDebt));
    return {
      month,
      count: concentration.count,
      total: concentration.total,
      topShare: concentration.topShare,
      hhi: concentration.hhi,
      totalGdp: concentration.total,
      meanStability: stabilities.length ? stabilities.reduce((sum, value) => sum + value, 0) / stabilities.length : 0,
      maxDebt: debts.length ? Math.max(...debts) : 0,
    };
  };

  const samples = [sample(0)];
  let cursor = startDate;
  for (let month = 1; month <= steps; month += 1) {
    state = advanceEconomy(state, {
      startDate: cursor,
      months: 1,
      shocks,
      seed,
      upkeep,
      posture,
      researchEffects,
      trade,
      orders: month === 1 ? orders : [],
    }).state;
    cursor = addGameMonths(cursor, 1);
    for (const name of names) {
      const polity = economyOf(state, name);
      const summary = track[name];
      summary.endGdp = polity?.gdp ?? summary.endGdp;
      summary.endPopulation = polity?.population ?? summary.endPopulation;
      summary.minStability = Math.min(summary.minStability, num(polity?.stability));
      summary.maxDebt = Math.max(summary.maxDebt, num(polity?.publicDebt));
    }
    if (month % every === 0 || month === steps) samples.push(sample(month));
  }

  const politiesReport = names.map((name) => {
    const summary = track[name];
    const growthMultiple = summary.startGdp > 0 ? summary.endGdp / summary.startGdp : 0;
    const collapsed = summary.minStability <= BALANCE_THRESHOLDS.collapseStabilityFloor
      || summary.maxDebt >= BALANCE_THRESHOLDS.debtCeiling
      || summary.endGdp < summary.startGdp * (1 - BALANCE_THRESHOLDS.collapseGdpDropFraction);
    return { name, ...summary, growthMultiple, collapsed };
  });

  const opening = samples[0];
  const closing = samples[samples.length - 1];
  const multiples = politiesReport.map((entry) => entry.growthMultiple).filter((value) => value > 0);
  const fastest = multiples.length ? Math.max(...multiples) : 0;
  const slowest = multiples.length ? Math.min(...multiples) : 0;
  const growthRatio = slowest > 0 ? fastest / slowest : 1;
  const snowball = closing.topShare - opening.topShare >= BALANCE_THRESHOLDS.snowballTopShareDelta
    || growthRatio >= BALANCE_THRESHOLDS.snowballGrowthRatio;

  return {
    months: steps,
    samples,
    polities: politiesReport,
    snowball,
    growthRatio,
    collapsed: politiesReport.filter((entry) => entry.collapsed).map((entry) => entry.name),
    concentration: {
      opening: concentrationOf(names.map((name) => track[name].startGdp)),
      closing: concentrationOf(names.map((name) => track[name].endGdp)),
    },
  };
};
