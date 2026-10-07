// Which drawn base map a scenario opens with, decided by when it is set.
//
// A campaign is a place in time, and the map should read as that time: anything
// before the modern era opens on Parchment (hand-drawn paper and sepia ink),
// 1900 and later on Modern Tactical (a dark, instrument-panel base). The player
// can override this in Settings, and a scenario that ships its own basemap still
// wins over the automatic choice — see World.jsx's resolution order.
//
// Pure logic and constants only: no React, no network. World.jsx supplies the
// scenario year (useScenarioEra.js) and the player's override.
import { gameDateYear } from "./gameDates.js";
import { MODERN_BASEMAP_ID, PARCHMENT_BASEMAP_ID } from "./assets.js";

// The first year that opens on the modern base. 1900 is a convention boundary,
// not a claim about any one technology.
export const MODERN_ERA_MIN_YEAR = 1900;

export const ERA_THEME_AUTO = "";
export const ERA_THEME_PARCHMENT = "parchment";
export const ERA_THEME_MODERN = "modern";

// The Settings picker, in order: the automatic choice first, then the locks.
export const ERA_THEME_CHOICES = Object.freeze([
  { value: ERA_THEME_AUTO, label: "Auto (by scenario year)" },
  { value: ERA_THEME_PARCHMENT, label: "Parchment (historical)" },
  { value: ERA_THEME_MODERN, label: "Modern Tactical" },
]);

export const isEraThemeOverride = (value) =>
  value === ERA_THEME_PARCHMENT || value === ERA_THEME_MODERN;

// The heart of the engine: a year in, a theme out. A missing or unusable year
// returns null, which World.jsx reads as "no era opinion" and falls back to the
// neutral default.
export const eraThemeForYear = (year) => {
  // Number(null) and Number("") are both 0, which would silently read as a
  // (very old) year. Only a real number or a non-empty numeric string counts.
  if (year === null || year === undefined || year === "") return null;
  const numeric = Number(year);
  if (!Number.isFinite(numeric)) return null;
  return numeric < MODERN_ERA_MIN_YEAR ? ERA_THEME_PARCHMENT : ERA_THEME_MODERN;
};

// The campaign's own clock: the era is anchored at the scenario's start date
// (startDate), never the current turn, so a 1200 campaign that runs for years
// does not drift into the modern base. Falls back to gameDate for saves written
// before startDate existed.
export const scenarioYear = (game) => {
  const start = gameDateYear(game?.startDate);
  return start !== null ? start : gameDateYear(game?.gameDate);
};

// A manual override wins over the year; otherwise the year decides.
export const resolveEraTheme = ({ override = "", year = null } = {}) => (
  isEraThemeOverride(override) ? override : eraThemeForYear(year)
);

// Theme -> the builtin basemap id World.jsx feeds to resolveBasemapId. Anything
// that is not a theme has no basemap and yields null.
export const basemapIdForEraTheme = (theme) => {
  if (theme === ERA_THEME_PARCHMENT) return PARCHMENT_BASEMAP_ID;
  if (theme === ERA_THEME_MODERN) return MODERN_BASEMAP_ID;
  return null;
};
