// Run: node --test src/engine/researchEffects.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { RESEARCH_DOMAINS } from "./research.js";
import {
  ECONOMY_GROWTH_PER_POINT,
  MAX_RESEARCH_EFFECT_POINTS,
  POOL_REGEN_PER_POINT,
  PRODUCTION_SPEED_PER_POINT,
  RESEARCH_EFFECT_POINTS,
  RESEARCH_EFFECT_TARGETS,
  economyGrowthBonus,
  effectPointsFor,
  effectTargetFor,
  foldResearchEffect,
  normalizeResearchEffects,
  poolRegenMultiplier,
  productionTimeMultiplier,
  researchEffectLabel,
  researchEffectTotalsFor,
  researchEffectTotalsLabel,
} from "./researchEffects.js";

test("every domain maps to exactly one known target", () => {
  for (const domain of RESEARCH_DOMAINS) {
    assert.ok(RESEARCH_EFFECT_TARGETS.includes(effectTargetFor(domain)), domain);
  }
});

test("the points a completion is worth follow the scale table", () => {
  assert.equal(effectPointsFor("industrial", "small"), RESEARCH_EFFECT_POINTS.small);
  assert.equal(effectPointsFor("industrial", "medium"), RESEARCH_EFFECT_POINTS.medium);
  assert.equal(effectPointsFor("industrial", "large"), RESEARCH_EFFECT_POINTS.large);
});

test("an unknown domain or scale is worth nothing", () => {
  assert.equal(effectTargetFor("psionics"), "");
  assert.equal(effectPointsFor("psionics", "large"), 0);
  assert.equal(effectPointsFor("industrial", "colossal"), 0);
});

test("folding accumulates into the target and caps there", () => {
  let totals = foldResearchEffect(null, { domain: "industrial", scale: "large" });
  assert.deepEqual(totals, { production: 3, pools: 0, economy: 0 });
  totals = foldResearchEffect(totals, { domain: "electronics", scale: "large" });
  assert.equal(totals.production, MAX_RESEARCH_EFFECT_POINTS);
  totals = foldResearchEffect(totals, { domain: "industrial", scale: "large" });
  assert.equal(totals.production, MAX_RESEARCH_EFFECT_POINTS);
});

test("folding is pure and order-independent", () => {
  const base = { production: 1, pools: 0, economy: 0 };
  const folded = foldResearchEffect(base, { domain: "industrial", scale: "medium" });
  assert.deepEqual(base, { production: 1, pools: 0, economy: 0 }, "the input is not mutated");
  assert.equal(folded.production, 3);
  const a = foldResearchEffect(
    foldResearchEffect(null, { domain: "industrial", scale: "medium" }),
    { domain: "naval", scale: "small" },
  );
  const b = foldResearchEffect(
    foldResearchEffect(null, { domain: "naval", scale: "small" }),
    { domain: "industrial", scale: "medium" },
  );
  assert.deepEqual(a, b);
});

test("the multipliers are the no-op at zero and the documented value at the cap", () => {
  assert.equal(productionTimeMultiplier(0), 1);
  assert.equal(poolRegenMultiplier(0), 1);
  assert.equal(economyGrowthBonus(0), 0);
  assert.equal(
    productionTimeMultiplier(MAX_RESEARCH_EFFECT_POINTS),
    1 / (1 + PRODUCTION_SPEED_PER_POINT * MAX_RESEARCH_EFFECT_POINTS),
  );
  assert.equal(
    poolRegenMultiplier(MAX_RESEARCH_EFFECT_POINTS),
    1 + POOL_REGEN_PER_POINT * MAX_RESEARCH_EFFECT_POINTS,
  );
  assert.equal(
    economyGrowthBonus(MAX_RESEARCH_EFFECT_POINTS),
    ECONOMY_GROWTH_PER_POINT * MAX_RESEARCH_EFFECT_POINTS,
  );
});

test("normalize floors, caps and omits all-zero rows", () => {
  const map = normalizeResearchEffects({
    France: { production: 99, pools: -3, economy: 0 },
    "": { production: 5 },
    Germany: { production: 0, pools: 0, economy: 0 },
  });
  assert.deepEqual(map, { France: { production: MAX_RESEARCH_EFFECT_POINTS, pools: 0, economy: 0 } });
  assert.deepEqual(researchEffectTotalsFor(map, "Nowhere"), { production: 0, pools: 0, economy: 0 });
});

test("the labels name the target and the amount", () => {
  assert.equal(researchEffectLabel("industrial", "medium"), "+10% production");
  assert.equal(researchEffectLabel("medical", "small"), "+0.1pp growth");
  assert.equal(researchEffectLabel("psionics", "large"), "");
  assert.equal(
    researchEffectTotalsLabel({ production: 6, pools: 2, economy: 0 }),
    "production +30%, pools +10%",
  );
  assert.equal(researchEffectTotalsLabel(null), "");
});
