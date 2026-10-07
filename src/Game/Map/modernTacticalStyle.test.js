import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILTIN_BASEMAP_CHOICES,
  MODERN_BASEMAP_ID,
  isBuiltinBasemapId,
  isVectorBasemapId,
} from "../../runtime/assets.js";
import { OPENMAPTILES_SOURCE_ID } from "../../runtime/vectorBasemapSource.js";
import {
  MODERN_TACTICAL_PALETTE,
  MODERN_TACTICAL_SOURCE_ID,
  buildModernTacticalStyle,
  isModernTacticalBasemap,
} from "./modernTacticalStyle.js";

const HEX = /^#[0-9a-f]{6}$/i;
const VALID_LAYER_TYPES = new Set(["background", "fill", "line", "symbol"]);

test("modern tactical is a first-class builtin vector basemap", () => {
  assert.equal(MODERN_BASEMAP_ID, "modern-tactical");
  assert.equal(isModernTacticalBasemap("modern-tactical"), true);
  assert.equal(isModernTacticalBasemap("parchment"), false);
  assert.equal(isBuiltinBasemapId(MODERN_BASEMAP_ID), true);
  assert.equal(isVectorBasemapId(MODERN_BASEMAP_ID), true);
  const entry = BUILTIN_BASEMAP_CHOICES.find((basemap) => basemap.id === MODERN_BASEMAP_ID);
  assert.ok(entry, "modern tactical is offered in the basemap picker");
  assert.match(entry.label, /modern/i);
});

test("both drawn basemaps name the shared source id", () => {
  assert.equal(MODERN_TACTICAL_SOURCE_ID, OPENMAPTILES_SOURCE_ID);
});

test("buildModernTacticalStyle produces a valid vector MapLibre style", () => {
  const style = buildModernTacticalStyle();
  assert.equal(style.version, 8);
  assert.equal(typeof style.glyphs, "string");
  assert.match(style.glyphs, /\{fontstack\}/);

  const source = style.sources[MODERN_TACTICAL_SOURCE_ID];
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
      assert.equal(layer.source, MODERN_TACTICAL_SOURCE_ID, `${layer.id} reads the vector source`);
      assert.equal(typeof layer["source-layer"], "string", `${layer.id} names a source layer`);
    }
  }
});

test("modern tactical does not fall back to the ESRI raster services", () => {
  const serialized = JSON.stringify(buildModernTacticalStyle());
  assert.doesNotMatch(serialized, /arcgisonline|arcgis\.com|MapServer|ESRI/i);
});

test("the palette is frozen, dark, and every colour is a plain hex", () => {
  assert.ok(Object.isFrozen(MODERN_TACTICAL_PALETTE));
  for (const [name, value] of Object.entries(MODERN_TACTICAL_PALETTE)) {
    assert.match(value, HEX, `${name} is a six-digit hex colour`);
  }
  // A dark instrument panel, not a bright map: the ground must be nearly black.
  const ground = MODERN_TACTICAL_PALETTE.ground;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(ground.slice(i, i + 2), 16));
  assert.ok(r + g + b < 60, "the ground stays dark");
});
