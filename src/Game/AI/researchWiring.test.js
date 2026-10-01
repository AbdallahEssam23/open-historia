import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");

test("the jump applies the engine's research ops as an engine-sourced event", () => {
  assert.match(gameplay, /researchOps/);
  assert.match(gameplay, /engineSourced:\s*true/);
  assert.match(gameplay, /applyEventImpactsToWorld\(/);
});
