import test from "node:test";
import assert from "node:assert/strict";

import { normalizeProjects } from "../runtime/gameState.js";

test("a research project keeps its closed domain and scale and its points", () => {
  const [entry] = normalizeProjects([
    { name: "Reactor", kind: "research", domain: "nuclear", scale: "large", researchPoints: 7 },
  ]);
  assert.equal(entry.kind, "research");
  assert.equal(entry.domain, "nuclear");
  assert.equal(entry.scale, "large");
  assert.equal(entry.researchPoints, 7);
});

test("unknown domain and scale fall back, and missing ones too", () => {
  const [entry] = normalizeProjects([{ name: "X", kind: "research", domain: "psionics", scale: "colossal" }]);
  assert.equal(entry.domain, "industrial");
  assert.equal(entry.scale, "small");
  assert.equal(entry.researchPoints, 0);
});

test("a non-research project carries no research fields", () => {
  const [entry] = normalizeProjects([{ name: "Dam", kind: "project", domain: "nuclear", scale: "large", researchPoints: 9 }]);
  assert.equal(entry.kind, "project");
  assert.equal(entry.domain, "");
  assert.equal(entry.scale, "");
  assert.equal(entry.researchPoints, 0);
});
