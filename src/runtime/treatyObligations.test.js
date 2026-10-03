// Run: node --test src/runtime/treatyObligations.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyTreatyJoins,
  buildTreatyObligationDigest,
  readTreatyObligations,
} from "./treatyObligations.js";
import { OBLIGATION_AGREEMENT_TYPES } from "../engine/treatyObligations.js";
import { normalizeWorldState } from "./gameState.js";

const world = (over = {}) => normalizeWorldState({
  polityOverrides: {
    France: { code: "France" },
    Germany: { code: "Germany" },
    Russia: { code: "Russia" },
    Italy: { code: "Italy" },
  },
  ...over,
});

test("the adapter reads an alliance out of the stored world", () => {
  const stored = world({
    wars: [{ id: "w1", status: "active", aggressor: "a", sideA: ["Germany"], sideB: ["France"], startedDate: "1914-08-03" }],
    agreements: [{ id: "central", type: "alliance", status: "active", parties: ["Germany", "Italy"] }],
  });
  const out = readTreatyObligations(stored, { playerPolity: "France" });
  assert.deepEqual(out.joins, [{ warId: "w1", side: "a", polity: "Italy", viaAgreementId: "central" }]);
});

test("the adapter never joins the player's own polity", () => {
  const stored = world({
    wars: [{ id: "w1", status: "active", aggressor: "a", sideA: ["Germany"], sideB: ["France"], startedDate: "1914-08-03" }],
    agreements: [{ id: "central", type: "alliance", status: "active", parties: ["Germany", "Italy"] }],
  });
  const out = readTreatyObligations(stored, { playerPolity: "Italy" });
  assert.deepEqual(out.joins, []);
  assert.equal(out.summary.joined, 0);
});

test("a withheld player join propagates nothing to a third party", () => {
  // P is allied to belligerent A and to neutral D. The player's own join is
  // withheld, and because P is never a chain node, D is not dragged in either.
  const stored = normalizeWorldState({
    polityOverrides: {
      P: { code: "P" },
      A: { code: "A" },
      B: { code: "B" },
      D: { code: "D" },
    },
    wars: [{ id: "war-a-b", status: "active", aggressor: "a", sideA: ["A"], sideB: ["B"], startedDate: "1914-08-03" }],
    agreements: [
      { id: "ag-p-a", type: "alliance", status: "active", parties: ["P", "A"] },
      { id: "ag-p-d", type: "alliance", status: "active", parties: ["P", "D"] },
    ],
  });
  const out = readTreatyObligations(stored, { playerPolity: "P" });
  assert.deepEqual(out.joins, []);
  assert.equal(out.summary.joined, 0);
});

test("applyTreatyJoins grows the named side and stamps the date and round", () => {
  const stored = world({
    wars: [{ id: "w1", status: "active", aggressor: "a", sideA: ["Germany"], sideB: ["France"], startedDate: "1914-08-03" }],
  });
  const next = applyTreatyJoins(stored, [{ warId: "w1", side: "a", polity: "Italy" }], { date: "1914-08-10", round: 3 });
  assert.deepEqual(next.wars[0].sideA, ["Germany", "Italy"]);
  assert.equal(next.wars[0].lastUpdatedDate, "1914-08-10");
  assert.equal(next.wars[0].updatedRound, 3);
  assert.equal(applyTreatyJoins(stored, [], { date: "1914-08-10", round: 3 }), stored, "a quiet turn copies nothing");
});

test("the digest orders rows, caps them and reports the overflow", () => {
  const standing = Array.from({ length: 8 }, (_, i) => ({
    warId: "w1",
    side: "a",
    agreementId: `a${i}`,
    agreementType: "alliance",
    polities: ["Germany", "Italy"],
  }));
  // A generous character cap here, so this test pins the ROW cap and the
  // overflow line; the character clamp is exercised by the runtime default.
  const block = buildTreatyObligationDigest({ standing, cap: 6, charCap: 1000 });
  assert.match(block, /^\[Treaty Obligations, as simulated\]/);
  assert.equal(block.split("\n").length, 8, "a header, six rows and one overflow line");
  assert.match(block, /\+2 more\./);
  assert.equal(buildTreatyObligationDigest({ standing: [] }), "");
  assert.equal(
    buildTreatyObligationDigest({ standing, cap: 6, charCap: 60 }),
    "[Treaty Obligations, as simulated]\n+2 more.",
    "the character cap drops whole rows on a line boundary",
  );
});

test("every obligating type is one the world normalizer recognizes", () => {
  for (const type of OBLIGATION_AGREEMENT_TYPES) {
    const stored = world({ agreements: [{ id: "x", type, parties: ["Germany", "Italy"] }] });
    assert.equal(stored.agreements[0].type, type, `${type} is not a world agreement type`);
  }
});

test("the adapter imports no Game/AI module", () => {
  const source = readFileSync(new URL("./treatyObligations.js", import.meta.url), "utf8");
  const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(specifiers.some((specifier) => specifier.includes("Game/AI")), false);
});
