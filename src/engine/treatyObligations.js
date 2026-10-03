/*! Open Historia - engine treaty obligations: the treaty clause a war triggers (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Which recorded promise a war calls in, as a pure function over plain data. An
// alliance is offensive and defensive; a mutual defense and a guarantee are
// defensive only, so the war must carry which side began it. No imports: the
// engine purity guard allows none, so the obligating type names are repeated
// here and a test pins them to the runtime enum.

export const MAX_WAR_SIDE = 12;
export const MAX_TREATY_JOINS_PER_STEP = 32;
export const MAX_OBLIGATION_PASSES = 8;
export const MAX_STANDING_OBLIGATIONS = 128;
export const MAX_TREATY_BREACHES_PER_TURN = 16;
export const BREACH_REPUTATION_PENALTY = 15;
export const BREACH_RELATION_PENALTY = 25;
export const OBLIGATION_AGREEMENT_TYPES = Object.freeze(["alliance", "mutual_defense", "guarantee"]);

const asString = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const keyOf = (value) => asString(value).toLowerCase();
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const comparePolity = (a, b) => compareText(keyOf(a), keyOf(b)) || compareText(asString(a), asString(b));

const uniqueByKey = (values) => {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const name = asString(value);
    const key = keyOf(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
};

// Parties in a total order that does not depend on how they were written, so
// reordering an agreement's parties can never change the derivation.
const partiesOf = (agreement) => uniqueByKey(list(agreement?.parties).slice().sort(comparePolity));

// The parties an agreement actually binds: a guarantee binds its guarantor and
// beneficiary, every other obligating type binds its listed parties. Shared by
// the standing read and the breach read so they agree on who is bound.
const relevantPartiesOf = (agreement) => {
  const parties = partiesOf(agreement);
  return asString(agreement?.type) === "guarantee"
    ? uniqueByKey([asString(agreement?.guarantor) || parties[0], asString(agreement?.beneficiary) || parties[1]])
    : parties;
};

const buildSides = (war) => {
  const sides = { a: new Map(), b: new Map() };
  for (const polity of uniqueByKey(list(war?.sideA))) sides.a.set(keyOf(polity), polity);
  for (const polity of uniqueByKey(list(war?.sideB))) {
    const key = keyOf(polity);
    if (!sides.a.has(key)) sides.b.set(key, polity);
  }
  return sides;
};

// The side each relevant party is obliged to join, given the sides as they
// stand. The single definition of "bound", called by the join derivation and by
// the breach read so the two can never disagree about who was bound.
const obligationTargets = (agreement, sides, defenderSide, originalDefenders) => {
  const type = asString(agreement?.type);
  const parties = partiesOf(agreement);
  const targets = [];
  const seen = new Set();
  const add = (polity, side) => {
    const key = keyOf(polity);
    if (!key || seen.has(key)) return;
    seen.add(key);
    targets.push({ polity: asString(polity), side });
  };
  const sideOf = (name) => {
    const key = keyOf(name);
    if (sides.a.has(key)) return "a";
    if (sides.b.has(key)) return "b";
    return "";
  };
  if (type === "alliance") {
    for (const member of parties) {
      const side = sideOf(member);
      if (!side) continue;
      for (const partner of parties) {
        if (keyOf(partner) === keyOf(member)) continue;
        add(partner, side);
      }
    }
  } else if (type === "mutual_defense") {
    for (const protectedParty of parties) {
      if (!originalDefenders.has(keyOf(protectedParty))) continue;
      for (const protector of parties) {
        if (keyOf(protector) === keyOf(protectedParty)) continue;
        add(protector, defenderSide);
      }
    }
  } else if (type === "guarantee") {
    const beneficiary = asString(agreement?.beneficiary) || parties[1];
    const guarantor = asString(agreement?.guarantor) || parties[0];
    if (originalDefenders.has(keyOf(beneficiary))) add(guarantor, defenderSide);
  }
  return targets;
};

const compareAgreements = (a, b) =>
  compareText(asString(a?.id), asString(b?.id))
  || compareText(partiesOf(a).join(","), partiesOf(b).join(","));

export const deriveTreatyObligations = ({ wars = [], agreements = [], inadmissible = [] } = {}) => {
  const sortedWars = list(wars)
    .filter((war) => asString(war?.status) === "active")
    .slice()
    .sort((a, b) => compareText(asString(a?.id), asString(b?.id)));
  const sortedAgreements = list(agreements)
    .filter((agreement) =>
      OBLIGATION_AGREEMENT_TYPES.includes(asString(agreement?.type))
      && asString(agreement?.status) === "active")
    .slice()
    .sort(compareAgreements);

  const joins = [];
  const rejections = [];
  const standing = [];
  let truncated = false;
  // A polity the caller bars is never admitted, so it can never become a chain
  // node that drags its own partners in. Filtering the output afterwards would
  // be too late: the fixed point would already have propagated through it.
  const barred = new Set(list(inadmissible).map(keyOf).filter(Boolean));

  for (const war of sortedWars) {
    const warId = asString(war?.id);
    const sides = buildSides(war);
    const aggressorSide = asString(war?.aggressor) === "b" ? "b" : "a";
    const defenderSide = aggressorSide === "a" ? "b" : "a";
    // The victim test reads this snapshot, not the live sides: a polity that
    // joins during the fixed point is a belligerent but not a victim, so a
    // defensive join cannot trigger the next one.
    const originalDefenders = new Set(sides[defenderSide].keys());

    for (const side of ["a", "b"]) {
      const memberKeys = new Set(sides[side].keys());
      for (const agreement of sortedAgreements) {
        // Standing is a descriptive read: reaching its cap stops the rows, never
        // the derivation, so a later war still gets its joins.
        if (standing.length >= MAX_STANDING_OBLIGATIONS) break;
        const type = asString(agreement?.type);
        const relevant = relevantPartiesOf(agreement);
        const onSide = relevant.filter((polity) => memberKeys.has(keyOf(polity)));
        if (onSide.length >= 2) {
          standing.push({
            warId,
            side,
            agreementId: asString(agreement?.id),
            agreementType: type,
            polities: onSide,
          });
        }
      }
    }

    let pass = 0;
    while (pass < MAX_OBLIGATION_PASSES) {
      pass += 1;
      const proposals = [];
      const proposed = new Set();
      const propose = (polity, side, agreementId) => {
        const name = asString(polity);
        const key = keyOf(name);
        if (!key || proposed.has(key)) return;
        proposed.add(key);
        proposals.push({ polity: name, side, agreementId });
      };

      for (const agreement of sortedAgreements) {
        const agreementId = asString(agreement?.id);
        for (const target of obligationTargets(agreement, sides, defenderSide, originalDefenders)) {
          propose(target.polity, target.side, agreementId);
        }
      }

      proposals.sort((a, b) => compareText(keyOf(a.polity), keyOf(b.polity)));
      const applied = [];
      for (const proposal of proposals) {
        const key = keyOf(proposal.polity);
        if (barred.has(key)) continue;
        const other = proposal.side === "a" ? "b" : "a";
        if (sides[proposal.side].has(key)) continue;
        if (sides[other].has(key)) {
          rejections.push({ warId, side: proposal.side, polity: proposal.polity, agreementId: proposal.agreementId, reason: "already-opposed" });
          continue;
        }
        if (sides[proposal.side].size >= MAX_WAR_SIDE) {
          rejections.push({ warId, side: proposal.side, polity: proposal.polity, agreementId: proposal.agreementId, reason: "side-full" });
          continue;
        }
        // Only a proposal that would actually be applied counts against the cap,
        // so a run of no-ops or rejects never flags a truncation.
        if (joins.length + applied.length >= MAX_TREATY_JOINS_PER_STEP) {
          truncated = true;
          break;
        }
        sides[proposal.side].set(key, proposal.polity);
        applied.push({ warId, side: proposal.side, polity: proposal.polity, viaAgreementId: proposal.agreementId });
      }
      joins.push(...applied);
      if (!applied.length || truncated) break;
    }
  }

  return {
    joins,
    standing,
    rejections,
    summary: {
      wars: sortedWars.length,
      joined: joins.length,
      standing: standing.length,
      rejected: rejections.length,
      truncated,
    },
  };
};

// A declared breach is honored only when the named party was actually bound: the
// agreement is active and one of the three obligating types, the party is one of
// its relevant parties, and at least one other relevant party already sits on the
// side it was bound to. Anything else is rejected with a reason and changes
// nothing, so a breach of an agreement that binds no one cannot manufacture a
// cost. The wronged parties are those already on the side the breaker abandoned.
export const deriveTreatyBreaches = ({ wars = [], agreements = [], breaches = [] } = {}) => {
  const sortedWars = list(wars)
    .filter((war) => asString(war?.status) === "active")
    .slice()
    .sort((a, b) => compareText(asString(a?.id), asString(b?.id)));
  const byId = new Map();
  for (const agreement of list(agreements)) {
    if (!OBLIGATION_AGREEMENT_TYPES.includes(asString(agreement?.type))) continue;
    byId.set(asString(agreement?.id), agreement);
  }

  // A total order over declarations: dedupe first, then sort, so the accepted
  // set and the cap cannot depend on how the model wrote the list.
  const declared = [];
  const seen = new Set();
  for (const entry of list(breaches)) {
    const agreementId = asString(entry?.agreementId);
    const polity = asString(entry?.polity);
    const key = keyOf(agreementId) + "\u0000" + keyOf(polity);
    if (!agreementId || !polity || seen.has(key)) continue;
    seen.add(key);
    declared.push({ agreementId, polity });
  }
  declared.sort((a, b) => compareText(a.agreementId, b.agreementId) || comparePolity(a.polity, b.polity));

  const accepted = [];
  const rejected = [];
  for (const declaration of declared) {
    const agreement = byId.get(declaration.agreementId) || null;
    if (!agreement) {
      rejected.push({ ...declaration, reason: "agreement-missing" });
      continue;
    }
    if (asString(agreement?.status) !== "active") {
      rejected.push({ ...declaration, reason: "agreement-inactive" });
      continue;
    }
    const relevant = relevantPartiesOf(agreement);
    if (!relevant.some((polity) => keyOf(polity) === keyOf(declaration.polity))) {
      rejected.push({ ...declaration, reason: "not-a-party" });
      continue;
    }
    const warIds = [];
    const wronged = [];
    for (const war of sortedWars) {
      const sides = buildSides(war);
      const aggressorSide = asString(war?.aggressor) === "b" ? "b" : "a";
      const defenderSide = aggressorSide === "a" ? "b" : "a";
      const originalDefenders = new Set(sides[defenderSide].keys());
      const target = obligationTargets(agreement, sides, defenderSide, originalDefenders)
        .find((candidate) => keyOf(candidate.polity) === keyOf(declaration.polity));
      if (!target) continue;
      const relying = relevant.filter((polity) =>
        keyOf(polity) !== keyOf(declaration.polity) && sides[target.side].has(keyOf(polity)));
      if (!relying.length) continue;
      warIds.push(asString(war?.id));
      for (const polity of relying) {
        if (!wronged.some((name) => keyOf(name) === keyOf(polity))) wronged.push(polity);
      }
    }
    if (!warIds.length) {
      rejected.push({ ...declaration, reason: "no-active-obligation" });
      continue;
    }
    accepted.push({
      agreementId: declaration.agreementId,
      agreementType: asString(agreement?.type),
      polity: declaration.polity,
      warIds,
      wrongedPolities: wronged.slice().sort(comparePolity),
    });
  }

  const kept = accepted.slice(0, MAX_TREATY_BREACHES_PER_TURN);
  for (const overflow of accepted.slice(MAX_TREATY_BREACHES_PER_TURN)) {
    rejected.push({ agreementId: overflow.agreementId, polity: overflow.polity, reason: "cap-reached" });
  }

  return {
    breaches: kept,
    rejected,
    summary: { declared: declared.length, accepted: kept.length, rejected: rejected.length },
  };
};
