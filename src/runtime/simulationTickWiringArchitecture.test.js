// Run: node --test src/runtime/simulationTickWiringArchitecture.test.js
//
// gameplay.js imports main.jsx and cannot be imported by node --test, so its
// wiring is pinned by reading the source. The executor module is read too, to
// keep it import-free except for the schedule.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { TICK_PHASES } from "../engine/tickSchedule.js";

const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
const executor = readFileSync(new URL("./simulationTick.js", import.meta.url), "utf8");

const REGION_START = "const applySimulationResult =";
const REGION_END = "const readSeenGameStateBundle =";
const start = gameplay.indexOf(REGION_START);
const end = gameplay.indexOf(REGION_END);
const region = gameplay.slice(start, end);

const TICK_IDS = TICK_PHASES.map((phase) => phase.id);
const PILOT = ["treatyBreaches", "casusBelli", "treatyObligations", "reparations"];
const PILOT_ANCHORS = [
  "readTreatyBreaches(worldWithImpacts",
  "readWarCasus(worldWithImpacts",
  "readTreatyObligations(worldWithImpacts",
  "applyWarReparations(worldWithImpacts",
];
const TREATY_CALL = 'await runTick(["treatyBreaches", "casusBelli", "treatyObligations", "reparations"], tickFacts);';

const countOf = (text, anchor) => text.split(anchor).length - 1;

// Every `runTick([...])` call in the region, with the phase ids it names.
const callGroups = () =>
  [...region.matchAll(/runTick\(\[([^\]]*)\]/g)].map((match) =>
    [...match[1].matchAll(/"([^"]+)"/g)].map((id) => id[1]),
  );

test("the executor imports only the schedule", () => {
  const specifiers = [...executor.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(specifiers, ["../engine/tickSchedule.js"]);
});

test("the applySimulationResult region is bounded", () => {
  assert.ok(start > 0, "applySimulationResult is missing");
  assert.ok(end > start, "the region end must follow its start");
});

test("the turn imports the executor and calls it once per group", () => {
  assert.ok(gameplay.includes('from "../../runtime/simulationTick.js"'), "the turn must import the executor");
  assert.equal(callGroups().length, 7, "the executor is called once per group");
});

test("the seven calls partition the declared schedule", () => {
  const planned = callGroups().flat();
  assert.deepEqual([...planned].sort(), [...TICK_IDS].sort(), "the calls must cover every phase");
  assert.equal(new Set(planned).size, planned.length, "no phase may be invoked by two calls");
});

test("every declared phase has a handler in the region", () => {
  for (const id of TICK_IDS) {
    const assigned = region.includes(`tickHandlers.${id} =`);
    const merged = region.includes(`    ${id}: () => {`);
    assert.ok(assigned || merged, `the phase handler must be defined in the region: ${id}`);
  }
});

test("the pilot phases live inside the Object.assign block before the treaty call", () => {
  const callAt = region.indexOf(TREATY_CALL);
  const handlersAt = region.indexOf("Object.assign(tickHandlers, {");
  assert.ok(callAt > 0, "the treaty call must be present");
  assert.ok(handlersAt > 0 && handlersAt < callAt, "the pilot handler block must precede the treaty call");
  for (const anchor of PILOT_ANCHORS) {
    assert.equal(countOf(region, anchor), 1, `the pilot anchor must appear once in the region: ${anchor}`);
    const at = region.indexOf(anchor);
    assert.ok(at > handlersAt && at < callAt, `the pilot anchor must be inside the handler block: ${anchor}`);
  }
  for (const id of PILOT) {
    assert.ok(region.includes(`    ${id}: () => {`), `the pilot handler must be in the block: ${id}`);
  }
});

test("only the treaty call passes the gate facts, derived before it", () => {
  assert.equal(countOf(region, "], tickFacts)"), 1, "only the treaty call may pass the fact set");
  const callAt = region.indexOf(TREATY_CALL);
  const factsAt = region.indexOf("const tickFacts = {");
  assert.ok(factsAt > 0 && factsAt < callAt, "the facts must be derived before the treaty call");
  const facts = region.slice(factsAt, callAt);
  for (const key of ["treaties", "casus", "settlements"]) {
    assert.ok(facts.includes(`${key}:`), `the fact set must carry ${key}`);
  }
});
