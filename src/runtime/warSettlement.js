/*! Open Historia - runtime war settlement: gather the facts, narrate the peace, move the reparations (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The adapter between the stored world and the pure settlement core. It reads
// the pre-turn world and this turn's battle results, calls the core, and turns
// the derivation into the two things the turn already knows how to apply: a
// narrated military event and a reserve transfer. It never imports the Game/AI
// layer and never writes the war ledger; gameplay.js owns that.

import { normalizeWeariness, settleWar, settlementTerms, warGoalScore, wearinessStep } from "../engine/warSettlement.js";
import { monthsBetweenDates, roundTo } from "../engine/economyMath.js";
import { normalizePools } from "../engine/forcePools.js";
import { applyCountryStatPatchToWorld, normalizeWorldState } from "./gameState.js";
import { compareGameDates } from "./gameDates.js";
import { toCountryName } from "./ownerNames.js";

const asString = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);

const canonical = (value) => {
  const raw = asString(value);
  return toCountryName(raw) || raw;
};

// Every declared belligerent of a war, canonicalized, side A first, deduped.
// The event's combatants and the player-party test both read this.
const belligerentsOf = (war) => {
  const seen = new Set();
  const out = [];
  for (const raw of [...list(war?.sideA), ...list(war?.sideB)]) {
    const polity = canonical(raw);
    const key = polity.toLowerCase();
    if (!polity || seen.has(key)) continue;
    seen.add(key);
    out.push(polity);
  }
  return out;
};

// A list of names as lowercased canonical keys, for membership tests against a
// side's belligerents or the war's recorded unjust aggressors.
const canonicalKeys = (values) => {
  const keys = new Set();
  for (const raw of list(values)) {
    const polity = canonical(raw);
    if (polity) keys.add(polity.toLowerCase());
  }
  return keys;
};

// A side carries the mark when any of its declared members was recorded as an
// unjust aggressor of this war, compared in the same lowercased canonical key
// space as every other name in this module.
const sideIsUnjust = (members, unjustKeys) => {
  for (const raw of list(members)) {
    const polity = canonical(raw);
    if (polity && unjustKeys.has(polity.toLowerCase())) return true;
  }
  return false;
};

// Whether a side counts the player among its declared members, folded through
// the same lowercased canonical key space the party test always used.
const sideHasPlayer = (members, playerKey) => {
  if (!playerKey) return false;
  for (const raw of list(members)) {
    const polity = canonical(raw);
    if (polity && polity.toLowerCase() === playerKey) return true;
  }
  return false;
};

// The declared target regions any belligerent of the side currently
// administers: a coalition's target counts as held whoever in the coalition
// sits on it. Both sides of the comparison fold through toCountryName so a code
// in the override meets a name in the declaration.
const heldRegions = (goal, memberKeys, overrides) => {
  if (!goal || !memberKeys || memberKeys.size === 0) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list(goal.targetRegionIds)) {
    const regionId = asString(raw);
    if (!regionId || seen.has(regionId)) continue;
    seen.add(regionId);
    const owner = canonical(overrides?.[regionId]).toLowerCase();
    if (owner && memberKeys.has(owner)) out.push(regionId);
  }
  return out;
};

// The strategic menu's view of one war, for a power deciding whether to sue for
// peace: which war, against whom, how weary the actor is, whether the actor is
// ahead of its enemy, and whether the player is a party. It reuses the same
// held-region and goal-score logic the settlement loop uses, so the "is it
// ahead" test cannot drift from the terms it is guarding. Returns null for a war
// the actor is not a side of. Advancing uses `advantage` 0: the turn's battle
// has not happened when a menu is built, and the locked rule keeps
// `reparations` at a tie the existing `pickVictor` settles.
export const seekPeaceFacts = ({ war, polity, playerPolity = "", regionOwnershipOverrides = {} } = {}) => {
  if (!war || typeof war !== "object") return null;
  if (asString(war.status).toLowerCase() !== "active") return null;
  const warId = asString(war.id);
  if (!warId) return null;
  const selfKey = canonical(polity).toLowerCase();
  if (!selfKey) return null;
  const sideA = list(war.sideA);
  const sideB = list(war.sideB);
  const onA = sideA.some((name) => canonical(name).toLowerCase() === selfKey);
  const onB = sideB.some((name) => canonical(name).toLowerCase() === selfKey);
  if (!onA && !onB) return null;

  const own = onA ? sideA : sideB;
  const other = onA ? sideB : sideA;
  const ownGoals = onA ? war?.goals?.a : war?.goals?.b;
  const otherGoals = onA ? war?.goals?.b : war?.goals?.a;
  const ownKind = asString(ownGoals?.kind).toLowerCase();
  const ownScore = warGoalScore({
    kind: ownKind,
    targetRegionIds: ownGoals?.targetRegionIds,
    heldRegionIds: heldRegions(ownGoals, canonicalKeys(own), regionOwnershipOverrides),
    advantage: 0,
  });
  const otherScore = warGoalScore({
    kind: asString(otherGoals?.kind).toLowerCase(),
    targetRegionIds: otherGoals?.targetRegionIds,
    heldRegionIds: heldRegions(otherGoals, canonicalKeys(other), regionOwnershipOverrides),
    advantage: 0,
  });
  // A status_quo side wants nothing, so it can never be "ahead": it may seek
  // peace the moment it is weary.
  const ahead = ownKind !== "status_quo" && ownScore > otherScore;

  const playerKey = canonical(playerPolity).toLowerCase();
  const party = Boolean(playerKey) && [...sideA, ...sideB].some((name) => canonical(name).toLowerCase() === playerKey);

  const weariness = normalizeWeariness(war.weariness);
  return {
    warId,
    opponent: canonical(list(other)[0]),
    weariness: onA ? (weariness?.a ?? 0) : (weariness?.b ?? 0),
    ahead,
    party,
  };
};

// Resolve every active war's peace for one turn. Reads the world it is given
// and the turn's battle results; it never mutates either and never writes the
// ledger (the caller passes the returned weariness back for that).
export const resolveWarSettlements = ({ world, events, engagements, date, playerPolity = "" } = {}) => {
  const settlements = [];
  const offers = [];
  const weariness = {};
  const unresolved = [];
  // The terms a power could get by suing for peace, for every war nothing
  // forced this turn. Read only when the gateway accepted a seek_peace, so an
  // intent-less turn never touches it. A player's war carries the side and the
  // pressure so a seek against the player can become an offer.
  const peaceTermsByWarId = {};
  const eventList = list(events);
  const battles = Array.isArray(engagements) ? engagements : list(engagements?.results);
  const turnDate = asString(date);
  const playerKey = canonical(playerPolity).toLowerCase();
  const overrides = world?.regionOwnershipOverrides ?? {};
  const mobilization = world?.economyEngine?.mobilization ?? {};
  const pools = world?.economyEngine?.pools ?? {};

  for (const war of list(world?.wars)) {
    if (!war || typeof war !== "object") continue;
    const warId = asString(war.id);
    if (!warId) continue;
    if (asString(war.status).toLowerCase() !== "active") continue;
    const startedDate = asString(war.startedDate);
    // compareGameDates, not a text compare: the same calendar day in 300 BC
    // sorts after one in 218 BC by text the wrong way round.
    if (startedDate && compareGameDates(startedDate, turnDate) >= 0) continue;

    const sides = belligerentsOf(war);
    // The player's wars are stepped and settled like any other; only the
    // DECISION is held back, so a due peace becomes an offer, not a fact.
    const sideAHasPlayer = sideHasPlayer(war.sideA, playerKey);
    const sideBHasPlayer = sideHasPlayer(war.sideB, playerKey);
    const party = sideAHasPlayer || sideBHasPlayer;

    // Aggregate this war's battles into one call to the core, so a second
    // battle on the same war can never settle it twice.
    let powerA = 0;
    let powerB = 0;
    let lossA = 0;
    let lossB = 0;
    for (const battle of battles) {
      if (!battle || typeof battle !== "object") continue;
      const index = Number(battle.eventIndex);
      const event = Number.isInteger(index) ? eventList[index] : null;
      if (!event || asString(event.warId) !== warId) continue;
      powerA += Number(battle.sideA?.adjustedPower) || 0;
      powerB += Number(battle.sideB?.adjustedPower) || 0;
      lossA = Math.max(lossA, Number(battle.sideA?.lossFraction) || 0);
      lossB = Math.max(lossB, Number(battle.sideB?.lossFraction) || 0);
    }
    const totalPower = powerA + powerB;
    const advantageA = totalPower > 0 ? powerA / totalPower : 0;
    const advantageB = totalPower > 0 ? powerB / totalPower : 0;

    const leadA = canonical(list(war.sideA)[0]);
    const leadB = canonical(list(war.sideB)[0]);
    const goalsA = war.goals?.a ?? null;
    const goalsB = war.goals?.b ?? null;
    const heldA = heldRegions(goalsA, canonicalKeys(war.sideA), overrides);
    const heldB = heldRegions(goalsB, canonicalKeys(war.sideB), overrides);
    const unjustKeys = canonicalKeys(war.unjustAggressors);
    const unjustA = sideIsUnjust(war.sideA, unjustKeys);
    const unjustB = sideIsUnjust(war.sideB, unjustKeys);

    const prior = normalizeWeariness(war.weariness);
    const months = monthsBetweenDates(prior?.throughDate || startedDate, turnDate);
    const nextA = wearinessStep({
      prior: prior?.a,
      months,
      lossFraction: lossA,
      mobilization: asString(mobilization[leadA]).toLowerCase(),
    });
    const nextB = wearinessStep({
      prior: prior?.b,
      months,
      lossFraction: lossB,
      mobilization: asString(mobilization[leadB]).toLowerCase(),
    });
    // Persisted every turn, peace or no peace, so the next turn steps from here.
    weariness[warId] = { a: nextA, b: nextB, throughDate: turnDate };

    const settlementInputs = {
      warId,
      date: turnDate,
      goalsA,
      goalsB,
      heldRegionIdsA: heldA,
      heldRegionIdsB: heldB,
      advantageA,
      advantageB,
      wearinessA: nextA,
      wearinessB: nextB,
      codeA: leadA,
      codeB: leadB,
      poolsA: pools[leadA] ?? {},
      poolsB: pools[leadB] ?? {},
      unjustA,
      unjustB,
    };
    const settlement = settleWar(settlementInputs);
    if (!settlement) {
      // Not due. Derive the very terms a forced peace would give, so a sought
      // peace is priced by the same solver. An AI-vs-AI war is settled on them
      // directly; a player's war is offered to the player, carrying the side the
      // player is on and the war's pressure, the same two fields a due offer
      // carries.
      const terms = settlementTerms(settlementInputs);
      peaceTermsByWarId[warId] = party
        ? { settlement: terms, belligerents: sides, side: sideAHasPlayer ? "a" : "b", pressure: Math.max(nextA, nextB) }
        : { settlement: terms, belligerents: sides };
      // Not due. A player's open war is still reported, as it was when the
      // party check skipped it; a non-party war stays silent as before.
      if (party) unresolved.push({ warId, reason: `the player is a party to ${warId}` });
      continue;
    }
    if (party) {
      offers.push({
        ...settlement,
        belligerents: sides,
        side: sideAHasPlayer ? "a" : "b",
        pressure: Math.max(nextA, nextB),
      });
      continue;
    }
    settlements.push({ ...settlement, belligerents: sides });
  }

  return { settlements, offers, weariness, unresolved, peaceTermsByWarId };
};

// The narrated peace: a military event with no combat region, so the battle
// resolver treats it as narrative and its transfers travel through the normal
// impact door. The title names the war without a battlefield verb.
export const buildSettlementEvent = (settlement, { date = "", round = 0 } = {}) => {
  const warId = asString(settlement?.warId);
  const eventDate = asString(date);
  const seen = new Set();
  const combatants = [];
  for (const raw of list(settlement?.belligerents)) {
    const polity = canonical(raw);
    const key = polity.toLowerCase();
    if (!polity || seen.has(key)) continue;
    seen.add(key);
    combatants.push(polity);
    if (combatants.length >= 8) break;
  }
  // Name the price only when it was actually imposed: a punitive defeat that
  // takes no terms is a white peace, and the narration must not invent one.
  const description = settlement?.punitive && settlement?.white === false
    ? `The war ${warId} is settled on punitive terms; the unjust aggressor's defeat is paid for on ${eventDate}.`
    : `The war ${warId} is settled; the terms take effect on ${eventDate}.`;
  const event = {
    id: `event-peace-${warId}-${eventDate}`,
    kind: "military",
    date: eventDate,
    round: Number(round) || 0,
    title: `Peace settlement: ${warId}`,
    description,
    warId,
    combatants,
    impacts: { regionTransfers: [] },
  };
  event.impacts.regionTransfers = list(settlement?.transfers).map((entry) => ({
    regionId: asString(entry?.regionId),
    fromCode: asString(entry?.fromCode),
    toCode: asString(entry?.toCode),
  }));
  return event;
};

// Move a settlement's reparations once: normalize the world, read the pools,
// take what the loser actually has (absolute zero floor), refresh the forces
// mirror. A settlement with nothing to pay returns the world unchanged.
export const applyWarReparations = (world, settlements) => {
  const owing = list(settlements).filter((settlement) => {
    const reparations = settlement?.reparations;
    if (!reparations) return false;
    const manpower = Number(reparations.manpower) || 0;
    const materiel = Number(reparations.materiel) || 0;
    return (manpower > 0 || materiel > 0)
      && asString(reparations.fromCode)
      && asString(reparations.toCode);
  });
  if (owing.length === 0) return world;

  const next = normalizeWorldState(world);
  const pools = normalizePools(next.economyEngine?.pools);
  const touched = new Set();
  for (const settlement of owing) {
    const fromCode = asString(settlement.reparations.fromCode);
    const toCode = asString(settlement.reparations.toCode);
    if (canonical(fromCode) === canonical(toCode)) continue;
    const loser = pools[fromCode] ?? { manpower: 0, materiel: 0 };
    const victor = pools[toCode] ?? { manpower: 0, materiel: 0 };
    const manpower = Math.min(
      Math.max(0, loser.manpower ?? 0),
      Math.max(0, Number(settlement.reparations.manpower) || 0),
    );
    const materiel = Math.min(
      Math.max(0, loser.materiel ?? 0),
      Math.max(0, Number(settlement.reparations.materiel) || 0),
    );
    if (manpower === 0 && materiel === 0) continue;
    pools[fromCode] = { manpower: loser.manpower - manpower, materiel: roundTo(loser.materiel - materiel, 2) };
    pools[toCode] = { manpower: victor.manpower + manpower, materiel: roundTo(victor.materiel + materiel, 2) };
    touched.add(fromCode);
    touched.add(toCode);
  }
  if (touched.size === 0) return world;

  const withPools = { ...next, economyEngine: { ...(next.economyEngine ?? {}), pools } };
  for (const polity of touched) {
    // next is already normalized; each polity's sheet is independent, so read it
    // once instead of re-normalizing the whole world per polity.
    const sheet = next.countryStats?.[polity]?.forces ?? {};
    applyCountryStatPatchToWorld(withPools, polity, {
      forces: {
        manpower: pools[polity].manpower,
        materiel: pools[polity].materiel,
        mobilization: sheet.mobilization ?? "peacetime",
        ...(sheet.shortfall ? { shortfall: sheet.shortfall } : {}),
      },
    }, { replaceComponents: true, engineSourced: true });
  }
  return withPools;
};
