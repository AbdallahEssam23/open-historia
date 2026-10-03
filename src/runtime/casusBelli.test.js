// Run: node --test src/runtime/casusBelli.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyWarCasus,
  buildWarCasusDigest,
  readRecordedUnjustWars,
  readWarCasus,
} from "./casusBelli.js";
import { normalizeWorldState } from "./gameState.js";

const world = (over = {}) => normalizeWorldState({
  polityOverrides: {
    France: { code: "France" },
    Germany: { code: "Germany" },
    Italy: { code: "Italy" },
    Ethiopia: { code: "Ethiopia" },
  },
  ...over,
});

const catalog = [
  { id: "alsace", name: "Alsace", country: "Germany" },
  { id: "eritrea", name: "Eritrea", country: "Ethiopia" },
];

test("a claim on a defender's region is a just cause read from the world", () => {
  const stored = world({
    regionClaimants: { alsace: ["France"] },
    regionOwnershipOverrides: { alsace: "Germany" },
    wars: [{ id: "w1", status: "active", aggressor: "a", sideA: ["France"], sideB: ["Germany"], startedDate: "1914-08-03" }],
  });
  const out = readWarCasus(stored, {
    starts: [{ warId: "w1", aggressors: ["France"], defenders: ["Germany"] }],
    catalog,
  });
  assert.deepEqual(out.wars, [{
    warId: "w1",
    aggressors: [{ polity: "France", justified: true, kind: "claim", target: "alsace" }],
    wronged: ["Germany"],
  }]);
  assert.deepEqual(out.summary, { judged: 1, justified: 1, unjust: 0 });
});

test("a recorded breach by the defender is a just cause read from the world", () => {
  const stored = world({
    agreements: [{ id: "pact", type: "alliance", status: "breached", parties: ["Germany", "France"], breachedBy: "Germany" }],
    wars: [{ id: "w1", status: "active", aggressor: "a", sideA: ["France"], sideB: ["Germany"], startedDate: "1914-08-03" }],
  });
  const out = readWarCasus(stored, {
    starts: [{ warId: "w1", aggressors: ["France"], defenders: ["Germany"] }],
    catalog,
  });
  assert.deepEqual(out.wars[0].aggressors, [{ polity: "France", justified: true, kind: "breach", target: "pact" }]);
});

test("a start whose war is missing or inactive is dropped with a reason", () => {
  const stored = world({
    wars: [{ id: "w2", status: "ended", sideA: ["France"], sideB: ["Germany"], startedDate: "1914-08-03" }],
  });
  const out = readWarCasus(stored, {
    starts: [
      { warId: "nope", aggressors: ["France"], defenders: ["Germany"] },
      { warId: "w2", aggressors: ["France"], defenders: ["Germany"] },
    ],
    catalog,
  });
  assert.deepEqual(out.rejected, [
    { warId: "nope", reason: "war-missing" },
    { warId: "w2", reason: "war-inactive" },
  ]);
  assert.deepEqual(out.wars, []);
});

test("an unjust war is charged and marked", () => {
  const stored = world({
    internationalReputation: { Italy: 50 },
    wars: [{ id: "w1", status: "active", aggressor: "a", sideA: ["Italy"], sideB: ["Ethiopia"], startedDate: "1935-10-03" }],
  });
  const next = applyWarCasus(stored, [{
    warId: "w1",
    aggressors: [{ polity: "Italy", justified: false, kind: "", target: "" }],
    wronged: ["Ethiopia"],
  }], { date: "1935-10-03", round: 1 });

  assert.equal(next.internationalReputation.Italy, 35);
  const relation = next.relations.find((entry) =>
    (entry.a === "Italy" && entry.b === "Ethiopia") || (entry.a === "Ethiopia" && entry.b === "Italy"));
  assert.ok(relation, "an unjust war leaves a relation with the wronged");
  assert.equal(relation.score, -25);
  assert.equal(relation.summary, "Italy began an unjust war on Ethiopia.");
  const war = next.wars.find((entry) => entry.id === "w1");
  assert.deepEqual(war.unjustAggressors, ["Italy"]);
});

test("a fully justified war is neither charged nor marked", () => {
  const stored = world({
    wars: [{ id: "w1", status: "active", aggressor: "a", sideA: ["Italy"], sideB: ["Ethiopia"], startedDate: "1935-10-03" }],
  });
  const next = applyWarCasus(stored, [{
    warId: "w1",
    aggressors: [{ polity: "Italy", justified: true, kind: "claim", target: "eritrea" }],
    wronged: ["Ethiopia"],
  }]);
  assert.equal(next, stored);
});

test("readRecordedUnjustWars names each unjust aggressor", () => {
  const stored = world({
    wars: [{
      id: "w1",
      status: "active",
      aggressor: "a",
      sideA: ["Italy"],
      sideB: ["Ethiopia"],
      startedDate: "1935-10-03",
      unjustAggressors: ["Italy"],
    }],
  });
  assert.deepEqual(readRecordedUnjustWars(stored), [{ warId: "w1", aggressor: "Italy", wronged: ["Ethiopia"] }]);
});

test("the digest orders rows, caps them and reports the overflow", () => {
  const wars = Array.from({ length: 8 }, (_, i) => ({
    warId: `w${i}`,
    aggressor: "Italy",
    wronged: ["Ethiopia"],
  }));
  const block = buildWarCasusDigest({ wars, cap: 6, charCap: 1000 });
  assert.match(block, /^\[Wars Begun Without Just Cause, as simulated\]/);
  assert.equal(block.split("\n").length, 8, "a header, six rows and one overflow line");
  assert.match(block, /\+2 more\./);
  assert.equal(buildWarCasusDigest({ wars: [] }), "");
});

test("the digest a jump builds from the recorded wars is not empty", () => {
  const stored = world({
    wars: [{
      id: "war-ethiopia-1935",
      status: "active",
      aggressor: "a",
      sideA: ["Italy"],
      sideB: ["Ethiopia"],
      startedDate: "1935-10-03",
      unjustAggressors: ["Italy"],
    }],
  });
  // The jump wires readRecordedUnjustWars straight into buildWarCasusDigest;
  // this bridges the two shapes so a silent empty block cannot slip through.
  const block = buildWarCasusDigest({ wars: readRecordedUnjustWars(stored) });
  assert.match(block, /^\[Wars Begun Without Just Cause, as simulated\]/);
  assert.match(block, /- Italy began war-ethiopia-1935 without just cause; wronged Ethiopia\./);
});

test("a claim on a region the caller's catalog omits still reads its override owner", () => {
  const stored = world({
    regionClaimants: { alsace: ["France"] },
    regionOwnershipOverrides: { alsace: "Germany" },
    wars: [{ id: "w1", status: "active", aggressor: "a", sideA: ["France"], sideB: ["Germany"], startedDate: "1914-08-03" }],
  });
  const out = readWarCasus(stored, {
    starts: [{ warId: "w1", aggressors: ["France"], defenders: ["Germany"] }],
    catalog: [],
  });
  assert.deepEqual(out.wars[0].aggressors, [{ polity: "France", justified: true, kind: "claim", target: "alsace" }]);
});
