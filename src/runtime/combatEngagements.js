// Open Historia - the engagement adapter (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// Gathers the two sides of a declared battle from the roster, calls the pure
// core, and translates the result into the ops the turn already knows how to
// apply plus the reserve cost of the losses. Never touches the map.

import { resolveEngagement } from "../engine/combat.js";
import { UNIT_UPKEEP, normalizePools } from "../engine/forcePools.js";
import { roundTo } from "../engine/economyMath.js";
import { applyCountryStatPatchToWorld, normalizeWorldState } from "./gameState.js";
import { toCountryName } from "./ownerNames.js";

// One strength point is this many months of the formation's upkeep, as a
// one-shot battle cost. First-draft calibration.
export const COMBAT_POOL_FACTOR = 10;

const name = (value) => String(value ?? "").trim();
const foldKey = (value) => name(value).toLocaleLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

const canonicalPolity = (value) => toCountryName(name(value)) || name(value);
const ownerOf = (unit) => canonicalPolity(unit?.ownerCode);

const findActiveWar = (warId, world) =>
  list(world?.wars).find(
    (entry) => name(entry?.id) === warId && name(entry?.status).toLowerCase() === "active",
  );

// Build the neutral engagement description, or null when the event is not a
// resolvable declaration (no war, no active war, no region, or a side absent
// from the field is left to the caller as an unresolved note).
export const buildEngagement = (event, world, { round = 0 } = {}) => {
  const warId = name(event?.warId);
  const regionId = name(event?.combatRegion);
  if (!warId || !regionId) return null;
  const war = findActiveWar(warId, world);
  if (!war) return null;

  const sideAKeys = new Set(list(war.sideA).map(foldKey));
  const sideBKeys = new Set(list(war.sideB).map(foldKey));
  const posture = {};
  for (const [polity, value] of Object.entries(world?.economyEngine?.mobilization ?? {})) {
    posture[toCountryName(name(polity)) || name(polity)] = name(value) || "peacetime";
  }

  const bucketA = new Map();
  const bucketB = new Map();
  for (const unit of list(world?.units)) {
    if (name(unit?.regionId) !== regionId) continue;
    const owner = ownerOf(unit);
    const bucket = sideAKeys.has(foldKey(owner)) ? bucketA : sideBKeys.has(foldKey(owner)) ? bucketB : null;
    if (!bucket) continue;
    if (!bucket.has(owner)) bucket.set(owner, []);
    bucket.get(owner).push({
      id: name(unit?.id),
      type: name(unit?.type) || "infantry",
      strength: Number(unit?.strength) || 0,
    });
  }

  // The core credits the province to the first polity of the winning side that
  // has units, so each side must be returned in the war's declared order, not
  // in roster order. Keep only declared polities that fielded a unit, deduped.
  const toSide = (declared, bucket) => {
    const seen = new Set();
    const side = [];
    for (const declaredName of list(declared)) {
      const polity = canonicalPolity(declaredName);
      const key = foldKey(polity);
      if (seen.has(key) || !bucket.has(polity)) continue;
      seen.add(key);
      side.push({ polity, posture: posture[polity] || "peacetime", units: bucket.get(polity) });
    }
    return side;
  };

  // The war declares a side as a list of polities; the buckets only hold the
  // ones that actually fielded a unit. Keep the declared names so an unresolved
  // note can name the side that was missing from the field.
  const sideAPolities = list(war.sideA).map(canonicalPolity);
  const sideBPolities = list(war.sideB).map(canonicalPolity);

  // The caller passes an already-normalized world (the turn's baseWorldNormalized),
  // so the override reads directly rather than re-normalizing per event.
  const override = world?.regionOwnershipOverrides?.[regionId];
  const controllerPolity = toCountryName(name(override)) || name(override);

  return {
    warId,
    regionId,
    date: name(event?.date),
    round: Number(round) || 0,
    controllerPolity,
    sideAPolities,
    sideBPolities,
    sideA: toSide(war.sideA, bucketA),
    sideB: toSide(war.sideB, bucketB),
  };
};

const casualtyOps = (casualties) => casualties.map((entry) => (
  entry.destroyed
    ? { op: "remove", unitId: entry.unitId }
    : { op: "strength", unitId: entry.unitId, strength: entry.nextStrength }
));

const addCost = (reserveCost, polity, type, lostPoints) => {
  const upkeep = UNIT_UPKEEP[type] ?? UNIT_UPKEEP.infantry;
  const row = reserveCost[polity] ?? { manpower: 0, materiel: 0 };
  row.manpower += upkeep.manpower * (lostPoints / 100) * COMBAT_POOL_FACTOR;
  row.materiel += upkeep.materiel * (lostPoints / 100) * COMBAT_POOL_FACTOR;
  reserveCost[polity] = row;
};

