/*! Open Historia - runtime opponent context: the facts and the report a decision reads (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/runtime/opponentContext.test.js
//
// The adapter between the stored world and the pure personality core. It reads
// the normalized world, builds one compact fact set per polity - defining tags,
// reputation, standing claims, active wars, recorded breaches and the force
// balance - and derives the profile from it. It owns no arithmetic of its own
// and makes no decision: it only turns the world into the facts a profile is a
// function of. It never imports the Game/AI layer.

import { derivePersonality } from "../engine/opponentPersonality.js";
import { resolveCountryTags } from "./countryTags.js";
import { normalizeWorldState } from "./gameState.js";
import { toCountryName } from "./ownerNames.js";

export const DEFAULT_REPORT_LIMIT = 12;
export const NEUTRAL_REPUTATION = 50;

const asName = (value) => String(value ?? "").trim();
const asList = (value) => (Array.isArray(value) ? value : []);
const keyLower = (value) => asName(value).toLowerCase();

// A polity's canonical name: the display name the rest of the world is keyed by.
const canonical = (value) => {
  const raw = asName(value);
  return toCountryName(raw) || raw;
};

const poolFor = (pools, polity) => {
  const raw = asName(polity);
  const code = canonical(polity);
  return pools?.[raw] ?? pools?.[code] ?? null;
};

const sideHas = (war, polityKey) =>
  [...asList(war?.sideA), ...asList(war?.sideB)].some((entry) => keyLower(entry) === polityKey);

// The regions where this polity is a recorded claimant. The map editor has
// written world.regionClaimants since before this increment (see gameState.js).
const claimsBy = (world, polityKey) => {
  let count = 0;
  for (const claimants of Object.values(world?.regionClaimants ?? {})) {
    if (asList(claimants).some((name) => keyLower(name) === polityKey)) count += 1;
  }
  return count;
};

// This polity's manpower over the strongest power in the pools, in 0..1. It is a
// share of the strongest, not of a sum, so it cannot drift with how many powers
// the world happens to model; an empty pool set is 0.
const powerShareOf = (world, polity) => {
  const pools = world?.economyEngine?.pools ?? {};
  let strongest = 0;
  for (const entry of Object.values(pools)) {
    const manpower = Number(entry?.manpower);
    if (Number.isFinite(manpower) && manpower > strongest) strongest = manpower;
  }
  if (strongest <= 0) return 0;
  const own = Number(poolFor(pools, polity)?.manpower);
  if (!Number.isFinite(own) || own <= 0) return 0;
  return Math.min(1, own / strongest);
};

// The compact facts for one polity. It reads defensively so a raw world is safe
// to pass, but the callers below normalize once and hand the result in.
export const worldFactsFor = (world, polity, { baseTags = {} } = {}) => {
  const target = canonical(polity);
  const targetKey = keyLower(target);
  const tags = resolveCountryTags(baseTags, world, target);

  const reputation = Number(world?.internationalReputation?.[target]);
  let activeWars = 0;
  for (const war of asList(world?.wars)) {
    if (keyLower(war?.status) !== "active") continue;
    if (sideHas(war, targetKey)) activeWars += 1;
  }

  let breaches = 0;
  let wrongedCount = 0;
  for (const agreement of asList(world?.agreements)) {
    if (keyLower(agreement?.status) !== "breached") continue;
    if (keyLower(agreement?.breachedBy) === targetKey) breaches += 1;
    else if (asList(agreement?.parties).some((party) => keyLower(party) === targetKey)) wrongedCount += 1;
  }

  return {
    polity: target,
    tags,
    reputation: Number.isFinite(reputation) ? reputation : NEUTRAL_REPUTATION,
    claims: claimsBy(world, targetKey),
    activeWars,
    breaches,
    wrongedCount,
    mobilization: keyLower(world?.economyEngine?.mobilization?.[target]),
    powerShare: powerShareOf(world, target),
  };
};

// One polity's full context: its facts and the profile derived from them.
export const aggregateWorldContext = (world, polity, { baseTags = {} } = {}) => {
  const normalized = normalizeWorldState(world);
  const facts = worldFactsFor(normalized, polity, { baseTags });
  return { polity: facts.polity, facts, personality: derivePersonality(facts) };
};

// The polities whose decision can reach the player this turn, bounded by a cap,
// exactly as the region vocabulary is tiered: the player, the belligerents of
// active wars, the player's relation and agreement partners, the holders and
// claimants around the player's claims, and the strongest by force. Sorted so
// the same world selects the same polities.
export const politiesInPlay = (world, { playerPolity = "", limit = DEFAULT_REPORT_LIMIT } = {}) => {
  const cap = Math.max(1, Math.trunc(Number(limit) || 0) || DEFAULT_REPORT_LIMIT);
  const player = canonical(playerPolity);
  const playerKey = keyLower(player);
  const inPlay = new Set();
  const add = (value) => {
    const polity = canonical(value);
    if (polity) inPlay.add(polity);
  };
  if (player) add(player);

  for (const war of asList(world?.wars)) {
    if (keyLower(war?.status) !== "active") continue;
    for (const member of [...asList(war?.sideA), ...asList(war?.sideB)]) add(member);
  }

  // The player's direct diplomatic partners: relations and standing agreements.
  for (const relation of asList(world?.relations)) {
    const a = canonical(relation?.a);
    const b = canonical(relation?.b);
    if (keyLower(a) === playerKey) add(b);
    if (keyLower(b) === playerKey) add(a);
  }
  for (const agreement of asList(world?.agreements)) {
    if (keyLower(agreement?.status) !== "active") continue;
    const parties = asList(agreement?.parties).map(canonical);
    if (!parties.some((party) => keyLower(party) === playerKey)) continue;
    for (const party of parties) add(party);
  }

  // The claimants around the player's claims, whichever side of the claim they
  // sit on: who claims what the player holds, and who holds what the player
  // claims. This is the set a war this turn would most plausibly be about.
  const overrides = world?.regionOwnershipOverrides ?? {};
  for (const [regionId, claimants] of Object.entries(world?.regionClaimants ?? {})) {
    const owner = canonical(overrides?.[regionId]);
    const claimers = asList(claimants).map(canonical);
    if (keyLower(owner) === playerKey) for (const claimer of claimers) add(claimer);
    if (claimers.some((claimer) => keyLower(claimer) === playerKey)) add(owner);
  }

  // The strongest by force, so a great power with no link to the player yet is
  // still modelled: half the cap, ties broken by name for a stable selection.
  const pools = world?.economyEngine?.pools ?? {};
  const strongest = Object.entries(pools)
    .map(([code, entry]) => ({ code: canonical(code), manpower: Number(entry?.manpower) || 0 }))
    .filter((row) => row.code && row.manpower > 0)
    .sort((a, b) => b.manpower - a.manpower || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .slice(0, Math.ceil(cap / 2));
  for (const row of strongest) add(row.code);

  const ordered = [...inPlay].sort((a, b) => {
    const aPlayer = keyLower(a) === playerKey ? 0 : 1;
    const bPlayer = keyLower(b) === playerKey ? 0 : 1;
    if (aPlayer !== bPlayer) return aPlayer - bPlayer;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return ordered.slice(0, cap);
};

// The strategic report: one context per polity in play, in a stable order.
export const buildStrategicReport = (world, { playerPolity = "", limit = DEFAULT_REPORT_LIMIT, baseTags = {} } = {}) => {
  const normalized = normalizeWorldState(world);
  return politiesInPlay(normalized, { playerPolity, limit }).map((polity) => {
    const facts = worldFactsFor(normalized, polity, { baseTags });
    return { polity: facts.polity, facts, personality: derivePersonality(facts) };
  });
};
