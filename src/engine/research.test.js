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
  normalizeResearchProgrammes,
  researchQueueFor,
  resolveResearchDomain,
  resolveResearchScale,
  stepResearchMonth,
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

const programme = (over = {}) => ({
  id: "p1", domain: "industrial", scale: "small", points: 0,
  priority: "normal", startedAt: "2000-01-01", status: "active", ...over,
});

test("normalize derives the cost and drops anything without an id", () => {
  const cost = researchCostFor({ domain: "nuclear", scale: "large" });
  const [entry] = normalizeResearchProgrammes([
    programme({ id: "n1", domain: "nuclear", scale: "large", points: 5 }),
    { domain: "naval", scale: "small" },
  ]);
  assert.equal(entry.id, "n1");
  assert.equal(entry.cost, cost);
  assert.equal(entry.accumulated, 5);
  assert.equal(normalizeResearchProgrammes([{ domain: "naval" }]).length, 0);
});

test("the queue is priority, then start date, then id, and only active programmes", () => {
  const queue = researchQueueFor(normalizeResearchProgrammes([
    programme({ id: "b", priority: "normal", startedAt: "2001-01-01" }),
    programme({ id: "a", priority: "high", startedAt: "2010-01-01" }),
    programme({ id: "c", priority: "high", startedAt: "2000-01-01" }),
    programme({ id: "z", priority: "high", startedAt: "2000-01-01" }),
    programme({ id: "p", status: "paused" }),
    programme({ id: "s", status: "proposed" }),
  ]));
  assert.deepEqual(queue.map((entry) => entry.id), ["c", "z", "a", "b"]);
});

test("one programme takes the whole rate and the rest wait", () => {
  const input = normalizeResearchProgrammes([
    programme({ id: "head", domain: "industrial", scale: "small" }), // cost 24
    programme({ id: "tail", domain: "industrial", scale: "small" }),
  ]);
  const { programmes, completions } = stepResearchMonth({ points: 10, programmes: input }, { monthOffset: 1 });
  assert.equal(programmes.find((p) => p.id === "head").accumulated, 10);
  assert.equal(programmes.find((p) => p.id === "tail").accumulated, 0);
  assert.deepEqual(completions, []);
});

test("overflow carries to the next programme in the same month", () => {
  // Each small industrial programme costs 24. 60 points finishes two and leaves 12.
  const input = normalizeResearchProgrammes([
    programme({ id: "a", priority: "high" }),
    programme({ id: "b", priority: "normal" }),
    programme({ id: "c", priority: "low" }),
  ]);
  const { programmes, completions } = stepResearchMonth({ points: 60, programmes: input }, { monthOffset: 3 });
  assert.deepEqual(completions, [{ id: "a", monthOffset: 3 }, { id: "b", monthOffset: 3 }]);
  assert.equal(programmes.find((p) => p.id === "c").accumulated, 12);
});

test("points left when the queue is exhausted are discarded, not banked", () => {
  const input = normalizeResearchProgrammes([programme({ id: "a" })]); // cost 24
  const { completions } = stepResearchMonth({ points: 100, programmes: input }, { monthOffset: 1 });
  assert.deepEqual(completions, [{ id: "a", monthOffset: 1 }]);
  // A second step with a fresh month and the same list reports nothing to give.
  const after = stepResearchMonth({ points: 100, programmes: [] }, { monthOffset: 2 });
  assert.deepEqual(after.completions, []);
});

test("the same input and span always produce the same output", () => {
  const build = () => normalizeResearchProgrammes([
    programme({ id: "a", priority: "high", points: 5 }),
    programme({ id: "b" }),
  ]);
  const first = stepResearchMonth({ points: 7, programmes: build() }, { monthOffset: 4 });
  const second = stepResearchMonth({ points: 7, programmes: build() }, { monthOffset: 4 });
  assert.deepEqual(first, second);
});
