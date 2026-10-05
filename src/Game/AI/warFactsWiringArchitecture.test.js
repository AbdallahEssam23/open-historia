// Run: node --test src/Game/AI/warFactsWiringArchitecture.test.js
//
// gameplay.js imports main.jsx and cannot be imported by node --test, so its
// wiring is pinned by reading the source. This is the house pattern for the
// other wiring architecture guards.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const gameplay = read("./gameplay.js");

test("the four war digests are built in exactly one place", () => {
  for (const builder of [
    "buildTreatyObligationDigest(",
    "buildTreatyBreachDigest(",
    "buildWarCasusDigest(",
    "buildPeaceOfferDigest(",
  ]) {
    assert.equal(gameplay.split(builder).length - 1, 1, `${builder} is built once`);
  }
  assert.match(gameplay, /const buildWarFactsVariables = async \(\{ world, game \} = \{\}\)/);
});

test("the jump says its war facts through the shared helper", () => {
  const jumpAt = gameplay.indexOf("export const simulateTimelineJump");
  assert.ok(jumpAt > 0, "the jump entry point is missing");
  assert.ok(
    gameplay.indexOf("await buildWarFactsVariables({", jumpAt) > jumpAt,
    "the jump still builds its war facts inline",
  );
});
