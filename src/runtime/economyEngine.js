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
} from "../engine/forcePools.js";
import { applyCountryStatPatchToWorld } from "./gameState.js";
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

  const upkeepTable = upkeep ?? buildUpkeepTable(world);
  const { state, journal } = advanceEconomy(committed, {
    startDate: fromDate,
    months,
    shocks: applied,
    seed,
    upkeep: upkeepTable,
    posture,
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
        mobilization: posture[name] ?? DEFAULT_POSTURE,
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
  // What the model should be told is still running: the leftover spans, in the
  // digest's shape (a shock this period's answer just declared is not running yet).
  const shocksRunning = leftovers.map((shock) => ({
    kind: shock.kind,
    severity: shock.severity,
    monthsLeft: shock.durationMonths,
  }));
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
  };
};
