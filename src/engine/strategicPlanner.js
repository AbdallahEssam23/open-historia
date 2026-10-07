/*! Open Historia - deterministic strategy: goals to a scored action plan (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/engine/strategicPlanner.test.js
//
// The law that says what is legal lives in strategicIntent.js; the character
// that says who an actor is lives in opponentPersonality.js. This module joins
// the two into a plan: it scores a closed set of strategic goals against the
// actor's compact state and profile, picks one, and expands it into an ordered,
// bounded, prerequisite-first sequence of actions. It is advice, not law: it
// may only choose among actions the legal menu already permits, and it never
// mutates anything. Nothing here reads the wall clock or draws a random number,
// so the same facts yield the same plan in any process.

import { clamp, roundTo } from "./economyMath.js";
import { MAX_RESEARCH_EFFECT_POINTS } from "./researchEffects.js";

export const MAX_PLAN_STEPS = 6;

// The closed goal vocabulary. Data, not logic: the scoring lives in goalScore
// so a reader sees the whole ladder in one place.
export const STRATEGIC_GOALS = Object.freeze([
  Object.freeze({ id: "economic_expansion", label: "Economic expansion" }),
  Object.freeze({ id: "military_insurance", label: "Military insurance" }),
  Object.freeze({ id: "political_bloc", label: "Political bloc" }),
]);

const action = (id, goal, label, requires, cost, economy) =>
  Object.freeze({
    id,
    goal,
    label,
    requires: Object.freeze(requires),
    cost,
    economy: Object.freeze(economy),
  });

// The action catalog, in canonical order. The planner never re-sorts it, so a
// goal always expands to the same sequence. `economy` is what the plan hands
// the economy clock through planEconomyInputs; it is site-free on purpose.
export const STRATEGIC_ACTIONS = Object.freeze([
  action("invest_industry", "economic_expansion", "Invest in industry", [], 2, { research: { economy: 2 } }),
  action("expand_output", "economic_expansion", "Expand output", ["invest_industry"], 3, { research: { economy: 3 } }),
  action("mobilize_partial", "military_insurance", "Mobilize partially", [], 2, { posture: "partial" }),
  action("invest_readiness", "military_insurance", "Invest in readiness", ["mobilize_partial"], 3, { research: { pools: 2 } }),
  action("fortify_defenses", "military_insurance", "Fortify the defenses", ["invest_readiness"], 2, { trade: { stability: 0.1 } }),
  action("deescalate", "political_bloc", "Seek peace", [], 1, { trade: { stability: 0.15 } }),
  action("open_relations", "political_bloc", "Open relations", [], 2, { trade: { gdp: 1.05 } }),
  action("formalize_bloc", "political_bloc", "Formalize the bloc", ["open_relations"], 3, { trade: { gdp: 1.1, stability: 0.1 } }),
]);

const ACTIONS_BY_ID = new Map(STRATEGIC_ACTIONS.map((entry) => [entry.id, entry]));

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const asList = (value) => (Array.isArray(value) ? value : []);
const axis = (value, fallback = 50) => clamp(num(value, fallback), 0, 100);

// The compact state as the planner consumes it, read defensively so a caller
// cannot hand it a value outside a range the scoring assumes.
export const normalizePlannerState = (state = {}) => ({
  gdpPerCapita: Math.max(0, num(state?.gdpPerCapita)),
  gdpGrowth: num(state?.gdpGrowth),
  publicDebt: Math.max(0, num(state?.publicDebt)),
  unemployment: Math.max(0, num(state?.unemployment)),
  stability: clamp(num(state?.stability, 50), 0, 100),
  powerShare: clamp(num(state?.powerShare), 0, 1),
  mobilization: String(state?.mobilization ?? "").trim().toLowerCase(),
  activeWars: Math.max(0, Math.trunc(num(state?.activeWars))),
  claims: Math.max(0, Math.trunc(num(state?.claims))),
  allies: Math.max(0, Math.trunc(num(state?.allies))),
});

const normalizeProfile = (personality = {}) => ({
  aggression: axis(personality?.aggression),
  patience: axis(personality?.patience),
  honor: axis(personality?.honor),
  opportunism: axis(personality?.opportunism),
  grievance: axis(personality?.grievance),
});

// The ladder for one goal. Deterministic, clamped to 0..100, and built only
// from the compact state and the profile so equal facts give equal scores.
const goalScore = (id, state, profile) => {
  if (id === "economic_expansion") {
    // Headroom to grow: a tight labour market and a light debt load reward it.
    const headroom = clamp((6 - state.unemployment) * 2 + (120 - state.publicDebt) * 0.1, -30, 30);
    return 50 + (profile.opportunism - 50) * 0.4 + (profile.patience - 50) * 0.1 + headroom;
  }
  if (id === "military_insurance") {
    // Threat: wars, a weak force share and standing claims all raise it.
    const threat = clamp(state.activeWars * 15 + Math.max(0, 0.35 - state.powerShare) * 120 + state.claims * 3, 0, 60);
    return 30 + threat + (profile.aggression - 50) * 0.5 + (profile.grievance - 50) * 0.3;
  }
  // Political bloc: isolation, patience and honor reward it; a war blocks it.
  const isolation = clamp(20 - state.allies * 8, 0, 20);
  return 40 + isolation + (profile.patience - 50) * 0.4 + (profile.honor - 50) * 0.3 - state.activeWars * 4;
};

// Every goal with its score, best first. Ties break by goal id compared by code
// unit, so the order is a function of the data alone and never flickers.
export const scoreGoals = ({ state = {}, personality = {} } = {}) => {
  const normalized = normalizePlannerState(state);
  const profile = normalizeProfile(personality);
  return STRATEGIC_GOALS
    .map((goal) => ({ goal: goal.id, label: goal.label, score: roundTo(clamp(goalScore(goal.id, normalized, profile), 0, 100), 2) }))
    .sort((a, b) => (b.score - a.score) || (a.goal < b.goal ? -1 : a.goal > b.goal ? 1 : 0));
};

// Whether an action can be taken now. It reads the compact state and the legal
// menu's array lengths, never its contents, so a plan can only ever name an
// option the menu already offers.
export const actionAvailable = (actionId, state, menu = {}) => {
  const s = normalizePlannerState(state);
  if (actionId === "mobilize_partial") return s.mobilization !== "partial" && s.mobilization !== "total";
  if (actionId === "deescalate") return asList(menu?.seekPeace).length > 0;
  return ACTIONS_BY_ID.has(actionId);
};

// A short ASCII clause explaining why the action is on the plan, built from the
// facts rather than written prose, so it is deterministic and bounded.
export const actionReason = (actionId, state) => {
  const s = normalizePlannerState(state);
  switch (actionId) {
    case "invest_industry": return "build the industrial base";
    case "expand_output": return "compound the new capacity";
    case "mobilize_partial":
      return s.activeWars > 0 ? `at war on ${s.activeWars} fronts` : "the force share is thin";
    case "invest_readiness": return "keep the pools full";
    case "fortify_defenses": return "guard the frontier";
    case "deescalate": return "peace opens trade";
    case "open_relations": return s.allies > 0 ? "widen the partnership" : "few partners";
    case "formalize_bloc": return "bind the partners";
    default: return "advance the goal";
  }
};

// A prerequisite whose effect the state already shows is met without being
// re-emitted: an actor already at partial mobilization still invests in
// readiness, it does not mobilize twice.
const actionDone = (actionId, state) => {
  if (actionId === "mobilize_partial") return state.mobilization === "partial" || state.mobilization === "total";
  return false;
};

// The goal's actions in declared order, prerequisite-first. An action is emitted
// only when it and its whole prerequisite chain are met; the result is
// de-duplicated and capped at MAX_PLAN_STEPS.
const expandChain = (goalId, state, menu) => {
  const catalog = STRATEGIC_ACTIONS.filter((entry) => entry.goal === goalId);
  const available = new Set(
    catalog.filter((entry) => actionAvailable(entry.id, state, menu)).map((entry) => entry.id),
  );
  const met = (id, guard = new Set()) => {
    if (actionDone(id, state)) return true;
    const entry = ACTIONS_BY_ID.get(id);
    if (!entry || !available.has(id) || guard.has(id)) return false;
    const next = new Set(guard).add(id);
    return entry.requires.every((requirement) => met(requirement, next));
  };
  const steps = [];
  const seen = new Set();
  const emit = (id) => {
    if (actionDone(id, state)) return;
    if (steps.length >= MAX_PLAN_STEPS || seen.has(id)) return;
    const entry = ACTIONS_BY_ID.get(id);
    if (!entry) return;
    seen.add(id);
    for (const requirement of entry.requires) emit(requirement);
    steps.push({
      action: entry.id,
      label: entry.label,
      cost: entry.cost,
      reason: actionReason(entry.id, state),
      economy: entry.economy,
    });
  };
  for (const entry of catalog) {
    if (!met(entry.id)) continue;
    emit(entry.id);
  }
  return steps.slice(0, MAX_PLAN_STEPS);
};

// The best goal and its plan. The best-scoring goal whose chain is non-empty
// wins; if no goal has an available action, the plan is empty and `goal` is
// null. `alternatives` carries every goal score so a reader sees the ranking.
export const derivePlan = ({ polity = "", state = {}, personality = {}, menu = {} } = {}) => {
  const normalized = normalizePlannerState(state);
  const scores = scoreGoals({ state: normalized, personality });
  let chosen = null;
  for (const entry of scores) {
    const steps = expandChain(entry.goal, normalized, menu);
    if (steps.length) {
      chosen = { goal: entry.goal, label: entry.label, score: entry.score, steps };
      break;
    }
  }
  const steps = chosen?.steps ?? [];
  return {
    polity: String(polity ?? "").trim(),
    goal: chosen?.goal ?? null,
    label: chosen?.label ?? "",
    score: chosen?.score ?? 0,
    steps,
    totalCost: steps.reduce((sum, entry) => sum + (Number(entry.cost) || 0), 0),
    alternatives: scores,
    reason: steps.length ? actionReason(steps[0].action, normalized) : "no legal action available",
  };
};

// The one place a plan meets the economy clock: fold the steps into the exact
// shapes advanceEconomy takes (a posture map, a research-effects map and a trade
// multiplier vector), so a plan can be run through balanceHarness. Pure, empty
// maps for an empty plan, and no order that needs a building site.
export const planEconomyInputs = (plan, { polity = "" } = {}) => {
  const name = String(polity ?? plan?.polity ?? "").trim();
  const posture = {};
  const researchEffects = {};
  const trade = {};
  if (!name) return { posture, researchEffects, trade };

  let research = null;
  const vector = { population: 1, gdp: 1, inflation: 0, unemployment: 0, stability: 0 };
  let hasTrade = false;
  for (const step of asList(plan?.steps)) {
    const economy = step?.economy ?? {};
    if (economy.posture && !posture[name]) posture[name] = String(economy.posture);
    if (economy.research) {
      research = research ?? { production: 0, pools: 0, economy: 0 };
      for (const key of ["production", "pools", "economy"]) {
        research[key] = Math.min(MAX_RESEARCH_EFFECT_POINTS, research[key] + Math.max(0, Math.trunc(num(economy.research[key]))));
      }
    }
    if (economy.trade) {
      hasTrade = true;
      vector.population *= num(economy.trade.population, 1);
      vector.gdp *= num(economy.trade.gdp, 1);
      vector.inflation += num(economy.trade.inflation);
      vector.unemployment += num(economy.trade.unemployment);
      vector.stability += num(economy.trade.stability);
    }
  }
  if (research && (research.production || research.pools || research.economy)) researchEffects[name] = research;
  if (hasTrade) trade[name] = vector;
  return { posture, researchEffects, trade };
};

// One bounded ASCII line, for logs and prompts. Never generated prose.
export const describePlan = (plan) => {
  const head = plan?.goal ? `${String(plan.polity || "actor")}: ${plan.goal} (${plan.score})` : `${String(plan?.polity || "actor")}: no plan`;
  const tail = asList(plan?.steps).map((entry) => entry.label).join(" -> ");
  const line = tail ? `${head} -> ${tail}` : head;
  return line.replace(/\s+/g, " ").slice(0, 200).trim();
};
