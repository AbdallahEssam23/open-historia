// Run: node --test src/engine/audioCues.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { CUE_NAMES, MUSIC_STATES, resolveCue, resolveMusic, volumeGain } from "./audioCues.js";

test("every named cue resolves to a non-empty list of voices", () => {
  assert.ok(CUE_NAMES.length > 0);
  for (const name of CUE_NAMES) {
    const voices = resolveCue(name);
    assert.ok(Array.isArray(voices) && voices.length > 0, `${name} has voices`);
    for (const voice of voices) {
      assert.equal(typeof voice.type, "string");
      assert.ok(Number.isFinite(voice.frequency) && voice.frequency > 0, `${name} frequency`);
      assert.ok(Number.isFinite(voice.startOffset) && voice.startOffset >= 0, `${name} startOffset`);
      assert.ok(Number.isFinite(voice.duration) && voice.duration > 0, `${name} duration`);
      assert.ok(Number.isFinite(voice.peak) && voice.peak > 0 && voice.peak <= 1, `${name} peak`);
    }
  }
});

test("an unknown cue resolves to null rather than an empty sound", () => {
  assert.equal(resolveCue("nonsense"), null);
  assert.equal(resolveCue(""), null);
  assert.equal(resolveCue(null), null);
  assert.equal(resolveCue(undefined), null);
});

test("the same cue name resolves to the same voices every time", () => {
  assert.deepEqual(resolveCue("war"), resolveCue("war"));
  // Frozen, so a caller cannot mutate the shared catalog out from under another.
  assert.ok(Object.isFrozen(resolveCue("war")));
});

test("volumeGain clamps and squares the level", () => {
  assert.equal(volumeGain(0), 0);
  assert.equal(volumeGain(0.5), 0.25);
  assert.equal(volumeGain(1), 1);
  assert.equal(volumeGain(2), 1);
  assert.equal(volumeGain(-1), 0);
  assert.equal(volumeGain(Number.NaN), 0);
  assert.equal(volumeGain("loud"), 0);
});

test("every music state resolves to a sustained voice list", () => {
  assert.deepEqual([...MUSIC_STATES], ["idle", "tension", "war"]);
  for (const state of MUSIC_STATES) {
    const voices = resolveMusic(state);
    assert.ok(Array.isArray(voices) && voices.length > 0, `${state} has voices`);
    for (const voice of voices) {
      assert.equal(typeof voice.type, "string");
      assert.ok(Number.isFinite(voice.frequency) && voice.frequency > 0, `${state} frequency`);
      assert.ok(Number.isFinite(voice.peak) && voice.peak > 0 && voice.peak <= 1, `${state} peak`);
    }
  }
});

test("all music states share one voice count so the bed retunes instead of rebuilding", () => {
  const counts = new Set(MUSIC_STATES.map((state) => resolveMusic(state).length));
  assert.equal(counts.size, 1, "one voice count across states");
  assert.equal(resolveMusic("nonsense"), null);
});
