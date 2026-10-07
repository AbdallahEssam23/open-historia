// Open Historia - the region adjacency adapter (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// Binds the pure contiguity graph to the world's ownership so any caller can ask
// "who does this power border". Read-only: it writes nothing and imports no
// Game/AI module, so the derivation cannot depend on the prompt layer. It exists
// so the AI lookup tools and the war engines share one answer to contiguity.

import { buildRegionAdjacency } from "../engine/regionAdjacency.js";
import { regionOwnerName } from "./regionOwners.js";
import { buildOwnerAliasMap, createOwnerResolver } from "./ownerNames.js";

const name = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const fold = (value) => name(value).toLocaleLowerCase();

// Build the graph and the owner lookup once, from a world and the rendered
// catalog. Ownership resolves the same way the front-line and supply adapters do:
// an explicit override wins, then the catalog's own owner, then the alias map, so
// a renamed polity and a legacy code both fold onto the name the units use.
export const readRegionAdjacency = (world, catalog) => {
  const overrides = world?.regionOwnershipOverrides;
  const resolveOwner = createOwnerResolver(buildOwnerAliasMap(world?.polityOverrides));
  const rows = list(catalog)
    .map((row) => ({
      id: name(row?.id),
      adjacencies: list(row?.adjacencies).map(name).filter(Boolean),
      bbox: Array.isArray(row?.bbox) && row.bbox.length === 4 ? row.bbox : null,
      geometry: row?.geometry ?? null,
    }))
    .filter((row) => row.id);
  const graph = buildRegionAdjacency(rows);
  const ownerById = new Map();
  for (const row of list(catalog)) {
    const id = name(row?.id);
    if (!id) continue;
    ownerById.set(id, resolveOwner(regionOwnerName(row, overrides)));
  }
  return { graph, ownerOf: (id) => ownerById.get(name(id)) ?? "", resolveOwner };
};

// The regions a polity holds, the regions of other polities that border them, and
// the distinct bordering polities. `polityId` may be a resolved name, an alias or
// a legacy code: it is canonicalised the same way the catalog owners are, so the
// two meet. An unknown polity is empty, not an error.
export const getContiguousNeighbors = (world, catalog, polityId) => {
  const { graph, ownerOf, resolveOwner } = readRegionAdjacency(world, catalog);
  const wanted = fold(resolveOwner(polityId) || name(polityId));

  const regions = [];
  const regionSet = new Set();
  for (const row of list(catalog)) {
    const id = name(row?.id);
    if (id && wanted && fold(ownerOf(id)) === wanted && !regionSet.has(id)) {
      regionSet.add(id);
      regions.push(id);
    }
  }

  const neighbours = [];
  const polities = [];
  const seenRegion = new Set();
  const seenPolity = new Set();
  for (const id of regions) {
    for (const neighbour of graph.neighborsOf(id)) {
      if (regionSet.has(neighbour) || seenRegion.has(neighbour)) continue;
      seenRegion.add(neighbour);
      const owner = ownerOf(neighbour);
      neighbours.push({ regionId: neighbour, owner });
      const key = fold(owner);
      if (key && !seenPolity.has(key)) {
        seenPolity.add(key);
        polities.push(owner);
      }
    }
  }

  return {
    polity: resolveOwner(polityId) || name(polityId),
    regions,
    neighbours,
    polities,
  };
};
