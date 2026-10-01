import test from "node:test";
import assert from "node:assert/strict";

import {
  applyEventImpactsToWorld,
  applyProjectOps,
  normalizeProjects,
  releaseProjectCompletionEffects,
} from "../runtime/gameState.js";

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
  assert.equal(next[0].researchPoints, 480);
  assert.equal(next[0].status, "complete");
});

test("the model cannot complete a research programme with a status patch either", () => {
  const ops = [{ op: "update", projectId: "rx", patch: { status: "complete" } }];
  const released = releaseProjectCompletionEffects(researchBoard(), ops, {});
  assert.equal(released.projectIds.length, 0);
  const next = applyProjectOps(researchBoard(), ops, {});
  assert.equal(next[0].status, "active");
  assert.equal(next[0].onCompleteAppliedAt, "");
  // And the engine can still complete it later.
  const engine = applyProjectOps(next, [{ op: "close", projectId: "rx", status: "complete" }], { engineSourced: true });
  assert.equal(engine[0].status, "complete");
});

test("the model cannot launder a research programme into another kind to complete it", () => {
  const ops = [
    { op: "update", projectId: "rx", patch: { kind: "project" } },
    { op: "update", projectId: "rx", patch: { status: "complete" } },
  ];
  const next = applyProjectOps(researchBoard(), ops, {});
  assert.equal(next[0].kind, "research");
  assert.equal(next[0].status, "active");
  assert.equal(next[0].onCompleteAppliedAt, "");
});

test("a created research programme starts at zero points and progress", () => {
  const created = applyProjectOps([], [
    { op: "create", name: "New Reactor", kind: "research", domain: "nuclear", scale: "large", researchPoints: 999, progress: 99 },
  ], {});
  assert.equal(created[0].researchPoints, 0);
  assert.equal(created[0].progress, 0);
});

test("a re-announced research programme cannot be demoted or forged either", () => {
  const ops = [
    { op: "create", name: "Reactor", kind: "project", researchPoints: 999, progress: 99 },
    { op: "update", projectId: "rx", patch: { status: "complete" } },
  ];
  const next = applyProjectOps(researchBoard(), ops, {});
  assert.equal(next[0].kind, "research");
  assert.equal(next[0].researchPoints, 0);
  assert.equal(next[0].progress, 0);
  assert.equal(next[0].status, "active");
  assert.equal(next[0].onCompleteAppliedAt, "");
});

test("the model cannot complete a research programme through create or re-announce", () => {
  const fresh = applyProjectOps([], [
    { op: "create", name: "New Reactor", kind: "research", domain: "nuclear", scale: "large", status: "complete" },
  ], {});
  assert.notEqual(fresh[0].status, "complete");
  assert.equal(fresh[0].onCompleteAppliedAt, "");

  const reannounced = applyProjectOps(researchBoard(), [
    { op: "create", name: "Reactor", status: "complete" },
  ], {});
  assert.equal(reannounced[0].status, "active");
  assert.equal(reannounced[0].onCompleteAppliedAt, "");
  // And the engine can still complete it later.
  const engine = applyProjectOps(reannounced, [{ op: "close", projectId: "rx", status: "complete" }], { engineSourced: true });
  assert.equal(engine[0].status, "complete");
});

test("promoting an entry into research drops model-authored progress", () => {
  const board = normalizeProjects([
    { id: "px", name: "Dam", kind: "project", progress: 99 },
  ]);
  const next = applyProjectOps(board, [
    { op: "update", projectId: "px", patch: { kind: "research", domain: "industrial", scale: "small" } },
  ], {});
  assert.equal(next[0].kind, "research");
  assert.equal(next[0].progress, 0);
  assert.equal(next[0].researchPoints, 0);
});

