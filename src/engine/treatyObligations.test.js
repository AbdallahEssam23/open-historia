// Run: node --test src/engine/treatyObligations.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_OBLIGATION_PASSES,
  MAX_TREATY_BREACHES_PER_TURN,
  MAX_TREATY_JOINS_PER_STEP,
  MAX_WAR_SIDE,
  deriveTreatyBreaches,
  deriveTreatyObligations,
} from "./treatyObligations.js";

const war = (over = {}) => ({
  id: "w1",
  status: "active",
  aggressor: "a",
  sideA: ["A"],
  sideB: ["B"],
  ...over,
});

const agreement = (over = {}) => ({
  id: "a1",
  type: "alliance",
  status: "active",
  parties: ["A", "C"],
  ...over,
});

test("an alliance drags a partner onto the fighting partner's aggressor side", () => {
  const out = deriveTreatyObligations({ wars: [war()], agreements: [agreement()] });
  assert.deepEqual(out.joins, [{ warId: "w1", side: "a", polity: "C", viaAgreementId: "a1" }]);
  assert.equal(out.summary.joined, 1);
});

test("an alliance whose fighting partner is the victim joins the defender side", () => {
  const out = deriveTreatyObligations({
    wars: [war()],
    agreements: [agreement({ parties: ["B", "C"] })],
  });
  assert.deepEqual(out.joins, [{ warId: "w1", side: "b", polity: "C", viaAgreementId: "a1" }]);
});

test("a mutual defense joins only when the protected party was attacked", () => {
  const defender = deriveTreatyObligations({
    wars: [war()],
    agreements: [agreement({ type: "mutual_defense", parties: ["B", "C"] })],
  });
  assert.deepEqual(defender.joins, [{ warId: "w1", side: "b", polity: "C", viaAgreementId: "a1" }]);

  const aggressor = deriveTreatyObligations({
    wars: [war()],
    agreements: [agreement({ type: "mutual_defense", parties: ["A", "C"] })],
  });
  assert.deepEqual(aggressor.joins, [], "a mutual defense does not pull anyone to the aggressor");
});

test("a guarantee pulls the guarantor to the beneficiary's defender side only", () => {
  const helps = deriveTreatyObligations({
    wars: [war()],
    agreements: [agreement({ type: "guarantee", parties: ["B", "G"], guarantor: "G", beneficiary: "B" })],
  });
  assert.deepEqual(helps.joins, [{ warId: "w1", side: "b", polity: "G", viaAgreementId: "a1" }]);

  const selfMade = deriveTreatyObligations({
    wars: [war()],
    agreements: [agreement({ type: "guarantee", parties: ["A", "G"], guarantor: "G", beneficiary: "A" })],
  });
  assert.deepEqual(selfMade.joins, [], "a guarantee does not pull the guarantor to an aggressor");
});

test("alliances chain to a fixed point; a defensive join never propagates defense", () => {
  const chained = deriveTreatyObligations({
    wars: [war()],
    agreements: [
      agreement({ id: "a1", parties: ["A", "C"] }),
      agreement({ id: "a2", parties: ["C", "D"] }),
    ],
  });
  assert.deepEqual(chained.joins.map((join) => join.polity), ["C", "D"]);

  const defensive = deriveTreatyObligations({
    wars: [war()],
    agreements: [
      agreement({ id: "a1", type: "mutual_defense", parties: ["B", "C"] }),
      agreement({ id: "a2", type: "mutual_defense", parties: ["C", "D"] }),
    ],
  });
  assert.deepEqual(defensive.joins.map((join) => join.polity), ["C"], "a defensive join must not become a new victim");
});

