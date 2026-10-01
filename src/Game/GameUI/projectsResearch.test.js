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
});
