// Run: node --test "src/Game/AI/tickScheduleWiringArchitecture.test.js"
//
// gameplay.js imports main.jsx and cannot be imported by node --test, so its
// wiring is pinned by reading the source. This is the house pattern for the
// other wiring architecture guards. It asserts the whole phase order at once,
// which no pairwise guard does.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { TICK_PHASES } from "../../engine/tickSchedule.js";

const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");

const REGION_START = "const applySimulationResult =";
const REGION_END = "const readSeenGameStateBundle =";
const start = gameplay.indexOf(REGION_START);
const end = gameplay.indexOf(REGION_END);
const region = gameplay.slice(start, end);

const countOf = (text, anchor) => text.split(anchor).length - 1;

const anchorPositions = (text) =>
  TICK_PHASES.flatMap((phase) => phase.anchors.map((anchor) => text.indexOf(anchor)));

const orderOk = (text) => {
  let previous = -1;
  for (const at of anchorPositions(text)) {
    if (at < 0 || at <= previous) return false;
    previous = at;
  }
  return true;
};

test("the applySimulationResult region is bounded", () => {
  assert.ok(start > 0, "applySimulationResult is missing");
  assert.ok(end > start, "the region end must follow its start");
});

test("every phase anchor appears exactly once in the apply region", () => {
  for (const phase of TICK_PHASES) {
    for (const anchor of phase.anchors) {
      assert.equal(countOf(region, anchor), 1, `${phase.id} anchor must appear once in applySimulationResult: ${anchor}`);
    }
  }
});

test("the phases run in the declared order", () => {
  assert.equal(orderOk(region), true, "the executed order must match TICK_PHASES");
  assert.ok(region.length > 0, "the region must not be empty");
});

test("the order check rejects a swapped pair and a missing anchor", () => {
  const swapped = region
    .replace("readSupplyAttrition(impactedWorld", "__SUPPLY__")
    .replace("readReinforcement(impactedWorld", "readSupplyAttrition(impactedWorld")
    .replace("__SUPPLY__", "readReinforcement(impactedWorld");
  assert.equal(orderOk(swapped), false, "a swapped supply/reinforcement pair must fail");
  assert.equal(orderOk(region.replace("resolveEventEngagements(freshEvents", "")), false, "a missing anchor must fail");
});