test("a model batch cannot release effects by promoting to research then completing", () => {
  const board = normalizeProjects([
    { id: "px", name: "Dam", kind: "project", status: "active",
      onComplete: { polityChanges: [{ code: "France", reputation: 60 }] } },
  ]);
  const ops = [
    { op: "update", projectId: "px", patch: { kind: "research", domain: "industrial", scale: "small" } },
    { op: "close", projectId: "px", status: "complete" },
  ];
  const released = releaseProjectCompletionEffects(board, ops, {});
  assert.deepEqual(released.projectIds, []);
  const next = applyProjectOps(board, ops, {});
  assert.equal(next[0].kind, "research");
  assert.notEqual(next[0].status, "complete");
  assert.equal(next[0].onCompleteAppliedAt, "");
});

test("a model batch cannot release effects by demoting research then completing", () => {
  const ops = [
    { op: "update", projectId: "rx", patch: { kind: "project" } },
    { op: "close", projectId: "rx", status: "complete" },
  ];
  const released = releaseProjectCompletionEffects(researchBoard(), ops, {});
  assert.deepEqual(released.projectIds, []);
  const next = applyProjectOps(researchBoard(), ops, {});
  assert.equal(next[0].kind, "research");
  assert.equal(next[0].status, "active");
  assert.equal(next[0].onCompleteAppliedAt, "");
});

test("a model batch cannot dodge the invariant with a non-canonical kind spelling", () => {
  const base = normalizeProjects([{ id: "pz", name: "Tower", kind: "project", status: "active" }]);
  const progressOps = [
    { op: "update", projectId: "pz", patch: { kind: "Research", progress: 99 } },
  ];
  const afterProgress = applyProjectOps(base, progressOps, {});
  assert.equal(afterProgress[0].kind, "research");
  assert.equal(afterProgress[0].progress, 0);

  const completeOps = [
    { op: "update", projectId: "pz", patch: { kind: "RESEARCH", status: "complete" } },
  ];
  const released = releaseProjectCompletionEffects(base, completeOps, {});
  assert.deepEqual(released.projectIds, []);
  const afterComplete = applyProjectOps(base, completeOps, {});
  assert.equal(afterComplete[0].kind, "research");
  assert.notEqual(afterComplete[0].status, "complete");
  assert.equal(afterComplete[0].onCompleteAppliedAt, "");
});

test("a model batch cannot release effects by renaming then promoting to research", () => {
  // The rename makes the promoted entry addressable by a NEW name later in the
  // batch. The scan must follow the rename, or it judges the completion against
  // the pre-batch name/kind and releases effects the applier withholds.
  const board = normalizeProjects([{
    id: "p1", name: "Alpha", kind: "project", status: "active",
    onComplete: { polityChanges: [{ code: "France", reputation: 60 }] },
  }]);
  const ops = [
    { op: "update", projectId: "p1", patch: { newName: "Beta" } },
    { op: "update", name: "Beta", patch: { kind: "research", domain: "industrial", scale: "small" } },
    { op: "close", projectId: "p1", status: "complete" },
  ];
  const released = releaseProjectCompletionEffects(board, ops, {});
  assert.deepEqual(released.projectIds, []);
  const next = applyProjectOps(board, ops, {});
  assert.equal(next[0].kind, "research");
  assert.equal(next[0].status, "active");
  assert.equal(next[0].onCompleteAppliedAt, "");
});

test("a model batch cannot release a research programme's effects by removing and recreating it", () => {
  // The removed research entry's id is reused by a non-research replacement. The
  // scan must agree with the applier: the replacement completes, so ITS effect is
  // released and the research programme's is not.
  const board = normalizeProjects([{
    id: "p1", name: "Reactor", kind: "research", status: "active", domain: "nuclear", scale: "large",
    onComplete: { polityChanges: [{ code: "France", reputation: 77 }] },
  }]);
  const ops = [
    { op: "remove", projectId: "p1" },
    { op: "create", project: {
      id: "p1", name: "Reactor", kind: "project", status: "active",
      onComplete: { polityChanges: [{ code: "France", reputation: 55 }] },
    } },
    { op: "close", projectId: "p1", status: "complete" },
  ];
  const released = releaseProjectCompletionEffects(board, ops, {});
  assert.deepEqual(released.projectIds, ["p1"]);
  assert.deepEqual(released.polityChanges.map((change) => change.reputation), [55]);
  const next = applyProjectOps(board, ops, {});
  assert.equal(next.length, 1);
  assert.equal(next[0].kind, "project");
  assert.equal(next[0].status, "complete");
});

