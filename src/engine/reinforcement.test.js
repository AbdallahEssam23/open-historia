// Run: node --test src/engine/reinforcement.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_REINFORCEMENT_POLICY,
  MAX_REINFORCEMENT,
  REINFORCEMENT_POLICIES,
  deriveReinforcement,
  normalizePendingReinforcement,
  normalizeReinforcement,
  normalizeReinforcementMap,
} from "./reinforcement.js";

const BASE = {
  policies: { France: "replacements" },
  pools: { France: { manpower: 100000, materiel: 1000 } },
  units: [
    { id: "u1", ownerCode: "France", type: "infantry", regionId: "r1", strength: 40, lng: 1, lat: 1 },
    { id: "u2", ownerCode: "France", type: "infantry", regionId: "r2", strength: 100, lng: 2, lat: 2 },
  ],
  supply: [
    { unitId: "u1", reachable: true },
    { unitId: "u2", reachable: true },
  ],
  months: 1,
};

test("an in-supply formation recovers the monthly rate and draws the cost", () => {
  const result = deriveReinforcement(BASE);
  assert.deepEqual(result.ops, [{ op: "strength", unitId: "u1", strength: 45 }]);
  assert.deepEqual(result.draws, { France: { manpower: 600, materiel: 0.25 } });
  assert.equal(result.summary.reinforced, 1);
  assert.equal(result.summary.pointsRestored, 5);
});

test("a cut-off formation recovers nothing and draws nothing", () => {
  const supply = [{ unitId: "u1", reachable: false }, { unitId: "u2", reachable: false }];
  const result = deriveReinforcement({ ...BASE, supply });
  assert.deepEqual(result.ops, []);
  assert.deepEqual(result.draws, {});
});

test("none reinforces nobody; belligerent only a polity on an active war", () => {
  assert.deepEqual(deriveReinforcement({ ...BASE, policies: { France: "none" } }).ops, []);
  const atWar = deriveReinforcement({
    ...BASE,
    policies: { France: "belligerent" },
    wars: [{ status: "active", sideA: ["France"], sideB: ["Germany"] }],
  });
  assert.equal(atWar.summary.reinforced, 1);
  const peace = deriveReinforcement({ ...BASE, policies: { France: "belligerent" } });
  assert.deepEqual(peace.ops, []);
});

test("the draw is bounded by the pool and never goes negative", () => {
  const poor = deriveReinforcement({ ...BASE, pools: { France: { manpower: 600, materiel: 0.25 } } });
  assert.deepEqual(poor.ops, [{ op: "strength", unitId: "u1", strength: 45 }]);
  assert.deepEqual(poor.draws, { France: { manpower: 600, materiel: 0.25 } });
  const broke = deriveReinforcement({ ...BASE, pools: { France: { manpower: 1, materiel: 0 } } });
  assert.deepEqual(broke.ops, []);
  assert.deepEqual(broke.draws, {});
});

test("a zero-month period restores nothing but a rotation still applies", () => {
  const result = deriveReinforcement({
    ...BASE,
    months: 0,
    units: [
      { id: "u1", ownerCode: "France", type: "infantry", regionId: "r1", strength: 40, lng: 1, lat: 1 },
      { id: "u2", ownerCode: "France", type: "infantry", regionId: "r2", strength: 90, lng: 2, lat: 2 },
    ],
    rotations: [{ out: "u1", in: "u2" }],
  });
  assert.deepEqual(result.ops.filter((op) => op.op === "strength"), []);
  assert.equal(result.summary.rotations, 1);
});

test("weakest first, and reordering the roster does not change the result", () => {
  const pools = { France: { manpower: 600, materiel: 0.25 } };
  const forward = deriveReinforcement({ ...BASE, pools });
  const reversed = deriveReinforcement({ ...BASE, pools, units: [...BASE.units].reverse() });
  assert.deepEqual(forward, reversed);
  assert.equal(forward.ops[0].unitId, "u1");
});

