import assert from "node:assert/strict";
import test from "node:test";

import {
  VISUAL_STEP_KEYS,
  VISUAL_VIEWS,
  summarizeVisualRun,
  visualPolicy,
} from "./views.mjs";

test("every view is uniquely identified and described", () => {
  assert.ok(Array.isArray(VISUAL_VIEWS) && VISUAL_VIEWS.length > 0);
  const seen = new Set();
  for (const view of VISUAL_VIEWS) {
    assert.match(view.id, /^[a-z][a-z0-9-]*$/, `bad id: ${view.id}`);
    assert.equal(seen.has(view.id), false, `duplicate id: ${view.id}`);
    seen.add(view.id);
    assert.equal(typeof view.description, "string");
    assert.ok(view.description.length > 0, `empty description: ${view.id}`);
    assert.equal(typeof view.waitFor, "string");
    assert.ok(view.waitFor.length > 0, `empty waitFor: ${view.id}`);
    assert.ok(Array.isArray(view.steps) && view.steps.length > 0, `no steps: ${view.id}`);
  }
});

test("every step uses exactly one known vocabulary key", () => {
  for (const view of VISUAL_VIEWS) {
    for (const step of view.steps) {
      const keys = Object.keys(step);
      assert.equal(keys.length, 1, `step has ${keys.length} keys in ${view.id}`);
      assert.ok(VISUAL_STEP_KEYS.includes(keys[0]), `unknown step key ${keys[0]} in ${view.id}`);
    }
  }
});

test("the policy defaults are advisory, bounded and numeric", () => {
  const policy = visualPolicy({});
  assert.equal(policy.strict, false);
  assert.equal(policy.update, false);
  assert.ok(Number.isInteger(policy.maxDiffPixels) && policy.maxDiffPixels >= 0);
  assert.ok(policy.maxDiffPixelRatio > 0 && policy.maxDiffPixelRatio < 1);
  assert.ok(policy.threshold > 0 && policy.threshold <= 1);
  assert.ok(policy.viewport.width > 0 && policy.viewport.height > 0);
  assert.ok(policy.timeoutMs > 0 && policy.mapIdleTimeoutMs > 0);
});

test("strict and update are opt-in and independent", () => {
  assert.equal(visualPolicy({ OH_VISUAL_STRICT: "1" }).strict, true);
  assert.equal(visualPolicy({ OH_VISUAL_STRICT: "true" }).strict, true);
  assert.equal(visualPolicy({ OH_VISUAL_STRICT: "0" }).strict, false);
  assert.equal(visualPolicy({ OH_VISUAL_STRICT: "false" }).strict, false);
  assert.equal(visualPolicy({ OH_VISUAL_STRICT: "" }).strict, false);

  assert.equal(visualPolicy({ OH_VISUAL_UPDATE: "1" }).update, true);
  assert.equal(visualPolicy({ OH_VISUAL_UPDATE: "0" }).update, false);

  const strictOnly = visualPolicy({ OH_VISUAL_STRICT: "1" });
  assert.equal(strictOnly.strict, true);
  assert.equal(strictOnly.update, false);
  const updateOnly = visualPolicy({ OH_VISUAL_UPDATE: "1" });
  assert.equal(updateOnly.strict, false);
  assert.equal(updateOnly.update, true);
});

test("a run is never blocking unless strict is asked for", () => {
  const results = [
    { id: "map", status: "passed" },
    { id: "map-heatmap", status: "failed", diffPixels: 400 },
    { id: "library", status: "skipped" },
  ];

  const advisory = summarizeVisualRun(results);
  assert.equal(advisory.total, 3);
  assert.equal(advisory.passed, 1);
  assert.equal(advisory.failed, 1);
  assert.equal(advisory.skipped, 1);
  assert.deepEqual(advisory.diffs, ["map-heatmap"]);
  assert.equal(advisory.blocking, false);

  const strict = summarizeVisualRun(results, { strict: true });
  assert.equal(strict.blocking, true);

  const cleanStrict = summarizeVisualRun([{ id: "map", status: "passed" }], { strict: true });
  assert.equal(cleanStrict.blocking, false);
});

test("an empty run summarizes to zeros and never blocks", () => {
  const summary = summarizeVisualRun([]);
  assert.deepEqual(
    { total: summary.total, passed: summary.passed, failed: summary.failed, skipped: summary.skipped },
    { total: 0, passed: 0, failed: 0, skipped: 0 },
  );
  assert.equal(summary.blocking, false);
});
