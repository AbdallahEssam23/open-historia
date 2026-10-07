// Shared building blocks for the drawn, OpenMapTiles-based basemaps.
//
// Parchment and Modern Tactical are the same cartography in two moods, so the
// layer constructors, the road classes and the place-name expression live here
// once. A style module supplies only its palette and the moods' differences.
import { OPENMAPTILES_SOURCE_ID } from "../../runtime/vectorBasemapSource.js";

export const PLACE_NAME_EXPRESSION = [
  "coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"],
];

export const GLYPH_REGULAR = ["Noto Sans Regular"];
export const GLYPH_BOLD = ["Noto Sans Bold"];
export const GLYPH_ITALIC = ["Noto Sans Italic"];

export const ROAD_CLASS_MAJOR = ["motorway", "trunk", "primary", "secondary", "tertiary"];
export const ROAD_CLASS_MINOR = ["minor", "service", "track", "path"];

export const classIn = (classes) => ["match", ["get", "class"], classes, true, false];

export const fillLayer = (id, sourceLayer, paint, extra = {}) => ({
  id,
  type: "fill",
  source: OPENMAPTILES_SOURCE_ID,
  "source-layer": sourceLayer,
  paint,
  ...extra,
});

export const lineLayer = (id, sourceLayer, paint, extra = {}) => ({
  id,
  type: "line",
  source: OPENMAPTILES_SOURCE_ID,
  "source-layer": sourceLayer,
  paint,
  ...extra,
});

export const symbolLayer = (id, sourceLayer, layout, paint, extra = {}) => ({
  id,
  type: "symbol",
  source: OPENMAPTILES_SOURCE_ID,
  "source-layer": sourceLayer,
  layout,
  paint,
  ...extra,
});

// The country/region boundary filters, shared so both moods partition the world
// the same way. Maritime segments are always excluded: the game draws its own
// political geography, and a dotted line down the middle of an ocean reads as a
// border that does not exist.
export const COUNTRY_BOUNDARY_FILTER = ["all",
  ["<=", ["get", "admin_level"], 2],
  ["!=", ["get", "maritime"], 1],
];
export const REGION_BOUNDARY_FILTER = ["all",
  [">", ["get", "admin_level"], 2],
  ["<=", ["get", "admin_level"], 4],
  ["!=", ["get", "maritime"], 1],
];
export const TUNNEL_FILTER = ["!=", ["get", "brunnel"], "tunnel"];
