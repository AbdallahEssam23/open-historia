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
