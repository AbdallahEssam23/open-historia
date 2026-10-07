import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILTIN_BASEMAP_CHOICES,
  DEFAULT_BASEMAP_ID,
  PARCHMENT_BASEMAP_ID,
  isBuiltinBasemapId,
  resolveBasemapId,
} from "../../runtime/assets.js";
import {
  PARCHMENT_PALETTE,
  PARCHMENT_SOURCE_ID,
  buildParchmentStyle,
  isParchmentBasemap,
  parchmentGlyphsUrl,
  parchmentSourceUrl,
} from "./parchmentStyle.js";

const HEX = /^#[0-9a-f]{6}$/i;
const VALID_LAYER_TYPES = new Set(["background", "fill", "line", "symbol"]);

test("parchment is a first-class builtin basemap without replacing the default", () => {
  assert.equal(PARCHMENT_BASEMAP_ID, "parchment");
  assert.equal(isParchmentBasemap("parchment"), true);
  assert.equal(isParchmentBasemap("ocean"), false);
  assert.equal(isBuiltinBasemapId("parchment"), true);
  assert.equal(isBuiltinBasemapId("ocean"), true);
  assert.equal(isBuiltinBasemapId("missing"), false);
  // A player override wins, and the neutral fallback is still ocean so the
  // existing built-in contract is untouched.
  assert.equal(resolveBasemapId({ overrideId: "parchment", scenarioId: "ocean" }), "parchment");
  assert.equal(resolveBasemapId({ overrideId: "missing", scenarioId: "missing" }), DEFAULT_BASEMAP_ID);
  assert.equal(DEFAULT_BASEMAP_ID, "ocean");
});

test("the picker lists parchment for the player", () => {
  const entry = BUILTIN_BASEMAP_CHOICES.find((basemap) => basemap.id === PARCHMENT_BASEMAP_ID);
  assert.ok(entry, "parchment is offered in the basemap picker");
  assert.match(entry.label, /parchment/i);
  assert.ok(BUILTIN_BASEMAP_CHOICES.length > 1, "raster basemaps are still listed");
});

test("the parchment source and glyph endpoints are configurable with live defaults", () => {
  assert.match(parchmentSourceUrl(), /^https?:\/\//);
  assert.match(parchmentGlyphsUrl(), /\{fontstack\}/);
  assert.match(parchmentGlyphsUrl(), /\{range\}/);
});

test("buildParchmentStyle produces a valid vector MapLibre style", () => {
  const style = buildParchmentStyle();
  assert.equal(style.version, 8);
  assert.equal(typeof style.glyphs, "string");
  assert.match(style.glyphs, /\{fontstack\}/);

  const source = style.sources[PARCHMENT_SOURCE_ID];
  assert.ok(source, "the OpenMapTiles vector source exists");
  assert.equal(source.type, "vector");
  assert.equal(typeof source.url, "string");
  assert.ok(source.attribution, "the free provider is credited");

  assert.ok(Array.isArray(style.layers) && style.layers.length > 0);
  assert.equal(style.layers[0].type, "background");

  const ids = new Set();
  for (const layer of style.layers) {
    assert.ok(VALID_LAYER_TYPES.has(layer.type), `${layer.id} has a renderable type`);
    assert.equal(ids.has(layer.id), false, `${layer.id} is unique`);
    ids.add(layer.id);
    if (layer.type !== "background") {
      assert.equal(layer.source, PARCHMENT_SOURCE_ID, `${layer.id} reads the vector source`);
      assert.equal(typeof layer["source-layer"], "string", `${layer.id} names a source layer`);
    }
  }
});

test("parchment does not fall back to the ESRI raster services", () => {
  const serialized = JSON.stringify(buildParchmentStyle());
  assert.doesNotMatch(serialized, /arcgisonline|arcgis\.com|MapServer|ESRI/i);
});

test("the palette is frozen and every colour is a plain hex", () => {
  assert.ok(Object.isFrozen(PARCHMENT_PALETTE));
  for (const [name, value] of Object.entries(PARCHMENT_PALETTE)) {
    assert.match(value, HEX, `${name} is a six-digit hex colour`);
  }
});
