// Run: node --test src/Game/GameUI/researchEffectsUi.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("the forces panel reads and renders the player's research effects", () => {
  const src = read("./forces.jsx");
  assert.match(src, /researchEffects/);
  assert.match(src, /researchEffectTotalsLabel/);
});

test("the research card shows a completed programme's own contribution", () => {
  const src = read("./projects.jsx");
  assert.match(src, /researchEffectLabel/);
  assert.match(src, /project\.status === "complete"/);
});
