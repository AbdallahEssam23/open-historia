// src/engine/productionQueue.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  BUILDING_TYPES,
  MAX_PRODUCTION_ORDERS,
  MAX_PRODUCTION_QUEUE,
  MAX_UNIT_COUNT,
  PRODUCTION_TABLE,
  PRODUCTION_UNIT_TYPES,
  markerKindFor,
  normalizeProductionOrders,
  normalizeProductionQueue,
  priceOf,
} from "./productionQueue.js";

test("the kind enums are closed and every type has a cost row", () => {
  assert.deepEqual(
    [...PRODUCTION_UNIT_TYPES],
    ["infantry", "armor", "air", "naval", "artillery", "garrison"],
  );
  assert.ok(BUILDING_TYPES.includes("fortification"));
  assert.ok(BUILDING_TYPES.includes("research_facility"));
  for (const type of [...PRODUCTION_UNIT_TYPES, ...BUILDING_TYPES]) {
    assert.ok(PRODUCTION_TABLE[type], `${type} has a cost row`);
    assert.ok(PRODUCTION_TABLE[type].months >= 1);
    assert.ok(PRODUCTION_TABLE[type].manpower >= 0);
    assert.ok(PRODUCTION_TABLE[type].materiel >= 0);
  }
});

test("a heavier item costs more and takes longer", () => {
  assert.ok(priceOf({ type: "naval", count: 1 }).materiel > priceOf({ type: "garrison", count: 1 }).materiel);
  assert.ok(priceOf({ type: "naval", count: 1 }).months > priceOf({ type: "garrison", count: 1 }).months);
  assert.ok(priceOf({ type: "industrial_plant", count: 1 }).months > priceOf({ type: "fortification", count: 1 }).months);
});

test("a count multiplies both the price and the build time", () => {
  const one = priceOf({ type: "infantry", count: 1 });
  const three = priceOf({ type: "infantry", count: 3 });
  assert.equal(three.manpower, one.manpower * 3);
  assert.equal(three.materiel, one.materiel * 3);
  assert.equal(three.months, one.months * 3);
});

test("a structure's marker kind reads as words", () => {
  assert.equal(markerKindFor("naval_base"), "naval base");
  assert.equal(markerKindFor("industrial_plant"), "industrial plant");
});

test("an order keeps only a known polity, kind and matching type", () => {
  const { valid, rejected } = normalizeProductionOrders(
    [
      { polity: "France", kind: "unit", type: "infantry", count: 2 },
      { polity: "Atlantis", kind: "unit", type: "infantry" },
      { polity: "France", kind: "vehicle", type: "infantry" },
      { polity: "France", kind: "unit", type: "fortification" },
      { polity: "France", kind: "building", type: "naval_base", at: "Brest" },
    ],
    { knownPolities: ["France", "Germany"] },
  );
  assert.equal(valid.length, 2);
  assert.deepEqual(valid[0], { polity: "France", kind: "unit", type: "infantry", count: 2 });
  assert.deepEqual(valid[1], { polity: "France", kind: "building", type: "naval_base", at: "Brest", count: 1 });
  assert.equal(rejected.length, 3);
  assert.match(rejected[0].reason, /unknown polity/);
  assert.match(rejected[1].reason, /unknown kind/);
  assert.match(rejected[2].reason, /unknown unit type/);
});

test("a count out of range is rejected, not clamped", () => {
  const over = normalizeProductionOrders(
    [{ polity: "France", kind: "unit", type: "infantry", count: MAX_UNIT_COUNT + 1 }],
    { knownPolities: ["France"] },
  );
  assert.equal(over.valid.length, 0);
  assert.match(over.rejected[0].reason, /count out of range/);
  const zero = normalizeProductionOrders(
    [{ polity: "France", kind: "unit", type: "infantry", count: 0 }],
    { knownPolities: ["France"] },
  );
  assert.equal(zero.rejected.length, 1);
});

test("a structure is a series of one", () => {
  const { valid, rejected } = normalizeProductionOrders(
    [{ polity: "France", kind: "building", type: "airfield", count: 2 }],
    { knownPolities: ["France"] },
  );
  assert.equal(valid.length, 0);
  assert.match(rejected[0].reason, /series of one/);
});

test("the period accepts at most MAX_PRODUCTION_ORDERS orders", () => {
  const orders = Array.from({ length: MAX_PRODUCTION_ORDERS + 1 }, () => ({
    polity: "France",
    kind: "unit",
    type: "infantry",
  }));
  const { valid, rejected } = normalizeProductionOrders(orders, { knownPolities: ["France"] });
  assert.equal(valid.length, MAX_PRODUCTION_ORDERS);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /orders in one period/);
});

