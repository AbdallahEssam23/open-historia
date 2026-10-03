// Run: node --test src/runtime/operationsDigest.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { OPERATIONS_CHAR_CAP, OPERATIONS_ROW_CAP, buildOperationsDigest } from "./operationsDigest.js";

const row = (id, over = {}) => ({
  id,
  name: id,
  type: "infantry",
  strength: 40,
  state: "supplied",
  reachable: true,
  ...over,
});

test("an empty roster produces an empty digest", () => {
  assert.equal(buildOperationsDigest({}), "");
  assert.equal(buildOperationsDigest({ formations: [] }), "");
});

test("the summary counts supply and the rows are ordered severity first", () => {
  const text = buildOperationsDigest({
    formations: [
      row("a", { name: "Alpha", strength: 80, state: "supplied" }),
      row("b", { name: "Bravo", strength: 40, state: "strained" }),
      row("c", { name: "Charlie", strength: 30, state: "isolated" }),
      row("d", { name: "Delta", strength: 100, state: "supplied" }),
    ],
    policyInForce: "replacements",
  });
  const lines = text.split("\n");
  assert.match(lines[1], /2 of 4 formations in supply; 1 strained, 1 cut off\. 3 below full strength\./);
  const rows = lines.filter((line) => line.startsWith("- "));
  assert.equal(rows[0], "- Charlie [id c] 30%, cut off.");
  assert.equal(rows[1], "- Bravo [id b] 40%, strained.");
  assert.equal(rows[2], "- Alpha [id a] 80%, in supply.");
  assert.equal(rows.some((line) => line.includes("Delta")), false);
});

test("a zero count is omitted from the summary line", () => {
  const text = buildOperationsDigest({
    formations: [row("a", { state: "supplied", strength: 100 }), row("b", { state: "strained", strength: 50 })],
    policyInForce: "none",
  });
  const summary = text.split("\n")[1];
  assert.match(summary, /1 of 2 formations in supply; 1 strained\./);
  assert.equal(summary.includes("cut off"), false);
});

test("the policy line names the policy in force and the pending only when it differs", () => {
  const same = buildOperationsDigest({
    formations: [row("a")],
    policyInForce: "replacements",
    pendingPolicy: "replacements",
  });
  assert.match(same, /Reinforcement policy: replacements \(in force\)\./);
  assert.equal(same.includes("declared for next period"), false);
  const changed = buildOperationsDigest({
    formations: [row("a")],
    policyInForce: "replacements",
    pendingPolicy: "belligerent",
  });
  assert.match(changed, /Reinforcement policy: replacements \(in force\); declared for next period: belligerent\./);
  const blank = buildOperationsDigest({ formations: [row("a")] });
  assert.match(blank, /Reinforcement policy: none in force\./);
});

test("the roster is capped and the overflow is counted", () => {
  const formations = Array.from({ length: 10 }, (_, i) =>
    row(`u${i}`, { name: `Unit ${i}`, state: "isolated", strength: 20 + i }),
  );
  const text = buildOperationsDigest({ formations, policyInForce: "none" });
  const lines = text.split("\n").filter((line) => line.startsWith("- "));
  assert.equal(lines.length, OPERATIONS_ROW_CAP);
  assert.match(text, /\+4 more out of supply\./);

  const realistic = buildOperationsDigest({ formations, policyInForce: "replacements" });
  assert.match(realistic, /\+4 more out of supply\./);
});

test("a block longer than the character cap is clamped on a line boundary", () => {
  const formations = Array.from({ length: 40 }, (_, i) =>
    row(`u${i}`, { name: `A very long formation name number ${i}`, state: "isolated", strength: 10 }),
  );
  const text = buildOperationsDigest({ formations, policyInForce: "none", cap: 40 });
  assert.ok(text.length <= OPERATIONS_CHAR_CAP, `got ${text.length}`);
  // The fixed section header is the only line that does not end in a period;
  // every clamped body line must, or a mid-line truncation slipped through.
  const lines = text.split("\n").filter(Boolean);
  assert.equal(lines[0], "[Your Forces in the Field, as simulated]");
  for (const line of lines.slice(1)) {
    assert.ok(line.endsWith("."), `partial line: ${line}`);
  }
});

test("the input is not mutated and the output is ASCII", () => {
  const formations = [row("a", { name: "Alpha" }), row("b", { state: "isolated" })];
  const snapshot = structuredClone(formations);
  const text = buildOperationsDigest({ formations, policyInForce: "replacements" });
  assert.deepEqual(formations, snapshot);
  assert.match(text, /^[\x00-\x7F]*$/);
});

test("the digest is deterministic and order-independent", () => {
  const a = row("a", { name: "Alpha", strength: 50, state: "strained" });
  const b = row("b", { name: "Bravo", strength: 30, state: "isolated" });
  const c = row("c", { name: "Charlie", strength: 90, state: "supplied" });
  const first = buildOperationsDigest({ formations: [a, b, c], policyInForce: "replacements", pendingPolicy: "none" });
  const second = buildOperationsDigest({ formations: [c, a, b], policyInForce: "replacements", pendingPolicy: "none" });
  assert.equal(first, second);
});
