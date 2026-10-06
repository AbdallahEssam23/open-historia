/*! Open Historia - deterministic economy: trade as a field of the diplomatic network (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Trade is not declared; it is the economic shape the diplomatic record already
// has. This module reads the three engine-owned ledgers (relations, agreements,
// wars) and returns a per-polity multiplier vector in the same shape the shock
// channel produces, so the economy clock composes the two with one rule. No
// clock, no entropy: the same ledgers give the same field forever.
//
// The field is a mean, not a sum. A polity with no partners nets to zero and is
// absent from the table, which is what makes an empty network byte-for-byte
// inert on the economy. A polity at war is severed from its opposite side
// whatever its relation score says.

import { TRADE_AGREEMENT_BONUS, TRADE_STEP } from "./economyConstants.js";
import { clamp, stableOrder } from "./economyMath.js";

const name = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
// A pair key that a polity name cannot forge: the separator is a NUL, which the
// name normalizers never keep.
const pairKey = (a, b) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
const typeKey = (value) => name(value).toLowerCase().replace(/[ -]+/g, "_");

// The per-polity multiplier vector for the current diplomatic network. An entry
// appears only when the polity's index is non-zero, so a neutral or isolated
// polity is simply absent and the clock leaves it untouched.
export const tradeMultipliers = ({ relations = [], agreements = [], wars = [] } = {}) => {
  const scores = new Map();
  const bonuses = new Map();
  const warPairs = new Set();
  // Every pair that carries a link, whichever ledger put it there, so the
  // partner lists are the union of the three and not relations alone.
  const links = new Map();
  const link = (a, b) => {
    if (!a || !b || a === b) return "";
    const key = pairKey(a, b);
    if (!links.has(key)) links.set(key, [a, b]);
    return key;
  };

  for (const entry of list(relations)) {
    const key = link(name(entry?.a), name(entry?.b));
    if (!key) continue;
    const score = Number(entry?.score);
    scores.set(key, Number.isFinite(score) ? clamp(score, -100, 100) : 0);
  }

  for (const entry of list(agreements)) {
    if (name(entry?.status).toLowerCase() !== "active") continue;
    const bonus = TRADE_AGREEMENT_BONUS[typeKey(entry?.type)] ?? 0;
    const members = stableOrder(list(entry?.parties).map(name));
    if (members.length < 2) continue;
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const key = link(members[i], members[j]);
        if (!key) continue;
        bonuses.set(key, (bonuses.get(key) ?? 0) + bonus);
      }
    }
  }

  for (const entry of list(wars)) {
    if (name(entry?.status).toLowerCase() !== "active") continue;
    const sideA = stableOrder(list(entry?.sideA).map(name));
    const sideB = stableOrder(list(entry?.sideB).map(name));
    for (const x of sideA) {
      for (const y of sideB) {
        const key = link(x, y);
        if (key) warPairs.add(key);
      }
    }
  }

  const partnersOf = new Map();
  for (const [a, b] of links.values()) {
    if (!partnersOf.has(a)) partnersOf.set(a, new Set());
    if (!partnersOf.has(b)) partnersOf.set(b, new Set());
    partnersOf.get(a).add(b);
    partnersOf.get(b).add(a);
  }

  const field = {};
  for (const polity of stableOrder([...partnersOf.keys()])) {
    const partners = stableOrder([...partnersOf.get(polity)]);
    if (!partners.length) continue;
    // Summed in stable partner order: float addition is not associative, so the
    // total must not depend on the order the ledgers happened to be read in.
    let sum = 0;
    for (const other of partners) {
      const key = pairKey(polity, other);
      if (warPairs.has(key)) {
        sum += TRADE_STEP.WAR_EDGE;
        continue;
      }
      const score = (scores.get(key) ?? 0) / 100;
      const bonus = bonuses.get(key) ?? 0;
      sum += clamp(score + bonus, -1, 1);
    }
    const index = clamp(sum / partners.length, -1, 1);
    if (index === 0) continue;
    field[polity] = {
      population: 1,
      gdp: 1 + TRADE_STEP.GDP_MAX * index,
      inflation: 0,
      unemployment: 0,
      stability: TRADE_STEP.STABILITY_MAX * index,
    };
  }
  return field;
};
