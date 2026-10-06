// Open Historia - the deterministic engagement core (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// One declared battle, resolved. The model says who fights, where and why; this
// module is the only place that turns that into numbers. It imports nothing:
// the force-pool table it is calibrated against lives in forcePools.js, but the
// casualty-to-reserve mapping is the adapter's job, so this core stays
// importable by a bare node --test.
//
// Air and naval formations are more than their weight: one domain edge per kind
// gives them a tactical effect a land force does not have. The rules are inert
// unless a side actually fields an air or naval unit, so a land-only battle
// resolves exactly as it did before the domains existed.
//
// A formation also has a tactical effect against the types it counters: the
// artillery arm plus a land triangle. This is a raw-power factor beside naval
// support, and it is inert unless a matchup in the table actually connects the
// two sides.

// How much a formation of this type is worth per point of strength. Ordered so
// heavier formations weigh more; first-draft calibration, and the tests assert
// the ordering, never a magnitude.
export const UNIT_COMBAT_WEIGHT = Object.freeze({
  garrison: 0.4,
  infantry: 1.0,
  artillery: 1.2,
  armor: 1.6,
  air: 2.0,
  naval: 2.2,
});

// A mobilized economy also fights better, but this is a separate table from
// forcePools' extraction effects: the two are different quantities.
export const MOBILIZATION_COMBAT_MULTIPLIER = Object.freeze({
  demobilized: 0.75,
  peacetime: 1.0,
  partial: 1.25,
  total: 1.5,
});

export const COMBAT_LOSS_BASE = 0.45;
export const COMBAT_LOSS_MIN = 0.03;
export const COMBAT_LOSS_MAX = 0.45;
export const COMBAT_JITTER_MIN = 0.85;
export const COMBAT_JITTER_SPAN = 0.3;
export const UNIT_DESTRUCTION_THRESHOLD = 15;
export const CONTROL_THRESHOLD = 0.4;

// The three domains a formation can belong to. An unknown type is land, the
// same fallback the weight table uses.
export const UNIT_DOMAIN = Object.freeze({
  garrison: "land",
  infantry: "land",
  artillery: "land",
  armor: "land",
  air: "air",
  naval: "naval",
});

// A side that holds the whole air domain moves the other side's loss fraction by
// at most this share; a side that holds the whole naval domain moves its own raw
// power by at most this share. Both are first-draft calibration, and the tests
// assert the ordering and the bounds, never a magnitude.
export const AIR_EDGE_MAX = 0.35;
export const NAVAL_SUPPORT_MAX = 0.25;

// The counter arm plus a land triangle: artillery reaches armour with direct
// fire, air with anti-aircraft fire and ships with coastal fire; armour beats
// infantry in the open; infantry beats artillery in close terrain. One named
// table of matchups, not a full type-versus-type matrix.
export const ANTI_COUNTERS = Object.freeze({
  artillery: Object.freeze(["armor", "air", "naval"]),
  armor: Object.freeze(["infantry"]),
  infantry: Object.freeze(["artillery"]),
});

// A side whose counter score dominates multiplies its raw power by at most this
// share. First-draft calibration, and the tests assert the bounds, never a
// magnitude.
export const ANTI_SUPPORT_MAX = 0.2;

const name = (value) => String(value ?? "").trim();
const foldKey = (value) => name(value).toLocaleLowerCase();

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export const unitDomain = (unit) => UNIT_DOMAIN[name(unit?.type)] ?? "land";

// FNV-1a over a string, mapped to [0, 1). The same algorithm runtime/spycraft.js
// uses, so a replay is consistent across the two systems; the engine may not
// import a runtime module, so the hash is repeated here on purpose.
export const engagementRoll = (key) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0) / 0x100000000;
};

export const unitCombatPower = (unit) => {
  const weight = UNIT_COMBAT_WEIGHT[name(unit?.type)] ?? UNIT_COMBAT_WEIGHT.infantry;
  const strength = clamp(Number(unit?.strength) || 0, 0, 100);
  return weight * (strength / 100);
};

export const mobilizationCombatMultiplier = (posture) =>
  MOBILIZATION_COMBAT_MULTIPLIER[name(posture)] ?? MOBILIZATION_COMBAT_MULTIPLIER.peacetime;

// How much of its strength a side loses, as a function of the OPPONENT's share
// of the adjusted power. The weaker side pays more; both pay something.
export const combatLossFraction = (shareOpponent) =>
  clamp(COMBAT_LOSS_BASE * (Number(shareOpponent) || 0), COMBAT_LOSS_MIN, COMBAT_LOSS_MAX);

