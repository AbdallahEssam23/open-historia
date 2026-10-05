/*! Open Historia - the runtime executor for the declared turn phase order (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/runtime/simulationTick.test.js
//
// A turn's deterministic phases run in one declared order (src/engine/
// tickSchedule.js). This executor walks that order and calls the handler each
// phase is given, so the order lives in the schedule and not in the object's
// key order or in the position of a statement. It imports only the schedule:
// the phase bodies read and write the stored world through src/runtime
// adapters, and a runtime module may not import src/Game/AI, so the bodies are
// handed in as handlers by the composition root (applySimulationResult).

import { TICK_PHASES, tickPhasePlan } from "../engine/tickSchedule.js";

// Run the registered phase handlers in the declared schedule order. A handler
// may be sync or async; each is awaited in turn, so a phase sees the world the
// one before it wrote. When a fact set is handed in, the plan is filtered by
// each phase's declared requirements, so a phase whose fact is false is skipped
// instead of run; without a fact set every registered handler runs, which is the
// pre-gate behaviour. Returns the ordered list of phase ids it ran.
export const runSimulationTick = async ({ handlers = {}, facts = null, phases = TICK_PHASES } = {}) => {
  const known = new Set(phases.map((phase) => phase.id));
  for (const id of Object.keys(handlers)) {
    if (typeof handlers[id] === "function" && !known.has(id)) {
      throw new Error(`runSimulationTick: unknown phase handler "${id}"`);
    }
  }
  const gated = facts === null ? null : new Set(tickPhasePlan(facts, phases));
  const plan = phases
    .filter((phase) => (gated === null || gated.has(phase.id)) && typeof handlers[phase.id] === "function")
    .map((phase) => phase.id);
  for (const id of plan) await handlers[id]();
  return plan;
};
