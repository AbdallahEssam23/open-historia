// Open Historia - canonicalize a declared combat region (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// Kept out of gameplay.js so a bare `node --test` can import it: gameplay.js
// pulls in ./main.jsx at module load, which node cannot parse. Pure: the catalog
// is passed in.

import { foldRegionKey } from "./regionMatch.js";

const name = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);

// Build a pure id/name resolver over a catalog of {id,name} rows: an exact id
// keeps itself, a friendly name folds to its id, and a value matching nothing
// resolves to "". `size` counts the rows that yielded a non-empty id.
export const buildRegionResolver = (catalog) => {
  const byId = new Set();
  const byName = new Map();
  for (const row of list(catalog)) {
    const id = name(row?.id);
    if (!id) continue;
    byId.add(id);
    const nameKey = foldRegionKey(name(row?.name));
    if (nameKey) byName.set(nameKey, id);
  }
  const resolve = (value) => {
    const key = name(value);
    if (!key) return "";
    if (byId.has(key)) return key;
    return byName.get(foldRegionKey(key)) ?? "";
  };
  return { resolve, size: byId.size };
};

// Canonicalize each event's combatRegion from a friendly name to a region id
// that the adapter can match against unit.regionId. The catalog is an array of
// {id,name} rows: an id keeps itself, a name folds to its id, and a value that
// matches nothing is cleared so an unresolvable declaration stays narrative
// rather than guessing.
export const resolveCombatRegionIds = (containers, catalog) => {
  const { resolve } = buildRegionResolver(catalog);
  let resolved = 0;
  let dropped = 0;
  // Each container is one { event, impacts, path } row; the declaration lives on
  // container.event, the same object the other resolvers read.
  const events = list(containers)
    .map((container) => container?.event)
    .filter((event) => event && typeof event === "object");
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const value = name(event.combatRegion);
    if (!value) continue;
    const match = resolve(value);
    if (match) {
      // An exact id is already canonical, so leave the field untouched as before.
      if (match !== value) event.combatRegion = match;
      resolved += 1;
      continue;
    }
    event.combatRegion = "";
    dropped += 1;
  }
  return { resolved, dropped };
};
