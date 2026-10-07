// Modern Tactical — the drawn base map for scenarios set in the modern era.
//
// Where Parchment is ink on paper, this is a dark instrument panel: a near-black
// ground, cool slate water, thin cyan-grey boundaries and restrained road light,
// with place names kept small and legible. Like Parchment it is drawn from the
// shared free OpenMapTiles source (runtime/vectorBasemapSource.js), never a
// photographed tile service, so both eras ride the same engine.
//
// The palette stays low-contrast on purpose: political colour, unit markers and
// borders are painted on top by the game and must remain the loudest layer.
import { MODERN_BASEMAP_ID } from "../../runtime/assets.js";
import {
  OPENMAPTILES_SOURCE_ID,
  VECTOR_BASEMAP_ATTRIBUTION,
  vectorBasemapSource,
  vectorGlyphsUrl,
} from "../../runtime/vectorBasemapSource.js";
import {
  COUNTRY_BOUNDARY_FILTER,
  GLYPH_BOLD,
  GLYPH_ITALIC,
  GLYPH_REGULAR,
  PLACE_NAME_EXPRESSION,
  REGION_BOUNDARY_FILTER,
  ROAD_CLASS_MAJOR,
  ROAD_CLASS_MINOR,
  TUNNEL_FILTER,
  classIn,
  fillLayer,
  lineLayer,
  symbolLayer,
} from "./vectorStyleKit.js";
import { MODERN_TACTICAL_PALETTE } from "./vectorPalettes.js";

// The palette lives in vectorPalettes.js so the editor can paint in the game's
// ink without importing this module (and assets.js) into its bundle. Re-exported
// here because this is where callers and the style test expect to find it.
export { MODERN_TACTICAL_PALETTE };

export const MODERN_TACTICAL_SOURCE_ID = OPENMAPTILES_SOURCE_ID;
export const MODERN_TACTICAL_ATTRIBUTION = VECTOR_BASEMAP_ATTRIBUTION;
export const isModernTacticalBasemap = (id) => id === MODERN_BASEMAP_ID;

const P = MODERN_TACTICAL_PALETTE;
const fill = fillLayer;
const line = lineLayer;
const symbol = symbolLayer;
const placeName = PLACE_NAME_EXPRESSION;

