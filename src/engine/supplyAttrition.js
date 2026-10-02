// Open Historia - derived supply and attrition (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// A pure read of the map as a graph: for every placed formation, whether a path
// of its own side's ground runs home, and what standing there costs it this
// period. It reads the front-line core for contact roles so a front line and a
// front-line loss can never disagree. It writes nothing and stores nothing.

import { deriveFrontLines } from "./frontLines.js";

const name = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
// Locale-independent, matching frontLines.js: the derivation must be
// byte-identical across machines, unlike the ledger's locale-sensitive fold.
const foldKey = (value) => name(value).toLowerCase();
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Strength points lost per whole month, by supply state. First-draft
// calibration: the tests assert ordering and the period multiplier, never a
// magnitude, exactly as forcePools.js states for its own constants.
export const SUPPLY_ATTRITION_RATES = Object.freeze({
  supplied: 0,
  strained: 2,
  isolated: 10,
});

export const SUPPLY_STATES = Object.freeze(["supplied", "strained", "isolated"]);

const rateFor = (state) => SUPPLY_ATTRITION_RATES[state] ?? 0;

export const deriveSupplyAttrition = ({ wars = [], units = [], regions = [], months = 0 } = {}) => {
  const period = Math.max(0, Math.trunc(Number(months)) || 0);

  // Effective controller and base (home) owner per region, and the undirected
  // neighbourhood. An ownerless row is skipped, matching frontLines.js.
  const controllerOf = new Map();
  const homeOf = new Map();
  for (const region of list(regions)) {
    const id = name(region?.id);
    const controller = name(region?.controller);
    if (!id || !controller) continue;
    controllerOf.set(id, controller);
    homeOf.set(id, name(region?.home));
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

  // Contact roles are the one front-line derivation over the same graph, so a
  // front line and a front-line loss can never disagree about where contact is.
  const fronts = deriveFrontLines({
    wars,
    units: list(units).map((unit) => ({
      ownerCode: name(unit?.ownerCode),
      regionId: name(unit?.regionId),
    })),
    regions: list(regions).map((region) => ({
      id: name(region?.id),
      controller: name(region?.controller),
      adjacencies: list(region?.adjacencies).map(name).filter(Boolean),
    })),
  });
  const inContact = (regionId) => {
    // fronts.regions is keyed with Object.fromEntries, so an interior region id
    // that collides with Object.prototype ("__proto__", "constructor") would
    // otherwise resolve to an inherited member; an own-property check is the
    // same guard frontLines.js applies when it builds the index.
    if (!Object.hasOwn(fronts.regions, regionId)) return false;
    const row = fronts.regions[regionId];
    return row.roles.includes("front") || row.roles.includes("contested");
  };

  // Belligerents: a polity on a side of at least one active war. A ceasefire or
  // ended war makes none, matching the ledger and the combat adapter. A war
  // that lists one polity on both sides is degenerate: it makes no enemy pair
  // in frontLines and contributes no belligerent here.
  const belligerents = new Set();
  for (const war of list(wars)) {
    if (!war || foldKey(war?.status) !== "active") continue;
    const sideA = list(war?.sideA).map(foldKey).filter(Boolean);
    const sideB = list(war?.sideB).map(foldKey).filter(Boolean);
    if (sideA.some((key) => sideB.includes(key))) continue;
    for (const key of [...sideA, ...sideB]) belligerents.add(key);
  }

  // The supplied network of one owner: the regions it controls reachable from a
  // region it still holds as home. No home source means no network. Cached per
  // owner; the walk is a membership question, so no Set order leaks into output.
  const networkCache = new Map();
  const networkFor = (ownerKey) => {
    if (networkCache.has(ownerKey)) return networkCache.get(ownerKey);
    const reachable = new Set();
    const queue = [];
    for (const [id, controller] of controllerOf) {
      if (foldKey(controller) !== ownerKey) continue;
      if (foldKey(homeOf.get(id)) !== ownerKey) continue;
      reachable.add(id);
      queue.push(id);
    }
    while (queue.length) {
      const id = queue.shift();
      for (const next of neighbours.get(id) ?? []) {
        if (reachable.has(next)) continue;
        if (foldKey(controllerOf.get(next)) !== ownerKey) continue;
        reachable.add(next);
        queue.push(next);
      }
    }
    networkCache.set(ownerKey, reachable);
    return reachable;
  };

  const seenIds = new Set();
  const results = [];
  for (const raw of list(units)) {
    const unitId = name(raw?.id);
    const owner = name(raw?.ownerCode);
    const regionId = name(raw?.regionId);
    if (!unitId || !owner || !regionId) continue;
    if (!controllerOf.has(regionId)) continue;
    if (seenIds.has(unitId)) continue;
    seenIds.add(unitId);

    const ownerKey = foldKey(owner);
    const network = networkFor(ownerKey);
    const reachable = network.has(regionId);
    const contact = inContact(regionId);
    const adjacentToNetwork = !reachable
      && [...(neighbours.get(regionId) ?? [])].some((other) => network.has(other));

    let state = "isolated";
    if (reachable && !contact) state = "supplied";
    else if (reachable || adjacentToNetwork) state = "strained";

    // A unit in the world carries a clamped 0-100 strength. A missing, blank or
    // unparseable value defaults to full, so a malformed row is never destroyed
    // by accident.
    const rawStrength = raw?.strength;
    const parsedStrength = rawStrength === null || rawStrength === undefined || rawStrength === ""
      ? NaN
      : Number(rawStrength);
    const strength = Number.isFinite(parsedStrength) ? Math.max(0, Math.min(100, parsedStrength)) : 100;
    const belligerent = belligerents.has(ownerKey);
    const loss = belligerent ? rateFor(state) * period : 0;
    const nextStrength = Math.max(0, strength - loss);

    results.push({
      unitId,
      ownerCode: owner,
      regionId,
      state,
      belligerent,
      reachable,
      contact,
      loss,
      nextStrength,
      destroyed: loss > 0 && nextStrength <= 0,
    });
  }
  results.sort((a, b) => compare(a.unitId, b.unitId));

  return {
    units: results,
    summary: {
      supplied: results.filter((row) => row.state === "supplied").length,
      strained: results.filter((row) => row.state === "strained").length,
      isolated: results.filter((row) => row.state === "isolated").length,
      damaged: results.filter((row) => row.loss > 0).length,
      destroyed: results.filter((row) => row.destroyed).length,
    },
  };
};
