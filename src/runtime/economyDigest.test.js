import test from "node:test";
import assert from "node:assert/strict";

import { DIGEST_CHAR_CAP, buildEconomyDigest } from "./economyDigest.js";

const delta = (polity, over = {}) => ({
  polity,
  gdpGrowth: 0.9,
  inflation: 4.1,
  unemployment: 6.8,
  publicDebt: 93,
  budgetBalance: -3.2,
  estimated: false,
  ...over,
});

test("an empty input produces an empty digest, so the prompt is unchanged", () => {
  assert.equal(buildEconomyDigest({ deltas: [] }), "");
  assert.equal(buildEconomyDigest({}), "");
});

test("the player's line leads and is always kept", () => {
  const text = buildEconomyDigest({
    deltas: [delta("France"), delta("Arab Republic of Egypt"), delta("Germany")],
    playerPolity: "Arab Republic of Egypt",
    tracked: ["France", "Germany"],
  });
  const lines = text.split("\n").filter((line) => line.startsWith("- "));
  assert.ok(lines[0].includes("Arab Republic of Egypt"));
  assert.ok(text.includes("France"));
});

test("it is capped, and the cap drops a whole line rather than a sentence", () => {
  const deltas = Array.from({ length: 40 }, (_, i) => delta(`Polity ${i}`));
  const text = buildEconomyDigest({ deltas, playerPolity: "Polity 0", tracked: deltas.map((d) => d.polity) });
  assert.ok(text.length <= DIGEST_CHAR_CAP, `got ${text.length}`);
  assert.ok(text.includes("Polity 0"));
  assert.equal(text.includes("..."), false, "no truncated sentence");
});

test("an uncalibrated polity says so", () => {
  const text = buildEconomyDigest({ deltas: [delta("Chad", { estimated: true })], playerPolity: "Chad" });
  assert.ok(/estimated/i.test(text), text);
});

test("a running shock is named with the months it has left", () => {
  const text = buildEconomyDigest({
    deltas: [delta("Egypt")],
    playerPolity: "Egypt",
    shocks: [{ kind: "sanctions", severity: 2, monthsLeft: 4 }],
  });
  assert.ok(text.includes("sanctions"));
  assert.ok(text.includes("4"));
});

test("the same input always renders the same text", () => {
  const args = { deltas: [delta("Egypt"), delta("France")], playerPolity: "Egypt", tracked: ["France"] };
  assert.equal(buildEconomyDigest(args), buildEconomyDigest(args));
});

test("the player pool line appears when the engine produced pools", () => {
  const text = buildEconomyDigest({
    deltas: [delta("Egypt")],
    playerPolity: "Egypt",
    playerPools: { manpower: 1_240_000, materiel: 318.4 },
    playerPosture: "peacetime",
  });
  assert.match(text, /Your reserves: manpower 1,240,000, materiel 318\.40\./);
  assert.match(text, /Mobilization: peacetime\./);
});

test("without pools the digest is byte-identical to the economy-only digest", () => {
  // The pre-pools output, pinned byte-for-byte: no stray separator or blank line.
  const expected = "Economy this period, computed locally (treat these as fact, do not restate them with different numbers):\n"
    + "- Egypt (yours): output +0.9%, inflation 4.1%, unemployment 6.8%, public debt 93% of output, budget -3.2%.";
  const without = buildEconomyDigest({ deltas: [delta("Egypt")], playerPolity: "Egypt" });
  const explicitNull = buildEconomyDigest({ deltas: [delta("Egypt")], playerPolity: "Egypt", playerPools: null });
  assert.equal(without, expected);
  assert.equal(without, explicitNull);
  assert.doesNotMatch(without, /\n\n/);
  assert.notEqual(without[0], "\n");
  assert.notEqual(without[without.length - 1], "\n");
});

test("an empty delta list still reports the reserves and mobilization line", () => {
  const text = buildEconomyDigest({
    deltas: [],
    playerPolity: "Egypt",
    playerPools: { manpower: 800, materiel: 12.5 },
    playerPosture: "total",
  });
  assert.match(text, /Your reserves: manpower 800, materiel 12\.50\./);
  assert.match(text, /Mobilization: total\./);
});

test("the pool line survives when the only economy line is too long to fit", () => {
  const text = buildEconomyDigest({
    deltas: [delta("x".repeat(DIGEST_CHAR_CAP))],
    playerPolity: "Egypt",
    playerPools: { manpower: 10, materiel: 1 },
    playerPosture: "peacetime",
  });
  assert.equal(text, "Your reserves: manpower 10, materiel 1.00. Mobilization: peacetime.");
  assert.equal(text.includes("Economy this period"), false);
});

test("a posture changed this period is named", () => {
  const text = buildEconomyDigest({
    deltas: [delta("Egypt")],
    playerPolity: "Egypt",
    playerPools: { manpower: 10, materiel: 1 },
    playerPosture: "total",
    postureChanged: true,
  });
  assert.match(text, /Mobilization: total \(changed this period\)\./);
});
