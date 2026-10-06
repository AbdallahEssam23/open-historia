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

// The side's leading polity: the first entry with units, the same one the core
// credits a province to, so a tactic clause names a side the way the region line
// does. Both sides are resolved in the war's declared order, so this is stable.
const leadingPolity = (side) => {
  for (const entry of list(side)) {
    if (list(entry?.units).length > 0) return name(entry.polity);
  }
  return "";
};

// A region's declared terrain, as a tri-state: `true` when the catalog says the
// region is coastal, `false` when it declares another terrain in a world that
// declares at least one coastal region, and `undefined` when there is no coastal
// data to apply (no coastal region anywhere, or an unknown id). The undefined
// case is what keeps the gate inert where the data does not exist.
export const regionCoastal = (regionId, catalog) => {
  const id = name(regionId);
  if (!id) return undefined;
  const rows = list(catalog);
  if (!rows.some((row) => name(row?.type).toLowerCase() === "coastal")) return undefined;
  const match = rows.find((row) => name(row?.id) === id);
  if (!match) return undefined;
  return name(match?.type).toLowerCase() === "coastal";
};

const findActiveWar = (warId, world) =>
  list(world?.wars).find(
    (entry) => name(entry?.id) === warId && name(entry?.status).toLowerCase() === "active",
  );

// Build the neutral engagement description, or null when the event is not a
// resolvable declaration (no war, no active war, no region, or a side absent
// from the field is left to the caller as an unresolved note).
export const buildEngagement = (event, world, { round = 0, regionCatalog = [] } = {}) => {
  const warId = name(event?.warId);
  const regionId = name(event?.combatRegion);
  if (!warId || !regionId) return null;
  const war = findActiveWar(warId, world);
  if (!war) return null;

  // The terrain the battle is fought on, forwarded to the core as a value. Only
  // an explicit `false` withholds naval shore support.
  const coastal = regionCoastal(regionId, regionCatalog);

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
    const key = foldKey(owner);
    const bucket = sideAKeys.has(key) ? bucketA : sideBKeys.has(key) ? bucketB : null;
    if (!bucket) continue;
    if (!bucket.has(key)) bucket.set(key, { polity: owner, units: [] });
    bucket.get(key).units.push({
      id: name(unit?.id),
      type: name(unit?.type) || "infantry",
      strength: Number(unit?.strength) || 0,
    });
  }

  // The core credits the province to the first polity of the winning side that
  // has units, so each side must be returned in the war's declared order, not
  // in roster order. Membership is case-insensitive (the same folded key the
  // ledger uses), but each entry keeps the roster's canonical spelling so the
  // reserve cost and posture lookups match the world. Keep only declared
  // polities that fielded a unit, deduped.
  const toSide = (declared, bucket) => {
    const seen = new Set();
    const side = [];
    for (const declaredName of list(declared)) {
      const key = foldKey(canonicalPolity(declaredName));
      const entry = bucket.get(key);
      if (!entry || seen.has(key)) continue;
      seen.add(key);
      side.push({
        polity: entry.polity,
        posture: posture[entry.polity] || "peacetime",
        units: entry.units,
      });
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
    coastal,
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

// One clause naming WHO benefited from the tactics the core computed, never by
// how much: the engine owns the numbers, the model owns the telling. Empty when
// nothing tactical happened, so the battle note is unchanged for a plain fight.
export const describeEngagementTactics = (result) => {
  const parts = [];
  const holder = (edge) => (edge > 0 ? name(result?.sideA?.polity) : name(result?.sideB?.polity));
  if (Number(result?.airEdge)) parts.push(`${holder(result.airEdge)} held the air`);
  const hasNaval = Number(result?.sideA?.navalPower) > 0 || Number(result?.sideB?.navalPower) > 0;
  if (result?.coastal === false && hasNaval) {
    parts.push("shore support was withheld (the region is inland)");
  } else if (Number(result?.navalEdge)) {
    parts.push(`${holder(result.navalEdge)} held the sea`);
  }
  if (Number(result?.antiEdge)) parts.push(`${holder(result.antiEdge)} had the counter edge`);
  return parts.join("; ");
};

const addCost = (reserveCost, polity, type, lostPoints) => {
  const upkeep = UNIT_UPKEEP[type] ?? UNIT_UPKEEP.infantry;
  const row = reserveCost[polity] ?? { manpower: 0, materiel: 0 };
  row.manpower += upkeep.manpower * (lostPoints / 100) * COMBAT_POOL_FACTOR;
  row.materiel += upkeep.materiel * (lostPoints / 100) * COMBAT_POOL_FACTOR;
  reserveCost[polity] = row;
};

// Resolve every declared battle in a turn. Reads the world it is given and
// returns ops and a cost; it never mutates the world.
export const resolveEventEngagements = (events, world, { round = 0, regionCatalog = [] } = {}) => {
  const results = [];
  const unresolved = [];
  const reserveCost = {};

  list(events).forEach((event, eventIndex) => {
    const input = buildEngagement(event, world, { round, regionCatalog });
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
    const sideBEmpty = input.sideB.length === 0;
    if (sideAEmpty || sideBEmpty) {
      const absent = [];
      if (sideAEmpty) absent.push(...input.sideAPolities);
      if (sideBEmpty) absent.push(...input.sideBPolities);
      const names = absent.join(", ");
      unresolved.push({
        eventIndex,
        reason: names ? `no units in ${input.regionId} for ${names}` : `no units in ${input.regionId}`,
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
      // The tactical breakdown the core computed, forwarded so the receipt can
      // tell the model why the battle went as it did.
      airEdge: outcome.airEdge,
      navalEdge: outcome.navalEdge,
      antiEdge: outcome.antiEdge,
      coastal: outcome.coastal,
      sideA: {
        polity: leadingPolity(input.sideA) || input.sideAPolities[0] || "",
        power: outcome.sideA.power,
        adjustedPower: outcome.sideA.adjustedPower,
        lossFraction: outcome.sideA.lossFraction,
        airPower: outcome.sideA.airPower,
        navalPower: outcome.sideA.navalPower,
        antiPower: outcome.sideA.antiPower,
      },
      sideB: {
        polity: leadingPolity(input.sideB) || input.sideBPolities[0] || "",
        power: outcome.sideB.power,
        adjustedPower: outcome.sideB.adjustedPower,
        lossFraction: outcome.sideB.lossFraction,
        airPower: outcome.sideB.airPower,
        navalPower: outcome.sideB.navalPower,
        antiPower: outcome.sideB.antiPower,
      },
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
