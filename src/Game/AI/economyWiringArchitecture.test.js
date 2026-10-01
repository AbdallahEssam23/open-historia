/*! Open Historia - portions (deterministic economy wiring guard) (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The economy is wired into applySimulationResult, a 15000 line function that is
// not exported and cannot be imported without building a whole turn's fixtures.
// What matters is ORDER - the engine must land after the event impacts and
// before the write, or a model estimate overwrites the engine's numbers - and
// order is invisible from outside the function. So this reads gameplay.js as
// text, scoping the ordering checks to applySimulationResult's own body so a
// match elsewhere in the file cannot satisfy them by accident.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const source = fs.readFileSync(
  path.join(path.dirname(url.fileURLToPath(import.meta.url)), "gameplay.js"),
  "utf8",
);

const applyBody = (() => {
  const start = source.indexOf("const applySimulationResult = async ({");
  assert.notEqual(start, -1, "applySimulationResult has been renamed; this guard needs updating");
  const end = source.indexOf("\nconst ", start + 1);
  return source.slice(start, end === -1 ? undefined : end);
})();

const refreshBody = (() => {
  const start = source.indexOf("const refreshTrackedCountryStatsIfDue = async ({");
  assert.notEqual(start, -1, "refreshTrackedCountryStatsIfDue has been renamed; this guard needs updating");
  const end = source.indexOf("\nconst ", start + 1);
  return source.slice(start, end === -1 ? undefined : end);
})();

const at = (needle, label) => {
  const index = applyBody.indexOf(needle);
  assert.notEqual(index, -1, `${label} is gone from applySimulationResult; this guard needs updating`);
  return index;
};

test("the engine runs in applySimulationResult, before the world is written", () => {
  const engineAt = at("advanceWorldEconomy(", "the economy advance");
  const writeAt = at("writeWorldState(nextWorld)", "writeWorldState(nextWorld)");
  assert.ok(engineAt < writeAt, "the engine must advance before the world is written, or the write persists the pre-engine state");
});

test("the engine runs after the event impacts, so its fields win", () => {
  const impactsAt = at("applyEventImpactsToWorld(", "applyEventImpactsToWorld");
  const engineAt = at("advanceWorldEconomy(", "the economy advance");
  assert.ok(impactsAt < engineAt, "the engine must land after the event impacts, or an event patch is the last word on gdp and debt");
});

test("the tracked stats refresh is suppressed behind a named switch", () => {
  assert.ok(
    source.includes("ECONOMY_ENGINE_OWNS_STANDARD_STATS"),
    "the periodic AI stats refresh must stand down behind a named switch, or it competes with the engine as a second writer",
  );
  assert.ok(
    refreshBody.includes("ECONOMY_ENGINE_OWNS_STANDARD_STATS"),
    "the switch must guard the STANDARD path inside refreshTrackedCountryStatsIfDue; the custom branch returns before it, so custom sheets keep refreshing",
  );
  assert.ok(
    refreshBody.indexOf("refreshTrackedCustomStatsIfDue({") < refreshBody.indexOf("ECONOMY_ENGINE_OWNS_STANDARD_STATS"),
    "the custom-sheet return must come BEFORE the switch, or a custom scenario would stop refreshing too",
  );
});

test("the digest is built for the prompt", () => {
  assert.ok(
    source.includes("buildEconomyDigest("),
    "the projected period digest must be built and injected into the jump prompt's variables",
  );
});
