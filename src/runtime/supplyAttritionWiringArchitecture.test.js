// Run: node --test src/runtime/supplyAttritionWiringArchitecture.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
const adapter = readFileSync(new URL("./supplyAttrition.js", import.meta.url), "utf8");
const core = readFileSync(new URL("../engine/supplyAttrition.js", import.meta.url), "utf8");

test("the supply core imports only the front-line sibling", () => {
  const specifiers = [...core.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(specifiers, ["./frontLines.js"]);
});

test("the adapter imports no Game/AI module", () => {
  const specifiers = [...adapter.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(specifiers.some((specifier) => specifier.includes("Game/AI")), false);
});

test("the turn attrits after the battles and before the economy", () => {
  const reserveAt = gameplay.indexOf("applyCombatReserveCost(impactedWorld");
  const supplyAt = gameplay.indexOf("readSupplyAttrition(impactedWorld");
  const economyAt = gameplay.indexOf("advanceWorldEconomy(nextWorld");
  assert.ok(reserveAt > 0 && supplyAt > 0 && economyAt > 0, "a supply seam is missing");
  assert.ok(reserveAt < supplyAt, "attrition must run after the combat reserve cost");
  assert.ok(supplyAt < economyAt, "attrition must run before the economy advances");
});

test("the turn applies the attrition ops as a board-only synthetic event", () => {
  assert.ok(gameplay.indexOf("SUPPLY_ATTRITION_EVENT_ID") > 0, "the event id is missing");
  assert.match(gameplay, /import \{ readSupplyAttrition \} from "\.\.\/\.\.\/runtime\/supplyAttrition\.js"/);
  assert.match(gameplay, /boardOnlyEventIds: \[SUPPLY_ATTRITION_EVENT_ID\]/);
  assert.match(gameplay, /impacts: \{ unitOps: supply\.ops \}/);
  // The research path carries a second engineSourced flag, so anchor this one to
  // the supply event; otherwise dropping the supply flag would still pass.
  assert.match(gameplay, /engineSourced: true,\s*boardOnlyEventIds: \[SUPPLY_ATTRITION_EVENT_ID\]/);
});
