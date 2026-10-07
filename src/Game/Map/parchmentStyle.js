// Parchment — the drawn historical base map.
//
// Every other basemap in the game is a photographed raster tile service. An
// atlas-from-the-past look cannot be photographed; it has to be drawn: aged
// paper for land, a faded water wash, sepia ink for roads and boundaries, and
// quiet place names. This module owns that drawing so World.jsx only decides
// *that* parchment is active, never how it is painted.
//
// Tiles come from OpenFreeMap (https://openfreemap.org), a free, key-less host
// of OpenMapTiles vector tiles with CORS and glyphs enabled. Both endpoints can
// be redirected at build time to a self-hosted stack (OpenMapTiles, Planetiler,
// or a Protomaps archive behind the pmtiles protocol) without touching the
// style itself:
//   VITE_OH_PARCHMENT_SOURCE_URL   TileJSON (or vector tile template) URL
//   VITE_OH_PARCHMENT_GLYPHS_URL   MapLibre glyph PBF template
//
// The palette is deliberately low-contrast: political borders, units and event
// markers are drawn on top by the game and must stay the loudest thing on the
// map. Parchment is the paper they are inked onto.
import { PARCHMENT_BASEMAP_ID } from "../../runtime/assets.js";

export const PARCHMENT_SOURCE_ID = "openmaptiles";

export const DEFAULT_PARCHMENT_SOURCE_URL = "https://tiles.openfreemap.org/planet";
export const DEFAULT_PARCHMENT_GLYPHS_URL =
  "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
export const PARCHMENT_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> ' +
  'Data <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

const envValue = (value, fallback) =>
  (typeof value === "string" && value.trim() ? value.trim() : fallback);

// import.meta.env is undefined under `node --test`, hence the optional chain.
export const parchmentSourceUrl = () =>
  envValue(import.meta.env?.VITE_OH_PARCHMENT_SOURCE_URL, DEFAULT_PARCHMENT_SOURCE_URL);

export const parchmentGlyphsUrl = () =>
  envValue(import.meta.env?.VITE_OH_PARCHMENT_GLYPHS_URL, DEFAULT_PARCHMENT_GLYPHS_URL);

export const isParchmentBasemap = (id) => id === PARCHMENT_BASEMAP_ID;

// Aged paper and sepia ink. Names read as "what the material is", not "where it
// is used", so a shade can be reused across water, landcover and labels.
export const PARCHMENT_PALETTE = Object.freeze({
  paper: "#efe3c8",
  paperShade: "#e4d5b3",
  paperEdge: "#d8c69f",
  ink: "#4a3c29",
  inkSoft: "#6b5a41",
  halo: "#f5ecd6",
  water: "#c9d7d2",
  waterLine: "#9fb8b3",
  waterLabel: "#5d7570",
  forest: "#ccd2a8",
  grass: "#d9dcb6",
  sand: "#e9dcae",
  rock: "#ddd2bb",
  wetland: "#c4d2c2",
  park: "#ced6a6",
  building: "#ddcda8",
  boundary: "#8a734f",
  roadCasing: "#b39a6d",
  roadMajor: "#cbae7c",
  roadMinor: "#d9c69c",
});

const P = PARCHMENT_PALETTE;
const glyph = ["Noto Sans Regular"];
const glyphBold = ["Noto Sans Bold"];
const glyphItalic = ["Noto Sans Italic"];

// OpenMapTiles stores the display name under `name`, with localized variants
// when the extract carries them. Prefer English then the latin transliteration
// so a place reads the same way regardless of the player's locale.
const placeName = ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]];

const fill = (id, sourceLayer, paint, extra = {}) => ({
  id,
  type: "fill",
  source: PARCHMENT_SOURCE_ID,
  "source-layer": sourceLayer,
  paint,
  ...extra,
});

const line = (id, sourceLayer, paint, extra = {}) => ({
  id,
  type: "line",
  source: PARCHMENT_SOURCE_ID,
  "source-layer": sourceLayer,
  paint,
  ...extra,
});

const symbol = (id, sourceLayer, layout, paint, extra = {}) => ({
  id,
  type: "symbol",
  source: PARCHMENT_SOURCE_ID,
  "source-layer": sourceLayer,
  layout,
  paint,
  ...extra,
});

const ROAD_CLASS_MAJOR = ["motorway", "trunk", "primary", "secondary", "tertiary"];
const ROAD_CLASS_MINOR = ["minor", "service", "track", "path"];

