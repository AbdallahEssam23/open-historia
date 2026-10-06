// Run: node --test src/runtime/economyWiringArchitecture.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
const adapter = readFileSync(new URL("./economyEngine.js", import.meta.url), "utf8");
const clock = readFileSync(new URL("../engine/economyTick.js", import.meta.url), "utf8");
const core = readFileSync(new URL("../engine/tradeCore.js", import.meta.url), "utf8");

test("the trade core imports only engine siblings", () => {
  const specifiers = [...core.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(specifiers.length > 0);
  for (const specifier of specifiers) {
    assert.match(specifier, /^\.\/[a-zA-Z0-9]+\.js$/, `tradeCore imports outside the engine: ${specifier}`);
  }
});

test("the adapter builds the field and imports no Game/AI module", () => {
  assert.match(adapter, /import \{ tradeMultipliers \} from "\.\.\/engine\/tradeCore\.js"/);
  assert.match(adapter, /tradeMultipliers\(\{/);
  const specifiers = [...adapter.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(specifiers.some((specifier) => specifier.includes("Game/AI")), false);
});

test("the clock composes the standing field with the shocks", () => {
  assert.match(clock, /import \{ activeMultipliers, composeMultipliers, shockAppliesTo \} from "\.\/economyShocks\.js"/);
  assert.match(clock, /composeMultipliers\(shockMultipliers, tradeVector\)/);
});

test("the turn tells the model who the trade field favoured and cut off", () => {
  assert.match(gameplay, /import \{ advanceWorldEconomy, buildUpkeepTable, describeTradeClimate \} from "\.\.\/\.\.\/runtime\/economyEngine\.js"/);
  assert.ok(gameplay.indexOf("describeTradeClimate(economy.trade)") > 0, "the receipt clause is missing");
  const economyAt = gameplay.indexOf("advanceWorldEconomy(nextWorld");
  const noteAt = gameplay.indexOf("describeTradeClimate(economy.trade)");
  assert.ok(economyAt > 0 && noteAt > economyAt, "the clause must follow the advance that produces the field");
});
