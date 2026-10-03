// Run: node --test src/Game/AI/operationsWiringArchitecture.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const builder = readFileSync(new URL("../../runtime/operationsDigest.js", import.meta.url), "utf8");

test("the operations digest builder imports nothing", () => {
  const specifiers = [...builder.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(specifiers, []);
});

test("the jump reads supply from the primed catalog for the operations digest", () => {
  assert.ok(
    gameplay.includes("readSupplyAttrition(bundle.world, getPrimedScenarioRegionCatalog() ?? []"),
    "the operations supply read is missing",
  );
  assert.ok(gameplay.includes("buildOperationsDigest("), "the operations digest is not built");
  assert.ok(
    gameplay.includes("operations: variables?.operationsDigest"),
    "the operations digest is not handed to the prompt",
  );
});
