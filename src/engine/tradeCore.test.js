import test from "node:test";
import assert from "node:assert/strict";

import { TRADE_STEP } from "./economyConstants.js";
import { tradeMultipliers } from "./tradeCore.js";

const relation = (a, b, score) => ({ a, b, score });
const war = (sideA, sideB, status = "active") => ({ status, sideA, sideB });
const pact = (type, parties, status = "active") => ({ type, parties, status });

test("no diplomatic data yields an empty field", () => {
  assert.deepEqual(tradeMultipliers({}), {});
  assert.deepEqual(tradeMultipliers(), {});
});

test("a neutral relation is absent, not a zero entry", () => {
  assert.deepEqual(tradeMultipliers({ relations: [relation("A", "B", 0)] }), {});
});

test("a warm relation lifts gdp and stability, and a cold one drags them", () => {
  const warm = tradeMultipliers({ relations: [relation("A", "B", 50)] });
  assert.equal(warm.A.gdp, 1 + TRADE_STEP.GDP_MAX * 0.5);
  assert.equal(warm.A.stability, TRADE_STEP.STABILITY_MAX * 0.5);
  assert.equal(warm.B.gdp, warm.A.gdp);
  const cold = tradeMultipliers({ relations: [relation("A", "B", -50)] });
  assert.ok(cold.A.gdp < 1);
  assert.ok(cold.A.stability < 0);
});

test("a mean, not a sum: partners at +0.5 and -1.0 give -0.25", () => {
  const field = tradeMultipliers({
    relations: [relation("A", "B", 50), relation("A", "C", -100)],
  });
  assert.equal(field.A.gdp, 1 + TRADE_STEP.GDP_MAX * -0.25);
  assert.equal(field.A.stability, TRADE_STEP.STABILITY_MAX * -0.25);
});

test("an active war severs the pair whatever the relation says", () => {
  const field = tradeMultipliers({
    relations: [relation("A", "B", 80)],
    wars: [war(["A"], ["B"])],
  });
  assert.equal(field.A.gdp, 1 + TRADE_STEP.GDP_MAX * -1);
  assert.equal(field.A.stability, TRADE_STEP.STABILITY_MAX * -1);
});

test("an ended war and an inactive pact are ignored", () => {
  const ended = tradeMultipliers({ relations: [relation("A", "B", 40)], wars: [war(["A"], ["B"], "ended")] });
  assert.ok(ended.A.gdp > 1);
  const inactive = tradeMultipliers({ agreements: [pact("trade_economic", ["A", "B"], "ended")] });
  assert.deepEqual(inactive, {});
});

test("an active trade pact lifts the edge above the bare relation", () => {
  const bare = tradeMultipliers({ relations: [relation("A", "B", 20)] });
  const pactField = tradeMultipliers({
    relations: [relation("A", "B", 20)],
    agreements: [pact("trade_economic", ["A", "B"])],
  });
  assert.ok(pactField.A.gdp > bare.A.gdp);
  // 0.20 relation + 0.35 pact = 0.55, clamped as it stands.
  assert.equal(pactField.A.gdp, 1 + TRADE_STEP.GDP_MAX * 0.55);
});

test("an unknown pact type contributes nothing", () => {
  assert.deepEqual(tradeMultipliers({ agreements: [pact("other", ["A", "B"])] }), {});
});

test("the field is deterministic and independent of input order", () => {
  const input = {
    relations: [relation("A", "B", 40), relation("A", "C", -30), relation("B", "C", 10)],
  };
  const reversed = { relations: [...input.relations].reverse() };
  assert.deepEqual(tradeMultipliers(input), tradeMultipliers(input));
  assert.deepEqual(tradeMultipliers(input), tradeMultipliers(reversed));
});