// The side with the larger adjusted power wins; an exact tie is held by the
// defender, or by side A when no defender could be identified.
export const engagementWinner = (adjustedA, adjustedB, defenderSide = "") => {
  if (adjustedA > adjustedB) return "a";
  if (adjustedB > adjustedA) return "b";
  return defenderSide || "a";
};

const sideHasPolity = (side, polity) =>
  Boolean(polity) && side.some((entry) => foldKey(entry?.polity) === foldKey(polity));

// The winning side must have boots on the ground to take a province; a pure
// fleet or air wing can win the battle and never change hands the map.
const sideHasLand = (side) =>
  side.some((entry) => (entry?.units ?? []).some((unit) => unitDomain(unit) === "land"));

// The first polity of a side that actually has units on the field, in the side's
// declared order, so the new controller is deterministic.
const leadingPolity = (side) => {
  for (const entry of side) {
    if (Array.isArray(entry?.units) && entry.units.length > 0) return name(entry.polity);
  }
  return "";
};

const scoreSide = (side) => {
  let power = 0;
  for (const entry of side) {
    const multiplier = mobilizationCombatMultiplier(entry?.posture);
    for (const unit of entry?.units ?? []) power += unitCombatPower(unit) * multiplier;
  }
  return power;
};

// The power one side holds in a single domain, mobilized exactly the way
// scoreSide mobilizes total power, so the two are the same quantity.
const domainPower = (side, domain) => {
  let power = 0;
  for (const entry of side) {
    const multiplier = mobilizationCombatMultiplier(entry?.posture);
    for (const unit of entry?.units ?? []) {
      if (unitDomain(unit) === domain) power += unitCombatPower(unit) * multiplier;
    }
  }
  return power;
};

// A side's power grouped by unit type, mobilized exactly the way scoreSide and
// domainPower mobilize it, so the three read the same quantity.
const powerByType = (side) => {
  const byType = {};
  for (const entry of side) {
    const multiplier = mobilizationCombatMultiplier(entry?.posture);
    for (const unit of entry?.units ?? []) {
      const type = name(unit?.type) || "infantry";
      byType[type] = (byType[type] ?? 0) + unitCombatPower(unit) * multiplier;
    }
  }
  return byType;
};

// How hard one side's counters bite the other: the sum, over every matchup in
// the table, of the counter type's power times the countered type's power. It is
// zero when no matchup connects the sides, which is what keeps the rule inert.
const counterScore = (attackerByType, targetByType) => {
  let score = 0;
  for (const [counter, targets] of Object.entries(ANTI_COUNTERS)) {
    const power = attackerByType[counter] ?? 0;
    if (!power) continue;
    for (const target of targets) score += power * (targetByType[target] ?? 0);
  }
  return score;
};

// A signed share in [-1, 1]: +1 when A holds the whole domain, 0 when the sides
// are equal or neither fields the domain, -1 when B holds the whole of it.
const domainEdge = (powerA, powerB) => {
  const total = powerA + powerB;
  return total > 0 ? (powerA - powerB) / total : 0;
};

// The air edge moves a loss fraction inside the band it already had, so it can
// neither create nor remove a destroyable loss on its own. sideEdge is +airEdge
// for side A and -airEdge for side B.
const adjustLoss = (loss, sideEdge) =>
  clamp(loss * (1 - AIR_EDGE_MAX * sideEdge), COMBAT_LOSS_MIN, COMBAT_LOSS_MAX);

// The naval edge scales a side's raw power before the jitter. Absent any naval
// power on either side it is exactly 1, so the arithmetic is unchanged.
const navalFactor = (sideEdge) => 1 + NAVAL_SUPPORT_MAX * sideEdge;

// The anti-type factor scales a side's raw power by its share of the counter
// score, before the jitter. Absent any connecting matchup the edge is 0 and the
// factor is exactly 1, so the arithmetic is unchanged.
const antiFactor = (sideEdge) => 1 + ANTI_SUPPORT_MAX * sideEdge;

// A winning force can only finish off a formation it can reach. Land is reached
// by any force; air needs air power; a fleet needs air or naval power.
const canReach = (unit, airPower, navalPower) => {
  const domain = unitDomain(unit);
  if (domain === "air") return airPower > 0;
  if (domain === "naval") return airPower > 0 || navalPower > 0;
  return true;
};

