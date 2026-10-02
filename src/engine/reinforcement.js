// Open Historia - the reinforcement and rotation core (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// A pure function of a declared policy, the reserves, the roster, the supply
// states part two derives and the declared rotation and merge orders. It
// restores strength from the same pools a battle charges and folds two
// formations together, without touching the world. It writes nothing and stores
// nothing; the turn applies its ops through the existing unit seam.

import { UNIT_UPKEEP } from "./forcePools.js";
import { roundTo } from "./economyMath.js";

const name = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
// Locale-independent, matching supplyAttrition.js: the derivation must be
// byte-identical across machines.
const foldKey = (value) => name(value).toLowerCase();
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// One strength point is this many months of the formation's upkeep, the same
// price a battle's reserve charge uses. A runtime test pins this to the
// runtime's COMBAT_POOL_FACTOR, so a lost point and a bought point cannot drift.
export const REINFORCEMENT_POOL_FACTOR = 10;
// Strength points a formation may buy back per whole month. First-draft
// calibration: the tests assert ordering and the period multiplier, never a
// magnitude.
export const REINFORCEMENT_RATE_PER_MONTH = 5;

export const REINFORCEMENT_POLICIES = Object.freeze(["none", "replacements", "belligerent"]);
export const DEFAULT_REINFORCEMENT_POLICY = "replacements";
export const MAX_REINFORCEMENT = 20;
export const MAX_ROTATIONS = 8;
export const MAX_MERGES = 8;

const POLICIES = new Set(REINFORCEMENT_POLICIES);

const clampStrength = (value) => {
  const raw = value === null || value === undefined || value === "" ? NaN : Number(value);
  return Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 100;
};

const hasStation = (unit) =>
  Number.isFinite(unit?.lng) && Number.isFinite(unit?.lat) && !(unit.lng === 0 && unit.lat === 0);

// The per-point price of one strength point, read from the same UNIT_UPKEEP row
// a battle's reserve charge reads. An unknown type prices as infantry, matching
// the combat charge.
const perPointCost = (type) => {
  const row = UNIT_UPKEEP[name(type)] ?? UNIT_UPKEEP.infantry;
  return {
    manpower: (row.manpower * REINFORCEMENT_POOL_FACTOR) / 100,
    materiel: (row.materiel * REINFORCEMENT_POOL_FACTOR) / 100,
  };
};

const costFor = (perPoint, points) => ({
  manpower: Math.round(perPoint.manpower * points),
  materiel: roundTo(perPoint.materiel * points, 2),
});

const poolFor = (pools, polity) => {
  const row = pools?.[polity] ?? {};
  return {
    manpower: Math.max(0, Math.floor(Number(row?.manpower) || 0)),
    materiel: Math.max(0, roundTo(Number(row?.materiel) || 0, 2)),
  };
};

// A polity on a side of at least one active war, the same rule the supply core
// uses. A degenerate war listing one polity on both sides makes none.
const belligerentsFor = (wars) => {
  const set = new Set();
  for (const war of list(wars)) {
    if (!war || foldKey(war?.status) !== "active") continue;
    const sideA = list(war?.sideA).map(foldKey).filter(Boolean);
    const sideB = list(war?.sideB).map(foldKey).filter(Boolean);
    if (sideA.some((key) => sideB.includes(key))) continue;
    for (const key of [...sideA, ...sideB]) set.add(key);
  }
  return set;
};

// The model's reinforcement declaration. Like normalizeMobilization: an entry
// that fails is dropped, never fatal, and returned so the caller can log it.
// Duplicates fold by polity, last one winning, because a policy is one value.
export const normalizeReinforcement = (value, { knownPolities = [] } = {}) => {
  const rows = Array.isArray(value) ? value : [];
  const known = new Set(list(knownPolities).map(name));
  const byPolity = new Map();
  const rejected = [];

  for (let index = 0; index < rows.length; index += 1) {
    const entry = rows[index];
    if (!entry || typeof entry !== "object") {
      rejected.push({ index, reason: "not an object" });
      continue;
    }
    const polity = name(entry.polity ?? entry.country);
    if (!polity || !known.has(polity)) {
      rejected.push({ index, reason: `unknown polity "${polity}"` });
      continue;
    }
    const policy = name(entry.policy).toLowerCase();
    if (!POLICIES.has(policy)) {
      rejected.push({ index, reason: `unknown policy "${entry.policy}"` });
      continue;
    }
    if (!byPolity.has(polity) && byPolity.size >= MAX_REINFORCEMENT) {
      rejected.push({ index, reason: `more than ${MAX_REINFORCEMENT} polities in one period` });
      continue;
    }
    byPolity.set(polity, { polity, policy });
  }

  return { valid: [...byPolity.values()], rejected };
};