test("a rename cannot make the scan release a different project than the applier completes", () => {
  // The renamed research entry collides with the non-research entry's name. The
  // applier resolves the completing op to the research entry and refuses it, so
  // the scan must release nothing rather than the non-research entry's effects.
  const board = normalizeProjects([
    { id: "a1", name: "Rho", kind: "research", status: "active", domain: "nuclear", scale: "large",
      onComplete: { polityChanges: [{ code: "France", reputation: 90 }] } },
    { id: "b1", name: "Alpha", kind: "project", status: "active",
      onComplete: { polityChanges: [{ code: "France", reputation: 42 }] } },
  ]);
  const ops = [
    { op: "update", projectId: "a1", patch: { newName: "Alpha" } },
    { op: "close", name: "Alpha", status: "complete" },
  ];
  const released = releaseProjectCompletionEffects(board, ops, {});
  assert.deepEqual(released.projectIds, []);
  assert.deepEqual(released.polityChanges, []);
  const next = applyProjectOps(board, ops, {});
  assert.equal(next.every((project) => project.status !== "complete"), true);
});

test("a later op cannot change which effects a completion released", () => {
  const board = () => normalizeProjects([{
    id: "p1", name: "Dam", kind: "project", status: "active",
    onComplete: { polityChanges: [{ code: "France", reputation: 10 }] },
  }]);
  // Clearing onComplete after the completion must not leave the latch spent with
  // nothing released: the payload is the one that stood at the transition.
  const cleared = releaseProjectCompletionEffects(board(), [
    { op: "close", projectId: "p1", status: "complete" },
    { op: "update", projectId: "p1", patch: { onComplete: {} } },
  ], {});
  assert.deepEqual(cleared.projectIds, ["p1"]);
  assert.deepEqual(cleared.polityChanges.map((change) => change.reputation), [10]);
  // Replacing it must release the transition's effect, not the replacement.
  const replaced = releaseProjectCompletionEffects(board(), [
    { op: "close", projectId: "p1", status: "complete" },
    { op: "update", projectId: "p1", patch: { onComplete: { polityChanges: [{ code: "France", reputation: 99 }] } } },
  ], {});
  assert.deepEqual(replaced.polityChanges.map((change) => change.reputation), [10]);
});

test("applyEventImpactsToWorld completes research only when engine-sourced", () => {
  const world = () => ({
    countryStats: {},
    projects: [{
      id: "rx", name: "Reactor", kind: "research", ownerCode: "France",
      domain: "nuclear", scale: "large", status: "active", progress: 0, researchPoints: 0,
      onComplete: { polityChanges: [{ code: "France", reputation: 60 }] },
    }],
  });
  const events = [{
    id: "e", title: "Research completed", description: "",
    impacts: { projectOps: [{ op: "close", projectId: "rx", status: "complete" }] },
  }];
  // The MODEL path refuses it and releases nothing.
  const model = applyEventImpactsToWorld({
    colors: {}, world: world(), events,
  });
  assert.equal(model.world.projects[0].status, "active");
  // The ENGINE path completes it and releases the effect.
  const engine = applyEventImpactsToWorld({
    colors: {}, world: world(), events, engineSourced: true,
  });
  assert.equal(engine.world.projects[0].status, "complete");
  assert.equal(typeof engine.world.projects[0].onCompleteAppliedAt, "string");
  assert.notEqual(engine.world.projects[0].onCompleteAppliedAt, "");
  // The released polity change really landed: its reputation is on the world. The
  // payload still sitting on the project is not proof - the refused model path
  // keeps it too - so the assertion is on the effect the release wrote.
  assert.deepEqual(engine.world.internationalReputation, { France: 60 });
  assert.equal(model.world.projects[0].onCompleteAppliedAt, "");
  assert.deepEqual(model.world.internationalReputation, {});
});
