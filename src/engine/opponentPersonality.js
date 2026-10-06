/*! Open Historia - deterministic opponent character: a profile derived from the facts (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/engine/opponentPersonality.test.js
//
// An opponent has no stored mind. This module reads the compact facts the world
// already carries - defining tags, international reputation, standing claims,
// active wars, recorded breaches and the force balance - and derives a
// five-axis character from them. Every power is then distinct from its own
// record, and no power is ever characterless, with no authored data required.
//
// The profile decides nothing the engine computes. It is an interpretive lens
// the narrator reads, never a filter on what is legal; the menu of legal
// choices is a separate, later concern. It imports only the engine's math, so
// the same facts yield the same profile in any process.

import { clamp } from "./economyMath.js";

export const PERSONALITY_AXES = Object.freeze([
  "aggression",
  "patience",
  "honor",
  "opportunism",
  "grievance",
]);

// Every axis starts neutral and is adjusted by the facts; the result is always
// clamped to the closed range, so no input can produce an out-of-range profile.
export const NEUTRAL_AXIS = 50;
export const MAX_CHARACTER_LEN = 120;

const asName = (value) => String(value ?? "").trim();
const asList = (value) => (Array.isArray(value) ? value : []);
const collapse = (value) => asName(value).replace(/\s+/g, " ");

// The tag key the frozen weight table is written in: lower case, one space
// between words. A tag the table does not know simply contributes nothing.
export const normalizeTagKey = (value) => collapse(value).toLowerCase();

// A closed tag vocabulary -> axis deltas. Unknown tags are inert on purpose: the
// map-maker's list is open, and an unrecognised word must never move a number.
// Suggestions live in countryTags.js; these are the ones that name a disposition.
export const TAG_WEIGHTS = Object.freeze({
  expansionist: { aggression: 18, opportunism: 6 },
  revanchist: { aggression: 8, grievance: 20 },
  imperialist: { aggression: 14, opportunism: 8 },
  colonial: { aggression: 10, opportunism: 10 },
  militarist: { aggression: 15, patience: -8 },
  "military-junta": { aggression: 15, patience: -8 },
  fascist: { aggression: 16, opportunism: 10, honor: -10 },
  warlike: { aggression: 16, patience: -8 },
  pacifist: { aggression: -15, patience: 15 },
  peaceful: { aggression: -10, patience: 12 },
  isolationist: { aggression: -10, patience: 15 },
  neutral: { aggression: -8, patience: 12 },
  "non-aligned": { patience: 8, opportunism: 4 },
  "great-power": { aggression: 8, opportunism: 8 },
  "regional-power": { aggression: 4 },
  "client-state": { patience: 8, honor: 6 },
  "puppet-state": { patience: 10 },
  pariah: { opportunism: 10, honor: -8 },
  "limited diplomatic recognition": { patience: 6, opportunism: 4 },
  separatists: { aggression: 8, grievance: 16 },
  rebels: { aggression: 8, grievance: 16 },
  democratic: { honor: 8, opportunism: -6 },
  liberal: { honor: 6, opportunism: -4 },
  socialist: { honor: 4 },
  communist: { aggression: 6, honor: 4 },
  authoritarian: { opportunism: 8 },
  totalitarian: { aggression: 10, opportunism: 8 },
  theocratic: { aggression: 4, honor: 6 },
  monarchist: { aggression: 4, honor: 6 },
  technocratic: { patience: 6 },
  capitalist: { opportunism: 8 },
  "social-democratic": { honor: 4 },
  conservative: { patience: 5 },
  "nato-aligned": { honor: 6 },
  "warsaw-pact": { aggression: 4, honor: 4 },
  nuclear: { aggression: 6 },
  "one-party": { opportunism: 6 },
});

// How a mobilization posture reads as aggression; peacetime and an absent value
// are both neutral, exactly as the weariness step treats them.
const MOBILIZATION_AGGRESSION = Object.freeze({
  demobilized: -4,
  peacetime: 0,
  partial: 6,
  total: 12,
});

const toNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const toCount = (value) => Math.max(0, Math.trunc(toNumber(value, 0)));

const roundAxis = (value) => Math.round(clamp(toNumber(value, NEUTRAL_AXIS), 0, 100));

// The compact facts as the core consumes them, defensively read so a caller
// cannot hand it a value outside a range the axis math assumes.
export const normalizeFacts = (facts = {}) => ({
  tags: asList(facts?.tags).map(collapse).filter(Boolean),
  reputation: clamp(toNumber(facts?.reputation, NEUTRAL_AXIS), 0, 100),
  claims: toCount(facts?.claims),
  activeWars: toCount(facts?.activeWars),
  breaches: toCount(facts?.breaches),
  wrongedCount: toCount(facts?.wrongedCount),
  mobilization: asName(facts?.mobilization).toLowerCase(),
  powerShare: clamp(toNumber(facts?.powerShare, 0), 0, 1),
});

// The one free line. It is assembled from a closed vocabulary keyed to the axis
// thresholds plus the polity's own tags, so it is deterministic, single line and
// bounded; it is never generated prose.
const describeCharacter = (profile, tags) => {
  const words = [];
  if (profile.aggression >= 65) words.push("warlike");
  else if (profile.aggression <= 35) words.push("peaceable");
  if (profile.patience >= 65) words.push("patient");
  if (profile.opportunism >= 65) words.push("opportunistic");
  if (profile.grievance >= 65) words.push("aggrieved");
  if (profile.honor >= 65) words.push("treaty-abiding");
  else if (profile.honor <= 35) words.push("faithless");
  if (!words.length) words.push("measured");
  const head = words.join(", ");
  const capital = head.charAt(0).toUpperCase() + head.slice(1);
  const shown = tags.map(collapse).filter(Boolean).slice(0, 3);
  const tail = shown.length ? `; ${shown.join(", ")}` : "";
  return (capital + tail).replace(/\s+/g, " ").slice(0, MAX_CHARACTER_LEN).trim();
};

// The five-axis profile for one polity, derived from its facts. Deterministic:
// equal facts give an equal profile, axis by axis.
export const derivePersonality = (facts = {}) => {
  const f = normalizeFacts(facts);
  let aggression = NEUTRAL_AXIS;
  let patience = NEUTRAL_AXIS;
  let honor = NEUTRAL_AXIS;
  let opportunism = NEUTRAL_AXIS;
  let grievance = NEUTRAL_AXIS;

  // Reputation reads as standing: a trusted power keeps its word, an infamous one
  // trades on others' weakness.
  const reputationDelta = (f.reputation - NEUTRAL_AXIS) / 5;
  honor += reputationDelta;
  opportunism -= reputationDelta * 0.6;

  // Standing claims and remembered wrongs are the grievance itself.
  grievance += Math.min(30, f.claims * 6);
  grievance += Math.min(20, f.wrongedCount * 8);

  // Its own breaches cost credibility and teach it that breaking pays.
  honor -= Math.min(25, f.breaches * 10);
  opportunism += Math.min(20, f.breaches * 8);

  // A power already fighting is read as readier to fight again.
  aggression += Math.min(20, f.activeWars * 8);
  patience -= Math.min(15, f.activeWars * 6);
  grievance += Math.min(10, f.activeWars * 3);

  const mobilization = MOBILIZATION_AGGRESSION[f.mobilization] ?? 0;
  aggression += mobilization;
  patience -= mobilization * 0.5;

  // Force share, recentred to [-1, 1]: the strong exploit, the weak wait.
  const powerDelta = (f.powerShare - 0.5) * 2;
  aggression += powerDelta * 12;
  opportunism += powerDelta * 10;
  patience -= powerDelta * 6;

  for (const tag of f.tags) {
    const weights = TAG_WEIGHTS[normalizeTagKey(tag)];
    if (!weights) continue;
    aggression += weights.aggression ?? 0;
    patience += weights.patience ?? 0;
    honor += weights.honor ?? 0;
    opportunism += weights.opportunism ?? 0;
    grievance += weights.grievance ?? 0;
  }

  const profile = {
    aggression: roundAxis(aggression),
    patience: roundAxis(patience),
    honor: roundAxis(honor),
    opportunism: roundAxis(opportunism),
    grievance: roundAxis(grievance),
  };
  profile.character = describeCharacter(profile, f.tags);
  profile.source = "derived";
  return profile;
};

// A stored or received profile, normalized, or null when it carries no axis. A
// non-object, or an object with no finite axis, is not a profile and never
// throws, the same posture as the other normalizers.
export const normalizePersonality = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const axes = PERSONALITY_AXES.filter((axis) => Number.isFinite(Number(value?.[axis])));
  if (!axes.length) return null;
  const profile = {};
  for (const axis of PERSONALITY_AXES) profile[axis] = roundAxis(value?.[axis]);
  profile.character = collapse(value?.character).slice(0, MAX_CHARACTER_LEN);
  profile.source = value?.source === "authored" ? "authored" : "derived";
  return profile;
};
