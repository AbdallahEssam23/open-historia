/*! Open Historia - engine casus belli: the warrant a war needs and the cost of one without (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Whether the power that began a war held a reason the world already records: an
// unresolved claim on land a defender holds, or an unredressed breach by a
// defender against a party. Pure over plain data with no imports, so it passes
// the engine purity guard.

export const UNJUST_WAR_REPUTATION_PENALTY = 15;
export const UNJUST_WAR_RELATION_PENALTY = 25;
export const MAX_CASUS_AGGRESSORS = 12;

const asString = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const keyOf = (value) => asString(value).toLowerCase();
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const comparePolity = (a, b) => compareText(keyOf(a), keyOf(b)) || compareText(asString(a), asString(b));

const uniqueByKey = (values, keyOfValue) => {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = keyOfValue(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
};

export const deriveWarCasus = ({ aggressors = [], defenders = [], claims = [], breaches = [] } = {}) => {
  const defenderKeys = new Set(list(defenders).map(keyOf).filter(Boolean));

  const claimRows = uniqueByKey(
    list(claims)
      .map((claim) => ({
        regionId: asString(claim?.regionId),
        claimant: asString(claim?.claimant),
        holder: asString(claim?.holder),
      }))
      .filter((claim) => claim.regionId && claim.claimant && claim.holder),
    (claim) => keyOf(claim.claimant) + "\u0000" + keyOf(claim.regionId),
  ).sort((a, b) => compareText(a.regionId, b.regionId) || comparePolity(a.claimant, b.claimant));

  const breachRows = uniqueByKey(
    list(breaches)
      .map((breach) => ({
        agreementId: asString(breach?.agreementId),
        breachedBy: asString(breach?.breachedBy),
        parties: uniqueByKey(list(breach?.parties).map(asString).filter(Boolean), keyOf),
      }))
      .filter((breach) => breach.agreementId && breach.breachedBy && breach.parties.length),
    (breach) => keyOf(breach.agreementId) + "\u0000" + keyOf(breach.breachedBy),
  ).sort((a, b) => compareText(a.agreementId, b.agreementId) || comparePolity(a.breachedBy, b.breachedBy));

  const declared = uniqueByKey(list(aggressors).map(asString).filter(Boolean), keyOf)
    .sort(comparePolity)
    .slice(0, MAX_CASUS_AGGRESSORS);

  const rows = declared.map((polity) => {
    const actorKey = keyOf(polity);
    const claim = claimRows.find((row) =>
      keyOf(row.claimant) === actorKey && defenderKeys.has(keyOf(row.holder)));
    if (claim) return { polity, justified: true, kind: "claim", target: claim.regionId };
    const breach = breachRows.find((row) =>
      defenderKeys.has(keyOf(row.breachedBy))
      && keyOf(row.breachedBy) !== actorKey
      && row.parties.some((party) => keyOf(party) === actorKey));
    if (breach) return { polity, justified: true, kind: "breach", target: breach.agreementId };
    return { polity, justified: false, kind: "", target: "" };
  });

  const justified = rows.filter((row) => row.justified).length;
  return {
    aggressors: rows,
    summary: { judged: rows.length, justified, unjust: rows.length - justified },
  };
};