test("the committed line round-trips and drops a half-written item", () => {
  const queue = normalizeProductionQueue({
    France: {
      active: { kind: "unit", type: "infantry", count: 1, monthsTotal: 2, monthsDone: 1 },
      queue: [
        { kind: "building", type: "fortification", count: 1, monthsTotal: 4, at: "Metz" },
        { kind: "unit", type: "infantry" },
        { kind: "unit", type: "unicorn", count: 1, monthsTotal: 2 },
      ],
    },
    Ghost: null,
  });
  assert.deepEqual(queue.France.active, { kind: "unit", type: "infantry", count: 1, monthsTotal: 2, monthsDone: 1 });
  assert.equal(queue.France.queue.length, 1);
  assert.equal(queue.France.queue[0].at, "Metz");
  assert.equal(queue.Ghost, undefined);
});

test("the committed tail is capped", () => {
  const items = Array.from({ length: MAX_PRODUCTION_QUEUE + 5 }, () => ({
    kind: "unit", type: "infantry", count: 1, monthsTotal: 2,
  }));
  const queue = normalizeProductionQueue({ France: { queue: items } });
  assert.equal(queue.France.queue.length, MAX_PRODUCTION_QUEUE);
});

import { enqueueOrders, stepLineMonth } from "./productionQueue.js";

test("an unaffordable order is rejected and the pool is untouched", () => {
  const result = enqueueOrders({
    pools: { manpower: 100, materiel: 100 },
    line: null,
    orders: [{ polity: "France", kind: "unit", type: "naval", count: 1 }],
  });
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /cannot afford/);
  assert.deepEqual(result.pools, { manpower: 100, materiel: 100 });
  assert.equal(result.line, null);
});

test("an affordable order is paid in full and enqueued with its build time", () => {
  const result = enqueueOrders({
    pools: { manpower: 1_000_000, materiel: 1000 },
    line: null,
    orders: [{ polity: "France", kind: "unit", type: "infantry", count: 2 }],
  });
  assert.equal(result.rejected.length, 0);
  assert.equal(result.pools.manpower, 1_000_000 - 16_000);
  assert.equal(result.pools.materiel, 1000 - 12);
  assert.equal(result.line.queue.length, 1);
  assert.equal(result.line.queue[0].monthsTotal, 4);
});

test("a full tail is rejected before it can take any money", () => {
  const full = { kind: "unit", type: "infantry", count: 1, monthsTotal: 2 };
  const line = { queue: Array.from({ length: MAX_PRODUCTION_QUEUE }, () => ({ ...full })) };
  const result = enqueueOrders({
    pools: { manpower: 1_000_000, materiel: 1000 },
    line,
    orders: [{ polity: "France", kind: "unit", type: "infantry", count: 1 }],
  });
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /line full/);
  assert.equal(result.pools.manpower, 1_000_000, "a full line never takes money");
});

test("the line builds one item at a time, in order, and stamps each completion", () => {
  let line = { queue: [
    { kind: "unit", type: "garrison", count: 1, monthsTotal: 1 },
    { kind: "unit", type: "infantry", count: 1, monthsTotal: 2 },
  ] };
  const first = stepLineMonth(line, { monthOffset: 1 });
  assert.equal(first.completions.length, 1);
  assert.equal(first.completions[0].type, "garrison");
  assert.equal(first.completions[0].monthOffset, 1);
  // The successor was promoted but NOT advanced this month.
  assert.equal(first.line.active.type, "infantry");
  assert.equal(first.line.active.monthsDone, 0);
  const second = stepLineMonth(first.line, { monthOffset: 2 });
  assert.equal(second.completions.length, 0);
  assert.equal(second.line.active.monthsDone, 1);
  const third = stepLineMonth(second.line, { monthOffset: 3 });
  assert.equal(third.completions.length, 1);
  assert.equal(third.completions[0].type, "infantry");
  assert.equal(third.completions[0].monthOffset, 3);
  assert.equal(third.line, null);
});

test("a null line steps to nothing", () => {
  assert.deepEqual(stepLineMonth(null, { monthOffset: 1 }), { line: null, completions: [] });
});

test("the same commit-step sequence always produces the same completions", () => {
  const line = { queue: [{ kind: "building", type: "fortification", count: 1, monthsTotal: 4, at: "Metz" }] };
  const run = () => {
    let current = line;
    const out = [];
    for (let month = 1; month <= 5; month += 1) {
      const stepped = stepLineMonth(current, { monthOffset: month });
      current = stepped.line;
      out.push(...stepped.completions);
    }
    return out;
  };
  assert.deepEqual(run(), run());
  assert.equal(run().length, 1);
  assert.equal(run()[0].at, "Metz");
});
