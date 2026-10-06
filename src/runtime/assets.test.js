// Run: node --test src/runtime/assets.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { primeCustomRegionCatalog, primeCustomRegionCatalogEntries } from "./assets.js";

const feature = (id, typeId) => ({
  type: "Feature",
  properties: { id, name: id, ...(typeId ? { typeId } : {}) },
  geometry: null,
});

test("the scenario catalog records the declared region terrain", () => {
  const geojson = {
    type: "FeatureCollection",
    features: [feature("C1", "coastal"), feature("L1", "land")],
  };
  const out = primeCustomRegionCatalog(geojson, { url: "test://regions", invalidateCatalog: false });
  const terrain = Object.fromEntries(out.map((entry) => [entry.id, entry.type]));
  assert.equal(terrain.C1, "coastal");
  assert.equal(terrain.L1, "land");
});

test("a legacy `type` property still projects when typeId is absent", () => {
  const geojson = {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { id: "C2", name: "C2", type: "coastal" }, geometry: null }],
  };
  const out = primeCustomRegionCatalog(geojson, { url: "test://regions", invalidateCatalog: false });
  assert.equal(out[0].type, "coastal");
});

test("the compact catalog keeps a record's declared terrain", () => {
  const out = primeCustomRegionCatalogEntries(
    [{ id: "C3", name: "C3", type: "coastal" }, { id: "L3", name: "L3", type: "land" }],
    { url: "test://records", invalidateCatalog: false },
  );
  const terrain = Object.fromEntries(out.map((entry) => [entry.id, entry.type]));
  assert.equal(terrain.C3, "coastal");
  assert.equal(terrain.L3, "land");
});
