// Run: node --test src/Game/AI/warFactsWiringArchitecture.test.js
//
// gameplay.js imports main.jsx and cannot be imported by node --test, so its
// wiring is pinned by reading the source. This is the house pattern for the
// other wiring architecture guards.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const gameplay = read("./gameplay.js");

test("the four war digests are built in exactly one place", () => {
  for (const builder of [
    "buildTreatyObligationDigest(",
    "buildTreatyBreachDigest(",
    "buildWarCasusDigest(",
    "buildPeaceOfferDigest(",
  ]) {
    assert.equal(gameplay.split(builder).length - 1, 1, `${builder} is built once`);
  }
  assert.match(gameplay, /const buildWarFactsVariables = async \(\{ world, game \} = \{\}\)/);
});

test("the jump says its war facts through the shared helper", () => {
  const jumpAt = gameplay.indexOf("export const simulateTimelineJump");
  assert.ok(jumpAt > 0, "the jump entry point is missing");
  assert.ok(
    gameplay.indexOf("await buildWarFactsVariables({", jumpAt) > jumpAt,
    "the jump still builds its war facts inline",
  );
});

test("the interactive prompts carry the engine's war facts", () => {
  assert.match(gameplay, /from "\.\.\/\.\.\/runtime\/warFacts\.js"/);
  assert.match(gameplay, /\["interactiveCreation", "interactiveExecutor"\]\.includes\(taskKey\)/);
  assert.match(gameplay, /buildWarFactsDirective\(variables\)/);
});

test("both interactive turns build the war facts", () => {
  const call = "await buildWarFactsVariables({ world: bundle.world, game: bundle.game })";
  const createAt = gameplay.indexOf("export const createInteractive");
  const advanceAt = gameplay.indexOf("export const advanceActiveInteractive");
  const jumpAt = gameplay.indexOf("export const simulateTimelineJump");
  assert.ok(createAt > 0 && advanceAt > createAt && jumpAt > advanceAt, "the entry points are missing or reordered");
  // Bound each search to its own function, else the jump's identical call (which
  // sits after both) would satisfy either assertion even when a caller is unwired.
  const createCallAt = gameplay.indexOf(call, createAt);
  const advanceCallAt = gameplay.indexOf(call, advanceAt);
  assert.ok(createCallAt > createAt && createCallAt < advanceAt, "createInteractive says the war facts");
  assert.ok(advanceCallAt > advanceAt && advanceCallAt < jumpAt, "advanceActiveInteractive says the war facts");
  // And before the caller builds its prompt, else the block is derived from
  // unset keys and silently comes out empty.
  const createTaskAt = gameplay.indexOf("runJsonTask(", createAt);
  const advanceTaskAt = gameplay.indexOf("runJsonTask(", advanceAt);
  assert.ok(createCallAt < createTaskAt && createTaskAt < advanceAt, "createInteractive sets the facts before its prompt");
  assert.ok(advanceCallAt < advanceTaskAt && advanceTaskAt < jumpAt, "advanceActiveInteractive sets the facts before its prompt");
});

test("the war facts module imports nothing", () => {
  const facts = read("../../runtime/warFacts.js");
  assert.doesNotMatch(facts, /^import /m);
  assert.match(facts, /export const buildWarFactsDirective/);
});

test("the game master preview says the war facts before it plans", () => {
  const call = "await buildWarFactsVariables({ world: bundle.world, game: bundle.game })";
  const previewAt = gameplay.indexOf("export const previewGameMasterCommand");
  const applyAt = gameplay.indexOf("export const applyGameMasterPreview");
  assert.ok(previewAt > 0 && applyAt > previewAt, "the game master entry points are missing or reordered");
  const callAt = gameplay.indexOf(call, previewAt);
  const planAt = gameplay.indexOf('runJsonTask("gameMaster"', previewAt);
  assert.ok(callAt > previewAt && callAt < planAt, "previewGameMasterCommand says the war facts before it plans");
});
