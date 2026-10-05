/*! Open Historia - one declared order for the deterministic turn phases (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/engine/tickSchedule.test.js
//
// applySimulationResult (src/Game/AI/gameplay.js) runs the deterministic
// subsystems of a turn in a fixed order: combat, settlement, supply,
// reinforcement, the war ledger, treaties, casus belli, reparations, espionage,
// the economy, production and the stats history. That order used to live only
// in the position of the function's statements. This module declares it once,
// so a guard can pin the executed order to it. It imports nothing: the schedule
// is data, and the phases themselves stay where they are, because they read and
// write the stored world through src/runtime adapters.

const PHASE = (id, anchors, requires) =>
  Object.freeze({ id, anchors: Object.freeze(anchors), requires: Object.freeze(requires) });

// Each phase names the exact source literals that identify its call in
// applySimulationResult and the world facts that make it apply. An empty
// requires list means the phase runs on every turn.
export const TICK_PHASES = Object.freeze([
  PHASE("engagements", ["resolveEventEngagements(freshEvents"], ["battles"]),
  PHASE("engagementMerge", ["mergeEngagementResults(freshEvents"], ["battles"]),
  PHASE("settlements", ["resolveWarSettlements({"], ["atWar"]),
  PHASE("engagementReserve", ["applyCombatReserveCost(impactedWorld, engagementOutcome.reserveCost)"], ["battles"]),
  PHASE("supply", ["readSupplyAttrition(impactedWorld"], ["supply"]),
  PHASE("reinforcement", ["readReinforcement(impactedWorld"], ["reinforcement"]),
  PHASE("reinforcementReserve", ["applyCombatReserveCost(impactedWorld, reinforcement.reserveCost)"], ["reinforcement"]),
  PHASE("warLedger", ["const warMerge = applyWarUpdates({"], []),
  PHASE("treatyBreaches", ["readTreatyBreaches(worldWithImpacts"], ["treaties"]),
  PHASE("casusBelli", ["readWarCasus(worldWithImpacts"], ["casus"]),
  PHASE("treatyObligations", ["readTreatyObligations(worldWithImpacts"], ["treaties"]),
  PHASE("reparations", ["applyWarReparations(worldWithImpacts"], ["settlements"]),
  PHASE("espionage", ["resolveEspionage(worldWithImpacts"], ["espionage"]),
  PHASE("economy", ["advanceWorldEconomy(nextWorld"], []),
  PHASE("production", ["await resolvePlacements(containers, nextWorld, { receipt })"], ["production"]),
  PHASE("statsHistory", ["nextWorld = captureCountryStatsHistory(nextWorld, {"], []),
]);

// The phases applicable to a set of facts, in declared order. The order always
// comes from TICK_PHASES; this only filters.
export const tickPhasePlan = (facts = {}) =>
  TICK_PHASES
    .filter((phase) => phase.requires.every((fact) => Boolean(facts?.[fact])))
    .map((phase) => phase.id);
