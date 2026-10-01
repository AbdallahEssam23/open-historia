/*! Open Historia - portions (production queue wiring guard) (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
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

test("the projection builds the production digest before the model is asked", () => {
  const body = bodyOf("export const simulateTimelineJump = async (");
  assert.match(body, /variables\.productionDigest = buildEconomyDigest\(/);
  assert.match(body, /playerProduction: projected\.production/);
});

test("the real advance is handed the declared production", () => {
  const body = bodyOf("const applySimulationResult = async ({");
  const advance = body.indexOf("advanceWorldEconomy(nextWorld");
  assert.notEqual(advance, -1);
  assert.match(body.slice(advance, advance + 1000), /declaredProduction:/);
});

test("the turn result carries the merged production orders", () => {
  const finish = bodyOf("const finishTimelineJump = async ({");
  assert.match(finish, /productionOrders: merged\.productionOrders/);
});

test("completions are applied after the advance and before the write", () => {
  const body = bodyOf("const applySimulationResult = async ({");
  const advance = body.indexOf("nextWorld = economy.world");
  const apply = body.indexOf("completionBatches");
  const write = body.indexOf("writeWorldState(nextWorld)");
  assert.notEqual(advance, -1);
  assert.notEqual(apply, -1);
  assert.notEqual(write, -1);
  assert.ok(advance < apply && apply < write, "the completion ops must land after the engine and before the write");
  assert.match(body, /applyEventImpactsToWorld\(/);
});
