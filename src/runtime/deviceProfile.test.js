import test from "node:test";
import assert from "node:assert/strict";
import {
  DEVICE_TIERS,
  classifyDevice,
  classifyDeviceTier,
  mapRuntimeLimits,
  warmsWholeMapArchives,
} from "./deviceProfile.js";

test("the Android app and touch-only screens take the constrained path", () => {
  assert.equal(classifyDevice({ native: true }), true);
  assert.equal(classifyDevice({ touchOnly: true, deviceMemoryGb: 8 }), true);
});

test("deviceMemory can say small but never big: 8 is the spec's cap, not a desktop", () => {
  assert.equal(classifyDevice({ deviceMemoryGb: 2 }), true);
  assert.equal(classifyDevice({ deviceMemoryGb: 4 }), true);
  assert.equal(classifyDevice({ deviceMemoryGb: 8 }), false);
  // A browser that does not report it (Firefox, Safari) is not guessed small.
  assert.equal(classifyDevice({ deviceMemoryGb: null }), false);
  assert.equal(classifyDevice({ deviceMemoryGb: 0 }), false);
  assert.equal(classifyDevice({}), false);
});

test("the stored override wins over every signal", () => {
  assert.equal(classifyDevice({ native: true, override: "full" }), false);
  assert.equal(classifyDevice({ deviceMemoryGb: 16, override: "constrained" }), true);
  assert.equal(classifyDevice({ native: true, override: "something else" }), true);
});

test("a phone gets two MapLibre workers and eight requests; a desktop what it had", () => {
  assert.deepEqual(mapRuntimeLimits({ hardwareThreads: 8, constrained: true }), { workerCount: 2, parallelImageRequests: 8 });
  assert.deepEqual(mapRuntimeLimits({ hardwareThreads: 8 }), { workerCount: 4, parallelImageRequests: 16 });
  assert.deepEqual(mapRuntimeLimits({ hardwareThreads: 16 }), { workerCount: 6, parallelImageRequests: 24 });
  assert.deepEqual(mapRuntimeLimits({ hardwareThreads: 2 }), { workerCount: 2, parallelImageRequests: 16 });
  assert.deepEqual(mapRuntimeLimits({}), { workerCount: 2, parallelImageRequests: 16 });
});

test("tiers keep a weak phone weak and stop treating a strong one as weak", () => {
  // Every classification is one of the four names, nothing else.
  const cases = [
    { native: true, deviceMemoryGb: 4, hardwareThreads: 8 },
    { native: true, deviceMemoryGb: null, hardwareThreads: 8 },
    { native: true, deviceMemoryGb: 8, hardwareThreads: 8 },
    { deviceMemoryGb: 8, hardwareThreads: 8 },
    { override: "full" },
    { override: "constrained" },
  ];
  for (const signals of cases) {
    assert.ok(DEVICE_TIERS.includes(classifyDeviceTier(signals)), `${JSON.stringify(signals)} resolves to a known tier`);
  }
  // 4 GB phones, and the coarse value a 6 GB phone reports, stay at the floor.
  assert.equal(classifyDeviceTier({ native: true, deviceMemoryGb: 4, hardwareThreads: 8 }), "low");
  assert.equal(classifyDeviceTier({ touchOnly: true, deviceMemoryGb: 2, hardwareThreads: 8 }), "low");
  // A phone that reports no memory (Safari) is not guessed strong.
  assert.equal(classifyDeviceTier({ native: true, deviceMemoryGb: null, hardwareThreads: 8 }), "mid");
  // Big memory but a weak CPU is not promoted either.
  assert.equal(classifyDeviceTier({ native: true, deviceMemoryGb: 8, hardwareThreads: 4 }), "mid");
  assert.equal(classifyDeviceTier({ native: true, deviceMemoryGb: 8, hardwareThreads: 8 }), "high");
  // A desktop takes the unrestricted path it always had.
  assert.equal(classifyDeviceTier({ deviceMemoryGb: 8, hardwareThreads: 8 }), "full");
  assert.equal(classifyDeviceTier({ deviceMemoryGb: null, hardwareThreads: 2 }), "full");
  // The stored override still wins.
  assert.equal(classifyDeviceTier({ native: true, deviceMemoryGb: 8, hardwareThreads: 8, override: "constrained" }), "low");
  assert.equal(classifyDeviceTier({ deviceMemoryGb: 2, hardwareThreads: 2, override: "full" }), "full");
});

test("a tier sets the map runtime limits; no tier keeps the original formula", () => {
  assert.deepEqual(mapRuntimeLimits({ tier: "low" }), { workerCount: 2, parallelImageRequests: 8 });
  assert.deepEqual(mapRuntimeLimits({ tier: "mid" }), { workerCount: 3, parallelImageRequests: 12 });
  assert.deepEqual(mapRuntimeLimits({ tier: "high" }), { workerCount: 4, parallelImageRequests: 16 });
  // "full" has no fixed row: it falls through to the formula the desktop used.
  assert.deepEqual(mapRuntimeLimits({ tier: "full", hardwareThreads: 16 }), { workerCount: 6, parallelImageRequests: 24 });
  assert.deepEqual(mapRuntimeLimits({ tier: "high", hardwareThreads: 2 }), { workerCount: 4, parallelImageRequests: 16 });
});

test("the map asks for its tier before the first map is made", async () => {
  const fs = await import("node:fs");
  const setup = fs.readFileSync(new URL("../Game/Map/mapLibreSetup.js", import.meta.url), "utf8");
  assert.match(setup, /import \{[^}]*deviceTier[^}]*\} from "\.\.\/\.\.\/runtime\/deviceProfile\.js"/);
  assert.match(setup, /mapRuntimeLimits\(\{[\s\S]*?tier: deviceTier\(\)/);
});

test("a phone's browser range-reads the big map archives; the Android app and a desktop load them whole", async () => {
  assert.equal(warmsWholeMapArchives({ native: false, constrained: true }), false, "iOS Safari, a phone's Chrome");
  assert.equal(warmsWholeMapArchives({ native: false, constrained: false }), true, "a desktop browser");
  assert.equal(warmsWholeMapArchives({ native: true, constrained: true }), true, "the Android app cannot range-read its APK");
  const fs = await import("node:fs");
  const preload = fs.readFileSync(new URL("./preload.js", import.meta.url), "utf8");
  for (const key of ["countries", "regions"]) {
    assert.ok(preload.includes(`warmsWholeMapArchives() ? warmPmtilesArchive(PMTILES_ARCHIVES.${key}`), `the ${key} warm asks first`);
  }
});

test("only the map imports maplibre-gl, so the first download goes without it", async () => {
  const fs = await import("node:fs");
  const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
  assert.doesNotMatch(read("./assets.js"), /from "maplibre-gl"/);
  assert.doesNotMatch(read("../main.jsx"), /configureMapRuntime/);
  assert.match(read("../App.jsx"), /const WorldMap = lazy\(\(\) => import\("\.\/Game\/Map\/World\.jsx"\)\)/);
  assert.match(read("../Game/Map/World.jsx"), /\nconfigureMapRuntime\(\);/);
});
