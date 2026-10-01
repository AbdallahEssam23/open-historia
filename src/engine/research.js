/*! Open Historia - deterministic economy: research capacity and programmes (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What a polity can research and how fast, out of the facilities it has actually
// built and the population behind them. Like the production line this is a pure
// function of the state: the model declares a PROGRAMME (a domain and a scale),
// never a cost and never a rate, and the engine owns both. IMPORT-FREE.

// Closed, because the engine switches on the value: the pair determines the
// cost, so a value the engine cannot price must not reach it.
export const RESEARCH_DOMAINS = Object.freeze([
  "military", "naval", "aerospace", "industrial",
  "electronics", "medical", "nuclear",
]);
export const RESEARCH_SCALES = Object.freeze(["small", "medium", "large"]);

export const DEFAULT_RESEARCH_DOMAIN = "industrial";
export const DEFAULT_RESEARCH_SCALE = "small";

const DOMAIN_BASE = Object.freeze({
  military: 30, naval: 36, aerospace: 48, industrial: 24,
  electronics: 36, medical: 30, nuclear: 60,
});
const SCALE_MULTIPLIER = Object.freeze({ small: 1, medium: 2, large: 3 });

export const RESEARCH_DOMAIN_BASE = DOMAIN_BASE;
export const RESEARCH_SCALE_MULTIPLIER = SCALE_MULTIPLIER;

export const RESEARCH_BASE_POINTS = 1;
export const RESEARCH_POINTS_PER_FACILITY = 2;
export const RESEARCH_POPULATION_PER_POINT = 50000000;
export const RESEARCH_MAX_POINTS = 12;

const name = (value) => String(value ?? "").trim().toLowerCase();
const whole = (value) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export const resolveResearchDomain = (value) => {
  const raw = name(value);
  return Object.prototype.hasOwnProperty.call(DOMAIN_BASE, raw) ? raw : DEFAULT_RESEARCH_DOMAIN;
};

export const resolveResearchScale = (value) => {
  const raw = name(value);
  return Object.prototype.hasOwnProperty.call(SCALE_MULTIPLIER, raw) ? raw : DEFAULT_RESEARCH_SCALE;
};

// Derived, never stored, so a programme's price cannot drift from the domain and
// scale on the entry.
export const researchCostFor = (entry = {}) =>
  DOMAIN_BASE[resolveResearchDomain(entry?.domain)] * SCALE_MULTIPLIER[resolveResearchScale(entry?.scale)];

// A property of a polity, not of a programme: the base of one means a polity
// with no laboratory still researches, slowly, and cannot be permanently locked
// out of the board's own promise. The cap keeps one month from finishing an
// end-game programme by arithmetic accident.
export const researchPointsFor = ({ facilities = 0, population = 0 } = {}) =>
  Math.min(
    RESEARCH_MAX_POINTS,
    RESEARCH_BASE_POINTS
      + RESEARCH_POINTS_PER_FACILITY * whole(facilities)
      + Math.floor(Math.max(0, Number(population) || 0) / RESEARCH_POPULATION_PER_POINT),
  );
