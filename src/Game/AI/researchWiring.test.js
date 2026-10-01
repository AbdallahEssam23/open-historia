/*! Open Historia - portions (research wiring guard) (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The engine's research completion is wired into applySimulationResult, a 15000
// line function that is not exported and cannot be imported without building a
// whole turn's fixtures. What matters is that the research block lands on the
// event path with the engine flag, and lands between the production completions
// and the stats snapshot; none of that is visible from outside. So this reads
// gameplay.js as text, scoping the checks to applySimulationResult's own body so
// a match elsewhere in the file cannot satisfy them by accident.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");

const bodyOf = (marker) => {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${marker} is present`);
  const end = source.indexOf("\nconst ", start + marker.length);
  return source.slice(start, end === -1 ? source.length : end);
};

test("the jump applies the engine's research ops as an engine-sourced event", () => {
  const body = bodyOf("const applySimulationResult = async ({");
  const completions = body.indexOf("completionBatches");
  const research = body.indexOf("researchOps");
  const stats = body.indexOf("captureCountryStatsHistory");
  assert.notEqual(completions, -1, "the production completions are present");
  assert.notEqual(research, -1, "the research ops are present");
  assert.notEqual(stats, -1, "the stats snapshot is present");
  assert.ok(
    completions < research && research < stats,
    "the research ops must land after the production completions and before the stats snapshot",
  );
  const block = body.slice(research, stats);
  assert.match(block, /engineSourced:\s*true/);
  assert.match(block, /boardOnlyEventIds:/);
  // normalizeEvents drops an event with an empty title and description, which
  // would silently discard every engine research close.
  assert.doesNotMatch(block, /title: ""/);
  assert.match(block, /title: "[^"]+"/);
});
