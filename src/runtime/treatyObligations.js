/*! Open Historia - runtime treaty obligations: read the ledgers, apply the joins (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The adapter between the stored world and the pure obligation core. It reads
// the world, resolves every war polity and agreement party into one canonical
// key space, calls the engine, and turns the joins into a new normalized world.
// It never imports the Game/AI layer and writes nothing but world.wars.

import { BREACH_RELATION_PENALTY, BREACH_REPUTATION_PENALTY, deriveTreatyBreaches, deriveTreatyObligations } from "../engine/treatyObligations.js";
import { normalizeWorldState } from "./gameState.js";
import { buildOwnerAliasMap, createOwnerResolver, toCountryName } from "./ownerNames.js";

export const TREATY_ROW_CAP = 6;
export const TREATY_CHAR_CAP = 360;
export const TREATY_BREACH_ROW_CAP = 6;
export const TREATY_BREACH_CHAR_CAP = 360;

const asString = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const keyLower = (value) => asString(value).toLowerCase();
const canonical = (value) => {
  const raw = asString(value);
  return toCountryName(raw) || raw;
};

const readerFor = (world) => {
  const resolveOwner = createOwnerResolver(buildOwnerAliasMap(world?.polityOverrides));
  return (value) => resolveOwner(asString(value)) || canonical(value);
};

const canonicalWars = (normalized, readPolity) => list(normalized?.wars)
  .filter((war) => asString(war?.status) === "active")
  .map((war) => ({
    id: asString(war?.id),
    status: "active",
    aggressor: asString(war?.aggressor) === "b" ? "b" : "a",
    sideA: list(war?.sideA).map(readPolity).filter(Boolean),
    sideB: list(war?.sideB).map(readPolity).filter(Boolean),
  }));

const canonicalAgreements = (normalized, readPolity) => list(normalized?.agreements).map((agreement) => ({
  id: asString(agreement?.id),
  type: asString(agreement?.type),
  status: asString(agreement?.status),
  parties: list(agreement?.parties).map(readPolity).filter(Boolean),
  guarantor: asString(agreement?.guarantor) ? readPolity(agreement.guarantor) : "",
  beneficiary: asString(agreement?.beneficiary) ? readPolity(agreement.beneficiary) : "",
}));

export const readTreatyObligations = (world, { playerPolity = "" } = {}) => {
  const normalized = normalizeWorldState(world);
  const readPolity = readerFor(normalized);
  const playerKey = asString(playerPolity) ? readPolity(playerPolity).toLowerCase() : "";

  const wars = list(normalized?.wars)
    .filter((war) => asString(war?.status) === "active")
    .map((war) => ({
      id: asString(war?.id),
      status: "active",
      aggressor: asString(war?.aggressor) === "b" ? "b" : "a",
      sideA: list(war?.sideA).map(readPolity).filter(Boolean),
      sideB: list(war?.sideB).map(readPolity).filter(Boolean),
    }));
  const agreements = list(normalized?.agreements).map((agreement) => ({
    id: asString(agreement?.id),
    type: asString(agreement?.type),
    status: asString(agreement?.status),
    parties: list(agreement?.parties).map(readPolity).filter(Boolean),
    guarantor: asString(agreement?.guarantor) ? readPolity(agreement.guarantor) : "",
    beneficiary: asString(agreement?.beneficiary) ? readPolity(agreement.beneficiary) : "",
  }));

  // The player key is handed to the engine as inadmissible so the player is
  // never a chain node: a withheld admission propagates nothing to its allies.
  return deriveTreatyObligations({ wars, agreements, inadmissible: playerKey ? [playerKey] : [] });
};

export const readTreatyBreaches = (world, { breaches = [] } = {}) => {
  const normalized = normalizeWorldState(world);
  const readPolity = readerFor(normalized);
  const declared = list(breaches)
    .map((entry) => ({
      agreementId: asString(entry?.agreementId),
      polity: readPolity(entry?.polity),
    }))
    .filter((entry) => entry.agreementId && entry.polity);
  const derived = deriveTreatyBreaches({
    wars: canonicalWars(normalized, readPolity),
    agreements: canonicalAgreements(normalized, readPolity),
    breaches: declared,
  });
  return derived;
};

export const readRecordedBreaches = (world) => {
  const normalized = normalizeWorldState(world);
  return list(normalized?.agreements)
    .filter((agreement) => asString(agreement?.status) === "breached")
    .map((agreement) => ({
      agreementId: asString(agreement?.id),
      agreementType: asString(agreement?.type),
      breachedBy: asString(agreement?.breachedBy),
      polities: list(agreement?.parties).map(asString).filter(Boolean),
    }))
    .sort((a, b) => compareText(a.agreementId, b.agreementId) || compareText(a.breachedBy, b.breachedBy));
};

export const applyTreatyBreaches = (world, breaches, { date = "", round = 0 } = {}) => {
  const pending = list(breaches).filter((breach) => asString(breach?.polity));
  if (!pending.length) return world;

  const normalized = normalizeWorldState(world);
  const reputation = { ...(normalized?.internationalReputation ?? {}) };
  const relations = list(normalized?.relations).map((relation) => ({ ...relation }));
  const pairKey = (a, b) => [keyLower(a), keyLower(b)].sort().join("\u0000");
  const relationByPair = new Map(relations.map((relation) => [pairKey(relation.a, relation.b), relation]));
  const stamp = asString(date);
  const roundNumber = Math.max(0, Math.trunc(Number(round) || 0));

  for (const breach of pending) {
    const breaker = asString(breach.polity);
    const priorReputation = Number.isFinite(Number(reputation[breaker])) ? Number(reputation[breaker]) : 50;
    reputation[breaker] = Math.max(0, Math.min(100, priorReputation - BREACH_REPUTATION_PENALTY));
    for (const wronged of list(breach.wrongedPolities).map(asString).filter(Boolean)) {
      if (keyLower(wronged) === keyLower(breaker)) continue;
      const key = pairKey(breaker, wronged);
      const prior = relationByPair.get(key);
      const score = Math.max(-100, Math.min(100, (Number(prior?.score) || 0) - BREACH_RELATION_PENALTY));
      if (prior) {
        prior.score = score;
        prior.status = "";
        prior.lastUpdatedDate = stamp || prior.lastUpdatedDate;
        prior.updatedRound = roundNumber || prior.updatedRound;
      } else {
        const relation = {
          id: `relation-breach-${keyLower(breaker)}-${keyLower(wronged)}`.replace(/\s+/g, "-"),
          a: breaker,
          b: wronged,
          score,
          status: "",
          summary: `${breaker} broke a treaty with ${wronged}.`,
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

export const buildTreatyBreachDigest = ({
  breaches = [],
  cap = TREATY_BREACH_ROW_CAP,
  charCap = TREATY_BREACH_CHAR_CAP,
} = {}) => {
  const rows = list(breaches)
    .filter((row) => row && typeof row === "object" && asString(row.agreementId) && asString(row.polity))
    .slice()
    .sort((a, b) =>
      compareText(asString(a.agreementId), asString(b.agreementId))
      || compareText(asString(a.polity), asString(b.polity)));
  if (!rows.length) return "";

  const limit = Math.max(0, Math.round(Number(cap) || 0));
  const budget = Math.max(0, Math.round(Number(charCap) || 0));
  const shown = rows.slice(0, limit);
  const fixed = "[Treaty Breaches, as simulated]";
  const overflow = rows.length > shown.length ? `+${rows.length - shown.length} more.` : "";

  let used = fixed.length + (overflow ? overflow.length + 1 : 0);
  const kept = [];
  for (const row of shown) {
    const wronged = list(row.wrongedPolities).map(asString).filter(Boolean).join(", ");
    const line = `- ${asString(row.polity)} broke ${asString(row.agreementId)} (${asString(row.agreementType)}); wronged ${wronged}.`;
    if (used + line.length + 1 > budget) break;
    kept.push(line);
    used += line.length + 1;
  }
  return [fixed, ...kept, overflow].filter(Boolean).join("\n");
};

export const applyTreatyJoins = (world, joins, { date = "", round = 0 } = {}) => {
  const pending = list(joins).filter((join) => asString(join?.warId) && asString(join?.polity));
  if (!pending.length) return world;

  const normalized = normalizeWorldState(world);
  const byId = new Map(list(normalized?.wars).map((war) => [asString(war?.id), { ...war }]));
  let touched = false;
  for (const join of pending) {
    const war = byId.get(asString(join.warId));
    if (!war) continue;
    const field = asString(join.side) === "b" ? "sideB" : "sideA";
    const polity = asString(join.polity);
    if (list(war[field]).some((name) => asString(name).toLowerCase() === polity.toLowerCase())) continue;
    war[field] = [...list(war[field]), polity];
    war.lastUpdatedDate = asString(date) || war.lastUpdatedDate;
    war.updatedRound = Math.max(0, Math.trunc(Number(round) || 0)) || war.updatedRound;
    touched = true;
  }
  if (!touched) return world;
  return normalizeWorldState({ ...normalized, wars: [...byId.values()] });
};

export const buildTreatyObligationDigest = ({
  standing = [],
  cap = TREATY_ROW_CAP,
  charCap = TREATY_CHAR_CAP,
} = {}) => {
  const rows = list(standing)
    .filter((row) => row && typeof row === "object" && asString(row.warId) && asString(row.agreementId))
    .slice()
    .sort((a, b) =>
      compareText(asString(a.warId), asString(b.warId))
      || compareText(asString(a.side), asString(b.side))
      || compareText(asString(a.agreementId), asString(b.agreementId)));
  if (!rows.length) return "";

  const limit = Math.max(0, Math.round(Number(cap) || 0));
  const budget = Math.max(0, Math.round(Number(charCap) || 0));
  const shown = rows.slice(0, limit);
  const fixed = "[Treaty Obligations, as simulated]";
  const overflow = rows.length > shown.length ? `+${rows.length - shown.length} more.` : "";

  // A line that would overflow the cap is dropped whole rather than truncated,
  // so the model is never handed half a fact, like the operations digest.
  let used = fixed.length + (overflow ? overflow.length + 1 : 0);
  const kept = [];
  for (const row of shown) {
    const polities = list(row.polities).map(asString).filter(Boolean).join(", ");
    const line = `- Under ${asString(row.agreementId)} (${asString(row.agreementType)}), ${polities} hold side ${asString(row.side).toUpperCase()} of ${asString(row.warId)}.`;
    if (used + line.length + 1 > budget) break;
    kept.push(line);
    used += line.length + 1;
  }
  return [fixed, ...kept, overflow].filter(Boolean).join("\n");
};