test("a rotation of two valid, reachable, same-type formations swaps their stations", () => {
  const result = deriveReinforcement({
    ...BASE,
    units: [
      { id: "u1", ownerCode: "France", type: "infantry", regionId: "r1", strength: 40, lng: 1, lat: 1 },
      { id: "u2", ownerCode: "France", type: "infantry", regionId: "r2", strength: 90, lng: 2, lat: 2 },
    ],
    rotations: [{ out: "u1", in: "u2" }],
  });
  assert.deepEqual(result.ops, [
    { op: "move", unitId: "u1", toLng: 2, toLat: 2, regionId: "r2" },
    { op: "move", unitId: "u2", toLng: 1, toLat: 1, regionId: "r1" },
  ]);
  // Neither formation is reinforced the turn it is committed.
  assert.deepEqual(result.draws, {});
  assert.equal(result.summary.rotations, 1);
});

test("a rotation naming an unreachable or mismatched formation is rejected", () => {
  const unreachable = deriveReinforcement({
    ...BASE,
    supply: [{ unitId: "u2", reachable: true }],
    rotations: [{ out: "u1", in: "u2" }],
  });
  assert.deepEqual(unreachable.ops.filter((op) => op.op === "move"), []);
  assert.equal(unreachable.summary.rejected, 1);
  const mismatched = deriveReinforcement({
    ...BASE,
    units: [BASE.units[0], { ...BASE.units[1], type: "armor" }],
    rotations: [{ out: "u1", in: "u2" }],
  });
  assert.deepEqual(mismatched.ops.filter((op) => op.op === "move"), []);
});

test("a merge yields a strength op capped at full and a remove op, keeping the survivor", () => {
  const units = [{ ...BASE.units[0], regionId: "r1" }, { ...BASE.units[1], strength: 30, regionId: "r1" }];
  const result = deriveReinforcement({ ...BASE, units, merges: [{ survivor: "u1", absorbed: "u2" }] });
  assert.deepEqual(result.ops, [
    { op: "strength", unitId: "u1", strength: 70 },
    { op: "remove", unitId: "u2" },
  ]);
  assert.equal(result.summary.merges, 1);
});

test("an isolated pair may merge, because a merge is not a movement", () => {
  const units = [{ ...BASE.units[0], regionId: "r1" }, { ...BASE.units[1], strength: 30, regionId: "r1" }];
  const supply = [{ unitId: "u1", reachable: false }, { unitId: "u2", reachable: false }];
  const result = deriveReinforcement({ ...BASE, units, supply, merges: [{ survivor: "u1", absorbed: "u2" }] });
  assert.equal(result.summary.merges, 1);
});

test("duplicate orders fold by key, first one winning", () => {
  const units = [
    { id: "u1", ownerCode: "France", type: "infantry", regionId: "r1", strength: 40, lng: 1, lat: 1 },
    { id: "u2", ownerCode: "France", type: "infantry", regionId: "r2", strength: 90, lng: 2, lat: 2 },
  ];
  const result = deriveReinforcement({
    ...BASE,
    units,
    rotations: [{ out: "u1", in: "u2" }, { out: "u1", in: "u2" }],
  });
  assert.equal(result.summary.rotations, 1);
  assert.equal(result.summary.rejected, 1);
});

test("empty inputs yield the empty shape, not a throw", () => {
  const result = deriveReinforcement();
  assert.deepEqual(result.ops, []);
  assert.deepEqual(result.draws, {});
  assert.deepEqual(result.rejections, []);
  assert.equal(result.summary.reinforced, 0);
});

test("the declaration normalizer validates the closed policy and the cap", () => {
  assert.deepEqual(
    normalizeReinforcement([{ polity: "France", policy: "none" }], { knownPolities: ["France"] }),
    { valid: [{ polity: "France", policy: "none" }], rejected: [] },
  );
  const bad = normalizeReinforcement(
    [{ polity: "Atlantis", policy: "total" }, { polity: "France", policy: "total" }],
    { knownPolities: ["France"] },
  );
  assert.deepEqual(bad.valid, []);
  assert.equal(bad.rejected.length, 2);
});

test("the committed map stores only a valid non-default policy", () => {
  assert.deepEqual(
    normalizeReinforcementMap({ France: DEFAULT_REINFORCEMENT_POLICY, Germany: "none", Italy: "junk" }),
    { Germany: "none" },
  );
});

test("the pending shape round-trips a valid declaration", () => {
  assert.deepEqual(
    normalizePendingReinforcement([{ polity: "France", policy: "belligerent" }]),
    [{ polity: "France", policy: "belligerent" }],
  );
  assert.equal(REINFORCEMENT_POLICIES.includes("replacements"), true);
  assert.equal(MAX_REINFORCEMENT, 20);
});
