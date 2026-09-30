import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_QUALITY_LEVEL,
  QUALITY_FULL,
  QUALITY_MINIMAL,
  QUALITY_REDUCED,
  __resetAdaptiveQualityForTests,
  createQualityController,
  currentQualityLevel,
  reportFrameDelta,
  resetQualitySamples,
  subscribeQuality,
} from "./adaptiveQuality.js";

// A short window so a test can drive a decision in a handful of observations.
const TUNING = {
  windowSize: 4,
  evaluateEvery: 4,
  minSamples: 4,
  downgradeFrameMs: 24,
  upgradeFrameMs: 17,
};

const feed = (controller, deltaMs, times) => {
  for (let i = 0; i < times; i += 1) controller.observe(deltaMs);
  return controller.getLevel();
};

test("comfortable frames leave the level at full", () => {
  const controller = createQualityController({ tuning: TUNING });
  assert.equal(feed(controller, 16.7, 12), QUALITY_FULL);
});

test("missed frames step the level down, one window at a time, to the floor", () => {
  const controller = createQualityController({ tuning: TUNING });
  assert.equal(feed(controller, 40, 4), QUALITY_REDUCED, "first slow window");
  assert.equal(feed(controller, 40, 4), QUALITY_MINIMAL, "second slow window");
  assert.equal(feed(controller, 40, 20), QUALITY_MINIMAL, "never past the floor");
  assert.equal(MAX_QUALITY_LEVEL, QUALITY_MINIMAL);
});

test("a recovered device earns quality back", () => {
  const controller = createQualityController({ tuning: TUNING, level: QUALITY_MINIMAL });
  assert.equal(feed(controller, 10, 4), QUALITY_REDUCED);
  assert.equal(feed(controller, 10, 4), QUALITY_FULL);
  assert.equal(feed(controller, 10, 20), QUALITY_FULL, "never below full");
});

test("a decision clears the window, so stale slow frames cannot re-trigger it", () => {
  const controller = createQualityController({ tuning: TUNING });
  // One slow window downgrades; the window is then empty, so a single further
  // slow frame must not be enough for the next step.
  assert.equal(feed(controller, 40, 4), QUALITY_REDUCED);
  assert.equal(controller.observe(40), QUALITY_REDUCED);
});

test("frames between the thresholds leave the level alone", () => {
  const controller = createQualityController({ tuning: TUNING });
  // 20ms is neither worse than 24 nor better than 17: the hysteresis band.
  assert.equal(feed(controller, 20, 12), QUALITY_FULL);
});

test("non-finite and non-positive deltas are ignored", () => {
  const controller = createQualityController({ tuning: TUNING });
  for (const bad of [NaN, Infinity, 0, -5, null, undefined, "nope"]) {
    assert.equal(controller.observe(bad), QUALITY_FULL);
  }
  // Real samples still work after the noise.
  assert.equal(feed(controller, 40, 4), QUALITY_REDUCED);
});

test("reset forgets the window but keeps the earned level", () => {
  const controller = createQualityController({ tuning: TUNING });
  assert.equal(feed(controller, 40, 4), QUALITY_REDUCED);
  controller.reset();
  assert.equal(controller.getLevel(), QUALITY_REDUCED);
  // Two slow frames are not enough to step again; the window started empty.
  assert.equal(controller.observe(40), QUALITY_REDUCED);
  assert.equal(controller.observe(40), QUALITY_REDUCED);
});

test("the shared controller notifies subscribers only when the level changes", () => {
  __resetAdaptiveQualityForTests();
  const seen = [];
  const unsubscribe = subscribeQuality((level) => seen.push(level));
  resetQualitySamples();

  for (let i = 0; i < 20; i += 1) reportFrameDelta(40);
  assert.equal(currentQualityLevel(), QUALITY_REDUCED);
  assert.deepEqual(seen, [QUALITY_REDUCED], "one notification for one change");

  unsubscribe();
  for (let i = 0; i < 20; i += 1) reportFrameDelta(40);
  assert.equal(currentQualityLevel(), QUALITY_MINIMAL);
  assert.deepEqual(seen, [QUALITY_REDUCED], "no notification after unsubscribe");
  __resetAdaptiveQualityForTests();
});

test("a subscriber that throws cannot break the frame loop", () => {
  __resetAdaptiveQualityForTests();
  subscribeQuality(() => {
    throw new Error("boom");
  });
  resetQualitySamples();
  assert.doesNotThrow(() => {
    for (let i = 0; i < 20; i += 1) reportFrameDelta(40);
  });
  assert.equal(currentQualityLevel(), QUALITY_REDUCED);
  __resetAdaptiveQualityForTests();
});
