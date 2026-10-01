/*! Open Historia - deterministic economy: the runtime adapter (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The ONLY place that knows both the world shape and the engine. It extracts a
// compact economic state out of world.countryStats, hands it to the pure core,
// and writes the result back through the existing country-stat seam. Nothing
// else in the game needs to know the engine exists.

import { advanceEconomy, makePolityEconomy } from "../engine/economyTick.js";
import { jitterFor, monthsBetweenDates, roundTo, stableOrder } from "../engine/economyMath.js";
import { MAX_SHOCKS, normalizeShocks } from "../engine/economyShocks.js";
import {
  DEFAULT_POSTURE,
  UNIT_UPKEEP,
  normalizeMobilization,
  normalizeMobilizationMap,
  normalizePools,
  normalizeUpkeepShortfall,
  postureFor,
} from "../engine/forcePools.js";
import {
  markerKindFor,
  normalizeProductionOrders,
  normalizeProductionQueue,
} from "../engine/productionQueue.js";
import { applyCountryStatPatchToWorld } from "./gameState.js";
import { addGameMonths } from "./gameDates.js";
import { hashSeed } from "./unitMotion.js";

const ENGINE_VERSION = 1;
const OWNED_ECONOMY_FIELDS = [
  "gdp",
  "gdpPerCapita",
  "gdpGrowth",
  "inflation",
  "unemployment",
  "publicDebt",
  "budgetBalance",
];

const hex32 = (text) => hashSeed(text).toString(16).padStart(8, "0").repeat(4);

export const economySeedFor = (campaignId, scenarioId) =>
  hex32(`${String(campaignId ?? "")}|${String(scenarioId ?? "")}|economy-v${ENGINE_VERSION}`);

const sheetToPolity = (name, sheet, seed) => {
  const economy = sheet?.economy ?? {};
  const population = sheet?.population ?? {};
  const components = Array.isArray(sheet?.territorialComponents)
    ? sheet.territorialComponents.map((c) => ({
      geography: String(c.geography ?? ""),
      group: String(c.group ?? "core"),
      population: Number(c.population) || 0,
      gdpPerCapita: Number(c.gdpPerCapita) || 0,
    }))
    : [];
  const totalPopulation = Number(population.total) || 0;
  const gdp = Number(economy.gdp) || 0;
  const gdpPerCapita = Number(economy.gdpPerCapita) || (totalPopulation > 0 ? gdp / totalPopulation : 0);
  if (!(totalPopulation > 0) || !(gdpPerCapita > 0)) return null;
  return makePolityEconomy({
    population: totalPopulation,
    gdp,
    gdpPerCapita,
    gdpGrowth: economy.gdpGrowth,
    inflation: economy.inflation,
    unemployment: economy.unemployment,
    publicDebt: economy.publicDebt,
    budgetBalance: economy.budgetBalance,
    stability: sheet.stability,
    gdpBreakdown: sheet.gdpBreakdown,
    components,
    jitter: jitterFor(seed, name),
  });
};

export const extractEconomyState = (world, { seed = "" } = {}) => {
  const polities = {};
  for (const [name, sheet] of Object.entries(world?.countryStats ?? {})) {
    const polity = sheetToPolity(name, sheet, seed);
    if (polity) polities[name] = polity;
  }
  const fromDate = String(world?.economyEngine?.lastDate ?? "");
  return {
    month: monthsBetweenDates("2000-01-01", fromDate),
    polities,
    pools: normalizePools(world?.economyEngine?.pools),
    shortfall: normalizeUpkeepShortfall(world?.economyEngine?.upkeepShortfall),
    production: normalizeProductionQueue(world?.economyEngine?.production),
  };
};

// The engine's patch. Only the fields the engine owns are written, so an index
// an event set the same turn is not disturbed. The component ledger goes into
// `territorialComponents` and is applied with `replaceComponents`, so a row the
// engine dropped does not linger in the merged sheet.
const polityToPatch = (polity) => ({
  stability: roundTo(polity.stability, 4),
  economy: {
    gdp: roundTo(polity.gdp, 2),
    gdpPerCapita: roundTo(polity.gdpPerCapita, 4),
    gdpGrowth: roundTo(polity.gdpGrowth, 4),
    inflation: roundTo(polity.inflation, 4),
    unemployment: roundTo(polity.unemployment, 4),
    publicDebt: roundTo(polity.publicDebt, 4),
    budgetBalance: roundTo(polity.budgetBalance, 4),
  },
  gdpBreakdown: { ...polity.gdpBreakdown },
  ...(polity.components.length
    ? {
      territorialComponents: polity.components.map((c) => ({
        geography: c.geography,
        group: c.group,
        population: Math.round(c.population),
        gdpPerCapita: roundTo(c.gdpPerCapita, 4),
      })),
    }
    : {}),
});

// What the roster costs every month, grouped by owner. Read only: a unit is
// never edited, moved or disbanded here. Units are counted per owner and type
// first, then each owner's row is summed in a stable type order. The materiel
// costs are floats and float addition is not associative, so summing them in
// roster order would make the total depend on the roster order; a fixed type
// order makes the arithmetic order-independent.
export const buildUpkeepTable = (world) => {
  const counts = {};
  for (const unit of Array.isArray(world?.units) ? world.units : []) {
    const owner = String(unit?.ownerCode ?? "").trim();
    if (!owner) continue;
    const type = String(unit?.type ?? "").toLowerCase();
    if (!UNIT_UPKEEP[type]) continue;
    const byType = counts[owner] ?? {};
    byType[type] = (byType[type] ?? 0) + 1;
    counts[owner] = byType;
  }
  const table = {};
  for (const owner of stableOrder(Object.keys(counts))) {
    let manpower = 0;
    let materiel = 0;
    for (const type of stableOrder(Object.keys(counts[owner]))) {
      const count = counts[owner][type];
      manpower += count * UNIT_UPKEEP[type].manpower;
      materiel += count * UNIT_UPKEEP[type].materiel;
    }
    table[owner] = { manpower, materiel };
  }
  return table;
};

// The words a completed unit is named with when the order gave no name. The
// engine never invents a display name; this is the boundary's own fallback so a
// spawned unit is readable on the map.
export const UNIT_LABEL = Object.freeze({
  infantry: "Infantry", armor: "Armor", air: "Air",
  naval: "Naval", artillery: "Artillery", garrison: "Garrison",
});

const unitSiteFor = (world, polity, at) => {
  if (at) return at;
  const sheet = world?.countryStats?.[polity];
  const capital = String(sheet?.capital ?? "").trim();
  if (capital) return capital;
  const component = Array.isArray(sheet?.territorialComponents) ? sheet.territorialComponents[0] : null;
  return String(component?.geography ?? "").trim();
};

const existingUnitCount = (world, polity, type) =>
  (Array.isArray(world?.units) ? world.units : []).filter(
    (unit) => String(unit?.ownerCode ?? "").trim() === polity
      && String(unit?.type ?? "").toLowerCase() === type,
  ).length;

// A completion is the engine's statement that an item is done. This turns those
// statements into the operations the narrator already emits, grouped by the date
// each item landed, so the event path can resolve and apply them.
export const completionBatchesFor = (completions, { world = {}, fromDate = "" } = {}) => {
  const byDate = new Map();
  const running = new Map();
  for (const completion of Array.isArray(completions) ? completions : []) {
    const offset = Math.max(1, Math.trunc(Number(completion?.monthOffset)) || 1);
    const date = addGameMonths(fromDate, offset);
    const batch = byDate.get(date) ?? { date, unitOps: [], markerOps: [] };
    if (completion.kind === "unit") {
      const site = unitSiteFor(world, completion.polity, completion.at);
      if (!site) continue;
      const count = Math.max(1, Math.trunc(Number(completion.count)) || 1);
      for (let index = 0; index < count; index += 1) {
        const key = `${completion.polity}|${completion.type}`;
        const seen = running.get(key) ?? existingUnitCount(world, completion.polity, completion.type);
        running.set(key, seen + 1);
        const label = UNIT_LABEL[completion.type] ?? completion.type;
        batch.unitOps.push({
          op: "spawn",
          unit: {
            type: completion.type,
            ownerCode: completion.polity,
            strength: 100,
            at: site,
            name: completion.name || `${label} ${seen + 1}`,
          },
        });
      }
    } else if (completion.at) {
      const kind = markerKindFor(completion.type);
      batch.markerOps.push({
        op: "build",
        marker: {
          name: completion.name || kind,
          kind,
          ownerCode: completion.polity,
          status: "active",
          at: completion.at,
        },
      });
    }
    byDate.set(date, batch);
  }
  return [...byDate.values()];
};

export const advanceWorldEconomy = (
  world,
  {
    fromDate = "",
    toDate = "",
    // This turn's answer. It is NOT applied now: a shock declared in the period
    // the model just narrated would retroactively rewrite that period, which is
    // exactly the race the one-period lag removes. It is stored and runs next
    // period, so the model reacts to the digest it was given instead.
    declaredShocks = [],
    declaredMobilization = [],
    declaredProduction = [],
    playerPolity = "",
    tracked = [],
    campaignId = "",
    scenarioId = "",
    // The period's OPENING roster cost, built by the caller so the dry run and
    // the authoritative advance charge the same army. Absent, it is built here.
    upkeep = null,
  } = {},
) => {
  const seed = String(world?.economyEngine?.seed ?? economySeedFor(campaignId, scenarioId));
  const committed = extractEconomyState(world, { seed });
  const months = monthsBetweenDates(fromDate, toDate);
  const knownPolities = Object.keys(committed.polities);
  if (months <= 0 || knownPolities.length === 0) {
    return {
      world,
      deltas: [],
      months: 0,
      journal: { steps: 0, capped: false, shockedMonths: 0, seed },
      seed,
      shocksRunning: [],
      pools: committed.pools,
      posture: {},
      shortfall: committed.shortfall,
      declaredMobilization: [],
      production: committed.production,
      completionBatches: [],
    };
  }

  const { valid: applied, rejected } = normalizeShocks(world?.economyEngine?.pendingShocks, { knownPolities });
  const { valid: declared, rejected: declaredRejected } = normalizeShocks(declaredShocks, { knownPolities });

  // The posture in force this period: committed, overridden by last turn's
  // pending declaration. This turn's declaration is stored for next period.
  const posture = { ...normalizeMobilizationMap(world?.economyEngine?.mobilization) };
  const { valid: pendingNow } = normalizeMobilization(world?.economyEngine?.pendingMobilization, { knownPolities });
  for (const entry of pendingNow) posture[entry.polity] = entry.posture;
  const { valid: declaredNow, rejected: declaredMobilizationRejected } =
    normalizeMobilization(declaredMobilization, { knownPolities });

  const { valid: appliedOrders, rejected: pendingProductionRejected } =
    normalizeProductionOrders(world?.economyEngine?.pendingProduction, { knownPolities });
  const { valid: declaredProductionNow, rejected: declaredProductionRejected } =
    normalizeProductionOrders(declaredProduction, { knownPolities });

  const upkeepTable = upkeep ?? buildUpkeepTable(world);
  const { state, journal, completions, rejectedProduction } = advanceEconomy(committed, {
    startDate: fromDate,
    months,
    shocks: applied,
    seed,
    upkeep: upkeepTable,
    posture,
    orders: appliedOrders,
  });

  // A shock longer than the period keeps running. Its window is re-based back to
  // the declared shape so the next advance starts it from month zero again, in
  // the period it actually reaches. The window is `endMonth - months` because
  // normalizeShocks sets startMonth 0 and endMonth to the full duration.
  const leftovers = applied
    .filter((shock) => shock.endMonth > months)
    .map((shock) => ({
      kind: shock.kind,
      severity: shock.severity,
      durationMonths: shock.endMonth - months,
      scope: Array.isArray(shock.scope) ? shock.scope : "world",
    }));
  const pendingShocks = [
    ...leftovers,
    ...declared.map((shock) => ({
      kind: shock.kind,
      severity: shock.severity,
      durationMonths: shock.endMonth,
      scope: Array.isArray(shock.scope) ? shock.scope : "world",
    })),
  ].slice(0, MAX_SHOCKS);

  // Only non-default postures are stored, so an absent name reads as peacetime.
  const committedMobilization = Object.fromEntries(
    stableOrder(Object.keys(posture))
      .filter((name) => posture[name] && posture[name] !== DEFAULT_POSTURE)
      .map((name) => [name, posture[name]]),
  );
  const shortfall = normalizeUpkeepShortfall(state.shortfall);

  const nextWorld = {
    ...world,
    countryStats: { ...(world?.countryStats ?? {}) },
    economyEngine: {
      version: ENGINE_VERSION,
      seed,
      lastDate: toDate,
      lastMonth: state.month,
      ...(pendingShocks.length ? { pendingShocks } : {}),
      ...(Object.keys(state.pools).length ? { pools: state.pools } : {}),
      ...(Object.keys(state.production).length ? { production: state.production } : {}),
      ...(declaredProductionNow.length ? { pendingProduction: declaredProductionNow } : {}),
      ...(Object.keys(committedMobilization).length ? { mobilization: committedMobilization } : {}),
      ...(declaredNow.length ? { pendingMobilization: declaredNow } : {}),
      ...(Object.keys(shortfall).length ? { upkeepShortfall: shortfall } : {}),
    },
  };

  const deltas = [];
  for (const [name, polity] of Object.entries(state.polities)) {
    applyCountryStatPatchToWorld(nextWorld, name, {
      ...polityToPatch(polity),
      forces: {
        manpower: state.pools[name]?.manpower ?? 0,
        materiel: state.pools[name]?.materiel ?? 0,
        mobilization: postureFor(posture, name),
        ...(shortfall[name] ? { shortfall: shortfall[name] } : {}),
      },
    }, {
      replaceComponents: true,
      engineSourced: true,
    });
    const engineSourced = OWNED_ECONOMY_FIELDS.every(
      (field) => (nextWorld.countryStats[name]?.economy?.[field] ?? null) !== null,
    );
    deltas.push({
      polity: name,
      gdpGrowth: polity.gdpGrowth,
      inflation: polity.inflation,
      unemployment: polity.unemployment,
      publicDebt: polity.publicDebt,
      budgetBalance: polity.budgetBalance,
      estimated: !engineSourced,
    });
  }

  const rejectedAll = [...rejected, ...declaredRejected, ...declaredMobilizationRejected];
  if (rejectedAll.length) nextWorld.economyEngine.rejectedShocks = rejectedAll;
  const rejectedProductionAll = [
    ...declaredProductionRejected,
    ...pendingProductionRejected,
    ...(Array.isArray(rejectedProduction) ? rejectedProduction : []),
  ];
  if (rejectedProductionAll.length) nextWorld.economyEngine.rejectedProduction = rejectedProductionAll;
  // What the model should be told is still running: the leftover spans, in the
  // digest's shape (a shock this period's answer just declared is not running yet).
  const shocksRunning = leftovers.map((shock) => ({
    kind: shock.kind,
    severity: shock.severity,
    monthsLeft: shock.durationMonths,
  }));
  const completionBatches = completionBatchesFor(completions, { world: nextWorld, fromDate });
  return {
    world: nextWorld,
    deltas,
    months,
    journal,
    seed,
    shocksRunning,
    pools: state.pools,
    posture,
    shortfall,
    declaredMobilization: declaredNow,
    production: state.production,
    completionBatches,
  };
};
