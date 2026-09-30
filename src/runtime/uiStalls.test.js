/*! Open Historia — main-thread stall recorder tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/uiStalls.test.js
//
// The stall recorder is what puts the numbers behind "it froze when I picked a
// country" into the Diagnostics Log. Node has no PerformanceObserver, so a fake
// one stands in and drives the same callback the browser would.

import test from "node:test";
import assert from "node:assert/strict";

class FakePerformanceObserver {
  constructor(callback) {
    FakePerformanceObserver.instance = this;
    this.callback = callback;
  }

  observe() {}

  emit(entries) {
    this.callback({ getEntries: () => entries });
  }
}

globalThis.PerformanceObserver = FakePerformanceObserver;

const {
  __resetUiStallsForTests,
  getUiStalls,
  installUiStallObserver,
  markUiInteraction,
  summarizeUiStalls,
} = await import("./uiStalls.js");

test("a long task is recorded and attributed to the interaction just before it", () => {
  __resetUiStallsForTests();
  installUiStallObserver();
  markUiInteraction("country pick");
  FakePerformanceObserver.instance.emit([{ duration: 1840, name: "self", attribution: [] }]);

  const stalls = getUiStalls();
  assert.equal(stalls.length, 1);
  assert.equal(stalls[0].ms, 1840);
  assert.equal(stalls[0].phase, "country pick");

  const summary = summarizeUiStalls();
  assert.equal(summary.count, 1);
  assert.equal(summary.worstMs, 1840);
  assert.equal(summary.worstPhase, "country pick");
});

test("no stall means no report section at all", () => {
  __resetUiStallsForTests();
  assert.equal(summarizeUiStalls(), null);
});

test("the worst stall sets the headline, not the newest", () => {
  __resetUiStallsForTests();
  installUiStallObserver();
  FakePerformanceObserver.instance.emit([
    { duration: 620, name: "self", attribution: [] },
    { duration: 140, name: "self", attribution: [{ containerType: "window" }] },
  ]);

  const summary = summarizeUiStalls();
  assert.equal(summary.count, 2);
  assert.equal(summary.totalMs, 760);
  assert.equal(summary.worstMs, 620);
});
