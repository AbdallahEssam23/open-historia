/*! Open Historia — startup telemetry checks © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import {
  describeStartupPerf,
  formatStartupPerf,
  lastStartupPerf,
  noteHudReady,
  recordStartupPerf,
} from "./startupPerf.js";

const summary = {
  bootMs: 4231.4,
  hudReadyMs: 1810,
  preloadMs: 3900,
  timeBudgetMs: 30000,
  deviceTier: "mid",
  constrained: true,
  at: "2026-01-01T00:00:00.000Z",
};

test("the console line and the Settings line say the same numbers", () => {
  assert.match(formatStartupPerf(summary), /ready in 4\.23s \(mid device, constrained\)/);
  assert.match(formatStartupPerf(summary), /HUD shell in hand 1\.81s · preload loop 3\.90s · budget 30\.00s/);
  assert.equal(
    describeStartupPerf(summary),
    "Started up in 4.23s · HUD shell at 1.81s · mid device · constrained profile",
  );
});

test("a sub-second start reads in milliseconds, an unmarked one says n/a, and nothing is empty strings", () => {
  assert.equal(
    describeStartupPerf({ ...summary, bootMs: 640.2, constrained: false }),
    "Started up in 640ms · HUD shell at 1.81s · mid device",
  );
  assert.match(
    formatStartupPerf({ ...summary, hudReadyMs: null, preloadMs: null }),
    /HUD shell in hand n\/a · preload loop n\/a/,
  );
  assert.equal(formatStartupPerf(null), "");
  assert.equal(describeStartupPerf(null), "");
  assert.equal(formatStartupPerf({ ...summary, hudReadyMs: null }).includes("HUD shell at"), false, "no HUD mark, no claim");
});

test("recording a start files it on the window, with the device class that shaped it", (t) => {
  t.mock.method(console, "info", () => {});
  const previous = globalThis.window;
  globalThis.window = {};
  try {
    noteHudReady();
    const recorded = recordStartupPerf({ preloadMs: 1234.56, timeBudgetMs: 30000 });
    assert.equal(globalThis.window.__OH_LAST_STARTUP_PERF__, recorded, "the object a report can copy");
    assert.equal(lastStartupPerf(), recorded);
    assert.equal(recorded.preloadMs, 1234.6);
    assert.equal(recorded.timeBudgetMs, 30000);
    assert.ok(recorded.bootMs >= 0);
    assert.ok(recorded.hudReadyMs >= 0, "the HUD mark noteHudReady took");
    assert.ok(["low", "mid", "high", "full"].includes(recorded.deviceTier));
    assert.equal(typeof recorded.constrained, "boolean");
    assert.match(recorded.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test("outside a page there is nothing to record and nothing to report", () => {
  const previous = globalThis.window;
  delete globalThis.window;
  try {
    assert.equal(recordStartupPerf({}), null);
    assert.equal(lastStartupPerf(), null);
  } finally {
    if (previous !== undefined) globalThis.window = previous;
  }
});
