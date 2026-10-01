import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RESEARCH_DOMAIN,
  DEFAULT_RESEARCH_SCALE,
  RESEARCH_DOMAINS,
  RESEARCH_MAX_POINTS,
  RESEARCH_SCALES,
  researchCostFor,
  researchPointsFor,
  resolveResearchDomain,
  resolveResearchScale,
} from "./research.js";

test("the domain and scale enums are closed and every domain has a base", () => {
  assert.deepEqual(
    [...RESEARCH_DOMAINS],
    ["military", "naval", "aerospace", "industrial", "electronics", "medical", "nuclear"],
  );
  assert.deepEqual([...RESEARCH_SCALES], ["small", "medium", "large"]);
  for (const domain of RESEARCH_DOMAINS) {
    const cost = researchCostFor({ domain, scale: "small" });
    assert.ok(Number.isInteger(cost) && cost > 0, `${domain} has a positive integer cost`);
  }
});

test("cost is a deterministic function of domain and scale", () => {
  // A large programme costs three times the small one of the same domain.
  assert.equal(
    researchCostFor({ domain: "nuclear", scale: "large" }),
    researchCostFor({ domain: "nuclear", scale: "small" }) * 3,
  );
  // Nuclear is dearer than industrial at the same scale.
  assert.ok(
    researchCostFor({ domain: "nuclear", scale: "medium" })
      > researchCostFor({ domain: "industrial", scale: "medium" }),
  );
});

test("an unknown domain or scale falls back to the default rather than throwing", () => {
  assert.equal(resolveResearchDomain("telepathy"), DEFAULT_RESEARCH_DOMAIN);
  assert.equal(resolveResearchDomain("NUCLEAR"), "nuclear");
  assert.equal(resolveResearchScale("enormous"), DEFAULT_RESEARCH_SCALE);
  assert.equal(resolveResearchScale("Large"), "large");
  // A missing pair still costs the default pair, never zero.
  assert.equal(
    researchCostFor({}),
    researchCostFor({ domain: DEFAULT_RESEARCH_DOMAIN, scale: DEFAULT_RESEARCH_SCALE }),
  );
});

test("capacity is the documented formula including the cap", () => {
  // Base of one, so a polity with nothing still researches.
  assert.equal(researchPointsFor({ facilities: 0, population: 0 }), 1);
  // Two points per facility.
  assert.equal(researchPointsFor({ facilities: 1, population: 0 }), 3);
  // One extra point per 50 million people, floored.
  assert.equal(researchPointsFor({ facilities: 0, population: 49999999 }), 1);
  assert.equal(researchPointsFor({ facilities: 0, population: 50000000 }), 2);
  assert.equal(researchPointsFor({ facilities: 0, population: 250000000 }), 6);
  // The cap holds however large the inputs.
  assert.equal(researchPointsFor({ facilities: 100, population: 10000000000 }), RESEARCH_MAX_POINTS);
  // Negative or malformed inputs do not go below the base.
  assert.equal(researchPointsFor({ facilities: -5, population: -100 }), 1);
});
