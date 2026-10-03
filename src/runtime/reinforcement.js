// Open Historia - the reinforcement and rotation adapter (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// Reads the world and the catalog into the pure core's plain inputs and maps the
// result to the unit ops and the reserve draw the turn already applies.
// Read-only: it writes nothing and imports no Game/AI module.

import { deriveReinforcement } from "../engine/reinforcement.js";
import { monthsBetweenDates } from "../engine/economyMath.js";
import { readSupplyAttrition } from "./supplyAttrition.js";
import { buildOwnerAliasMap, createOwnerResolver } from "./ownerNames.js";

const name = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);

export const readReinforcement = (world, catalog, { fromDate = "", toDate = "", rotations = [], merges = [] } = {}) => {
  const resolveOwner = createOwnerResolver(buildOwnerAliasMap(world?.polityOverrides));

  // The policy in force this span: committed, overridden by last turn's pending
  // declaration. This turn's declaration is not read here; the economy commit
  // stores it for next period, exactly as mobilization lags.
  const committed = world?.economyEngine?.reinforcement;
  const pending = list(world?.economyEngine?.pendingReinforcement);
  const policies = {};
  for (const [rawKey, rawValue] of Object.entries(committed ?? {})) {
    const polity = resolveOwner(name(rawKey));
    const policy = name(rawValue).toLowerCase();
    if (polity && policy) policies[polity] = policy;
  }
  for (const entry of pending) {
    const polity = resolveOwner(name(entry?.polity ?? entry?.country));
    const policy = name(entry?.policy).toLowerCase();
    if (polity && policy) policies[polity] = policy;
  }

  const pools = {};
  for (const [rawKey, row] of Object.entries(world?.economyEngine?.pools ?? {})) {
    const polity = resolveOwner(name(rawKey));
    if (!polity || !row || typeof row !== "object") continue;
    pools[polity] = { manpower: row.manpower, materiel: row.materiel };
  }

  const units = list(world?.units).map((unit) => ({
    id: name(unit?.id),
    ownerCode: resolveOwner(name(unit?.ownerCode)),
    type: name(unit?.type),
    regionId: name(unit?.regionId),
    // Passed through raw: the core owns the 0-100 clamp and the full-strength
    // default, so a blank or missing value is not read as zero here.
    strength: unit?.strength,
    lng: unit?.lng,
    lat: unit?.lat,
  }));
  const wars = list(world?.wars).map((war) => ({
    status: name(war?.status),
    sideA: list(war?.sideA).map((row) => resolveOwner(name(row))).filter(Boolean),
    sideB: list(war?.sideB).map((row) => resolveOwner(name(row))).filter(Boolean),
  }));

  // The supply states part two already derives, read through its own adapter so
  // "in supply" has one definition. Only reachable is read; the attrition loss
  // is ignored.
  const supply = readSupplyAttrition(world, catalog, { fromDate, toDate }).units.map((row) => ({
    unitId: row.unitId,
    reachable: row.reachable,
  }));

  const result = deriveReinforcement({
    policies,
    pools,
    units,
    supply,
    wars,
    rotations,
    merges,
    // The same whole-month step the economy uses: a one-day turn is a zero-month
    // turn, so it restores nothing but still rotates or merges.
    months: Math.max(0, monthsBetweenDates(fromDate, toDate)),
  });

  return {
    ops: result.ops,
    reserveCost: result.draws,
    summary: result.summary,
    rejections: result.rejections,
  };
};
