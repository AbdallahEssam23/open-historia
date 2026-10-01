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

import { applyProjectOps, releaseProjectCompletionEffects } from "../runtime/gameState.js";

const researchBoard = () => normalizeProjects([
  {
    id: "rx", name: "Reactor", kind: "research", domain: "nuclear", scale: "large", status: "active",
    // A canonical, normalizable effect: the plan's `polity`/`field`/`delta` shape
    // is rejected by normalizePolityChange, which would leave onComplete null and
    // make the engine-release assertion unsatisfiable.
    onComplete: { polityChanges: [{ code: "France", reputation: 60 }] },
  },
]);

test("the model cannot set progress on a research programme", () => {
  const next = applyProjectOps(researchBoard(), [{ op: "update", projectId: "rx", patch: { progress: 90 } }], {});
  assert.equal(next[0].progress, 0);
});

test("the model cannot complete a research programme or release its effects", () => {
  const ops = [{ op: "close", projectId: "rx", status: "complete" }];
  const released = releaseProjectCompletionEffects(researchBoard(), ops, {});
  assert.equal(released.projectIds.length, 0);
  const next = applyProjectOps(researchBoard(), ops, {});
  assert.equal(next[0].status, "active");
});

test("the engine path may write progress, points and completion", () => {
  const ops = [
    { op: "update", projectId: "rx", patch: { progress: 50, researchPoints: 480 } },
    { op: "close", projectId: "rx", status: "complete" },
  ];
  const released = releaseProjectCompletionEffects(researchBoard(), ops, { engineSourced: true });
  assert.deepEqual(released.projectIds, ["rx"]);
  const next = applyProjectOps(researchBoard(), ops, { engineSourced: true });
  assert.equal(next[0].progress, 100);
  assert.equal(next[0].status, "complete");
});