const classIn = (classes) => ["match", ["get", "class"], classes, true, false];

const parchmentLayers = () => [
  // The paper itself. No source: it is the colour that shows through wherever
  // no feature is drawn, including the pole caps.
  {
    id: "parchment-paper",
    type: "background",
    paint: { "background-color": P.paper },
  },
  // Broad land cover: forests, grass, sand, ice and wetland. Held at partial
  // opacity so relief-like variation reads without competing with borders.
  fill(
    "parchment-landcover",
    "landcover",
    {
      "fill-color": [
        "match",
        ["get", "class"],
        "ice", "#e9eef0",
        "wood", P.forest,
        "grass", P.grass,
        "farmland", P.grass,
        "sand", P.sand,
        "rock", P.rock,
        "wetland", P.wetland,
        P.paper,
      ],
      "fill-opacity": [
        "match",
        ["get", "class"],
        "wood", 0.5,
        "grass", 0.38,
        "farmland", 0.34,
        "sand", 0.5,
        "ice", 0.72,
        0.3,
      ],
    },
  ),
  // Built-up ground, kept as a whisper of shading rather than a grey blob.
  fill("parchment-landuse", "landuse", {
    "fill-color": P.paperShade,
    "fill-opacity": 0.34,
  }),
  fill("parchment-park", "park", {
    "fill-color": P.park,
    "fill-opacity": 0.42,
  }),
  // Water last of the fills so lakes and seas always sit above landcover.
  fill("parchment-water", "water", {
    "fill-color": P.water,
    "fill-opacity": 1,
    "fill-outline-color": P.waterLine,
  }),
  line(
    "parchment-waterway",
    "waterway",
    {
      "line-color": P.waterLine,
      "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 6, 0.4, 12, 1.3],
      "line-opacity": 0.85,
    },
    { minzoom: 6 },
  ),
  // Footprints only once the camera is close enough to mean them.
  fill(
    "parchment-buildings",
    "building",
    {
      "fill-color": P.building,
      "fill-opacity": 0.5,
      "fill-outline-color": "rgba(74, 60, 41, 0.16)",
    },
    { minzoom: 13 },
  ),
  // Boundaries. Country borders are a broken sepia rule; regions are lighter
  // and appear later. Maritime and disputed segments stay out of the way.
  line(
    "parchment-boundary-country",
    "boundary",
    {
      "line-color": P.boundary,
      "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.5, 6, 1.1, 12, 1.8],
      "line-dasharray": [3, 1.6],
      "line-opacity": 0.72,
    },
    {
      filter: ["all",
        ["<=", ["get", "admin_level"], 2],
        ["!=", ["get", "maritime"], 1],
      ],
    },
  ),
  line(
    "parchment-boundary-region",
    "boundary",
    {
      "line-color": P.boundary,
      "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.3, 12, 0.9],
      "line-dasharray": [2, 2],
      "line-opacity": 0.4,
    },
    {
      minzoom: 5,
      filter: ["all",
        [">", ["get", "admin_level"], 2],
        ["<=", ["get", "admin_level"], 4],
        ["!=", ["get", "maritime"], 1],
      ],
    },
  ),
  // Roads: a soft casing plus an ink fill, drawn narrow so they never outrank
  // the political layer. Tunnels are hidden; bridges are not.
  line(
    "parchment-road-casing",
    "transportation",
    {
      "line-color": P.roadCasing,
      "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 5, 0.6, 10, 2.2, 14, 5],
      "line-opacity": 0.45,
    },
    {
      minzoom: 5,
      layout: { "line-cap": "round", "line-join": "round" },
      filter: ["all", classIn(ROAD_CLASS_MAJOR), ["!=", ["get", "brunnel"], "tunnel"]],
    },
  ),
  line(
    "parchment-road-major",
    "transportation",
    {
      "line-color": P.roadMajor,
      "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 5, 0.3, 10, 1.2, 14, 3],
    },
    {
      minzoom: 5,
      layout: { "line-cap": "round", "line-join": "round" },
      filter: ["all", classIn(ROAD_CLASS_MAJOR), ["!=", ["get", "brunnel"], "tunnel"]],
    },
  ),
  line(
    "parchment-road-minor",
    "transportation",
    {
      "line-color": P.roadMinor,
      "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 9, 0.3, 14, 1.6],
      "line-opacity": 0.85,
    },
    {
      minzoom: 9,
      layout: { "line-cap": "round", "line-join": "round" },
      filter: ["all", classIn(ROAD_CLASS_MINOR), ["!=", ["get", "brunnel"], "tunnel"]],
    },
  ),
  // Labels. Water first (it is the ground), then physical features, then the
  // human geography the player actually navigates by.
  symbol(
    "parchment-water-name",
    "water_name",
    {
      "text-field": placeName,
      "text-font": glyphItalic,
      "text-size": ["interpolate", ["linear"], ["zoom"], 0, 10, 6, 13, 12, 17],
      "text-letter-spacing": 0.12,
      "text-max-width": 6,
      "text-padding": 8,
    },
    {
      "text-color": P.waterLabel,
      "text-halo-color": P.halo,
      "text-halo-width": 1.2,
    },
    {
      minzoom: 1,
      filter: ["all", classIn(["ocean", "sea", "lake"]), ["has", "name"]],
    },
  ),
  symbol(
    "parchment-mountain-peak",
    "mountain_peak",
    {
      "text-field": placeName,
      "text-font": glyph,
      "text-size": 11,
      "text-transform": "uppercase",
      "text-letter-spacing": 0.18,
      "text-padding": 6,
    },
    {
      "text-color": P.inkSoft,
      "text-halo-color": P.halo,
      "text-halo-width": 1.1,
    },
    {
      minzoom: 8,
      filter: ["all", classIn(["peak", "volcano"]), ["has", "name"]],
    },
  ),
  symbol(
    "parchment-place-country",
    "place",
    {
      "text-field": placeName,
      "text-font": glyphBold,
      "text-size": ["interpolate", ["linear"], ["zoom"], 1, 11, 5, 15, 10, 20],
      "text-transform": "uppercase",
      "text-letter-spacing": 0.22,
      "text-max-width": 7,
      "text-padding": 10,
      "symbol-sort-key": ["coalesce", ["get", "rank"], 10],
    },
    {
      "text-color": P.ink,
      "text-halo-color": P.halo,
      "text-halo-width": 1.4,
      "text-halo-blur": 0.4,
    },
    {
      minzoom: 1,
      filter: ["all", ["match", ["get", "class"], ["country"], true, false], ["has", "name"]],
    },
  ),
  symbol(
    "parchment-place-city",
    "place",
    {
      "text-field": placeName,
      "text-font": glyph,
      "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 10, 15],
      "text-max-width": 8,
      "text-padding": 6,
      "symbol-sort-key": ["coalesce", ["get", "rank"], 10],
    },
    {
      "text-color": P.ink,
      "text-halo-color": P.halo,
      "text-halo-width": 1.2,
    },
    {
      minzoom: 4,
      // Declutter progressively: only the most significant places show at
      // mid zooms, and everything named by the local extract by z10.
      filter: ["all",
        ["match", ["get", "class"], ["city", "town"], true, false],
        ["<=", ["coalesce", ["get", "rank"], 10], ["interpolate", ["linear"], ["zoom"], 4, 6, 10, 12]],
        ["has", "name"],
      ],
    },
  ),
  symbol(
    "parchment-place-village",
    "place",
    {
      "text-field": placeName,
      "text-font": glyph,
      "text-size": ["interpolate", ["linear"], ["zoom"], 8, 9, 13, 13],
      "text-max-width": 8,
      "text-padding": 5,
    },
    {
      "text-color": P.inkSoft,
      "text-halo-color": P.halo,
      "text-halo-width": 1.1,
    },
    {
      minzoom: 8,
      filter: ["all",
        ["match", ["get", "class"], ["village", "hamlet", "suburb", "quarter", "neighbourhood"], true, false],
        ["has", "name"],
      ],
    },
  ),
];

// A complete MapLibre style. `terrain` is applied by World.jsx (the DEM source
// and hillshade are shared with the raster basemaps), so this returns only the
// drawn paper.
export const buildParchmentStyle = () => ({
  version: 8,
  name: "Parchment",
  glyphs: parchmentGlyphsUrl(),
  sources: {
    [PARCHMENT_SOURCE_ID]: {
      type: "vector",
      url: parchmentSourceUrl(),
      attribution: PARCHMENT_ATTRIBUTION,
    },
  },
  layers: parchmentLayers(),
  sky: { "atmosphere-blend": 0 },
});
