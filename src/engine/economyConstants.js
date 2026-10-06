/*! Open Historia - deterministic economy: the auditable constants (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One frozen table per concern, so "why did the economy do that" is answered by
// reading this file rather than by tracing arithmetic through the step. The
// numbers are first-draft calibration: the tests assert bounds and determinism,
// never a specific magnitude, which is what lets them be tuned without a rewrite.
//
// IMPORT-FREE ON PURPOSE. The step must run under bare `node --test` and in a
// worker, exactly like forcePosture.js and unitMotion.js.

export const MONTH_DAYS = 30;
// Twenty years in one turn. A 365 day jump is 12 steps and a 10 year jump is
// 120, so the cap only bounds a deliberate outlier.
export const MAX_STEPS = 240;
export const ENGINE_VERSION = 1;

// Monthly population growth by era. Pre-modern growth is slow enough that a
// century of play is a few percent, which is the point.
const POPULATION_BANDS = Object.freeze([
  Object.freeze({ until: 1500, populationMonthly: 0.0001, productivityMonthly: 0.00015 }),
  Object.freeze({ until: 1800, populationMonthly: 0.00025, productivityMonthly: 0.0003 }),
  Object.freeze({ until: 1900, populationMonthly: 0.00045, productivityMonthly: 0.00085 }),
  Object.freeze({ until: 1950, populationMonthly: 0.0007, productivityMonthly: 0.0013 }),
  Object.freeze({ until: 2000, populationMonthly: 0.0009, productivityMonthly: 0.0016 }),
  Object.freeze({ until: Number.POSITIVE_INFINITY, populationMonthly: 0.00055, productivityMonthly: 0.00105 }),
]);

// A year that is not a number (an unparseable scenario date) takes the modern
// band rather than throwing. A fantasy calendar should still get an economy.
export const eraBandFor = (year) => {
  // `Number(null)` and `Number("")` are 0, which is finite, so a missing date
  // would silently land in the year-zero band. Treat those as unparseable.
  const missing = year === null || year === undefined || year === "";
  const value = missing ? Number.NaN : Number(year);
  const resolved = Number.isFinite(value) ? value : 2026;
  for (const band of POPULATION_BANDS) {
    if (resolved < band.until) return band;
  }
  return POPULATION_BANDS[POPULATION_BANDS.length - 1];
};

export const ECONOMY_STEP = Object.freeze({
  // Productivity responds to how industrial a polity is: a services economy
  // compounds faster than a subsistence one at the same era.
  SECTOR_LIFT: 0.45,
  // Debt above this share of output drags growth, up to the drag cap.
  DEBT_DRAG_START: 100,
  DEBT_DRAG_MAX: 0.35,
  // Unemployment above the natural rate drags growth (a demand effect).
  UNEMP_DRAG: 0.35,
  // How far the deterministic per-polity character term can swing growth.
  CHARACTER_AMPLITUDE: 0.25,
  CHARACTER_SCALE: 0.5,
  // Annual inflation percent the rate mean-reverts toward, plus the deficit
  // pass-through that pushes it up.
  INFLATION_TARGET: 2,
  INFLATION_REVERSION: 0.05,
  DEFICIT_INFLATION: 0.35,
  DEFICIT_THRESHOLD: 3,
  INFLATION_MIN: -5,
  INFLATION_MAX: 2000,
  // Unemployment: a discrete Okun step toward the natural rate.
  NATURAL_UNEMPLOYMENT: 5.5,
  OKUN: 0.35,
  TREND_GROWTH: 2,
  UNEMP_REVERSION: 0.04,
  UNEMP_MAX: 60,
  // Fiscal structure, all as shares of output.
  REVENUE_PER_GDP: 0.34,
  SPENDING_PER_GDP: 0.37,
  MILITARY_PER_GDP: 0.03,
  // Monthly real interest rate the debt ratio compounds at.
  RATE_MONTHLY: 0.0035,
  DEBT_MAX: 400,
  // Stability drifts toward an equilibrium the economy sets.
  STABILITY_BASE: 50,
  STAB_GROWTH: 1.2,
  STAB_INFLATION: 1.5,
  STAB_UNEMP: 1.1,
  STAB_REVERSION: 0.08,
});

// Trade is a standing field over the diplomatic network, not a declared shock.
// The economy clock composes it with the shock vector every month. A polity at
// full interdependence grows this fraction faster and drifts this many index
// points steadier each month; a polity cut off by war is dragged by the same
// amounts. The edge bonuses below are a closed table, so the field is a function
// of the ledgers alone and nothing here needs a clock or a draw.
export const TRADE_STEP = Object.freeze({
  GDP_MAX: 0.15,
  STABILITY_MAX: 0.25,
  WAR_EDGE: -1,
  NOTE_THRESHOLD: 0.15,
});

export const TRADE_AGREEMENT_BONUS = Object.freeze({
  trade_economic: 0.35,
  alliance: 0.25,
  military_cooperation: 0.15,
  friendship_consultation: 0.1,
  non_aggression: 0.05,
});
