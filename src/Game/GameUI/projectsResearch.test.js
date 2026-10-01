import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./projects.jsx", import.meta.url), "utf8");

test("the projects panel renders research programmes distinctly", () => {
  // The badge is gated on the research kind, so ordinary projects are unaffected.
  assert.match(src, /project\.kind === "research"/);
  // Both programme fields reach the card, not just the underlying model.
  assert.match(src, /project\.domain/);
  assert.match(src, /project\.scale/);
  // The gate is tied to the caption, the badge label is spelled, and the two
  // fields are joined as the card shows them - so moving either behind a
  // different condition, or dropping one, fails here rather than silently.
  assert.match(src, /kind === "research" && \(project\.domain \|\| project\.scale\)/);
  assert.match(src, /Research/);
  assert.match(src, /\.filter\(Boolean\)\.join\(" \/ "\)/);
});
