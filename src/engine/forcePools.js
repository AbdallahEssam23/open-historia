/*! Open Historia - deterministic economy: the force pools (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Manpower and materiel, in the same month step as the economy so one clock
// drives both. The model declares a POSTURE, never a number: the pool is drawn
// from the population and output the economy step already computed, and every
// value here is a function of the state. IMPORT-FREE apart from the shared math.

import { clamp, roundTo } from "./economyMath.js";

export const MOBILIZATION_POSTURES = Object.freeze(["demobilized", "peacetime", "partial", "total"]);
export const DEFAULT_POSTURE = "peacetime";
export const MAX_MOBILIZATION = 20;

const POSTURES = new Set(MOBILIZATION_POSTURES);

// extraction: multiplies manpower production. allocation: multiplies materiel
// production. growthDrag: the share of output the call-up removes. stabilityDrag:
// index points the posture costs every month. First-draft calibration; the tests
// assert ordering, never a magnitude.
const posture = (extraction, allocation, growthDrag, stabilityDrag) =>
  Object.freeze({ extraction, allocation, growthDrag, stabilityDrag });

export const MOBILIZATION_EFFECTS = Object.freeze({
  demobilized: posture(0.6, 0.7, -0.02, 0),
  peacetime: posture(1, 1, 0, 0),
  partial: posture(1.8, 1.6, 0.15, 0.05),
  total: posture(3, 2.6, 0.4, 0.12),
});

// Monthly cost per unit type. Keyed by UNIT_TYPES (gameState.js). A passive cost
// only: it is read from the roster and never written back to it.
const upkeep = (manpower, materiel) => Object.freeze({ manpower, materiel });

export const UNIT_UPKEEP = Object.freeze({
  infantry: upkeep(1200, 0.5),
  armor: upkeep(900, 2.4),
  air: upkeep(400, 3.2),
  naval: upkeep(1500, 5),
  artillery: upkeep(800, 1.6),
  garrison: upkeep(600, 0.3),
});

export const FORCE_POOLS = Object.freeze({
  MANPOWER_PER_CAPITA_MONTHLY: 0.0009,
  MATERIEL_PER_OUTPUT_MONTHLY: 0.0012,
  MANPOWER_CAP_SHARE: 0.06,
  MATERIEL_CAP_SHARE: 0.12,
  INITIAL_MANPOWER_SHARE: 0.02,
  INITIAL_MATERIEL_SHARE: 0.03,
  STABILITY_UPKEEP_SHORTFALL: 4,
});

const name = (value) => String(value ?? "").trim();

// The model's mobilization declaration. Like normalizeShocks: an entry that fails
// is dropped, never fatal to the turn, and returned so the caller can log it.
// Duplicates fold by polity, last one winning, because a posture is one value.
export const normalizeMobilization = (value, { knownPolities = [] } = {}) => {
  const list = Array.isArray(value) ? value : [];
  const known = new Set((Array.isArray(knownPolities) ? knownPolities : []).map(name));
  const byPolity = new Map();
  const rejected = [];

  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index];
    if (!entry || typeof entry !== "object") {
      rejected.push({ index, reason: "not an object" });
      continue;
    }
    const polity = name(entry.polity ?? entry.country);
    if (!polity || !known.has(polity)) {
      rejected.push({ index, reason: `unknown polity "${polity}"` });
      continue;
    }
    const post = name(entry.posture).toLowerCase();
    if (!POSTURES.has(post)) {
      rejected.push({ index, reason: `unknown posture "${entry.posture}"` });
      continue;
    }
    if (!byPolity.has(polity) && byPolity.size >= MAX_MOBILIZATION) {
      rejected.push({ index, reason: `more than ${MAX_MOBILIZATION} polities in one period` });
      continue;
    }
    byPolity.set(polity, { polity, posture: post });
  }

  return { valid: [...byPolity.values()], rejected };
};

// The storage shape: what the model declared, validated without a world. A
// corrupted save costs the entry, never the world.
export const normalizePendingMobilization = (value) => {
  const list = Array.isArray(value) ? value : [];
  const byPolity = new Map();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    if (byPolity.size >= MAX_MOBILIZATION && !byPolity.has(name(entry.polity))) continue;
    const polity = name(entry.polity ?? entry.country);
    const post = name(entry.posture).toLowerCase();
    if (!polity || !POSTURES.has(post)) continue;
    byPolity.set(polity, { polity, posture: post });
  }
  return [...byPolity.values()];
};

export const normalizePools = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const key of Object.keys(value).map(name).filter(Boolean)) {
    const row = value[key];
    if (!row || typeof row !== "object") continue;
    const manpower = Number(row.manpower);
    const materiel = Number(row.materiel);
    if (!Number.isFinite(manpower) || !Number.isFinite(materiel)) continue;
    out[key] = { manpower: Math.max(0, Math.round(manpower)), materiel: Math.max(0, roundTo(materiel, 2)) };
  }
  return out;
};

// The committed posture. Sparse: only non-default entries are stored, so an
// absent name is peacetime and a save that never mobilized is unchanged.
export const normalizeMobilizationMap = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const key of Object.keys(value).map(name).filter(Boolean)) {
    const post = name(value[key]).toLowerCase();
    if (post && post !== DEFAULT_POSTURE && POSTURES.has(post)) out[key] = post;
  }
  return out;
};

export const normalizeUpkeepShortfall = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const key of Object.keys(value).map(name).filter(Boolean)) {
    const row = value[key];
    if (!row || typeof row !== "object") continue;
    const manpower = Math.max(0, Math.round(Number(row.manpower) || 0));
    const materiel = Math.max(0, roundTo(Number(row.materiel) || 0, 2));
    if (manpower > 0 || materiel > 0) out[key] = { manpower, materiel };
  }
  return out;
};

export const postureFor = (map, polityName) => map?.[name(polityName)] ?? DEFAULT_POSTURE;

export const clampPercent = (value) => clamp(value, 0, 100);
