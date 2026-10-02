/*! Open Historia - runtime research wiring guard (AGPL-3.0-or-later; see LICENSE). */
// Run: node --test src/runtime/researchWiringArchitecture.test.js
//
// A source-structure guard for the RUNTIME layer of the deterministic research
// path. It pins the identifiers that shipped and, where that is cheap, their
// ORDER, so a refactor that deletes the wiring fails here even though the pure
// core's own tests still pass. It reads the source as text rather than importing
// it: economyEngine.js and gameState.js reach browser modules and are not
// importable under node --test. The jump's synthetic event has its own guard in
// src/Game/AI/researchWiring.test.js; this file is the runtime side only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("the engine derives the research input and threads it into advanceEconomy", () => {
  const source = read("./economyEngine.js");
  assert.match(source, /export const buildResearchInput = \(world,/);
  assert.match(source, /const researchInput = buildResearchInput\(world, \{ playerPolity \}\);/);
  // The derived input must be the value handed to the pure core, in the same
  // call: not a second rebuild, and not a field named something else.
  assert.match(source, /advanceEconomy\(\s*\{\s*\.\.\.committed,\s*research: researchInput\s*\},/);
});

test("the engine emits research ops and returns the engine's research state", () => {
  const source = read("./economyEngine.js");
  assert.match(source, /const researchOps = \[\];/);
  assert.match(source, /researchOps\.push\(\{\s*op: "update",/);
  assert.match(source, /researchOps\.push\(\{ op: "close", projectId: completion\.id, status: "complete" \}\)/);
  // The return the caller reads the advanced state back out of.
  assert.match(source, /research: state\.research,/);
});

test("the model guard refuses a model close of a research programme", () => {
  const source = read("./gameState.js");
  // The default is what keeps every model-sourced path guarded; only the engine
  // flips it true.
  assert.match(source, /engineSourced = false/);
  assert.match(source, /const holdResearchInvariant = \(entry, baseline = null\) => \{/);
  assert.match(source, /holdResearchInvariant\(merged, existing\.kind === "research" \? existing : null\)/);
  // The close op: a model may fail or cancel, but only the engine may complete.
  assert.match(source, /if \(current\.kind === "research" && op\.status === "complete" && !engineSourced\) continue;/);
  assert.doesNotMatch(source, /if \(current\.kind === "research" && op\.status === "complete"\) continue;/);
});

test("the engine flag rides the completion release into the project applier", () => {
  const source = read("./gameState.js");
  assert.match(source, /export const releaseProjectCompletionEffects = \(projects, ops, \{ engineSourced = false \} = \{\}\) => \{/);
  assert.match(source, /releaseProjectCompletionEffects\(nextWorld\.projects, event\.impacts\.projectOps, \{ engineSourced \}\)/);
  // The release pre-scan runs the applier with the same flag, so the two cannot
  // disagree about whether a research completion is engine-sourced.
  assert.match(source, /applyProjectOps\(projects, ops, \{ engineSourced, completions \}\)/);
});

test("the digest renders the engine's research clause", () => {
  const source = read("./economyDigest.js");
  assert.match(source, /const researchClauseFor = \(research\) => \{/);
  assert.match(source, /const researchLine = researchClauseFor\(research\);/);
  // The clause is folded into the reserve block, or it never reaches the prompt.
  assert.match(source, /\[poolLine, productionLine, researchLine, researchEffectsLine\]\.filter\(Boolean\)\.join\("\\n"\)/);
});

test("the research core stays import-free", () => {
  // enginePurity.test.js walks the whole engine directory; this one line states
  // that this path's core keeps the same purity its capacity math depends on.
  const core = read("../engine/research.js");
  assert.doesNotMatch(core, /\bfrom\s+"|require\(|window\.|document\.|localStorage/);
});

test("the clock threads the research effects into all three seams", () => {
  const tick = read("./../engine/economyTick.js");
  assert.match(tick, /researchEffectTotalsFor/);
  assert.match(tick, /productionTimeMultiplier\(effects\.production\)/);
  assert.match(tick, /poolRegenMultiplier\(effects\.pools\)/);
  assert.match(tick, /economyGrowthBonus\(effects\.economy\)/);
});

test("the engine functions carry the multiplier seams", () => {
  assert.match(read("./../engine/productionQueue.js"), /timeMultiplier/);
  assert.match(read("./../engine/forcePools.js"), /regenMultiplier/);
  assert.match(read("./../engine/economyTick.js"), /growthBonus/);
});

test("the adapter folds the completions and writes the totals", () => {
  const source = read("./economyEngine.js");
  assert.match(source, /foldResearchEffect/);
  assert.match(source, /normalizeResearchEffects/);
  assert.match(source, /researchEffects: researchEffectsNext/);
  assert.match(source, /researchEffects: appliedResearchEffects/);
});

test("the engine record keeps the field and the digest renders it", () => {
  assert.match(read("./gameState.js"), /normalizeResearchEffects/);
  assert.match(read("./economyDigest.js"), /researchEffectTotalsLabel/);
});
