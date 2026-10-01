/*! Open Historia - deterministic economy: research effects (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What completing a research programme does to the simulation: a modifier
// derived from the closed domain/scale pair the research increment already
// stores, applied to the production line, the force pools and the economic step.
// Like every core file this is pure and IMPORT-FREE.

// The three consumers, one per target.
export const RESEARCH_EFFECT_TARGETS = Object.freeze(["production", "pools", "economy"]);

// Total over RESEARCH_DOMAINS: every programme the engine can price can be
// applied, and each domain feeds exactly one target.
export const RESEARCH_DOMAIN_EFFECT = Object.freeze({
  military: "pools",
  naval: "pools",
  aerospace: "pools",
  industrial: "production",
  electronics: "production",
  medical: "economy",
  nuclear: "economy",
});

// What one completion is worth, by scale. The same scale is worth the same
// everywhere, so a large programme always moves its target three times as much
// as a small one.
export const RESEARCH_EFFECT_POINTS = Object.freeze({ small: 1, medium: 2, large: 3 });
// A per-target ceiling, so a long campaign cannot turn one target unbounded.
export const MAX_RESEARCH_EFFECT_POINTS = 6;

// First-draft calibration, expected to be tuned against campaigns. The tests
// assert bounds and determinism, never a magnitude.
export const PRODUCTION_SPEED_PER_POINT = 0.05;
export const POOL_REGEN_PER_POINT = 0.05;
export const ECONOMY_GROWTH_PER_POINT = 0.1;

const text = (value) => String(value ?? "").trim().toLowerCase();
const round1 = (value) => Math.round(value * 10) / 10;
const whole = (value) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const clampPoints = (value) => Math.min(MAX_RESEARCH_EFFECT_POINTS, whole(value));

const totalsShape = (value) => ({
  production: clampPoints(value?.production),
  pools: clampPoints(value?.pools),
  economy: clampPoints(value?.economy),
});

// The target a domain feeds, or "" for a domain the table does not know.
export const effectTargetFor = (domain) => RESEARCH_DOMAIN_EFFECT[text(domain)] ?? "";

// The points a completion is worth, or 0 when either half is unknown. A zero is
// the "no effect" the fold and the multipliers already handle.
export const effectPointsFor = (domain, scale) =>
  (effectTargetFor(domain) ? (RESEARCH_EFFECT_POINTS[text(scale)] ?? 0) : 0);

// Pure: the input totals are never mutated, so a caller can fold over a shared
// baseline without copying it first.
export const foldResearchEffect = (totals, { domain, scale } = {}) => {
  const target = effectTargetFor(domain);
  const points = effectPointsFor(domain, scale);
  const current = totalsShape(totals);
  if (!target || points <= 0) return current;
  return { ...current, [target]: Math.min(MAX_RESEARCH_EFFECT_POINTS, current[target] + points) };
};

// Mirrors normalizePools: floor and cap every row, drop an unknown polity, and
// omit a row that ends up all-zero so a campaign with no research keeps the
// economyEngine record byte-identical to the previous increment's.
export const normalizeResearchEffects = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [polity, row] of Object.entries(value)) {
    const name = String(polity ?? "").trim();
    if (!name) continue;
    const totals = totalsShape(row);
    if (totals.production || totals.pools || totals.economy) out[name] = totals;
  }
  return out;
};

export const researchEffectTotalsFor = (map, polity) =>
  totalsShape(map?.[String(polity ?? "")]);

export const productionTimeMultiplier = (points) =>
  1 / (1 + PRODUCTION_SPEED_PER_POINT * clampPoints(points));
export const poolRegenMultiplier = (points) =>
  1 + POOL_REGEN_PER_POINT * clampPoints(points);
export const economyGrowthBonus = (points) =>
  ECONOMY_GROWTH_PER_POINT * clampPoints(points);

// One programme's own contribution ("+10% production"), or "" when it is worth
// nothing. Used by the research card so the board explains where a modifier came
// from, from the same table the engine applies.
export const researchEffectLabel = (domain, scale) => {
  const target = effectTargetFor(domain);
  const points = effectPointsFor(domain, scale);
  if (!target || points <= 0) return "";
  if (target === "economy") return `+${round1(ECONOMY_GROWTH_PER_POINT * points)}pp growth`;
  const perPoint = target === "production" ? PRODUCTION_SPEED_PER_POINT : POOL_REGEN_PER_POINT;
  return `+${round1(100 * perPoint * points)}% ${target}`;
};

// A polity's totals as one phrase ("production +30%, pools +10%"), or "" when
// all three are zero. The digest and the panel both render this, so the two
// cannot disagree about what a total means.
export const researchEffectTotalsLabel = (totals) => {
  const row = totalsShape(totals);
  const parts = [];
  if (row.production) parts.push(`production +${round1(100 * PRODUCTION_SPEED_PER_POINT * row.production)}%`);
  if (row.pools) parts.push(`pools +${round1(100 * POOL_REGEN_PER_POINT * row.pools)}%`);
  if (row.economy) parts.push(`growth +${round1(ECONOMY_GROWTH_PER_POINT * row.economy)}pp`);
  return parts.join(", ");
};
