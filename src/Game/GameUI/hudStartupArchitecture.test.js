/*! Open Historia — the HUD's boot path stays small © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
const main = read("./main.jsx");

// Every panel here is fetched and parsed before the HUD can draw its first frame
// when it is statically imported, and the shell is what the player waits for at
// every start. The split only survives if nobody re-adds the import, which is a
// one-line change that looks entirely reasonable at the time.
test("the heavy HUD panels are dynamic imports of the shell, never static ones", () => {
  for (const panel of ["libraryBar", "settings", "chat", "search", "forces"]) {
    assert.doesNotMatch(
      main,
      new RegExp(`^import .* from "\\./${panel}"`, "m"),
      `./${panel} is statically imported by the HUD shell`,
    );
    assert.match(
      main,
      new RegExp(`import\\("\\./${panel}"\\)`),
      `./${panel} is never imported dynamically, so it never loads at all`,
    );
  }
});

// What the shell reads back out of those panels is what would quietly undo the
// split: importing the menu's open flag from the library, or a unit's strength
// colour from the forces panel, puts the whole panel back on the boot path. The
// leaves below are where those pieces live instead, and the panels no longer
// export them.
test("what the shell shares with those panels lives in leaves, not in the panels", () => {
  assert.match(main, /from "\.\/mainMenu\.js"/);
  assert.match(main, /from "\.\/hudDock\.js"/);

  const libraryBar = read("./libraryBar.jsx");
  assert.doesNotMatch(libraryBar, /export const (isMainMenuOpen|useMainMenuOpen|openLibraryTab|TOP_BAR_OFFSET)/);
  assert.doesNotMatch(read("./time.jsx"), /from "\.\/libraryBar"/);
  assert.doesNotMatch(read("./chat.jsx"), /from "\.\/libraryBar"/);

  // The map's selection UI is on the boot path with the map and the HUD both, so
  // its edges into the chat panel and the forces panel are the ones that mattered.
  assert.doesNotMatch(read("../Selection/Regions.jsx"), /from "\.\.\/GameUI\/chat\.jsx"/);
  assert.doesNotMatch(read("../Selection/CountryPanel.jsx"), /from "\.\.\/GameUI\/chat\.jsx"/);
  assert.doesNotMatch(read("../Selection/Units.jsx"), /from "\.\.\/GameUI\/forces\.jsx"/);
  assert.match(read("../Selection/Units.jsx"), /from "\.\.\/GameUI\/unitDisplay\.js"/);

  // The date widget is part of the shell and reaches into the AI stack exactly
  // once, for three one-line functions about the structured-output ladder. Kept
  // in AI/main.jsx, those three lines put the whole ~370 KB model-calling chunk
  // on the HUD, fetched and parsed while the startup screen was still counting.
  assert.doesNotMatch(read("./time.jsx"), /from "\.\.\/AI\/main\.jsx"/);
  assert.match(read("./time.jsx"), /from "\.\.\/AI\/structuredModeSuggestions\.js"/);
  assert.match(read("../AI/structuredModeSuggestions.js"), /export const getStructuredModeSuggestion/);
  assert.match(read("../AI/main.jsx"), /from "\.\/structuredModeSuggestions\.js"/);
});
