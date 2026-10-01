/*! Open Historia - deterministic economy: the production line (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What a polity builds out of the reserves the pools hold. Like the pools this
// is a pure function of the state: the model declares an ORDER (what and how
// many), never a price or a duration, and the engine owns both. IMPORT-FREE
// apart from the shared math.

import { roundTo } from "./economyMath.js";

// The unit types are the roster's own six (UNIT_TYPES, gameState.js). They are
// re-declared here because the engine may not import the runtime; a runtime test
// asserts the two lists are equal so they cannot drift.
export const PRODUCTION_UNIT_TYPES = Object.freeze([
  "infantry", "armor", "air", "naval", "artillery", "garrison",
]);
export const BUILDING_TYPES = Object.freeze([
  "fortification", "airfield", "naval_base", "military_base",
  "industrial_plant", "logistics_hub", "research_facility",
]);
export const PRODUCTION_KINDS = Object.freeze(["unit", "building"]);

export const MAX_PRODUCTION_ORDERS = 20;
export const MAX_UNIT_COUNT = 20;
export const MAX_PRODUCTION_QUEUE = 12;

const UNIT_TYPE_SET = new Set(PRODUCTION_UNIT_TYPES);
const BUILDING_TYPE_SET = new Set(BUILDING_TYPES);
const KIND_SET = new Set(PRODUCTION_KINDS);

// Monthly build time is a series: a count of three is one item built three times
// over, so both the price and the duration scale with it.
const cost = (manpower, materiel, months) => Object.freeze({ manpower, materiel, months });

export const PRODUCTION_TABLE = Object.freeze({
  infantry: cost(8000, 6, 2),
  armor: cost(6000, 24, 3),
  artillery: cost(5000, 16, 3),
  air: cost(2000, 40, 4),
  garrison: cost(3000, 3, 1),
  naval: cost(12000, 90, 6),
  fortification: cost(4000, 30, 4),
  airfield: cost(3000, 45, 5),
  logistics_hub: cost(4000, 35, 4),
  military_base: cost(5000, 50, 6),
  naval_base: cost(6000, 70, 7),
  industrial_plant: cost(9000, 60, 8),
  research_facility: cost(7000, 55, 9),
});

// The marker `kind` a completed structure is built as, in the same words the
// narrator and the game master already use for map features.
export const BUILDING_MARKER_KIND = Object.freeze({
  fortification: "fortification",
  airfield: "airfield",
  naval_base: "naval base",
  military_base: "military base",
  industrial_plant: "industrial plant",
  logistics_hub: "logistics hub",
  research_facility: "research facility",
});

export const markerKindFor = (type) => BUILDING_MARKER_KIND[type] ?? String(type ?? "").trim();

const name = (value) => String(value ?? "").trim();

const countFor = (value) => {
  if (value === undefined || value === null || value === "") return 1;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MAX_UNIT_COUNT, n);
};

// The whole price of an order, in one place: the pool draw at enqueue and the
// build time the line is stamped with are the same function of the order.
export const priceOf = (entry) => {
  const row = PRODUCTION_TABLE[name(entry?.type).toLowerCase()] ?? { manpower: 0, materiel: 0, months: 0 };
  const count = Math.max(1, countFor(entry?.count));
  return { manpower: count * row.manpower, materiel: count * row.materiel, months: count * row.months };
};

// Like normalizeMobilization: an entry that fails is dropped, never fatal to the
// turn, and returned so the caller can log it. The per-period cap counts
// ACCEPTED orders; a rejected entry does not consume a slot.
export const normalizeProductionOrders = (value, { knownPolities = [] } = {}) => {
  const list = Array.isArray(value) ? value : [];
  const known = new Set((Array.isArray(knownPolities) ? knownPolities : []).map(name));
  const valid = [];
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
    const kind = name(entry.kind).toLowerCase();
    if (!KIND_SET.has(kind)) {
      rejected.push({ index, reason: `unknown kind "${entry.kind}"` });
      continue;
    }
    const type = name(entry.type).toLowerCase();
    const allowed = kind === "unit" ? UNIT_TYPE_SET : BUILDING_TYPE_SET;
    if (!allowed.has(type)) {
      rejected.push({ index, reason: `unknown ${kind} type "${entry.type}"` });
      continue;
    }
    if (entry.count !== undefined && entry.count !== null && entry.count !== "") {
      const raw = Number(entry.count);
      if (!Number.isFinite(raw) || Math.trunc(raw) !== raw || raw < 1 || raw > MAX_UNIT_COUNT) {
        rejected.push({ index, reason: `count out of range (1-${MAX_UNIT_COUNT})` });
        continue;
      }
    }
    const count = countFor(entry.count);
    if (kind === "building" && count > 1) {
      rejected.push({ index, reason: "a structure is a series of one" });
      continue;
    }
    if (valid.length >= MAX_PRODUCTION_ORDERS) {
      rejected.push({ index, reason: `more than ${MAX_PRODUCTION_ORDERS} orders in one period` });
      continue;
    }
    valid.push({
      polity,
      kind,
      type,
      count,
      ...(name(entry.at) ? { at: name(entry.at) } : {}),
      ...(name(entry.name) ? { name: name(entry.name) } : {}),
    });
  }

  return { valid, rejected };
};

// The committed line, validated without a world: a corrupted save costs the
// entry, never the world. A half-written item is dropped rather than defaulted,
// the same discipline normalizePools uses.
const normalizeQueuedItem = (item) => {
  if (!item || typeof item !== "object") return null;
  const kind = name(item.kind).toLowerCase();
  if (!KIND_SET.has(kind)) return null;
  const type = name(item.type).toLowerCase();
  const allowed = kind === "unit" ? UNIT_TYPE_SET : BUILDING_TYPE_SET;
  if (!allowed.has(type)) return null;
  const rawMonths = Number(item.monthsTotal);
  if (!Number.isFinite(rawMonths) || rawMonths < 1) return null;
  const monthsTotal = Math.trunc(rawMonths);
  const count = kind === "building" ? 1 : countFor(item.count);
  return {
    kind,
    type,
    count,
    monthsTotal,
    ...(name(item.at) ? { at: name(item.at) } : {}),
    ...(name(item.name) ? { name: name(item.name) } : {}),
  };
};

const normalizeActiveItem = (item) => {
  const base = normalizeQueuedItem(item);
  if (!base) return null;
  const monthsDone = Math.max(0, Math.trunc(Number(item.monthsDone)) || 0);
  return { ...base, monthsDone: Math.min(monthsDone, base.monthsTotal) };
};

export const normalizeProductionQueue = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [rawKey, entry] of Object.entries(value)) {
    const key = name(rawKey);
    if (!key || !entry || typeof entry !== "object") continue;
    const active = normalizeActiveItem(entry.active);
    const queue = (Array.isArray(entry.queue) ? entry.queue : [])
      .map(normalizeQueuedItem)
      .filter(Boolean)
      .slice(0, MAX_PRODUCTION_QUEUE);
    if (!active && !queue.length) continue;
    out[key] = { ...(active ? { active } : {}), queue };
  }
  return out;
};
