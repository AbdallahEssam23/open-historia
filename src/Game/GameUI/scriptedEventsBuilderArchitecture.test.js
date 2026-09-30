import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const builder = fs.readFileSync(new URL("./ScriptedEventsBuilder.jsx", import.meta.url), "utf8");
const editor = fs.readFileSync(new URL("./FeaturesSectionEditor.jsx", import.meta.url), "utf8");

test("the text setting is the only source of truth the builder writes", () => {
  // Every edit re-serialises the whole text: no parallel card-only state.
  assert.match(builder, /parseScriptedEvents\(value\)/);
  assert.match(builder, /const write = \(next\) => onChange\(serializeScriptedEvents\(next\)\)/);
  assert.match(builder, /parseImpactLine\(text\)/);
});

test("unreadable lines fall back to raw text instead of being dropped", () => {
  assert.match(builder, /const errors = beats\.flatMap/);
  assert.match(builder, /\(raw \|\| errors\.length > 0\) && \(/);
  assert.match(builder, /value=\{value \?\? ""\}/);
});

test("the builder replaces the plain textarea for its setting only", () => {
  assert.match(editor, /const built = setting\.editor === "scriptedEvents"/);
  assert.match(editor, /built \? \(/);
  assert.match(editor, /<ScriptedEventsBuilder/);
});