// Resolve every declared battle in a turn. Reads the world it is given and
// returns ops and a cost; it never mutates the world.
export const resolveEventEngagements = (events, world, { round = 0 } = {}) => {
  const results = [];
  const unresolved = [];
  const reserveCost = {};

  list(events).forEach((event, eventIndex) => {
    const input = buildEngagement(event, world, { round });
    if (!input) {
      // An active-war declaration with no region is still a battle declaration:
      // it stays narrative and draws a note explaining what was missing.
      const warId = name(event?.warId);
      if (warId && !name(event?.combatRegion) && findActiveWar(warId, world)) {
        unresolved.push({
          eventIndex,
          reason: `the declaration for ${warId} named no combat region`,
        });
      }
      return;
    }
    const sideAEmpty = input.sideA.length === 0;
    if (sideAEmpty || input.sideB.length === 0) {
      const absent = sideAEmpty ? input.sideAPolities : input.sideBPolities;
      unresolved.push({
        eventIndex,
        reason: `no units in ${input.regionId} for ${absent.join(", ")}`,
      });
      return;
    }

    const outcome = resolveEngagement(input);
    for (const casualty of outcome.casualties) {
      addCost(reserveCost, casualty.polity, casualty.type, casualty.lostPoints);
    }
    const controlOps = outcome.controlChange
      ? [{
        op: "control",
        regionId: input.regionId,
        fromCode: input.controllerPolity,
        toCode: outcome.controlChange.toCode,
        note: "engine-resolved engagement",
      }]
      : [];
    results.push({
      eventIndex,
      unitOps: casualtyOps(outcome.casualties),
      regionControlOps: controlOps,
      controlRegionId: input.regionId,
      controlToCode: outcome.controlChange?.toCode ?? "",
      casualtyCount: outcome.casualties.length,
      destroyedCount: outcome.casualties.filter((entry) => entry.destroyed).length,
      winner: outcome.winner,
    });
  });

  const rounded = {};
  for (const [polity, row] of Object.entries(reserveCost)) {
    rounded[polity] = {
      manpower: Math.round(row.manpower),
      materiel: roundTo(row.materiel, 2),
    };
  }
  return { results, reserveCost: rounded, unresolved };
};

// Replace the model's own numbers and its claim on the contested region with the
// engine's result, in place. The model keeps its moves and spawns. Returns how
// many events were rewritten so the caller can report it.
export const mergeEngagementResults = (events, results) => {
  let merged = 0;
  for (const result of list(results)) {
    const event = events?.[result.eventIndex];
    if (!event || typeof event !== "object") continue;
    const impacts = event.impacts && typeof event.impacts === "object"
      ? event.impacts
      : (event.impacts = {});
    impacts.unitOps = list(impacts.unitOps).filter(
      (op) => !["strength", "remove"].includes(name(op?.op).toLowerCase()),
    );
    impacts.regionControlOps = list(impacts.regionControlOps).filter(
      (op) => name(op?.regionId) !== result.controlRegionId,
    );
    impacts.regionTransfers = list(impacts.regionTransfers).filter(
      (op) => name(op?.regionId) !== result.controlRegionId,
    );
    impacts.unitOps.push(...result.unitOps);
    impacts.regionControlOps.push(...result.regionControlOps);
    merged += 1;
  }
  return merged;
};

// Charge a battle's losses to the reserves with the absolute zero floor, and
// refresh the forces mirror so the panel shows the post-battle reserve now.
export const applyCombatReserveCost = (world, reserveCost) => {
  if (!reserveCost || Object.keys(reserveCost).length === 0) return world;
  const next = normalizeWorldState(world);
  const pools = normalizePools(next.economyEngine?.pools);
  for (const [polity, cost] of Object.entries(reserveCost)) {
    const prior = pools[polity] ?? { manpower: 0, materiel: 0 };
    pools[polity] = {
      manpower: Math.max(0, Math.round((prior.manpower ?? 0) - (cost.manpower ?? 0))),
      materiel: Math.max(0, roundTo((prior.materiel ?? 0) - (cost.materiel ?? 0), 2)),
    };
  }
  const withPools = {
    ...next,
    economyEngine: { ...(next.economyEngine ?? {}), pools },
  };
  for (const polity of Object.keys(reserveCost)) {
    // next is already normalized; each polity's sheet is independent, so read it
    // once instead of re-normalizing the whole world per polity.
    const sheet = next.countryStats?.[polity]?.forces ?? {};
    applyCountryStatPatchToWorld(withPools, polity, {
      forces: {
        manpower: pools[polity].manpower,
        materiel: pools[polity].materiel,
        mobilization: sheet.mobilization ?? "peacetime",
        ...(sheet.shortfall ? { shortfall: sheet.shortfall } : {}),
      },
    }, { replaceComponents: true, engineSourced: true });
  }
  return withPools;
};
