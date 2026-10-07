import test from "node:test";
import assert from "node:assert/strict";

import { buildHeatmapData, buildHeatmapPlans, heatmapRegionsFromCatalog } from "./heatmapData.js";

const catalog = [
  { id: "r1", country: "Spain", lng: 1, lat: 2 },
  { id: "r2", country: "France", bounds: [[10, 10], [20, 20]] },
];

const world = {
  countryStats: {
    Spain: { economy: { gdp: 100, gdpPerCapita: 5, gdpGrowth: 4, publicDebt: 20, unemployment: 3 }, stability: 70 },
    France: { economy: { gdp: 300, gdpPerCapita: 9, gdpGrowth: 2, publicDebt: 40, unemployment: 6 }, stability: 55 },
  },
};

test("heatmapRegionsFromCatalog carries ids, coordinates and the live owner", () => {
  const regions = heatmapRegionsFromCatalog(catalog, undefined);
  assert.deepEqual(regions.map((r) => [r.id, r.owner, r.lng ?? null, r.lat ?? null]), [
    ["r1", "Spain", 1, 2],
    ["r2", "France", null, null],
  ]);
});

test("an ownership override wins over the catalog's base country", () => {
  const regions = heatmapRegionsFromCatalog(catalog, { r1: "France" });
  assert.equal(regions[0].owner, "France");
});

test("a region without an id is dropped", () => {
  assert.equal(heatmapRegionsFromCatalog([{ country: "Spain" }, { id: "r1", country: "Spain" }], undefined).length, 1);
});

test("buildHeatmapPlans returns a scored plan for the player's polity", () => {
  const plans = buildHeatmapPlans(world, { playerPolity: "Spain" });
  assert.ok(plans.Spain);
  assert.ok(plans.Spain.score > 0);
  assert.ok(typeof plans.Spain.goal === "string");
});

test("buildHeatmapPlans omits a polity that is not in play", () => {
  const plans = buildHeatmapPlans(world, { playerPolity: "Spain" });
  assert.equal(plans.Atlantis, undefined);
});

test("wealth weighs a region by its controller's GDP", () => {
  const model = buildHeatmapData(world, catalog, { mode: "wealth", playerPolity: "Spain" });
  const byId = Object.fromEntries(model.features.features.map((f) => [f.properties.regionId, f.properties]));
  assert.equal(byId.r1.owner, "Spain");
  assert.equal(byId.r1.weight, 0.333333);
  assert.equal(byId.r2.weight, 1);
});

test("strategy produces a non-zero gradient from the derived plans", () => {
  const model = buildHeatmapData(world, catalog, { mode: "strategy", playerPolity: "Spain" });
  assert.ok(model.features.features.length >= 1);
  assert.ok(model.features.features.some((f) => f.properties.weight > 0));
});

test("tension with no war is a flat zero map", () => {
  const model = buildHeatmapData(world, catalog, { mode: "tension", playerPolity: "Spain" });
  assert.equal(model.max, 0);
  assert.ok(model.features.features.every((f) => f.properties.weight === 0));
});

test("an unknown mode falls back to tension", () => {
  const model = buildHeatmapData(world, catalog, { mode: "nonsense", playerPolity: "Spain" });
  assert.equal(model.mode, "tension");
});

test("an empty world never throws and yields no points", () => {
  const model = buildHeatmapData({}, [], { mode: "wealth" });
  assert.equal(model.pointCount, 0);
  assert.equal(model.max, 0);
});