const applyLosses = ({ side, lossFraction, destroyed, canFinish = () => true }) => {
  const units = [];
  const casualties = [];
  for (const entry of side) {
    for (const unit of entry?.units ?? []) {
      const strength = clamp(Number(unit?.strength) || 0, 0, 100);
      let nextStrength = clamp(Math.round(strength * (1 - lossFraction)), 1, 100);
      let isDestroyed = false;
      if (destroyed && nextStrength < UNIT_DESTRUCTION_THRESHOLD && canFinish(unit)) {
        isDestroyed = true;
        nextStrength = 0;
      }
      const lostPoints = strength - nextStrength;
      const result = {
        id: name(unit?.id),
        polity: name(entry?.polity),
        type: name(unit?.type) || "infantry",
        strength,
        nextStrength,
        lostPoints,
        destroyed: isDestroyed,
      };
      units.push(result);
      if (lostPoints > 0) casualties.push({ ...result, unitId: result.id });
    }
  }
  return { units, casualties };
};

export const resolveEngagement = ({
  warId = "",
  regionId = "",
  date = "",
  round = 0,
  sideA = [],
  sideB = [],
  controllerPolity = "",
} = {}) => {
  const key = `${name(warId)}|${name(regionId)}|${name(date)}|${Number(round) || 0}`;
  const airA = domainPower(sideA, "air");
  const airB = domainPower(sideB, "air");
  const navalA = domainPower(sideA, "naval");
  const navalB = domainPower(sideB, "naval");
  const airEdge = domainEdge(airA, airB);
  const navalEdge = domainEdge(navalA, navalB);
  const byTypeA = powerByType(sideA);
  const byTypeB = powerByType(sideB);
  const antiA = counterScore(byTypeA, byTypeB);
  const antiB = counterScore(byTypeB, byTypeA);
  const antiEdge = domainEdge(antiA, antiB);
  const powerA = scoreSide(sideA) * navalFactor(navalEdge) * antiFactor(antiEdge);
  const powerB = scoreSide(sideB) * navalFactor(-navalEdge) * antiFactor(-antiEdge);
  const adjustedA = powerA * (COMBAT_JITTER_MIN + COMBAT_JITTER_SPAN * engagementRoll(`${key}|a`));
  const adjustedB = powerB * (COMBAT_JITTER_MIN + COMBAT_JITTER_SPAN * engagementRoll(`${key}|b`));
  const total = adjustedA + adjustedB;

  const defenderSide = sideHasPolity(sideA, controllerPolity)
    ? "a"
    : sideHasPolity(sideB, controllerPolity) ? "b" : "";
  const attackerSide = defenderSide === "a" ? "b" : defenderSide === "b" ? "a" : "";

  const winner = engagementWinner(adjustedA, adjustedB, defenderSide);

  const shareA = total > 0 ? adjustedA / total : 0.5;
  const shareB = total > 0 ? adjustedB / total : 0.5;
  const lossA = adjustLoss(combatLossFraction(shareB), airEdge);
  const lossB = adjustLoss(combatLossFraction(shareA), -airEdge);

  // The winner's own domain power decides what it can finish off: the losing
  // side's reachable formations are destroyed, the unreachable ones withdraw.
  const winnerAir = winner === "a" ? airA : airB;
  const winnerNaval = winner === "a" ? navalA : navalB;
  const finish = (unit) => canReach(unit, winnerAir, winnerNaval);
  const a = applyLosses({ side: sideA, lossFraction: lossA, destroyed: winner !== "a", canFinish: finish });
  const b = applyLosses({ side: sideB, lossFraction: lossB, destroyed: winner !== "b", canFinish: finish });

  let controlChange = null;
  if (defenderSide && attackerSide && winner === attackerSide && sideHasLand(winner === "a" ? sideA : sideB)) {
    const defenderShare = defenderSide === "a" ? shareA : shareB;
    if (defenderShare < CONTROL_THRESHOLD) {
      const toCode = leadingPolity(winner === "a" ? sideA : sideB);
      if (toCode) controlChange = { toCode };
    }
  }

  return {
    key,
    winner,
    defenderSide,
    controlChange,
    airEdge,
    navalEdge,
    antiEdge,
    sideA: { power: powerA, adjustedPower: adjustedA, lossFraction: lossA, airPower: airA, navalPower: navalA, antiPower: antiA, units: a.units },
    sideB: { power: powerB, adjustedPower: adjustedB, lossFraction: lossB, airPower: airB, navalPower: navalB, antiPower: antiB, units: b.units },
    casualties: [...a.casualties, ...b.casualties],
  };
};
