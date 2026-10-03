/*! Open Historia - runtime diplomatic cost: the reputation and relation penalty one act costs (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One definition of what an unjust act costs a polity: a reputation penalty and
// a relation penalty against each wronged party. It lives in runtime rather than
// Game/AI because runtime modules must not import the AI layer, and it is shared
// by the treaty-breach and unjust-war charges so the two can never disagree.

import { normalizeWorldState } from "./gameState.js";

const asString = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const keyLower = (value) => asString(value).toLowerCase();

export const applyDiplomaticCost = (world, charges, { date = "", round = 0 } = {}) => {
  const pending = list(charges).filter((charge) => asString(charge?.actor));
  if (!pending.length) return world;

  const normalized = normalizeWorldState(world);
  const reputation = { ...(normalized?.internationalReputation ?? {}) };
  const relations = list(normalized?.relations).map((relation) => ({ ...relation }));
  const pairKey = (a, b) => [keyLower(a), keyLower(b)].sort().join("\u0000");
  const relationByPair = new Map(relations.map((relation) => [pairKey(relation.a, relation.b), relation]));
  const stamp = asString(date);
  const roundNumber = Math.max(0, Math.trunc(Number(round) || 0));

  for (const charge of pending) {
    const actor = asString(charge.actor);
    const reputationPenalty = Math.max(0, Number(charge.reputationPenalty) || 0);
    const relationPenalty = Math.max(0, Number(charge.relationPenalty) || 0);
    const reason = asString(charge.reason);
    const prefix = asString(charge.relationIdPrefix) || "relation";
    const priorReputation = Number.isFinite(Number(reputation[actor])) ? Number(reputation[actor]) : 50;
    reputation[actor] = Math.max(0, Math.min(100, priorReputation - reputationPenalty));
    for (const wronged of list(charge.wronged).map(asString).filter(Boolean)) {
      if (keyLower(wronged) === keyLower(actor)) continue;
      const key = pairKey(actor, wronged);
      const prior = relationByPair.get(key);
      const score = Math.max(-100, Math.min(100, (Number(prior?.score) || 0) - relationPenalty));
      if (prior) {
        prior.score = score;
        prior.status = "";
        prior.lastUpdatedDate = stamp || prior.lastUpdatedDate;
        prior.updatedRound = roundNumber || prior.updatedRound;
      } else {
        const relation = {
          id: `${prefix}-${keyLower(actor)}-${keyLower(wronged)}`.replace(/\s+/g, "-"),
          a: actor,
          b: wronged,
          score,
          status: "",
          summary: `${actor} ${reason} ${wronged}.`,
          lastUpdatedDate: stamp,
          updatedRound: roundNumber,
        };
        relations.push(relation);
        relationByPair.set(key, relation);
      }
    }
  }

  return normalizeWorldState({ ...normalized, internationalReputation: reputation, relations });
};