test("a party on the opposing side is rejected, and a party already on the side is a no-op", () => {
  const opposed = deriveTreatyObligations({
    wars: [war()],
    agreements: [agreement({ parties: ["A", "B"] })],
  });
  assert.deepEqual(opposed.joins, []);
  assert.deepEqual(
    opposed.rejections.map((row) => [row.polity, row.side, row.reason]),
    [["A", "b", "already-opposed"], ["B", "a", "already-opposed"]],
  );

  const honored = deriveTreatyObligations({
    wars: [war({ sideA: ["A", "C"] })],
    agreements: [agreement({ parties: ["A", "C", "D"] })],
  });
  assert.deepEqual(honored.rejections, []);
  assert.deepEqual(honored.joins.map((join) => join.polity), ["D"]);
});

test("a side at the cap rejects the next join with side-full", () => {
  const fill = Array.from({ length: MAX_WAR_SIDE - 1 }, (_, i) => `S${i}`);
  const out = deriveTreatyObligations({
    wars: [war({ sideA: ["A", ...fill] })],
    agreements: [agreement({ parties: ["A", "C"] })],
  });
  assert.deepEqual(out.joins, []);
  assert.deepEqual(out.rejections, [{ warId: "w1", side: "a", polity: "C", agreementId: "a1", reason: "side-full" }]);
});

test("the per-step join cap truncates the derivation and reports it", () => {
  const wars = [1, 2, 3].map((n) => war({ id: `w${n}`, sideA: [`A${n}`], sideB: [`B${n}`] }));
  const agreements = wars.map((w, index) => agreement({
    id: `a${index + 1}`,
    parties: [w.sideA[0], ...Array.from({ length: 12 }, (_, i) => `P${index}-${i}`)],
  }));
  const out = deriveTreatyObligations({ wars, agreements });
  assert.equal(out.joins.length, MAX_TREATY_JOINS_PER_STEP);
  assert.equal(out.summary.truncated, true);
});

test("the pass cap bounds an alliance chain", () => {
  const agreements = [];
  let previous = "A";
  for (let i = 1; i <= 9; i += 1) {
    const next = `C${i}`;
    agreements.push(agreement({ id: `a${i}`, parties: [previous, next] }));
    previous = next;
  }
  const out = deriveTreatyObligations({ wars: [war()], agreements });
  assert.equal(out.joins.length, MAX_OBLIGATION_PASSES);
  assert.equal(out.joins.some((join) => join.polity === "C9"), false);
});

test("a ceasefire war and a suspended agreement bind no one", () => {
  const cease = deriveTreatyObligations({ wars: [war({ status: "ceasefire" })], agreements: [agreement()] });
  assert.deepEqual(cease.joins, []);
  assert.equal(cease.summary.wars, 0);

  const suspended = deriveTreatyObligations({ wars: [war()], agreements: [agreement({ status: "suspended" })] });
  assert.deepEqual(suspended.joins, []);
});

test("standing reports the agreement links the world already realizes", () => {
  const out = deriveTreatyObligations({
    wars: [war({ sideA: ["A", "C"] })],
    agreements: [agreement({ parties: ["A", "C"] })],
  });
  assert.deepEqual(out.standing, [
    { warId: "w1", side: "a", agreementId: "a1", agreementType: "alliance", polities: ["A", "C"] },
  ]);
  assert.deepEqual(out.joins, [], "an honored alliance proposes nobody new");
});

test("reordering wars, agreements and parties never changes the result", () => {
  const wars = [war({ id: "w1" }), war({ id: "w2", sideA: ["A2"], sideB: ["B2"] })];
  const agreements = [
    agreement({ id: "a1", parties: ["A", "C"] }),
    agreement({ id: "a2", type: "guarantee", parties: ["B2", "G2"], guarantor: "G2", beneficiary: "B2" }),
  ];
  const first = deriveTreatyObligations({ wars, agreements });
  const second = deriveTreatyObligations({
    wars: [...wars].reverse(),
    agreements: [...agreements].reverse().map((entry) => ({ ...entry, parties: [...entry.parties].reverse() })),
  });
  assert.deepEqual(second, first);
});

