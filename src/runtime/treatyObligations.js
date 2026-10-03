/*! Open Historia - runtime treaty obligations: read the ledgers, apply the joins (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The adapter between the stored world and the pure obligation core. It reads
// the world, resolves every war polity and agreement party into one canonical
// key space, calls the engine, and turns the joins into a new normalized world.
// It never imports the Game/AI layer and writes nothing but world.wars.

import { deriveTreatyObligations } from "../engine/treatyObligations.js";
import { normalizeWorldState } from "./gameState.js";
import { buildOwnerAliasMap, createOwnerResolver, toCountryName } from "./ownerNames.js";

export const TREATY_ROW_CAP = 6;
export const TREATY_CHAR_CAP = 360;

const asString = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const canonical = (value) => {
  const raw = asString(value);
  return toCountryName(raw) || raw;
};

const readerFor = (world) => {
  const resolveOwner = createOwnerResolver(buildOwnerAliasMap(world?.polityOverrides));
  return (value) => resolveOwner(asString(value)) || canonical(value);
};

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
