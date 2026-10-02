// Open Historia - derived front lines (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// A pure read of the map as a graph: which adjacent regions are held by two
// enemies in an active war, and where enemy units stand together. It computes
// no losses and writes nothing; it exists so the attrition and supply work has
// one definition of "contact" to read. Imports nothing, so enginePurity holds.

const name = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
// The same folded membership key the war ledger and the combat adapter use.
const foldKey = (value) => name(value).toLocaleLowerCase();
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const dedupe = (values) => {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = foldKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
};

export const deriveFrontLines = ({ wars = [], units = [], regions = [] } = {}) => {
  // Effective controller per region, and the undirected neighbourhood.
  const controllerOf = new Map();
  for (const region of list(regions)) {
    const id = name(region?.id);
    const controller = name(region?.controller);
    // An ownerless row (ocean, unowned, malformed) is not a side of any front
    // and not a contested holder, matching regionVocab's groupByOwner skip.
    if (id && controller) controllerOf.set(id, controller);
  }
  const neighbours = new Map();
  for (const id of controllerOf.keys()) neighbours.set(id, new Set());
  for (const region of list(regions)) {
    const id = name(region?.id);
    if (!id || !controllerOf.has(id)) continue;
    for (const raw of list(region?.adjacencies)) {
      const other = name(raw);
      if (!other || other === id || !controllerOf.has(other)) continue;
      neighbours.get(id).add(other);
      neighbours.get(other).add(id);
    }
  }

  // Active wars, and for each polity the active wars it stands in on each side.
  const activeWars = [];
  const sideOfPolity = new Map();
  const bucket = (key, side) => {
    let entry = sideOfPolity.get(key);
    if (!entry) {
      entry = { a: new Set(), b: new Set() };
      sideOfPolity.set(key, entry);
    }
    return entry[side];
  };
  const seenWars = new Set();
  for (const war of list(wars)) {
    const id = name(war?.id);
    if (!id || seenWars.has(id) || foldKey(war?.status) !== "active") continue;
    seenWars.add(id);
    const sideA = dedupe(list(war?.sideA).map(name).filter(Boolean));
    const sideB = dedupe(list(war?.sideB).map(name).filter(Boolean));
    activeWars.push({ id, sideA, sideB });
    for (const polity of sideA) bucket(foldKey(polity), "a").add(id);
    for (const polity of sideB) bucket(foldKey(polity), "b").add(id);
  }
  activeWars.sort((a, b) => compare(a.id, b.id));

  // The active wars in which two controllers are enemies.
  const hostileWars = (a, b) => {
    const ka = foldKey(a);
    const kb = foldKey(b);
    if (!ka || !kb || ka === kb) return [];
    const ea = sideOfPolity.get(ka);
    const eb = sideOfPolity.get(kb);
    if (!ea || !eb) return [];
    const out = new Set();
    for (const id of ea.a) if (eb.b.has(id)) out.add(id);
    for (const id of ea.b) if (eb.a.has(id)) out.add(id);
    return [...out].sort(compare);
  };

  const edges = [];
  for (const regionA of [...controllerOf.keys()].sort(compare)) {
    for (const regionB of neighbours.get(regionA)) {
      if (compare(regionA, regionB) >= 0) continue;
      const polityA = controllerOf.get(regionA);
      const polityB = controllerOf.get(regionB);
      const warIds = hostileWars(polityA, polityB);
      if (!warIds.length) continue;
      edges.push({ regionA, regionB, polityA, polityB, warIds });
    }
  }
  edges.sort((a, b) => compare(a.regionA, b.regionA) || compare(a.regionB, b.regionB));

  // Units by region, deduped to one display spelling per owner.
  const ownersInRegion = new Map();
  for (const unit of list(units)) {
    const regionId = name(unit?.regionId);
    const owner = name(unit?.ownerCode);
    if (!regionId || !owner || !controllerOf.has(regionId)) continue;
    let owners = ownersInRegion.get(regionId);
    if (!owners) {
      owners = new Map();
      ownersInRegion.set(regionId, owners);
    }
    const key = foldKey(owner);
    if (!owners.has(key)) owners.set(key, owner);
  }
  const presentSide = (declared, owners) =>
    declared.map((polity) => owners.get(foldKey(polity))).filter(Boolean);

  const contested = [];
  for (const war of activeWars) {
    for (const [regionId, owners] of ownersInRegion) {
      const sideA = presentSide(war.sideA, owners);
      const sideB = presentSide(war.sideB, owners);
      if (!sideA.length || !sideB.length) continue;
      contested.push({
        regionId,
        warId: war.id,
        controller: controllerOf.get(regionId) ?? "",
        sideA,
        sideB,
      });
    }
  }
  contested.sort((a, b) => compare(a.regionId, b.regionId) || compare(a.warId, b.warId));

  const byWar = [];
  for (const war of activeWars) {
    const warEdges = edges
      .filter((edge) => edge.warIds.includes(war.id))
      .map((edge) => [edge.regionA, edge.regionB]);
    const warContested = contested
      .filter((entry) => entry.warId === war.id)
      .map((entry) => entry.regionId);
    if (!warEdges.length && !warContested.length) continue;
    byWar.push({ warId: war.id, sideA: [...war.sideA], sideB: [...war.sideB], edges: warEdges, contested: warContested });
  }
  byWar.sort((a, b) => compare(a.warId, b.warId));

  const regionsIndex = {};
  const addRole = (regionId, role, warIds) => {
    let row = regionsIndex[regionId];
    if (!row) {
      row = { controller: controllerOf.get(regionId) ?? "", roles: [], warIds: [] };
      regionsIndex[regionId] = row;
    }
    if (!row.roles.includes(role)) row.roles.push(role);
    for (const id of warIds) if (!row.warIds.includes(id)) row.warIds.push(id);
  };
  for (const edge of edges) {
    addRole(edge.regionA, "front", edge.warIds);
    addRole(edge.regionB, "front", edge.warIds);
  }
  for (const entry of contested) addRole(entry.regionId, "contested", [entry.warId]);
  for (const row of Object.values(regionsIndex)) {
    row.roles.sort(compare);
    row.warIds.sort(compare);
  }

  return { edges, contested, byWar, regions: regionsIndex };
};
