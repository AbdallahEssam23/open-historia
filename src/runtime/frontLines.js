// Open Historia - the front-line adapter (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// Reads the world and the catalog into the pure core's plain inputs and returns
// the derivation. Read-only: it writes nothing, and it imports no Game/AI
// module, so the derivation cannot depend on the prompt layer.

import { deriveFrontLines } from "../engine/frontLines.js";
import { regionOwnerName } from "./regionOwners.js";

const name = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);

export const readFrontLines = (world, catalog) => {
  const overrides = world?.regionOwnershipOverrides;
  const wars = list(world?.wars).map((war) => ({
    id: name(war?.id),
    status: name(war?.status),
    sideA: list(war?.sideA).map(name).filter(Boolean),
    sideB: list(war?.sideB).map(name).filter(Boolean),
  }));
  const units = list(world?.units)
    .map((unit) => ({ ownerCode: name(unit?.ownerCode), regionId: name(unit?.regionId) }))
    .filter((unit) => unit.ownerCode && unit.regionId);
  const regions = list(catalog)
    .map((row) => ({
      id: name(row?.id),
      controller: regionOwnerName(row, overrides),
      adjacencies: list(row?.adjacencies).map(name).filter(Boolean),
    }))
    .filter((region) => region.id);
  return deriveFrontLines({ wars, units, regions });
};
