import test from "node:test";
import assert from "node:assert/strict";

import { HEATMAP_MODES, buildHeatmapModel, regionPoint } from "./heatmapModel.js";

const region = (id, overrides = {}) => ({ id, owner: "A", lng: 10, lat: 20, ...overrides });

test("regionPoint prefers its own coordinate", () => {
  assert.deepEqual(regionPoint({ lng: 3, lat: 4, bounds: [[0, 0], [10, 10]] }), { lng: 3, lat: 4 });
});

test("regionPoint falls back to the bounds centre", () => {
  assert.deepEqual(regionPoint({ bounds: [[0, 10], [20, 30]] }), { lng: 10, lat: 20 });
});

test("regionPoint skips a region with neither coordinate nor bounds", () => {
  assert.equal(regionPoint({ id: "x" }), null);
  assert.equal(regionPoint({ bounds: [[0, 0], [Number.NaN, 10]] }), null);
});

test("the three documented modes are the whole vocabulary", () => {
  assert.deepEqual([...HEATMAP_MODES], ["wealth", "strategy", "tension"]);
});

test("an unknown mode falls back to tension", () => {
  const model = buildHeatmapModel({ mode: "nonsense", regions: [region("r1")] });
  assert.equal(model.mode, "tension");
});

test("wealth weights a region by its controller's GDP", () => {
  const model = buildHeatmapModel({
    mode: "wealth",
    regions: [region("r1", { owner: "Rich" }), region("r2", { owner: "Poor" })],
    countryStats: { Rich: { economy: { gdp: 300 } }, Poor: { economy: { gdp: 100 } } },
  });
  const byId = Object.fromEntries(model.features.features.map((f) => [f.properties.regionId, f.properties]));
  assert.equal(model.pointCount, 2);
  assert.equal(model.max, 300);
  assert.equal(byId.r1.weight, 1);
  assert.equal(byId.r2.weight, 0.333333);
  assert.equal(byId.r1.owner, "Rich");
});

test("wealth gives a region with no sheet a zero weight", () => {
  const model = buildHeatmapModel({ mode: "wealth", regions: [region("r1", { owner: "Ghost" })], countryStats: {} });
  assert.equal(model.max, 0);
  assert.equal(model.features.features[0].properties.weight, 0);
});

test("strategy weights a region by its controller's plan score", () => {
  const model = buildHeatmapModel({
    mode: "strategy",
    regions: [region("r1", { owner: "A" }), region("r2", { owner: "B" })],
    plans: { A: { goal: "military_insurance", score: 80 }, B: { goal: "political_bloc", score: 40 } },
  });
  const byId = Object.fromEntries(model.features.features.map((f) => [f.properties.regionId, f.properties]));
  assert.equal(byId.r1.weight, 1);
  assert.equal(byId.r2.weight, 0.5);
});

test("tension ranks contested above a front and ignores an unroled region", () => {
  const model = buildHeatmapModel({
    mode: "tension",
    regions: [region("hot"), region("warm"), region("quiet")],
    frontLines: { regions: { hot: { roles: ["contested", "front"] }, warm: { roles: ["front"] } } },
  });
  const byId = Object.fromEntries(model.features.features.map((f) => [f.properties.regionId, f.properties]));
  assert.equal(model.max, 1);
  assert.equal(byId.hot.weight, 1);
  assert.equal(byId.warm.weight, 0.7);
  assert.equal(byId.quiet.weight, 0);
});

test("every normalized weight stays within zero and one", () => {
  const model = buildHeatmapModel({
    mode: "tension",
    regions: [region("a"), region("b", { owner: "B" })],
    frontLines: { regions: { a: { roles: ["contested"] }, b: { roles: ["front"] } } },
  });
  for (const feature of model.features.features) {
    assert.ok(feature.properties.weight >= 0 && feature.properties.weight <= 1);
  }
});

test("an empty region list yields no points and no division", () => {
  const model = buildHeatmapModel({ mode: "wealth" });
  assert.equal(model.pointCount, 0);
  assert.equal(model.max, 0);
  assert.deepEqual(model.features, { type: "FeatureCollection", features: [] });
});

test("a region without a point is skipped, not pinned at zero", () => {
  const model = buildHeatmapModel({ mode: "wealth", regions: [region("ok"), { id: "nowhere", owner: "A" }] });
  assert.equal(model.pointCount, 1);
  assert.equal(model.features.features[0].properties.regionId, "ok");
});

test("the model is deep-equal across two calls", () => {
  const input = {
    mode: "strategy",
    regions: [region("r1"), region("r2", { owner: "B", bounds: [[0, 0], [2, 2]] })],
    plans: { A: { score: 55 }, B: { score: 20 } },
  };
  assert.deepEqual(buildHeatmapModel(input), buildHeatmapModel(input));
});
