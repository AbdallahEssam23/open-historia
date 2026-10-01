import test from "node:test";
import assert from "node:assert/strict";

import { buildProductionInstructions } from "./gameplayPrompts.js";
import { PROJECTS_SCHEMA } from "./gameplaySchemas.js";

// A jump carries no project ops any more (the board moved to the separate
// `projects` call), so the research fields are asserted on the schema that
// actually declares them: the project op inside PROJECTS_SCHEMA.
test("the project op schema accepts a research programme with domain and scale", () => {
  const json = JSON.stringify(PROJECTS_SCHEMA);
  assert.match(json, /"research"/);
  assert.match(json, /"domain"/);
  assert.match(json, /"scale"/);
  assert.match(json, /"nuclear"/);
});

test("the instruction tells the model to declare research, never progress it", () => {
  const text = buildProductionInstructions({ digest: "" });
  assert.match(text, /research/i);
  assert.match(text, /do not state its progress/i);
});
