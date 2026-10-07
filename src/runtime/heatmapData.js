/*! Open Historia - runtime heatmap inputs: world and catalog as weighted map points (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/runtime/heatmapData.test.js
//
// The seam between the stored world and the pure heatmap core. It reads the
// scenario region catalog and the world's country sheets and derived plans into
// the plain inputs engine/heatmapModel.js consumes, and calls readFrontLines
// only for the tension mode. Read-only, DOM-free, and it imports no Game/AI
// module, so it runs under bare node --test.

import { DEFAULT_HEATMAP_MODE, HEATMAP_MODES, buildHeatmapModel } from "../engine/heatmapModel.js";
import { derivePlan } from "../engine/strategicPlanner.js";
import { readFrontLines } from "./frontLines.js";
import { buildStrategicMenus } from "./opponentContext.js";
import { regionOwnerName } from "./regionOwners.js";

const asList = (value) => (Array.isArray(value) ? value : []);
const name = (value) => String(value ?? "").trim();
const keyLower = (value) => name(value).toLowerCase();

// The catalog rows the pure model needs, with each region's live controller
// resolved through regionOwnerName so the heatmap and the AI agree on who holds
// a region. Bounds are carried as-is for the coordinate fallback.
export const heatmapRegionsFromCatalog = (catalog, overrides) =>
  asList(catalog)
    .map((row) => ({
      id: name(row?.id),
      owner: regionOwnerName(row, overrides),
      lng: row?.lng,
      lat: row?.lat,
      bounds: Array.isArray(row?.bounds) && row.bounds.length === 2 ? row.bounds : null,
    }))
    .filter((region) => region.id);

// How many distinct partners this polity stands with, over its relations and its
// active agreements. Counted by folded name so one partner is one ally however
// the world spells it; bounded by the data, never by a constant.
const alliesOf = (world, polity) => {
  const selfKey = keyLower(polity);
  if (!selfKey) return 0;
  const allies = new Set();
  for (const relation of asList(world?.relations)) {
    const a = keyLower(relation?.a);
    const b = keyLower(relation?.b);
    if (a === selfKey && b) allies.add(b);
    else if (b === selfKey && a) allies.add(a);
  }
  for (const agreement of asList(world?.agreements)) {
    if (keyLower(agreement?.status) !== "active") continue;
    const parties = asList(agreement?.parties).map(keyLower).filter(Boolean);
    if (!parties.includes(selfKey)) continue;
    for (const party of parties) if (party !== selfKey) allies.add(party);
  }
  return allies.size;
};

const sheetFor = (countryStats, polity) => {
  const direct = countryStats?.[polity];
  return direct && typeof direct === "object" ? direct : null;
};

// The compact state the planner scores, from the country sheet and the fact set
// worldFactsFor already built. A missing sheet contributes zeros.
const plannerStateFor = (sheet, facts, allies) => ({
  gdpPerCapita: Number(sheet?.economy?.gdpPerCapita) || 0,
  gdpGrowth: Number(sheet?.economy?.gdpGrowth) || 0,
  publicDebt: Number(sheet?.economy?.publicDebt) || 0,
  unemployment: Number(sheet?.economy?.unemployment) || 0,
  stability: Number(sheet?.stability) || 0,
  powerShare: Number(facts?.powerShare) || 0,
  mobilization: facts?.mobilization ?? "",
  activeWars: Number(facts?.activeWars) || 0,
  claims: Number(facts?.claims) || 0,
  allies,
});

// One derived plan per polity in play, keyed by the canonical polity name:
// { [polity]: { goal, score } }. A polity with no plan is simply absent. The
// facts, personality and legal menu come from buildStrategicMenus, so the
// heatmap's view of a power is the same one the AI acts on.
export const buildHeatmapPlans = (world, { playerPolity = "", limit } = {}) => {
  const menus = buildStrategicMenus(world, { playerPolity, ...(limit ? { limit } : {}), regions: [] });
  const countryStats = world?.countryStats ?? {};
  const plans = {};
  for (const entry of menus) {
    const polity = entry?.polity;
    if (!polity) continue;
    const state = plannerStateFor(sheetFor(countryStats, polity), entry.facts, alliesOf(world, polity));
    const plan = derivePlan({ polity, state, personality: entry.personality, menu: entry.menu });
    plans[polity] = { goal: plan.goal, score: plan.score };
  }
  return plans;
};

// The whole overlay input to the pure model. readFrontLines is called only for
// the tension mode, so a wealth or strategy render never pays for the graph.
export const buildHeatmapData = (world, catalog, { mode, playerPolity = "", limit } = {}) => {
  const regions = heatmapRegionsFromCatalog(catalog, world?.regionOwnershipOverrides);
  const requested = String(mode ?? "").trim();
  const resolvedMode = HEATMAP_MODES.includes(requested) ? requested : DEFAULT_HEATMAP_MODE;
  const countryStats = world?.countryStats ?? {};
  const plans = resolvedMode === "strategy" ? buildHeatmapPlans(world, { playerPolity, limit }) : {};
  // The front-line graph is derived only for the mode that reads it.
  const frontLines = resolvedMode === "tension" ? readFrontLines(world, catalog) : null;
  return buildHeatmapModel({ mode: resolvedMode, regions, countryStats, plans, frontLines });
};
