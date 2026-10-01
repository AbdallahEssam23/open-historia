// Run: node --test src/Game/AI/economyPrompt.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const prompts = readFileSync(new URL("./gameplayPrompts.js", import.meta.url), "utf8");

test("the prompt says the economy is computed locally and numbers must not be restated", () => {
  assert.ok(prompts.includes("computed locally"));
  assert.ok(/do not (state|restate)/i.test(prompts));
  assert.ok(prompts.includes("economicShocks"));
});

test("the prompt names the shock list it may use", () => {
  for (const kind of ["harvest_failure", "sanctions", "mobilization", "reconstruction"]) {
    assert.ok(prompts.includes(kind), kind);
  }
});

test("with no digest the block is rules only and never an empty heading", async () => {
  const { buildEconomyEngineInstructions } = await import("./gameplayPrompts.js");
  const block = buildEconomyEngineInstructions({ digest: "" });
  assert.ok(block.includes("computed locally"));
  assert.equal(block.includes("The Period's Economy"), false);
});
