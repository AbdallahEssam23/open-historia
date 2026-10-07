import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(here, rel), "utf8");

const basemaps = read("../src/Editor/basemaps.js");
const picker = read("../src/Editor/BasemapPicker.jsx");
const olMap = read("../src/Editor/OlMap.jsx");
const doc = read("../src/Editor/useMapDocument.js");
const assets = read("../src/runtime/assets.js");
const olVector = read("../src/runtime/vectorBasemapOpenLayers.js");
const pickerMap = read("../src/Game/GameUI/CountryPickerMap.jsx");

test("the editor offers only the drawn, free-vector basemaps", () => {
  assert.match(basemaps, /id: "parchment"/);
  assert.match(basemaps, /id: "modern-tactical"/);
  assert.match(basemaps, /label: "Parchment \(historical\)"/);
  assert.match(basemaps, /label: "Modern Tactical"/);
  // No ArcGIS tile helper survives in the editor's basemap module.
  assert.doesNotMatch(basemaps, /arcgisonline\.com|MapServer|esriXyzUrl|esriPreviewUrl|service:/);
});

test("built-in basemap cards preview a colour swatch, not a fetched thumbnail", () => {
  assert.match(basemaps, /swatch:/);
  assert.match(picker, /swatch=\{b\.swatch\}/);
  assert.match(picker, /const BasemapCard = \(\{ title, imageUrl, swatch/);
});

test("OpenLayers draws the reference basemap from vector tiles, not ESRI XYZ", () => {
  assert.match(olVector, /import VectorTileLayer from "ol\/layer\/VectorTile"/);
  assert.match(olVector, /new MVT\(/);
  assert.match(olVector, /vectorTileTemplate\(\)/);
  assert.match(olMap, /vectorOlLayer\(\{ theme \}\)/);
  assert.doesNotMatch(olMap, /esriXyzUrl|arcgisonline/i);
  assert.doesNotMatch(olVector, /arcgisonline\.com|MapServer/);
});

test("the country picker paints the drawn basemap too, not ArcGIS", () => {
  assert.match(pickerMap, /vectorOlLayer\(\{ theme: "modern" \}\)/);
  assert.doesNotMatch(pickerMap, /ESRI_DARK_GRAY_TILES|arcgisonline|MapServer/);
});

test("the editor opens on a drawn basemap while the game default stays ocean", () => {
  assert.match(doc, /basemap: "parchment"/);
  assert.match(assets, /export const DEFAULT_BASEMAP_ID = "ocean"/);
  assert.match(assets, /if \(isBuiltinBasemapId\(scenarioId\)\) return scenarioId/);
});
