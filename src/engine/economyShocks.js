/*! Open Historia - deterministic economy: the closed shock channel (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// This is the ONLY numeric economic input the model has. It does not set a
// value; it scales the rates for a bounded number of months, and the engine
// derives everything from the state it already holds. A closed enum is what
// makes a model's answer safe to apply without a second opinion.
//
// Effects per severity level: `population` and `gdp` multiply a monthly rate;
// `inflation`, `unemployment` and `stability` are additive per month in their
// own units (annual percent, percent, and index points).

import { clamp } from "./economyMath.js";

export const SHOCK_KINDS = Object.freeze([
  "harvest_failure",
  "sanctions",
  "blockade",
  "industrial_damage",
  "capital_flight",
  "debt_crisis",
  "mobilization",
  "reconstruction",
  "aid_inflow",
  "trade_boom",
]);

const level = (population, gdp, inflation, unemployment, stability) =>
  Object.freeze({ population, gdp, inflation, unemployment, stability });

export const SHOCK_EFFECTS = Object.freeze({
  harvest_failure: [
    level(1, 0.92, 0.12, 0.1, -0.6),
    level(1, 0.82, 0.25, 0.2, -1.3),
    level(0.999, 0.68, 0.45, 0.35, -2.2),
  ],
  sanctions: [
    level(1, 0.93, 0.1, 0.12, -0.3),
    level(1, 0.85, 0.22, 0.26, -0.7),
    level(0.9995, 0.72, 0.4, 0.45, -1.2),
  ],
  blockade: [
    level(1, 0.94, 0.12, 0.1, -0.25),
    level(1, 0.86, 0.26, 0.24, -0.65),
    level(0.9995, 0.74, 0.48, 0.42, -1.1),
  ],
  industrial_damage: [
    level(1, 0.94, 0.06, 0.08, -0.3),
    level(1, 0.86, 0.14, 0.18, -0.8),
    level(1, 0.72, 0.26, 0.34, -1.5),
  ],
  capital_flight: [
    level(1, 0.96, 0.3, 0.1, -0.35),
    level(0.999, 0.9, 0.7, 0.22, -0.85),
    level(0.998, 0.8, 1.3, 0.42, -1.6),
  ],
  debt_crisis: [
    level(1, 0.93, 0.4, 0.2, -0.6),
    level(0.999, 0.84, 0.9, 0.45, -1.3),
    level(0.997, 0.72, 1.6, 0.8, -2.2),
  ],
  mobilization: [
    level(0.9995, 1.02, 0.18, -0.1, -0.2),
    level(0.998, 1.05, 0.4, -0.2, -0.55),
    level(0.995, 1.1, 0.75, -0.3, -1.1),
  ],
  reconstruction: [
    level(1.0005, 1.06, -0.05, -0.2, 0.4),
    level(1.001, 1.12, -0.1, -0.4, 0.9),
    level(1.002, 1.2, -0.15, -0.6, 1.6),
  ],
  aid_inflow: [
    level(1, 1.03, -0.05, -0.1, 0.3),
    level(1, 1.06, -0.1, -0.22, 0.7),
    level(1.0005, 1.1, -0.15, -0.36, 1.2),
  ],
  trade_boom: [
    level(1, 1.05, 0.05, -0.12, 0.25),
    level(1.0005, 1.11, 0.12, -0.26, 0.6),
    level(1.001, 1.18, 0.22, -0.42, 1),
  ],
});

export const MAX_SHOCKS = 20;
export const MAX_SHOCK_MONTHS = 120;
const SEVERITIES = new Set([1, 2, 3]);

export const normalizeShocks = (value, { knownPolities = [] } = {}) => {
  const list = Array.isArray(value) ? value : [];
  const known = new Set((Array.isArray(knownPolities) ? knownPolities : []).map((name) => String(name ?? "")));
  const valid = [];
  const rejected = [];

  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index];
    if (valid.length >= MAX_SHOCKS) {
      rejected.push({ index, reason: `more than ${MAX_SHOCKS} shocks in one period` });
      continue;
    }
    if (!entry || typeof entry !== "object") {
      rejected.push({ index, reason: "not an object" });
      continue;
    }
    const kind = String(entry.kind ?? "");
    if (!SHOCK_KINDS.includes(kind)) {
      rejected.push({ index, reason: `unknown kind "${kind}"` });
      continue;
    }
    const severity = Math.trunc(Number(entry.severity));
    if (!SEVERITIES.has(severity)) {
      rejected.push({ index, reason: `severity must be 1, 2 or 3, got ${entry.severity}` });
      continue;
    }
    const durationMonths = Math.trunc(Number(entry.durationMonths));
    if (!Number.isFinite(durationMonths) || durationMonths < 1 || durationMonths > MAX_SHOCK_MONTHS) {
      rejected.push({ index, reason: `durationMonths must be 1..${MAX_SHOCK_MONTHS}, got ${entry.durationMonths}` });
      continue;
    }
    // A world-scope shock is everything. A named scope keeps only names the
    // caller recognises; a scope that resolves to nothing is still a valid
    // world shock, because dropping the whole entry would make an unknown
    // polity name silently expensive.
    let scope = null;
    if (Array.isArray(entry.scope)) {
      scope = [...new Set(entry.scope.map((name) => String(name ?? "")).filter((name) => name && known.has(name)))];
    }
    valid.push({ kind, severity, startMonth: 0, endMonth: durationMonths, scope });
  }

  return { valid, rejected };
};

// The storage shape of a shock: what the model declared, not the month span the
// step converts it to. It exists because a shock declared now runs in the NEXT
// period, so it must survive a save untouched and be re-based onto the clock in
// the period it actually runs in. Validation matches normalizeShocks, except the
// scope is not resolved against a polity list here: that needs the world, which
// the applying call has and this one does not. Entries that fail are dropped, not
// thrown, so a corrupted save costs the shock and never the world.
export const normalizeDeclaredShocks = (value) => {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  for (const entry of list) {
    if (out.length >= MAX_SHOCKS) break;
    if (!entry || typeof entry !== "object") continue;
    const kind = String(entry.kind ?? "");
    if (!SHOCK_KINDS.includes(kind)) continue;
    const severity = Math.trunc(Number(entry.severity));
    if (!SEVERITIES.has(severity)) continue;
    const durationMonths = Math.trunc(Number(entry.durationMonths));
    if (!Number.isFinite(durationMonths) || durationMonths < 1 || durationMonths > MAX_SHOCK_MONTHS) continue;
    const scope = Array.isArray(entry.scope)
      ? [...new Set(entry.scope.map((name) => String(name ?? "")).filter(Boolean))]
      : "world";
    out.push({ kind, severity, durationMonths, scope });
  }
  return out;
};

// The multiplier/addend vector for one month, from every shock still running.
// Effects compose by multiplication and by addition; a positive shock does not
// cancel a negative one, it offsets it.
export const activeMultipliers = (shocks, month) => {
  const result = { population: 1, gdp: 1, inflation: 0, unemployment: 0, stability: 0 };
  const at = Math.trunc(Number(month) || 0);
  for (const shock of Array.isArray(shocks) ? shocks : []) {
    if (!(at >= shock.startMonth && at < shock.endMonth)) continue;
    const row = SHOCK_EFFECTS[shock.kind]?.[shock.severity - 1];
    if (!row) continue;
    result.population *= row.population;
    result.gdp *= row.gdp;
    result.inflation += row.inflation;
    result.unemployment += row.unemployment;
    result.stability += row.stability;
  }
  result.inflation = clamp(result.inflation, -50, 50);
  result.unemployment = clamp(result.unemployment, -20, 20);
  result.stability = clamp(result.stability, -30, 30);
  return result;
};

// Whether a shock names this polity. World scope reaches everyone.
export const shockAppliesTo = (shock, polityName) =>
  shock.scope === null || shock.scope.includes(String(polityName ?? ""));
