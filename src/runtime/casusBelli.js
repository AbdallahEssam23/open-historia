/*! Open Historia - runtime casus belli: judge a war's aggressor and charge an unjust one (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The adapter between the stored world and the pure casus core. It reads the
// claims, the breached agreements and the wars started this turn, resolves every
// name into one canonical key space, calls the engine, and charges each unjust
// aggressor. It never imports the Game/AI layer.

import {
  MAX_CASUS_AGGRESSORS,
  UNJUST_WAR_RELATION_PENALTY,
  UNJUST_WAR_REPUTATION_PENALTY,
  deriveWarCasus,
} from "../engine/casusBelli.js";
import { applyDiplomaticCost } from "./diplomaticCost.js";
import { normalizeWorldState } from "./gameState.js";
import { buildOwnerAliasMap, createOwnerResolver, toCountryName } from "./ownerNames.js";
import { regionOwnerName } from "./regionOwners.js";

export const WAR_CASUS_ROW_CAP = 6;
export const WAR_CASUS_CHAR_CAP = 360;

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

const uniqueNames = (values) => {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const name = asString(value);
    const key = keyLower(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
};

// One claim row per (regionId, claimant). The holder is the region's current
// owner: the override wins, else the catalog base country, folded through the
// same canonical key space as every other name.
const claimRowsOf = (normalized, readPolity, catalog) => {
  const catalogById = new Map(list(catalog).map((region) => [asString(region?.id), region]));
  const overrides = normalized?.regionOwnershipOverrides ?? {};
  const rows = [];
  for (const [regionId, claimants] of Object.entries(normalized?.regionClaimants ?? {})) {
    const holder = readPolity(regionOwnerName(catalogById.get(asString(regionId)), overrides));
    if (!holder) continue;
    for (const claimant of list(claimants)) {
      const name = readPolity(claimant);
      if (!name) continue;
      rows.push({ regionId: asString(regionId), claimant: name, holder });
    }
  }
  return rows;
};

const breachRowsOf = (normalized, readPolity) => list(normalized?.agreements)
  .filter((agreement) => asString(agreement?.status) === "breached")
  .map((agreement) => ({
    agreementId: asString(agreement?.id),
    breachedBy: readPolity(agreement?.breachedBy),
    parties: list(agreement?.parties).map(readPolity).filter(Boolean),
  }))
  .filter((row) => row.agreementId && row.breachedBy && row.parties.length);

export const readWarCasus = (world, { starts = [], catalog = [] } = {}) => {
  const normalized = normalizeWorldState(world);
  const readPolity = readerFor(normalized);
  const claims = claimRowsOf(normalized, readPolity, catalog);
  const breaches = breachRowsOf(normalized, readPolity);
  const byId = new Map(list(normalized?.wars).map((war) => [asString(war?.id), war]));

  const wars = [];
  const rejected = [];
  const summary = { judged: 0, justified: 0, unjust: 0 };

  for (const start of list(starts)) {
    const warId = asString(start?.warId);
    if (!warId) continue;
    const war = byId.get(warId);
    if (!war) {
      rejected.push({ warId, reason: "war-missing" });
      continue;
    }
    if (asString(war?.status) !== "active") {
      rejected.push({ warId, reason: "war-inactive" });
      continue;
    }
    const aggressors = uniqueNames(list(start?.aggressors).map(readPolity).filter(Boolean));
    const defenders = uniqueNames(list(start?.defenders).map(readPolity).filter(Boolean));
    if (!aggressors.length || !defenders.length) continue;
    const verdict = deriveWarCasus({ aggressors, defenders, claims, breaches });
    if (!verdict.aggressors.length) continue;
    const wronged = defenders.slice().sort((a, b) => compareText(keyLower(a), keyLower(b)) || compareText(a, b));
    wars.push({ warId, aggressors: verdict.aggressors, wronged });
    summary.judged += verdict.summary.judged;
    summary.justified += verdict.summary.justified;
    summary.unjust += verdict.summary.unjust;
  }

  return { wars, rejected, summary };
};

export const applyWarCasus = (world, wars, { date = "", round = 0 } = {}) => {
  const charges = [];
  const marks = new Map();

  for (const judgment of list(wars)) {
    const warId = asString(judgment?.warId);
    if (!warId) continue;
    const unjust = uniqueNames(
      list(judgment?.aggressors)
        .filter((row) => asString(row?.polity) && row?.justified === false)
        .map((row) => row.polity),
    ).slice(0, MAX_CASUS_AGGRESSORS).sort((a, b) => compareText(keyLower(a), keyLower(b)) || compareText(a, b));
    if (!unjust.length) continue;
    const wronged = uniqueNames(list(judgment?.wronged));
    marks.set(warId, unjust);
    for (const actor of unjust) {
      charges.push({
        actor,
        wronged,
        reputationPenalty: UNJUST_WAR_REPUTATION_PENALTY,
        relationPenalty: UNJUST_WAR_RELATION_PENALTY,
        reason: "began an unjust war on",
        relationIdPrefix: "relation-unjust-war",
      });
    }
  }
  if (!marks.size) return world;

  const charged = normalizeWorldState(applyDiplomaticCost(world, charges, { date, round }));
  const wars2 = list(charged?.wars).map((war) => {
    const mark = marks.get(asString(war?.id));
    return mark ? { ...war, unjustAggressors: mark } : war;
  });
  return normalizeWorldState({ ...charged, wars: wars2 });
};

export const readRecordedUnjustWars = (world) => {
  const normalized = normalizeWorldState(world);
  const rows = [];
  for (const war of list(normalized?.wars)) {
    const unjust = uniqueNames(list(war?.unjustAggressors));
    if (!unjust.length) continue;
    const sideA = list(war?.sideA).map(asString);
    const sideAKeys = new Set(sideA.map(keyLower));
    const aggressorSide = unjust.some((name) => sideAKeys.has(keyLower(name))) ? "sideA" : "sideB";
    const wronged = uniqueNames(aggressorSide === "sideA" ? list(war?.sideB) : list(war?.sideA));
    for (const aggressor of unjust) {
      rows.push({ warId: asString(war?.id), aggressor, wronged });
    }
  }
  return rows.sort((a, b) => compareText(a.warId, b.warId) || compareText(a.aggressor, b.aggressor));
};

export const buildWarCasusDigest = ({
  wars = [],
  cap = WAR_CASUS_ROW_CAP,
  charCap = WAR_CASUS_CHAR_CAP,
} = {}) => {
  const rows = list(wars)
    .filter((row) => row && typeof row === "object" && asString(row.warId) && asString(row.aggressor))
    .slice()
    .sort((a, b) =>
      compareText(asString(a.warId), asString(b.warId))
      || compareText(asString(a.aggressor), asString(b.aggressor)));
  if (!rows.length) return "";

  const limit = Math.max(0, Math.round(Number(cap) || 0));
  const budget = Math.max(0, Math.round(Number(charCap) || 0));
  const shown = rows.slice(0, limit);
  const fixed = "[Wars Begun Without Just Cause, as simulated]";
  const overflow = rows.length > shown.length ? `+${rows.length - shown.length} more.` : "";

  let used = fixed.length + (overflow ? overflow.length + 1 : 0);
  const kept = [];
  for (const row of shown) {
    const wronged = list(row.wronged).map(asString).filter(Boolean).join(", ");
    const line = `- ${asString(row.aggressor)} began ${asString(row.warId)} without just cause; wronged ${wronged}.`;
    if (used + line.length + 1 > budget) break;
    kept.push(line);
    used += line.length + 1;
  }
  return [fixed, ...kept, overflow].filter(Boolean).join("\n");
};
