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
  assert.ok(createAt > 0 && advanceAt > 0, "the interactive entry points are missing");
  assert.ok(gameplay.indexOf(call, createAt) > createAt, "createInteractive says the war facts");
  assert.ok(gameplay.indexOf(call, advanceAt) > advanceAt, "advanceActiveInteractive says the war facts");
});

test("the war facts module imports nothing", () => {
  const facts = read("../../runtime/warFacts.js");
  assert.doesNotMatch(facts, /^import /m);
  assert.match(facts, /export const buildWarFactsDirective/);
});
