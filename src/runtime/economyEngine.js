/*! Open Historia - deterministic economy: the runtime adapter (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The ONLY place that knows both the world shape and the engine. It extracts a
// compact economic state out of world.countryStats, hands it to the pure core,
// and writes the result back through the existing country-stat seam. Nothing
// else in the game needs to know the engine exists.

import { advanceEconomy, makePolityEconomy } from "../engine/economyTick.js";
import { jitterFor, monthsBetweenDates, roundTo } from "../engine/economyMath.js";
import { normalizeShocks } from "../engine/economyShocks.js";
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
  return { month: monthsBetweenDates("2000-01-01", fromDate), polities };
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

export const advanceWorldEconomy = (
  world,
  {
    fromDate = "",
    toDate = "",
    shocks = [],
    playerPolity = "",
    tracked = [],
    campaignId = "",
    scenarioId = "",
  } = {},
) => {
  const seed = String(world?.economyEngine?.seed ?? economySeedFor(campaignId, scenarioId));
  const committed = extractEconomyState(world, { seed });
  const months = monthsBetweenDates(fromDate, toDate);
  if (months <= 0 || Object.keys(committed.polities).length === 0) {
    return { world, deltas: [], months: 0, journal: { steps: 0, capped: false, shockedMonths: 0, seed }, seed };
  }

  const knownPolities = Object.keys(committed.polities);
  const { valid, rejected } = normalizeShocks(shocks, { knownPolities });
  const { state, journal } = advanceEconomy(committed, { startDate: fromDate, months, shocks: valid, seed });

  const nextWorld = {
    ...world,
    countryStats: { ...(world?.countryStats ?? {}) },
    economyEngine: { version: ENGINE_VERSION, seed, lastDate: toDate, lastMonth: state.month },
  };

  const deltas = [];
  for (const [name, polity] of Object.entries(state.polities)) {
    applyCountryStatPatchToWorld(nextWorld, name, polityToPatch(polity), {
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

  if (rejected.length) nextWorld.economyEngine.rejectedShocks = rejected;
  return { world: nextWorld, deltas, months, journal, seed };
};
