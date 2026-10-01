/*! Open Historia - deterministic economy: the math the step shares (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Everything here is a pure function of its arguments. `hashSeed` and
// `diffGameDays` are imported rather than reimplemented so the whole codebase
// keeps one definition of "the same string gives the same number" and one of
// "how many days apart are these two game dates".

import { diffGameDays } from "../runtime/gameDates.js";
import { hashSeed } from "../runtime/unitMotion.js";
import { MONTH_DAYS } from "./economyConstants.js";

export const clamp = (value, min, max) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return number < min ? min : number > max ? max : number;
};

export const roundTo = (value, decimals) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const places = Math.max(0, Math.trunc(Number(decimals)) || 0);
  // Scale through a string rather than by multiplying: 1.005 * 100 is
  // 100.49999999999999, but Number("1.005e2") is exactly 100.5, so the value
  // a reader typed rounds the way they expect and a stored sheet is stable.
  const scaled = Number(`${number}e${places}`);
  if (!Number.isFinite(scaled)) return number;
  return Number(`${Math.round(scaled)}e-${places}`);
};

// Whole 30 day steps between two dates. An unparseable date, or a span that is
// not forward, advances nothing: a fantasy calendar must not be able to make
// the economy run backwards or divide by a null.
export const monthsBetweenDates = (fromDate, toDate) => {
  const days = diffGameDays(fromDate, toDate);
  if (days === null || !Number.isFinite(days) || days <= 0) return 0;
  return Math.floor(days / MONTH_DAYS);
};

// A per-polity character term in [-1, 1], derived from the campaign seed and
// the polity name. This is the whole of the engine's "randomness": it is
// reproducible forever from stored inputs, which is why it is safe to store a
// seed and never a value.
export const jitterFor = (seed, polityName) => {
  const raw = hashSeed(`${seed}:${polityName}`);
  return (raw / 0xffffffff) * 2 - 1;
};

// Code-unit sort, never localeCompare: the engine's iteration order must be a
// function of the data alone, and locale collation is environment-dependent.
export const stableOrder = (names) => {
  const unique = [...new Set((Array.isArray(names) ? names : []).map((name) => String(name ?? "")).filter(Boolean))];
  unique.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return unique;
};
