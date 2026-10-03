// Run: node --test src/runtime/diplomaticCost.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { applyDiplomaticCost } from "./diplomaticCost.js";
import { normalizeWorldState } from "./gameState.js";

const world = (over = {}) => normalizeWorldState({
  polityOverrides: {
    Italy: { code: "Italy" },
    Russia: { code: "Russia" },
  },
  ...over,
});

const charge = (over = {}) => ({
  actor: "Italy",
  wronged: ["Russia"],
  reputationPenalty: 15,
  relationPenalty: 25,
  reason: "broke a treaty with",
  relationIdPrefix: "relation-breach",
  ...over,
});

test("a charge lowers the actor reputation and its relation with each wronged party", () => {
  const next = applyDiplomaticCost(
    world({ internationalReputation: { Italy: 30 }, relations: [{ a: "Italy", b: "Russia", score: 10 }] }),
    [charge()],
  );
  assert.equal(next.internationalReputation.Italy, 15);
  const relation = next.relations.find((entry) => entry.a === "Italy" && entry.b === "Russia");
  assert.equal(relation.score, -15);
  assert.equal(relation.status, "cautious");
});

test("an unset reputation defaults to 50 before the penalty", () => {
  const next = applyDiplomaticCost(world(), [charge()]);
  assert.equal(next.internationalReputation.Italy, 35);
});

test("the reputation floors at 0 and the relation at -100", () => {
  const next = applyDiplomaticCost(
    world({ internationalReputation: { Italy: 5 }, relations: [{ a: "Italy", b: "Russia", score: -90 }] }),
    [charge()],
  );
  assert.equal(next.internationalReputation.Italy, 0);
  const relation = next.relations.find((entry) => entry.a === "Italy" && entry.b === "Russia");
  assert.equal(relation.score, -100);
});

test("a pair with no relation is created, charged and summarized", () => {
  const next = applyDiplomaticCost(world(), [charge()]);
  const created = next.relations.find((entry) =>
    (entry.a === "Italy" && entry.b === "Russia") || (entry.a === "Russia" && entry.b === "Italy"));
  assert.ok(created, "the charge leaves a pair where none was recorded");
  assert.equal(created.score, -25);
  assert.equal(created.summary, "Italy broke a treaty with Russia.");
  assert.equal(created.id, "relation-breach-italy-russia");
});

test("an empty charge list returns the same world", () => {
  const prior = world();
  assert.equal(applyDiplomaticCost(prior, []), prior);
});
