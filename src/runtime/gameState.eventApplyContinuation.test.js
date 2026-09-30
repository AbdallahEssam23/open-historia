/*! Open Historia — applying a turn's events in batches © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/gameState.eventApplyContinuation.test.js
//
// applyEventImpactsToWorld normalizes the world it is handed, and
// normalizeWorldState rebuilds every ledger in the document — tens of
// milliseconds on a long campaign. Callers that apply several batches in a row
// (the board's carrier loop, the event reveal) therefore normalize ONCE and hand
// the running result back in. These pin that this continuation is a pure saving
// and not a second set of rules: same result as one pass, and nothing already
// handed out is mutated underneath its holder.

import test from "node:test";
import assert from "node:assert/strict";

import { applyEventImpactsToWorld, normalizeWorldState } from "./gameState.js";

const MOTION = { originDate: "2020-01-01", round: 5, tick: 0 };

const baseWorld = () => normalizeWorldState({
  polityOverrides: {
    France: { code: "France", name: "France" },
    Germany: { code: "Germany", name: "Germany" },
  },
  regionOwnershipOverrides: { "EGY.1": "France", "EGY.2": "France" },
  markers: [{ id: "m1", name: "Port", lng: 10, lat: 10, ownerCode: "France", kind: "city" }],
  units: [{ id: "u1", ownerCode: "France", lng: 10, lat: 10, strength: 100 }],
  projects: [{ id: "pr1", name: "Railway", status: "active", ownerCode: "France", progress: 10, milestones: [] }],
  reports: [{ id: "r1", title: "Note", body: "b", holders: ["France"], date: "2020-01-01" }],
});

const event = (id, day, impacts) => ({
  id,
  date: `2020-01-${String(day).padStart(2, "0")}`,
  title: `Event ${id}`,
  description: "",
  impacts: {
    polityChanges: [], regionTransfers: [], unitOps: [], markerOps: [], projectOps: [],
    createdChats: [], regionClaims: [], regionControlOps: [], reports: [], ...impacts,
  },
});

// The only thing a batch boundary changes is the wall-clock stamp applyProjectOps
// writes; the world a player sees is otherwise identical.
const withoutStamps = (value) =>
  JSON.stringify(value, (key, entry) => (key === "createdAt" || key === "updatedAt" ? undefined : entry));

test("a continuation apply reaches the same world as the default path", () => {
  const events = [event("e1", 10, { regionTransfers: [{ regionId: "EGY.1", to: "Germany", basis: "conquest" }] })];

  const oneShot = applyEventImpactsToWorld({ colors: {}, events, motion: MOTION, world: baseWorld(), round: 5 });
  const continued = applyEventImpactsToWorld({
    colors: {},
    events,
    motion: MOTION,
    normalized: true,
    round: 5,
    world: baseWorld(),
  });

  assert.equal(withoutStamps(continued.world), withoutStamps(oneShot.world));
  assert.deepEqual(continued.colors, oneShot.colors);
});

test("batches applied in a row equal one pass over every event", () => {
  const batches = [
    [event("e1", 10, { regionTransfers: [{ regionId: "EGY.1", to: "Germany", basis: "conquest" }] })],
    [event("e2", 20, { regionClaims: [{ regionId: "EGY.3", claimants: ["France"] }] })],
    [event("e3", 28, { polityChanges: [{ code: "France", newName: "Frankia", change: "rename" }] })],
  ];

  const onePass = applyEventImpactsToWorld({
    colors: {},
    events: batches.flat(),
    motion: MOTION,
    round: 5,
    world: baseWorld(),
  });

  let running = baseWorld();
  let colors = {};
  for (const batch of batches) {
    const step = applyEventImpactsToWorld({
      colors,
      events: batch,
      motion: MOTION,
      normalized: true,
      round: 5,
      world: running,
    });
    running = step.world;
    colors = step.colors;
  }

  // Polities are re-keyed by their new name (Frankia), so the last batch's
  // rename must have folded exactly as it does in one pass.
  assert.equal(withoutStamps(running), withoutStamps(onePass.world));
});

// The carrier loop this was written for applies project ops in batches, and a
// batch that COMPLETES a project releases that project's onComplete effects into
// the same batch (a rename, a border). Those effects must release identically on
// the continuation path, where the projects board was never re-normalized.
test("an onComplete released mid-continuation lands exactly as it does in one pass", () => {
  const batches = [
    [event("e1", 10, {
      projectOps: [{
        op: "create",
        project: {
          id: "pr9",
          name: "The Northern Question",
          summary: "Obtain the northern marches.",
          status: "active",
          ownerCode: "France",
          progress: 60,
          onComplete: {
            polityChanges: [{ code: "France", newName: "Frankia" }],
            regionTransfers: [{ regionId: "EGY.2", toCode: "Germany" }],
          },
        },
      }],
    })],
    [event("e2", 20, { projectOps: [{ op: "close", projectId: "pr9", status: "complete" }] })],
  ];

  const onePass = applyEventImpactsToWorld({
    colors: {},
    events: batches.flat(),
    motion: MOTION,
    round: 5,
    world: baseWorld(),
  });

  let running = baseWorld();
  let colors = {};
  for (const batch of batches) {
    const step = applyEventImpactsToWorld({
      colors,
      events: batch,
      motion: MOTION,
      normalized: true,
      round: 5,
      world: running,
    });
    running = step.world;
    colors = step.colors;
  }

  assert.equal(withoutStamps(running), withoutStamps(onePass.world));
  // Sanity: the effects really were released, not silently dropped on one side.
  assert.ok(running.polityOverrides.Frankia, "the onComplete rename must have re-keyed France");
  assert.equal(running.regionOwnershipOverrides["EGY.2"], "Germany");
});

test("a continuation apply leaves the world and colours its holder already has untouched", () => {
  const first = applyEventImpactsToWorld({
    colors: {},
    events: [event("e1", 10, { regionTransfers: [{ regionId: "EGY.1", to: "Germany", basis: "conquest" }] })],
    motion: MOTION,
    round: 5,
    world: baseWorld(),
  });
  const heldWorld = withoutStamps(first.world);
  const heldColors = withoutStamps(first.colors);

  applyEventImpactsToWorld({
    colors: first.colors,
    events: [event("e2", 20, { polityChanges: [{ code: "France", newName: "Frankia", change: "rename" }] })],
    motion: MOTION,
    normalized: true,
    round: 5,
    world: first.world,
  });

  // The rename writes into world.polityOverrides, so the earlier world must not
  // share that map — otherwise React holds a value that changes under it.
  assert.equal(withoutStamps(first.world), heldWorld, "the world already handed out was rewritten in place");
  assert.equal(withoutStamps(first.colors), heldColors, "the colours already handed out were rewritten in place");
});
