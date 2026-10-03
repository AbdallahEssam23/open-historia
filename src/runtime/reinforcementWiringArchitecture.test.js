// Run: node --test src/runtime/reinforcementWiringArchitecture.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
const jumpSegments = readFileSync(new URL("../Game/AI/jumpSegments.js", import.meta.url), "utf8");
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

test("the reinforcement draw is charged through the combat reserve cost", () => {
  assert.match(gameplay, /applyCombatReserveCost\(impactedWorld, reinforcement\.reserveCost\)/);
});

test("the reinforcement step is isolated so a failure preserves the completed turn", () => {
  const commentAt = gameplay.indexOf("// Reinforcement and consolidation:");
  const stepAt = gameplay.indexOf("readReinforcement(impactedWorld");
  const warnAt = gameplay.indexOf(
    'console.warn("[engine] the reinforcement step failed; the completed turn is preserved.", error)',
  );
  assert.ok(commentAt > 0 && stepAt > 0 && warnAt > 0, "the reinforcement step or its catch handler is missing");
  assert.ok(commentAt < stepAt && stepAt < warnAt, "the reinforcement step must sit inside its try/catch");
});

// The merge and the result object are assembled field by field, so a new
// declaration is dropped silently unless it is carried through both. This guards
// the exact regression the whole-slice review found.
test("the merged declarations reach the turn result field by field", () => {
  assert.match(gameplay, /reinforcement: merged\.reinforcement/);
  assert.match(gameplay, /rotations: merged\.rotations/);
  assert.match(gameplay, /merges: merged\.merges/);
  assert.match(jumpSegments, /reinforcement\.push\(\.\.\.asArray\(payload\.reinforcement\)\)/);
  assert.match(jumpSegments, /rotations\.push\(\.\.\.asArray\(payload\.rotations\)\)/);
  assert.match(jumpSegments, /merges\.push\(\.\.\.asArray\(payload\.merges\)\)/);
  assert.match(jumpSegments, /reinforcement: \[\.\.\.reinforcementByPolity\.values\(\)\]/);
  assert.match(jumpSegments, /rotations,/);
  assert.match(jumpSegments, /merges,/);
});
