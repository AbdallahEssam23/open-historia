// Run: node --test src/runtime/simulationTickWiringArchitecture.test.js
//
// gameplay.js imports main.jsx and cannot be imported by node --test, so its
// wiring is pinned by reading the source. The executor module is read too, to
// keep it import-free except for the schedule.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
const executor = readFileSync(new URL("./simulationTick.js", import.meta.url), "utf8");

const REGION_START = "const applySimulationResult =";
const REGION_END = "const readSeenGameStateBundle =";
const start = gameplay.indexOf(REGION_START);
const end = gameplay.indexOf(REGION_END);
const region = gameplay.slice(start, end);

const CALL = "await runSimulationTick({ handlers: tickHandlers, facts: tickFacts });";
const HANDLERS = "const tickHandlers = {";
const PILOT_ANCHORS = [
  "readTreatyBreaches(worldWithImpacts",
  "readWarCasus(worldWithImpacts",
  "readTreatyObligations(worldWithImpacts",
  "applyWarReparations(worldWithImpacts",
];

const countOf = (text, anchor) => text.split(anchor).length - 1;

test("the executor imports only the schedule", () => {
  const specifiers = [...executor.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(specifiers, ["../engine/tickSchedule.js"]);
});

test("the applySimulationResult region is bounded", () => {
  assert.ok(start > 0, "applySimulationResult is missing");
  assert.ok(end > start, "the region end must follow its start");
});

test("the executor is imported and called exactly once", () => {
  assert.ok(gameplay.includes('from "../../runtime/simulationTick.js"'), "the turn must import the executor");
  assert.equal(countOf(region, CALL), 1, "the executor is called once in the region");
});

test("the four pilot phases live inside the handler object before the call", () => {
  const callAt = region.indexOf(CALL);
  const handlersAt = region.indexOf(HANDLERS);
  assert.ok(handlersAt > 0 && handlersAt < callAt, "the handler object must precede the call");
  for (const anchor of PILOT_ANCHORS) {
    assert.equal(countOf(region, anchor), 1, `the pilot anchor must appear once in the region: ${anchor}`);
    const at = region.indexOf(anchor);
    assert.ok(at > handlersAt && at < callAt, `the pilot anchor must be inside the handler object: ${anchor}`);
  }
});

test("the gate facts are derived before the call and passed to it", () => {
  const callAt = region.indexOf(CALL);
  const factsAt = region.indexOf("const tickFacts = {");
  assert.ok(factsAt > 0 && factsAt < callAt, "the facts must be derived before the call");
  const facts = region.slice(factsAt, callAt);
  for (const key of ["treaties", "casus", "settlements"]) {
    assert.ok(facts.includes(`${key}:`), `the fact set must carry ${key}`);
  }
});
