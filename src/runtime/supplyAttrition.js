// Open Historia - the supply and attrition adapter (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// Reads the world and the catalog into the pure core's plain inputs and maps
// the result to the unit ops the turn already applies. Read-only: it writes
// nothing, charges no reserve, and imports no Game/AI module.

import { deriveSupplyAttrition } from "../engine/supplyAttrition.js";
import { monthsBetweenDates } from "../engine/economyMath.js";
import { regionOwnerName } from "./regionOwners.js";

const name = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);

export const readSupplyAttrition = (world, catalog, { fromDate = "", toDate = "" } = {}) => {
  const overrides = world?.regionOwnershipOverrides;
  const wars = list(world?.wars).map((war) => ({
    id: name(war?.id),
    status: name(war?.status),
    sideA: list(war?.sideA).map(name).filter(Boolean),
    sideB: list(war?.sideB).map(name).filter(Boolean),
  }));
  const units = list(world?.units).map((unit) => ({
    id: name(unit?.id),
    ownerCode: name(unit?.ownerCode),
    regionId: name(unit?.regionId),
    // Passed through raw: the core owns the 0-100 clamp and the full-strength
    // default, so a blank or missing value is not read as zero here.
    strength: unit?.strength,
  }));
  const regions = list(catalog)
    .map((row) => ({
      id: name(row?.id),
      controller: regionOwnerName(row, overrides),
      // The home owner ignores overrides: supply flows from soil the polity
      // still holds as its own, not from whatever it happens to occupy.
      home: regionOwnerName(row, {}),
      adjacencies: list(row?.adjacencies).map(name).filter(Boolean),
    }))
    .filter((region) => region.id);

  const result = deriveSupplyAttrition({
    wars,
    units,
    regions,
    // The same whole-month step the economy uses, so a one-day turn is a
    // zero-month turn and a time skip wears a pocket down month by month.
    months: Math.max(0, monthsBetweenDates(fromDate, toDate)),
  });

  const ops = [];
  for (const unit of result.units) {
    if (unit.destroyed) ops.push({ op: "remove", unitId: unit.unitId });
    else if (unit.loss > 0) ops.push({ op: "strength", unitId: unit.unitId, strength: unit.nextStrength });
  }

  return { units: result.units, ops, summary: { ...result.summary, opCount: ops.length } };
};
