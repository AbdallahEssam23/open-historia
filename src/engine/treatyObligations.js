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
    const sides = { a: new Map(), b: new Map() };
    for (const polity of uniqueByKey(list(war?.sideA))) sides.a.set(keyOf(polity), polity);
    for (const polity of uniqueByKey(list(war?.sideB))) {
      const key = keyOf(polity);
      if (!sides.a.has(key)) sides.b.set(key, polity);
    }
    const aggressorSide = asString(war?.aggressor) === "b" ? "b" : "a";
    const defenderSide = aggressorSide === "a" ? "b" : "a";
    // The victim test reads this snapshot, not the live sides: a polity that
    // joins during the fixed point is a belligerent but not a victim, so a
    // defensive join cannot trigger the next one.
    const originalDefenders = new Set(sides[defenderSide].keys());
    const sideOf = (polity) => {
      const key = keyOf(polity);
      if (!key) return "";
      if (sides.a.has(key)) return "a";
      if (sides.b.has(key)) return "b";
      return "";
    };

    for (const side of ["a", "b"]) {
      const memberKeys = new Set(sides[side].keys());
      for (const agreement of sortedAgreements) {
        // Standing is a descriptive read: reaching its cap stops the rows, never
        // the derivation, so a later war still gets its joins.
        if (standing.length >= MAX_STANDING_OBLIGATIONS) break;
        const type = asString(agreement?.type);
        const parties = partiesOf(agreement);
        const relevant = type === "guarantee"
          ? uniqueByKey([asString(agreement?.guarantor) || parties[0], asString(agreement?.beneficiary) || parties[1]])
          : parties;
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
        const type = asString(agreement?.type);
        const parties = partiesOf(agreement);
        if (type === "alliance") {
          for (const member of parties) {
            const side = sideOf(member);
            if (!side) continue;
            for (const partner of parties) {
              if (keyOf(partner) === keyOf(member)) continue;
              propose(partner, side, agreementId);
            }
          }
        } else if (type === "mutual_defense") {
          for (const protectedParty of parties) {
            if (!originalDefenders.has(keyOf(protectedParty))) continue;
            for (const protector of parties) {
              if (keyOf(protector) === keyOf(protectedParty)) continue;
              propose(protector, defenderSide, agreementId);
            }
          }
        } else if (type === "guarantee") {
          const beneficiary = asString(agreement?.beneficiary) || parties[1];
          const guarantor = asString(agreement?.guarantor) || parties[0];
          if (originalDefenders.has(keyOf(beneficiary))) propose(guarantor, defenderSide, agreementId);
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
