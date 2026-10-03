// Run: node --test src/runtime/reinforcementWiringArchitecture.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
const adapter = readFileSync(new URL("./reinforcement.js", import.meta.url), "utf8");
const core = readFileSync(new URL("../engine/reinforcement.js", import.meta.url), "utf8");

test("the reinforcement core imports only the force-pool and math siblings", () => {
  const specifiers = [...core.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(specifiers, ["./forcePools.js", "./economyMath.js"]);
});

test("the adapter imports no Game/AI module", () => {
  const specifiers = [...adapter.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(specifiers.some((specifier) => specifier.includes("Game/AI")), false);
});

test("the turn reinforces after attrition and before the economy", () => {
  const attritionAt = gameplay.indexOf("readSupplyAttrition(impactedWorld");
  const reinforceAt = gameplay.indexOf("readReinforcement(impactedWorld");
  const economyAt = gameplay.indexOf("advanceWorldEconomy(nextWorld");
  assert.ok(attritionAt > 0 && reinforceAt > 0 && economyAt > 0, "a reinforcement seam is missing");
  assert.ok(attritionAt < reinforceAt, "reinforcement must run after attrition");
  assert.ok(reinforceAt < economyAt, "reinforcement must run before the economy advances");
});

test("the turn applies the reinforcement ops as a board-only synthetic event", () => {
  assert.ok(gameplay.indexOf("REINFORCEMENT_EVENT_ID") > 0, "the event id is missing");
  assert.match(gameplay, /boardOnlyEventIds: \[REINFORCEMENT_EVENT_ID\]/);
  assert.match(gameplay, /impacts: \{ unitOps: reinforcement\.ops \}/);
});

test("the declared policy is handed to the economy advance", () => {
  assert.match(gameplay, /declaredReinforcement: normalizeArray\(result\.reinforcement\)/);
});
