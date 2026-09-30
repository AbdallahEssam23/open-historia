/*! Open Historia — country-label caching © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/countryLabels.test.js
//
// A label translation arrives as an "i18n:labels-updated" event, and the map
// answers it with a forced reload. That force means "a translation landed", NOT
// "the labels changed", so the loader fingerprints the names the tile would draw
// and serves the cache when they are unchanged — the rebuild is the expensive
// part, and running it on every content batch froze the map. These pin the
// reuse, the regeneration when the names really do change, and the fingerprint.

import test from "node:test";
import assert from "node:assert/strict";

import { createCountryLabelLoader } from "./countryLabels.js";

const TILE = { data: new Uint8Array([1, 2, 3, 4]) };

// Minimal vector-tile stand-in: the two countries the fingerprint walks.
const decodeTwoCountries = async () => ({
  layers: {
    countries: {
      length: 2,
      feature: (index) => ({
        properties: index === 0
          ? { GID_0: "EGY", Country: "Egypt" }
          : { GID_0: "FRA", Country: "France" },
      }),
    },
  },
});

const payload = (labelSignature) => ({
  pointLabelData: { type: "FeatureCollection", features: [{ id: "egy" }] },
  curvedLabelData: { type: "FeatureCollection", features: [{ id: "egy" }] },
  labelSignature,
});

// A loader whose IO is all fakes, with a counter on the expensive rebuild.
const makeLoader = ({ cached = null, built = payload("built"), resolveName = (name) => name, readLabel = (name) => name } = {}) => {
  const calls = { build: 0, writes: [] };
  const loader = createCountryLabelLoader({
    getTileData: async () => TILE,
    decodeTile: decodeTwoCountries,
    readJson: async () => cached,
    writeJson: async (key, data) => { calls.writes.push({ key, data }); },
    resolveName,
    readLabel,
    build: async () => { calls.build += 1; return built; },
  });
  return { loader, calls };
};

test("a normal load serves the cached payload without rebuilding", async () => {
  const cached = payload("anything");
  const { loader, calls } = makeLoader({ cached });
  assert.equal(await loader.load(), cached);
  assert.equal(calls.build, 0);
});

test("a forced load with unchanged names returns the cache and rebuilds nothing", async () => {
  const { loader: probe } = makeLoader();
  const signature = await probe.nameSignature(TILE);

  const cached = payload(signature);
  const { loader, calls } = makeLoader({ cached });
  const result = await loader.load({ force: true });
  assert.equal(result, cached, "the cached payload is reused");
  assert.equal(calls.build, 0, "the atlas was not rebuilt");
  assert.deepEqual(calls.writes, [], "an unchanged cache is not persisted again");
});

test("a forced load with changed names regenerates and re-stamps", async () => {
  const { loader, calls } = makeLoader({ cached: payload("stale-signature") });
  const result = await loader.load({ force: true });
  assert.equal(calls.build, 1, "the atlas was rebuilt once");
  const expected = await loader.nameSignature(TILE);
  assert.equal(result.labelSignature, expected);
  assert.equal(calls.writes.length, 1);
  assert.equal(calls.writes[0].data.labelSignature, expected);
});

test("the fingerprint is stable, and changes when a name does", async () => {
  const { loader: same } = makeLoader();
  assert.equal(await same.nameSignature(TILE), await same.nameSignature(TILE));

  const { loader: renamed } = makeLoader({
    resolveName: (name) => (name === "Egypt" ? "مصر" : name),
  });
  assert.notEqual(await same.nameSignature(TILE), await renamed.nameSignature(TILE));
});

test("the fingerprint reads through the injected reader, never translateLabel", async () => {
  let reads = 0;
  const { loader } = makeLoader({ readLabel: (name) => { reads += 1; return name; } });
  await loader.nameSignature(TILE);
  assert.equal(reads, 2, "one read per country, and no other path was used");
});
