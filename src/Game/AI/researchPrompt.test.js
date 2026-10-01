import test from "node:test";
import assert from "node:assert/strict";

import { buildProductionInstructions } from "./gameplayPrompts.js";
import { PROJECTS_SCHEMA } from "./gameplaySchemas.js";
import { buildResearchBoardDirective } from "./projectsDirective.js";

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

// The model that DECLARES a programme is the separate `projects` task, whose
// frozen template is appended to at call time. This is the contract that reaches
// it, not the jump's production paragraph.
test("the board pass directive tells the declaring model to open research, never progress it", () => {
  const text = buildResearchBoardDirective();
  assert.match(text, /never write its progress/i);
  assert.match(text, /kind "research"/);
});

// The jump still needs to not invent research progress in what it narrates, even
// though it no longer emits projectOps.
test("the jump narration is told not to state research progress", () => {
  const text = buildProductionInstructions({ digest: "" });
  assert.match(text, /research/i);
  assert.match(text, /do not state its progress/i);
});