test("reaching the standing cap never abandons the derivation", () => {
  const honored = Array.from({ length: 140 }, (_, i) => ({
    id: `h${String(i).padStart(3, "0")}`,
    type: "alliance",
    status: "active",
    parties: ["A", "B"],
  }));
  const out = deriveTreatyObligations({
    wars: [
      { id: "w1", status: "active", aggressor: "a", sideA: ["A", "B"], sideB: ["Z"] },
      { id: "w2", status: "active", aggressor: "a", sideA: ["A2"], sideB: ["B2"] },
    ],
    agreements: [...honored, { id: "drag", type: "alliance", status: "active", parties: ["A2", "C2"] }],
  });
  assert.equal(out.standing.length, 128, "standing is bounded");
  assert.deepEqual(out.joins, [{ warId: "w2", side: "a", polity: "C2", viaAgreementId: "drag" }]);
});

test("an inadmissible polity is never added and never drags its allies", () => {
  // C is allied to belligerent A and to neutral D. If C were admitted it would
  // become a chain node and pull D in. Barring C must leave D out entirely.
  const out = deriveTreatyObligations({
    wars: [war()],
    agreements: [
      agreement({ id: "a1", parties: ["A", "C"] }),
      agreement({ id: "a2", parties: ["C", "D"] }),
    ],
    inadmissible: ["C"],
  });
  assert.deepEqual(out.joins, []);
  assert.deepEqual(out.rejections, [], "a barred proposal is not recorded as a rejection");
});

test("an inadmissible polity already on a side still drags its alliance partners", () => {
  // C is the player and already a belligerent on side A. A war the player is in
  // is not skipped: another power's obligation to enter still fires.
  const out = deriveTreatyObligations({
    wars: [war({ sideA: ["A", "C"] })],
    agreements: [agreement({ parties: ["C", "D"] })],
    inadmissible: ["C"],
  });
  assert.deepEqual(out.joins, [{ warId: "w1", side: "a", polity: "D", viaAgreementId: "a1" }]);
});

test("an alliance breach is accepted and names the fighting partner as wronged", () => {
  const out = deriveTreatyBreaches({
    wars: [war()],
    agreements: [agreement({ parties: ["A", "C"] })],
    breaches: [{ agreementId: "a1", polity: "C" }],
  });
  assert.deepEqual(out.breaches, [
    { agreementId: "a1", agreementType: "alliance", polity: "C", warIds: ["w1"], wrongedPolities: ["A"] },
  ]);
  assert.deepEqual(out.rejected, []);
  assert.equal(out.summary.accepted, 1);
});

test("a breach of an agreement that binds no one is rejected no-active-obligation", () => {
  // Z and C are both parties, but neither is on a war side, so the alliance
  // binds C to nothing: there is no join for the breach to block.
  const out = deriveTreatyBreaches({
    wars: [war()],
    agreements: [agreement({ id: "a1", type: "alliance", parties: ["Z", "C"] })],
    breaches: [{ agreementId: "a1", polity: "C" }],
  });
  assert.deepEqual(out.breaches, []);
  assert.deepEqual(out.rejected, [{ agreementId: "a1", polity: "C", reason: "no-active-obligation" }]);
});

test("a breached agreement binds no one in the join derivation", () => {
  // The pre-pass marks the pact breached before the obligation step reads it:
  // the same pact that would have drawn C in now draws nobody.
  const out = deriveTreatyObligations({
    wars: [war()],
    agreements: [agreement({ status: "breached" })],
  });
  assert.deepEqual(out.joins, []);
});

test("a mutual defense breach is accepted only for the victim's protector", () => {
  const defense = deriveTreatyBreaches({
    wars: [war()],
    agreements: [agreement({ type: "mutual_defense", parties: ["B", "C"] })],
    breaches: [{ agreementId: "a1", polity: "C" }],
  });
  assert.deepEqual(defense.breaches, [
    { agreementId: "a1", agreementType: "mutual_defense", polity: "C", warIds: ["w1"], wrongedPolities: ["B"] },
  ]);

  // The aggressor's protector is not a victim, so it has nothing to refuse.
  const aggressor = deriveTreatyBreaches({
    wars: [war()],
    agreements: [agreement({ type: "mutual_defense", parties: ["A", "C"] })],
    breaches: [{ agreementId: "a1", polity: "C" }],
  });
  assert.deepEqual(aggressor.breaches, []);
  assert.deepEqual(aggressor.rejected, [{ agreementId: "a1", polity: "C", reason: "no-active-obligation" }]);
});

