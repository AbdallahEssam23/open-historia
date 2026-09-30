/*! Open Historia — the Limit AI generation toggle reads as it behaves © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The setting that ends a stalled generation is read from four places: the AI
// pipeline that applies the deadline, the Settings toggle that shows it, and the
// diagnostics log that reports it. If any one of them reads it with the wrong
// default, the toggle can read "off" while the pipeline behaves "on" — the exact
// drift this test exists to catch. (It already drifted once: the toggle's own
// comment said "ships ON" while its code read the default-off getter.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
const mapSettings = read("./mapSettings.js");
const gameplay = read("../Game/AI/gameplay.js");
const settings = read("../Game/GameUI/settings.jsx");
const settingsLog = read("./settingsLog.js");

// Every read of the key, with the getter it went through.
const readsOf = (source) => [...source.matchAll(/(getMapSetting(?:DefaultOn)?)\(\s*MAP_SETTING_KEYS\.limitAiGeneration\s*\)/g)]
  .map((match) => match[1]);

test("every reader of the generation deadline agrees on its default", () => {
  for (const [name, source] of [["gameplay.js", gameplay], ["settings.jsx", settings], ["settingsLog.js", settingsLog]]) {
    const readers = readsOf(source);
    assert.ok(readers.length > 0, `${name} never reads limitAiGeneration`);
    for (const reader of readers) {
      assert.equal(reader, "getMapSettingDefaultOn", `${name} reads the deadline with ${reader}, so the toggle and the pipeline can disagree`);
    }
  }
});

test("the deadline is not read anywhere with the default-off getter", () => {
  // A bare getMapSetting(...) is what regressed the toggle; the guard above
  // covers the three files that read it, this covers a fourth that appears later.
  for (const [name, source] of [["gameplay.js", gameplay], ["settings.jsx", settings], ["settingsLog.js", settingsLog], ["mapSettings.js", mapSettings]]) {
    assert.doesNotMatch(source, /getMapSetting\(\s*MAP_SETTING_KEYS\.limitAiGeneration\s*\)/, `${name} reads the deadline with the default-off getter`);
  }
});

test("the deadline ships on, so an absent key means on", () => {
  // getMapSettingDefaultOn reads an absent key as on (typeof localStorage guard).
  assert.match(mapSettings, /export function getMapSettingDefaultOn/);
  assert.match(mapSettings, /limitAiGeneration: "ai_limit_generation"/);
});
