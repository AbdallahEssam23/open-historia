/*! Open Historia - portions (force pools wiring guard) (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The force-pools wiring spans two unexported call sites inside a 15000 line
// module: the projection that feeds the model and the authoritative advance that
// commits the turn. Both must charge the OPENING roster and the authoritative
// call must carry this turn's declaration, none of which is visible from the
// outside. So this reads gameplay.js as text and scopes each check to the
// enclosing function body, so a match elsewhere cannot satisfy it by accident.
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

test("the real advance passes an opening-roster upkeep table and the declared mobilization", () => {
  const body = bodyOf("const applySimulationResult = async ({");
  const advance = body.indexOf("advanceWorldEconomy(nextWorld");
  assert.notEqual(advance, -1);
  const call = body.slice(advance, advance + 900);
  assert.match(call, /upkeep:/);
  assert.match(call, /declaredMobilization:/);
});

test("the projection builds the upkeep table and the pool digest before the model is asked", () => {
  const body = bodyOf("export const simulateTimelineJump = async (");
  assert.match(body, /buildUpkeepTable\(bundle\.world\)/);
  assert.match(body, /variables\.forcePoolsDigest = buildEconomyDigest\(/);
  // The pool digest names the posture in force this period and the shortfall the
  // army could not pay, and it is built only when a month actually advanced.
  assert.match(body, /playerShortfall: projected\.shortfall/);
  assert.match(body, /postureChanged:/);
  assert.match(body, /if \(projected\.months > 0\)/);
});

test("the upkeep table is built from the opening world, not the post-impact world", () => {
  const body = bodyOf("const applySimulationResult = async ({");
  assert.match(body, /buildUpkeepTable\(baseWorld\)/);
});
