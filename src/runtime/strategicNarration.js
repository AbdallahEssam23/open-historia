/*! Open Historia - the opponent's accepted move, told to the player (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/runtime/strategicNarration.test.js
//
// The gateway (Game/AI/strategicGateway.js) decides WHAT a computer power does
// and keeps the reason it was legal; nothing tells the player. This module turns
// that accepted decision into the two things the timeline needs: the compact
// rows it stores on the turn, and the one deterministic sentence it shows.
//
// It imports nothing and reads no clock: the same move and the same region name
// give the same words in any process. A region NAME is a parameter, never a
// lookup, so the surface resolves it where the catalog already lives.

export const MAX_TURN_MOVES = 12;
export const MAX_MOVE_REASONS = 3;

// How a declared war's aim reads. A closed table keyed to the engine's goals,
// with `status_quo` the fallback so an unrecognised goal still reads.
export const GOAL_PHRASES = Object.freeze({
  annex: "to annex territory",
  reparations: "to impose reparations",
  status_quo: "to force a settlement",
});

// The legal cause the menu stated, as the player reads it. Only these two are
// produced by the engine; anything else is dropped rather than shown raw.
export const REASON_LABELS = Object.freeze({
  "standing claim": "standing claim",
  "recorded breach": "recorded breach",
});

export const NO_CAUSE_LABEL = "no recorded cause";

const asName = (value) => String(value ?? "").trim();
const asList = (value) => (Array.isArray(value) ? value : []);

// The turn's accepted decisions as stored rows. `accepted` is what
// applyStrategicIntents returned; `events` are the turn's events, whose `warId`
// the gateway stamped, so a declaration resolves to the event that narrates it.
// A row the surface could not place (no actor, or no target/region) is dropped,
// never thrown, and an `existing` declaration is skipped: the direct warUpdates
// record already stands for it.
export const buildTurnMoves = ({ accepted = {}, events = [], date = "" } = {}) => {
  const rows = [];
  const eventIdByWarId = new Map();
  for (const event of asList(events)) {
    const warId = asName(event?.warId);
    if (warId && !eventIdByWarId.has(warId)) eventIdByWarId.set(warId, asName(event?.id));
  }

  const day = asName(date);
  for (const entry of asList(accepted?.declareWar)) {
    if (!entry || typeof entry !== "object" || entry.existing) continue;
    const actor = asName(entry.actor);
    const target = asName(entry.target);
    if (!actor || !target) continue;
    rows.push({
      kind: "declare_war",
      actor,
      target,
      goal: asName(entry.goal),
      justified: entry.justified === true,
      reasons: asList(entry.reasons).map(asName).filter(Boolean).slice(0, MAX_MOVE_REASONS),
      eventId: eventIdByWarId.get(asName(entry.warId)) || "",
      date: day,
    });
    if (rows.length >= MAX_TURN_MOVES) return rows;
  }

  for (const entry of asList(accepted?.pressClaim)) {
    if (!entry || typeof entry !== "object") continue;
    const actor = asName(entry.actor);
    const regionId = asName(entry.regionId);
    if (!actor || !regionId) continue;
    rows.push({
      kind: "press_claim",
      actor,
      regionId,
      owner: asName(entry.owner),
      // A claim is applied on a board-only synthetic event that is never
      // written, so it has no timeline event to sit beside. It lands as the
      // turn's closing block instead.
      eventId: "",
      date: day,
    });
    if (rows.length >= MAX_TURN_MOVES) return rows;
  }

  return rows;
};

// The one sentence a row reads as, plus the chips beside it. Past tense: this
// is what a power DID, never an option for the player. `regionName` is the
// caller's resolved display name, falling back to the raw id.
export const describeStrategicMove = (move, { regionName = "" } = {}) => {
  if (!move || typeof move !== "object") return null;
  const actor = asName(move.actor);
  if (!actor) return null;

  if (move.kind === "declare_war") {
    const target = asName(move.target);
    if (!target) return null;
    const reasons = asList(move.reasons)
      .map((token) => REASON_LABELS[asName(token)])
      .filter(Boolean)
      .slice(0, MAX_MOVE_REASONS);
    return {
      headline: `${actor} declares war on ${target}`,
      detail: GOAL_PHRASES[asName(move.goal)] || GOAL_PHRASES.status_quo,
      reasons: reasons.length ? reasons : (move.justified ? [] : [NO_CAUSE_LABEL]),
    };
  }

  if (move.kind === "press_claim") {
    const region = asName(regionName) || asName(move.regionId);
    if (!region) return null;
    const owner = asName(move.owner);
    return {
      headline: `${actor} presses a claim on ${region}`,
      detail: owner ? `held by ${owner}` : "",
      reasons: [],
    };
  }

  return null;
};
