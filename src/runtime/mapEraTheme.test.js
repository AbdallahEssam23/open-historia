import test from "node:test";
import assert from "node:assert/strict";
import {
  ERA_THEME_AUTO,
  ERA_THEME_CHOICES,
  ERA_THEME_MODERN,
  ERA_THEME_PARCHMENT,
  MODERN_ERA_MIN_YEAR,
  basemapIdForEraTheme,
  eraThemeForYear,
  isEraThemeOverride,
  resolveEraTheme,
  scenarioYear,
} from "./mapEraTheme.js";
import { MODERN_BASEMAP_ID, PARCHMENT_BASEMAP_ID, resolveBasemapId } from "./assets.js";

test("the boundary year is the first one that opens on the modern base", () => {
  assert.equal(eraThemeForYear(0), ERA_THEME_PARCHMENT);
  assert.equal(eraThemeForYear(-300), ERA_THEME_PARCHMENT);
  assert.equal(eraThemeForYear(1899), ERA_THEME_PARCHMENT);
  assert.equal(eraThemeForYear(MODERN_ERA_MIN_YEAR), ERA_THEME_MODERN);
  assert.equal(eraThemeForYear(2016), ERA_THEME_MODERN);
});

test("a year as text still reads as that year, and a missing one has no opinion", () => {
  assert.equal(eraThemeForYear("1944"), ERA_THEME_MODERN);
  assert.equal(eraThemeForYear(null), null);
  assert.equal(eraThemeForYear(undefined), null);
  assert.equal(eraThemeForYear(""), null);
  assert.equal(eraThemeForYear("not a year"), null);
});

test("the scenario clock is anchored at its start date, not the current turn", () => {
  // A 1200 campaign that has run to 1500 must not drift into the modern base.
  assert.equal(scenarioYear({ startDate: "1200-01-01", gameDate: "1500-06-01" }), 1200);
  // Saves written before startDate existed fall back to gameDate.
  assert.equal(scenarioYear({ gameDate: "1812-09-07" }), 1812);
  assert.equal(scenarioYear({}), null);
  assert.equal(scenarioYear(null), null);
});

test("a manual lock wins over the year; otherwise the year decides", () => {
  assert.equal(resolveEraTheme({ override: ERA_THEME_MODERN, year: 1200 }), ERA_THEME_MODERN);
  assert.equal(resolveEraTheme({ override: ERA_THEME_PARCHMENT, year: 2016 }), ERA_THEME_PARCHMENT);
  assert.equal(resolveEraTheme({ override: ERA_THEME_AUTO, year: 1200 }), ERA_THEME_PARCHMENT);
  assert.equal(resolveEraTheme({ year: 2016 }), ERA_THEME_MODERN);
  assert.equal(resolveEraTheme({ override: "something else", year: 2016 }), ERA_THEME_MODERN);
  assert.equal(resolveEraTheme({}), null);
});

test("only a real theme name counts as a lock", () => {
  assert.equal(isEraThemeOverride(ERA_THEME_PARCHMENT), true);
  assert.equal(isEraThemeOverride(ERA_THEME_MODERN), true);
  assert.equal(isEraThemeOverride(ERA_THEME_AUTO), false);
  assert.equal(isEraThemeOverride("auto"), false);
  assert.equal(isEraThemeOverride(null), false);
});

test("the Settings list offers Auto first, then the two locks", () => {
  assert.equal(ERA_THEME_CHOICES[0].value, ERA_THEME_AUTO);
  assert.deepEqual(
    ERA_THEME_CHOICES.map((choice) => choice.value),
    [ERA_THEME_AUTO, ERA_THEME_PARCHMENT, ERA_THEME_MODERN],
  );
});

test("a theme maps to the builtin basemap the map resolves", () => {
  assert.equal(basemapIdForEraTheme(ERA_THEME_PARCHMENT), PARCHMENT_BASEMAP_ID);
  assert.equal(basemapIdForEraTheme(ERA_THEME_MODERN), MODERN_BASEMAP_ID);
  assert.equal(basemapIdForEraTheme(ERA_THEME_AUTO), null);
  assert.equal(basemapIdForEraTheme(null), null);
});

test("the automatic era is only a fallback, so an authored basemap still wins", () => {
  // No override, no authored basemap: the era's basemap fills the fallback slot.
  assert.equal(
    resolveBasemapId({ fallbackId: basemapIdForEraTheme(eraThemeForYear(2016)) }),
    MODERN_BASEMAP_ID,
  );
  // An authored scenario basemap outranks the automatic choice.
  assert.equal(
    resolveBasemapId({ scenarioId: "natgeo-dark", fallbackId: MODERN_BASEMAP_ID }),
    "natgeo-dark",
  );
  // A player lock outranks both.
  assert.equal(
    resolveBasemapId({ overrideId: PARCHMENT_BASEMAP_ID, scenarioId: "natgeo-dark", fallbackId: MODERN_BASEMAP_ID }),
    PARCHMENT_BASEMAP_ID,
  );
});