const modernTacticalLayers = () => [
  {
    id: "modern-tactical-ground",
    type: "background",
    paint: { "background-color": P.ground },
  },
  fill("modern-tactical-landcover", "landcover", {
    "fill-color": [
      "match",
      ["get", "class"],
      "ice", P.ice,
      "wood", P.forest,
      "grass", P.grass,
      "farmland", P.grass,
      "sand", P.sand,
      "rock", P.rock,
      "wetland", P.wetland,
      P.ground,
    ],
    "fill-opacity": [
      "match",
      ["get", "class"],
      "ice", 0.55,
      "wood", 0.42,
      "grass", 0.32,
      0.28,
    ],
  }),
  fill("modern-tactical-landuse", "landuse", {
    "fill-color": P.groundShade,
    "fill-opacity": 0.4,
  }),
  fill("modern-tactical-park", "park", {
    "fill-color": P.park,
    "fill-opacity": 0.4,
  }),
  fill("modern-tactical-water", "water", {
    "fill-color": P.water,
    "fill-opacity": 1,
    "fill-outline-color": P.waterLine,
  }),
  line(
    "modern-tactical-waterway",
    "waterway",
    {
      "line-color": P.waterLine,
      "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 6, 0.4, 12, 1.3],
      "line-opacity": 0.9,
    },
    { minzoom: 6 },
  ),
  fill(
    "modern-tactical-buildings",
    "building",
    {
      "fill-color": P.building,
      "fill-opacity": 0.55,
      "fill-outline-color": "rgba(77, 113, 134, 0.22)",
    },
    { minzoom: 13 },
  ),
  line(
    "modern-tactical-boundary-country",
    "boundary",
    {
      "line-color": P.boundary,
      "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.6, 6, 1.2, 12, 2],
      "line-dasharray": [3, 1.6],
      "line-opacity": 0.85,
    },
    { filter: COUNTRY_BOUNDARY_FILTER },
  ),
  line(
    "modern-tactical-boundary-region",
    "boundary",
    {
      "line-color": P.boundary,
      "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.3, 12, 0.9],
      "line-dasharray": [2, 2],
      "line-opacity": 0.42,
    },
    { minzoom: 5, filter: REGION_BOUNDARY_FILTER },
  ),
  line(
    "modern-tactical-road-casing",
    "transportation",
    {
      "line-color": P.roadCasing,
      "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 5, 0.6, 10, 2.4, 14, 5.5],
      "line-opacity": 0.7,
    },
    {
      minzoom: 5,
      layout: { "line-cap": "round", "line-join": "round" },
      filter: ["all", classIn(ROAD_CLASS_MAJOR), TUNNEL_FILTER],
    },
  ),
  line(
    "modern-tactical-road-major",
    "transportation",
    {
      "line-color": P.roadMajor,
      "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 5, 0.3, 10, 1.3, 14, 3.2],
    },
    {
      minzoom: 5,
      layout: { "line-cap": "round", "line-join": "round" },
      filter: ["all", classIn(ROAD_CLASS_MAJOR), TUNNEL_FILTER],
    },
  ),
  line(
    "modern-tactical-road-minor",
    "transportation",
    {
      "line-color": P.roadMinor,
      "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 9, 0.3, 14, 1.6],
      "line-opacity": 0.85,
    },
    {
      minzoom: 9,
      layout: { "line-cap": "round", "line-join": "round" },
      filter: ["all", classIn(ROAD_CLASS_MINOR), TUNNEL_FILTER],
    },
  ),
  symbol(
    "modern-tactical-water-name",
    "water_name",
    {
      "text-field": placeName,
      "text-font": GLYPH_ITALIC,
      "text-size": ["interpolate", ["linear"], ["zoom"], 0, 9, 6, 12, 12, 15],
      "text-letter-spacing": 0.14,
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
    "modern-tactical-mountain-peak",
    "mountain_peak",
    {
      "text-field": placeName,
      "text-font": GLYPH_REGULAR,
      "text-size": 10,
      "text-transform": "uppercase",
      "text-letter-spacing": 0.2,
      "text-padding": 6,
    },
    {
      "text-color": P.textSoft,
      "text-halo-color": P.halo,
      "text-halo-width": 1,
    },
    {
      minzoom: 8,
      filter: ["all", classIn(["peak", "volcano"]), ["has", "name"]],
    },
  ),
  symbol(
    "modern-tactical-place-country",
    "place",
    {
      "text-field": placeName,
      "text-font": GLYPH_BOLD,
      "text-size": ["interpolate", ["linear"], ["zoom"], 1, 10, 5, 14, 10, 18],
      "text-transform": "uppercase",
      "text-letter-spacing": 0.2,
      "text-max-width": 7,
      "text-padding": 10,
      "symbol-sort-key": ["coalesce", ["get", "rank"], 10],
    },
    {
      "text-color": P.text,
      "text-halo-color": P.halo,
      "text-halo-width": 1.3,
      "text-halo-blur": 0.4,
    },
    {
      minzoom: 1,
      filter: ["all", ["match", ["get", "class"], ["country"], true, false], ["has", "name"]],
    },
  ),
  symbol(
    "modern-tactical-place-city",
    "place",
    {
      "text-field": placeName,
      "text-font": GLYPH_REGULAR,
      "text-size": ["interpolate", ["linear"], ["zoom"], 4, 9, 10, 14],
      "text-max-width": 8,
      "text-padding": 6,
      "symbol-sort-key": ["coalesce", ["get", "rank"], 10],
    },
    {
      "text-color": P.text,
      "text-halo-color": P.halo,
      "text-halo-width": 1.2,
    },
    {
      minzoom: 4,
      filter: ["all",
        ["match", ["get", "class"], ["city", "town"], true, false],
        ["<=", ["coalesce", ["get", "rank"], 10], ["interpolate", ["linear"], ["zoom"], 4, 6, 10, 12]],
        ["has", "name"],
      ],
    },
  ),
  symbol(
    "modern-tactical-place-village",
    "place",
    {
      "text-field": placeName,
      "text-font": GLYPH_REGULAR,
      "text-size": ["interpolate", ["linear"], ["zoom"], 8, 9, 13, 12],
      "text-max-width": 8,
      "text-padding": 5,
    },
    {
      "text-color": P.textSoft,
      "text-halo-color": P.halo,
      "text-halo-width": 1,
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

export const buildModernTacticalStyle = () => ({
  version: 8,
  name: "Modern Tactical",
  glyphs: vectorGlyphsUrl(),
  sources: {
    [MODERN_TACTICAL_SOURCE_ID]: vectorBasemapSource(),
  },
  layers: modernTacticalLayers(),
  sky: { "atmosphere-blend": 0 },
});