// The storage shape: what the model declared, validated without a world. A
// corrupted save costs the entry, never the world.
export const normalizePendingReinforcement = (value) => {
  const rows = Array.isArray(value) ? value : [];
  const byPolity = new Map();
  for (const entry of rows) {
    if (!entry || typeof entry !== "object") continue;
    const polity = name(entry.polity ?? entry.country);
    if (byPolity.size >= MAX_REINFORCEMENT && !byPolity.has(polity)) continue;
    const policy = name(entry.policy).toLowerCase();
    if (!polity || !POLICIES.has(policy)) continue;
    byPolity.set(polity, { polity, policy });
  }
  return [...byPolity.values()];
};

// The committed policy. Sparse: only non-default entries are stored, so an
// absent name reads as replacements and a save that never used this increment
// keeps the record byte-identical.
export const normalizeReinforcementMap = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = name(rawKey);
    if (!key) continue;
    const policy = name(rawValue).toLowerCase();
    if (policy && policy !== DEFAULT_REINFORCEMENT_POLICY && POLICIES.has(policy)) out[key] = policy;
  }
  return out;
};

export const deriveReinforcement = ({
  policies = {},
  pools = {},
  units = [],
  supply = [],
  wars = [],
  rotations = [],
  merges = [],
  months = 0,
} = {}) => {
  const period = Math.max(0, Math.trunc(Number(months)) || 0);
  const rejections = [];

  // First occurrence of an id wins, so a duplicate row cannot double a
  // formation.
  const roster = new Map();
  for (const raw of list(units)) {
    const id = name(raw?.id);
    if (!id || roster.has(id)) continue;
    roster.set(id, {
      id,
      ownerCode: name(raw?.ownerCode),
      type: name(raw?.type) || "infantry",
      regionId: name(raw?.regionId),
      strength: clampStrength(raw?.strength),
      lng: raw?.lng,
      lat: raw?.lat,
    });
  }

  const supplyById = new Map();
  for (const row of list(supply)) {
    const unitId = name(row?.unitId);
    if (!unitId || supplyById.has(unitId)) continue;
    supplyById.set(unitId, row?.reachable === true);
  }
  const reachableOf = (unit) => supplyById.get(unit.id) === true;

  // A rotation or a merge claims both of its formations, so no formation is
  // touched by two orders, and a claimed formation is not reinforced the same
  // turn: rotate the worn formation out now, let it rebuild in the rear next.
  const claimed = new Set();

  const rotationRejection = (order) => {
    if (order.out === order.in) return "a rotation needs two different formations";
    const out = roster.get(order.out);
    const into = roster.get(order.in);
    if (!out || !into) return "unknown formation";
    if (claimed.has(out.id) || claimed.has(into.id)) return "a formation is already committed this turn";
    if (foldKey(out.ownerCode) !== foldKey(into.ownerCode)) return "different polities";
    if (out.type !== into.type) return "different types";
    if (out.regionId === into.regionId) return "the two formations stand on one region";
    if (!reachableOf(out) || !reachableOf(into)) return "a formation is out of supply";
    if (!hasStation(out) || !hasStation(into)) return "a formation has no usable station";
    return "";
  };

  const mergeRejection = (order) => {
    if (order.survivor === order.absorbed) return "a merge needs two different formations";
    const survivor = roster.get(order.survivor);
    const absorbed = roster.get(order.absorbed);
    if (!survivor || !absorbed) return "unknown formation";
    if (claimed.has(survivor.id) || claimed.has(absorbed.id)) return "a formation is already committed this turn";
    if (foldKey(survivor.ownerCode) !== foldKey(absorbed.ownerCode)) return "different polities";
    if (survivor.type !== absorbed.type) return "different types";
    if (!survivor.regionId || survivor.regionId !== absorbed.regionId) return "the two formations stand on different regions";
    return "";
  };

  // Rotations run before merges, so a formation named by both is rotated and the
  // merge is rejected: the two halves of one decision cannot disagree.
  const moveOps = [];
  const rotationOrders = list(rotations)
    .map((order, index) => ({ out: name(order?.out), in: name(order?.in), index }))
    .filter((order) => order.out && order.in)
    .sort((a, b) => compare(a.out, b.out) || compare(a.in, b.in) || a.index - b.index);
  let rotationCount = 0;
  for (const order of rotationOrders) {
    const reason = rotationRejection(order);
    if (reason) {
      rejections.push({ kind: "rotation", index: order.index, reason });
      continue;
    }
    const out = roster.get(order.out);
    const into = roster.get(order.in);
    claimed.add(out.id);
    claimed.add(into.id);
    // Swap station and the region that reads supply, so the supply layer and
    // the map never disagree about which station a formation now holds.
    moveOps.push({ op: "move", unitId: out.id, toLng: into.lng, toLat: into.lat, regionId: into.regionId });
    moveOps.push({ op: "move", unitId: into.id, toLng: out.lng, toLat: out.lat, regionId: out.regionId });
    rotationCount += 1;
  }

  const mergeOps = [];
  const mergeOrders = list(merges)
    .map((order, index) => ({ survivor: name(order?.survivor), absorbed: name(order?.absorbed), index }))
    .filter((order) => order.survivor && order.absorbed)
    .sort((a, b) => compare(a.survivor, b.survivor) || compare(a.absorbed, b.absorbed) || a.index - b.index);
  let mergeCount = 0;
  for (const order of mergeOrders) {
    const reason = mergeRejection(order);
    if (reason) {
      rejections.push({ kind: "merge", index: order.index, reason });
      continue;
    }
    const survivor = roster.get(order.survivor);
    const absorbed = roster.get(order.absorbed);
    claimed.add(survivor.id);
    claimed.add(absorbed.id);
    const strength = Math.min(100, survivor.strength + absorbed.strength);
    mergeOps.push({ op: "strength", unitId: survivor.id, strength });
    mergeOps.push({ op: "remove", unitId: absorbed.id });
    mergeCount += 1;
  }

  const belligerents = belligerentsFor(wars);
  const draws = {};
  const reinforceOps = [];
  let reinforcedCount = 0;
  let pointsRestored = 0;

  const policyFor = (polity) => {
    const declared = name(policies?.[polity]).toLowerCase();
    return POLICIES.has(declared) ? declared : DEFAULT_REINFORCEMENT_POLICY;
  };

  // Polities in stable name order, each against its own pool, so one polity's
  // draw cannot change another's.
  const polityNames = [...new Set([...roster.values()].map((unit) => unit.ownerCode).filter(Boolean))];
  polityNames.sort(compare);

  for (const polity of polityNames) {
    const policy = policyFor(polity);
    if (policy === "none") continue;
    if (policy === "belligerent" && !belligerents.has(foldKey(polity))) continue;
    const pool = poolFor(pools, polity);
    const running = { ...pool };
    const eligible = [...roster.values()]
      .filter((unit) => unit.ownerCode === polity && !claimed.has(unit.id) && reachableOf(unit) && unit.strength < 100)
      .sort((a, b) => a.strength - b.strength || compare(a.id, b.id));
    for (const unit of eligible) {
      const perPoint = perPointCost(unit.type);
      const cap = Math.trunc(Math.min(100 - unit.strength, period * REINFORCEMENT_RATE_PER_MONTH));
      let points = Math.max(0, cap);
      // The largest whole number of points both pools can afford at this
      // moment. A poor polity reinforces slowly rather than not at all.
      while (points > 0) {
        const candidate = costFor(perPoint, points);
        if (candidate.manpower <= running.manpower && candidate.materiel <= running.materiel) break;
        points -= 1;
      }
      if (points <= 0) continue;
      const cost = costFor(perPoint, points);
      running.manpower -= cost.manpower;
      running.materiel = Math.max(0, roundTo(running.materiel - cost.materiel, 2));
      reinforceOps.push({ op: "strength", unitId: unit.id, strength: unit.strength + points });
      reinforcedCount += 1;
      pointsRestored += points;
    }
    const spentManpower = pool.manpower - running.manpower;
    const spentMateriel = roundTo(pool.materiel - running.materiel, 2);
    if (spentManpower > 0 || spentMateriel > 0) {
      draws[polity] = { manpower: spentManpower, materiel: spentMateriel };
    }
  }

  // A fixed order: reinforcement, then rotations, then merges.
  const ops = [...reinforceOps, ...moveOps, ...mergeOps];
  return {
    ops,
    draws,
    summary: {
      reinforced: reinforcedCount,
      pointsRestored,
      rotations: rotationCount,
      merges: mergeCount,
      rejected: rejections.length,
      opCount: ops.length,
    },
    rejections,
  };
};
