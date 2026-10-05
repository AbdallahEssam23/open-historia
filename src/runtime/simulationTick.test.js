// Run: node --test src/runtime/simulationTick.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { runSimulationTick } from "./simulationTick.js";
import { TICK_PHASES } from "../engine/tickSchedule.js";

const PILOT = ["treatyBreaches", "casusBelli", "treatyObligations", "reparations"];

test("the plan is the declared order, not the object's key order", async () => {
  const trace = [];
  // Written in reverse; the executor must still run them in TICK_PHASES order.
  const handlers = {
    reparations: () => trace.push("reparations"),
    treatyObligations: () => trace.push("treatyObligations"),
    casusBelli: () => trace.push("casusBelli"),
    treatyBreaches: () => trace.push("treatyBreaches"),
  };
  const plan = await runSimulationTick({ handlers });
  assert.deepEqual(trace, PILOT);
  assert.deepEqual(plan, PILOT);
});

test("the pilot ids are declared phases", () => {
  const ids = TICK_PHASES.map((phase) => phase.id);
  for (const id of PILOT) assert.ok(ids.includes(id), `${id} must be a declared phase`);
});

test("an async handler is awaited before the next one runs", async () => {
  const trace = [];
  const handlers = {
    treatyBreaches: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      trace.push("treatyBreaches");
    },
    casusBelli: () => trace.push("casusBelli"),
  };
  await runSimulationTick({ handlers });
  assert.deepEqual(trace, ["treatyBreaches", "casusBelli"]);
});

test("a function under an unknown key is rejected", async () => {
  await assert.rejects(
    () => runSimulationTick({ handlers: { nonsense: () => {} } }),
    /unknown phase handler "nonsense"/,
  );
});

test("a non-function value is not a handler", async () => {
  assert.deepEqual(await runSimulationTick({ handlers: { treatyBreaches: 42 } }), []);
});

test("no handlers runs nothing and returns an empty plan", async () => {
  assert.deepEqual(await runSimulationTick(), []);
  assert.deepEqual(await runSimulationTick({ handlers: {} }), []);
});

test("a custom phase list sets the order", async () => {
  const trace = [];
  const phases = [{ id: "b" }, { id: "a" }];
  const handlers = { a: () => trace.push("a"), b: () => trace.push("b") };
  const plan = await runSimulationTick({ phases, handlers });
  assert.deepEqual(trace, ["b", "a"]);
  assert.deepEqual(plan, ["b", "a"]);
});
