// Open Historia - the deterministic engagement core (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// One declared battle, resolved. The model says who fights, where and why; this
// module is the only place that turns that into numbers. It imports nothing:
// the force-pool table it is calibrated against lives in forcePools.js, but the
// casualty-to-reserve mapping is the adapter's job, so this core stays
// importable by a bare node --test.

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

const name = (value) => String(value ?? "").trim();
const foldKey = (value) => name(value).toLocaleLowerCase();

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

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

const applyLosses = ({ side, lossFraction, destroyed }) => {
  const units = [];
  const casualties = [];
  for (const entry of side) {
    for (const unit of entry?.units ?? []) {
      const strength = clamp(Number(unit?.strength) || 0, 0, 100);
      let nextStrength = clamp(Math.round(strength * (1 - lossFraction)), 1, 100);
      let isDestroyed = false;
      if (destroyed && nextStrength < UNIT_DESTRUCTION_THRESHOLD) {
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
  const powerA = scoreSide(sideA);
  const powerB = scoreSide(sideB);
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
  const lossA = combatLossFraction(shareB);
  const lossB = combatLossFraction(shareA);

  const a = applyLosses({ side: sideA, lossFraction: lossA, destroyed: winner !== "a" });
  const b = applyLosses({ side: sideB, lossFraction: lossB, destroyed: winner !== "b" });

  let controlChange = null;
  if (defenderSide && attackerSide && winner === attackerSide) {
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
    sideA: { power: powerA, adjustedPower: adjustedA, lossFraction: lossA, units: a.units },
    sideB: { power: powerB, adjustedPower: adjustedB, lossFraction: lossB, units: b.units },
    casualties: [...a.casualties, ...b.casualties],
  };
};