test("a guarantee breach names the beneficiary as wronged", () => {
  const out = deriveTreatyBreaches({
    wars: [war()],
    agreements: [agreement({ type: "guarantee", parties: ["B", "G"], guarantor: "G", beneficiary: "B" })],
    breaches: [{ agreementId: "a1", polity: "G" }],
  });
  assert.deepEqual(out.breaches, [
    { agreementId: "a1", agreementType: "guarantee", polity: "G", warIds: ["w1"], wrongedPolities: ["B"] },
  ]);
});

test("a breach with a missing, inactive, or non-party target is rejected", () => {
  const missing = deriveTreatyBreaches({
    wars: [war()],
    agreements: [],
    breaches: [{ agreementId: "a1", polity: "C" }],
  });
  assert.deepEqual(missing.rejected, [{ agreementId: "a1", polity: "C", reason: "agreement-missing" }]);

  const inactive = deriveTreatyBreaches({
    wars: [war()],
    agreements: [agreement({ status: "suspended" })],
    breaches: [{ agreementId: "a1", polity: "C" }],
  });
  assert.deepEqual(inactive.rejected, [{ agreementId: "a1", polity: "C", reason: "agreement-inactive" }]);

  const stranger = deriveTreatyBreaches({
    wars: [war()],
    agreements: [agreement({ parties: ["A", "C"] })],
    breaches: [{ agreementId: "a1", polity: "Z" }],
  });
  assert.deepEqual(stranger.rejected, [{ agreementId: "a1", polity: "Z", reason: "not-a-party" }]);

  const nonObligating = deriveTreatyBreaches({
    wars: [war()],
    agreements: [agreement({ type: "trade_economic", parties: ["A", "C"] })],
    breaches: [{ agreementId: "a1", polity: "C" }],
  });
  assert.deepEqual(nonObligating.rejected, [{ agreementId: "a1", polity: "C", reason: "agreement-missing" }]);
});

test("the per-turn breach cap accepts the limit and rejects the rest cap-reached", () => {
  const wars = [war()];
  const agreements = Array.from({ length: MAX_TREATY_BREACHES_PER_TURN + 2 }, (_, i) => agreement({
    id: `a${String(i).padStart(3, "0")}`,
    parties: ["A", `C${i}`],
  }));
  const breaches = agreements.map((entry) => ({ agreementId: entry.id, polity: entry.parties[1] }));
  const out = deriveTreatyBreaches({ wars, agreements, breaches });
  assert.equal(out.breaches.length, MAX_TREATY_BREACHES_PER_TURN);
  assert.equal(out.rejected.length, 2);
  assert.ok(out.rejected.every((row) => row.reason === "cap-reached"));
});

test("reordering breaches, wars and agreements never changes the breach result", () => {
  const wars = [war({ id: "w1" }), war({ id: "w2", sideA: ["A2"], sideB: ["B2"] })];
  const agreements = [
    agreement({ id: "a1", parties: ["A", "C"] }),
    agreement({ id: "a2", parties: ["A2", "C2"] }),
  ];
  const breaches = [
    { agreementId: "a2", polity: "C2" },
    { agreementId: "a1", polity: "C" },
  ];
  const first = deriveTreatyBreaches({ wars, agreements, breaches });
  const second = deriveTreatyBreaches({
    wars: [...wars].reverse(),
    agreements: [...agreements].reverse().map((entry) => ({ ...entry, parties: [...entry.parties].reverse() })),
    breaches: [...breaches].reverse(),
  });
  assert.deepEqual(second, first);
});
