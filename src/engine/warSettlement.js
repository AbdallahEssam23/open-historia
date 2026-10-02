/*! Open Historia - deterministic war settlement: declared goals, weariness and the peace core (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A war ends when the facts force it, not when a model decides to stop
// narrating. This file owns the arithmetic of that: how far a side has got
// toward its declared goal, how exhausted it is, and what the derived peace
// takes. Every value is a pure function of stored inputs, so the same state
// always yields the same terms; the runtime adapter owns the world, this file
// owns nothing but numbers.

import { clamp, roundTo } from "./economyMath.js";

export const WAR_GOAL_KINDS = Object.freeze(["annex", "reparations", "status_quo"]);

const WAR_GOAL_KIND_SET = new Set(WAR_GOAL_KINDS);

// A declared target list is bounded so a corrupted save cannot grow a war
// without limit; the cap applies after duplicates fold, so a repeat never
// consumes a slot.
const MAX_TARGET_REGIONS = 32;

export const WEARINESS_COMPEL = 0.6;
export const WEARINESS_CAPITULATION = 0.9;
export const WEARINESS_MONTHLY_GAIN = 0.04;
export const WEARINESS_LOSS_GAIN = 0.5;

export const MOBILIZATION_WEARINESS_DRAG = Object.freeze({
  demobilized: 0,
  peacetime: 0,
  partial: 0.05,
  total: 0.1,
});

export const REPARATION_SHARE = 0.25;
export const REPARATION_MANPOWER_CAP = 1000000;

const asString = (value) => String(value ?? "").trim();

const dedupeRegions = (value) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const region of value) {
    const id = asString(region);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_TARGET_REGIONS) break;
  }
  return out;
};

const normalizeGoal = (entry) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const kind = asString(entry.kind).toLowerCase();
  if (!WAR_GOAL_KIND_SET.has(kind)) return null;
  return { kind, targetRegionIds: dedupeRegions(entry.targetRegionIds), note: asString(entry.note) };
};

// The stored declaration, one entry per side, validated without a world. An
// unusable value is null and an unusable side is a null entry, never a throw,
// the same posture as normalizeMobilization.
export const normalizeWarGoals = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const a = normalizeGoal(value.a);
  const b = normalizeGoal(value.b);
  if (!a && !b) return null;
  return { a, b };
};

// The persisted weariness: a pair in 0..1 plus the date the pair was last
// stepped to, so the adapter can measure whole months forward from it.
export const normalizeWeariness = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    a: clamp(value.a, 0, 1),
    b: clamp(value.b, 0, 1),
    throughDate: asString(value.throughDate),
  };
};

// Goal progress in 0..1. Each kind reads exactly one input: annex the held
// share of the declared targets, reparations the side's share of the turn's
// battle power, status quo the satisfaction of wanting no gain.
export const warGoalScore = ({ kind, targetRegionIds = [], heldRegionIds = [], advantage = 0 } = {}) => {
  if (kind === "annex") {
    const targets = Array.isArray(targetRegionIds) ? targetRegionIds : [];
    const held = new Set(
      (Array.isArray(heldRegionIds) ? heldRegionIds : []).map(asString).filter(Boolean),
    );
    const seen = new Set();
    let taken = 0;
    for (const target of targets) {
      const id = asString(target);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (held.has(id)) taken += 1;
    }
    return seen.size === 0 ? 0 : clamp(taken / seen.size, 0, 1);
  }
  if (kind === "status_quo") return 1;
  if (kind === "reparations") return clamp(advantage, 0, 1);
  return 0;
};

// One step of weariness: time alone, this turn's own losses, and the drag of
// the mobilization posture. It never decreases while the war is active because
// every term is non-negative.
export const wearinessStep = ({ prior = 0, months = 0, lossFraction = 0, mobilization = "" } = {}) => {
  const drag = MOBILIZATION_WEARINESS_DRAG[mobilization] ?? 0;
  const elapsed = Math.max(0, Number(months) || 0);
  const loss = clamp(lossFraction, 0, 1);
  return clamp(clamp(prior, 0, 1) + elapsed * WEARINESS_MONTHLY_GAIN + loss * WEARINESS_LOSS_GAIN + drag, 0, 1);
};

// The two weariness values as the mandatory-peace signal.
export const warPressure = ({ wearinessA = 0, wearinessB = 0 } = {}) => {
  const a = clamp(wearinessA, 0, 1);
  const b = clamp(wearinessB, 0, 1);
  return {
    compelled: a >= WEARINESS_COMPEL || b >= WEARINESS_COMPEL,
    capitulationA: a >= WEARINESS_CAPITULATION,
    capitulationB: b >= WEARINESS_CAPITULATION,
  };
};

const goalFor = (entry) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { kind: "status_quo", targetRegionIds: [], note: "" };
  }
  return {
    kind: WAR_GOAL_KIND_SET.has(entry.kind) ? entry.kind : "status_quo",
    targetRegionIds: Array.isArray(entry.targetRegionIds) ? entry.targetRegionIds : [],
    note: asString(entry.note),
  };
};

// The higher score wins; a tie goes to the lower weariness, then to side A, so
// the outcome is a total order on the stored facts.
const pickVictor = (scoreA, scoreB, wearinessA, wearinessB) => {
  if (scoreA > scoreB) return "a";
  if (scoreB > scoreA) return "b";
  if (wearinessA < wearinessB) return "a";
  if (wearinessB < wearinessA) return "b";
  return "a";
};

// The peace, or nothing while no peace is due. The victor's declared kind, not
// any inferred controller, decides the terms.
export const settleWar = (input = {}) => {
  const {
    warId = "",
    date = "",
    goalsA = null,
    goalsB = null,
    heldRegionIdsA = [],
    heldRegionIdsB = [],
    advantageA = 0,
    advantageB = 0,
    wearinessA = 0,
    wearinessB = 0,
    codeA = "",
    codeB = "",
    poolsA = {},
    poolsB = {},
  } = input ?? {};

  const goals = { a: goalFor(goalsA), b: goalFor(goalsB) };
  const scoreA = warGoalScore({
    kind: goals.a.kind,
    targetRegionIds: goals.a.targetRegionIds,
    heldRegionIds: heldRegionIdsA,
    advantage: advantageA,
  });
  const scoreB = warGoalScore({
    kind: goals.b.kind,
    targetRegionIds: goals.b.targetRegionIds,
    heldRegionIds: heldRegionIdsB,
    advantage: advantageB,
  });

  const wa = clamp(wearinessA, 0, 1);
  const wb = clamp(wearinessB, 0, 1);
  const { compelled, capitulationA, capitulationB } = warPressure({ wearinessA: wa, wearinessB: wb });

  // "Goal achieved" means a war aim that can be attained: status_quo wants
  // nothing, so its score of 1 is satisfaction from the outset, not a reason
  // to close the war. Only an annex or reparations side at full score, or
  // weariness, forces a peace.
  const achievedA = goals.a.kind !== "status_quo" && scoreA >= 1;
  const achievedB = goals.b.kind !== "status_quo" && scoreB >= 1;

  let victor;
  let capitulation = false;
  if (capitulationA && capitulationB) {
    victor = pickVictor(scoreA, scoreB, wa, wb);
    capitulation = true;
  } else if (capitulationA) {
    victor = "b";
    capitulation = true;
  } else if (capitulationB) {
    victor = "a";
    capitulation = true;
  } else if (!compelled && !achievedA && !achievedB) {
    return null;
  } else {
    victor = pickVictor(scoreA, scoreB, wa, wb);
  }

  const loser = victor === "a" ? "b" : "a";
  const heldSource = victor === "a" ? heldRegionIdsA : heldRegionIdsB;
  const heldVictor = new Set(
    (Array.isArray(heldSource) ? heldSource : []).map(asString).filter(Boolean),
  );
  const codeVictor = asString(victor === "a" ? codeA : codeB);
  const codeLoser = asString(victor === "a" ? codeB : codeA);
  const victorKind = goals[victor].kind;

  const transfers = [];
  if (victorKind === "annex") {
    const seen = new Set();
    for (const target of goals[victor].targetRegionIds) {
      const regionId = asString(target);
      if (!regionId || seen.has(regionId)) continue;
      seen.add(regionId);
      // A capitulation compels the cession of every declared target; a
      // compelled peace takes only the declared targets already held. The
      // transfer is legal, so it runs loser to victor regardless of who
      // currently sits in the region.
      if (capitulation || heldVictor.has(regionId)) {
        transfers.push({ regionId, fromCode: codeLoser, toCode: codeVictor });
      }
    }
  }

  let reparations = { fromCode: "", toCode: "", manpower: 0, materiel: 0 };
  if (victorKind === "reparations") {
    const pools = (victor === "a" ? poolsB : poolsA) ?? {};
    const manpower = Math.min(
      REPARATION_MANPOWER_CAP,
      Math.max(0, roundTo(Math.max(0, Number(pools.manpower) || 0) * REPARATION_SHARE, 0)),
    );
    const materiel = Math.max(
      0,
      roundTo(Math.max(0, Number(pools.materiel) || 0) * REPARATION_SHARE, 2),
    );
    reparations = { fromCode: codeLoser, toCode: codeVictor, manpower, materiel };
  }

  return {
    key: `${warId}|${date}|${victor}|${loser}`,
    warId,
    victor,
    loser,
    capitulation,
    white: transfers.length === 0 && reparations.manpower === 0 && reparations.materiel === 0,
    transfers,
    reparations,
  };
};
