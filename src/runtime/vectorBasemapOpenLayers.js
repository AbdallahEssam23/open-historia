// The drawn free-vector basemap, rendered by OpenLayers.
//
// The game's MapLibre map draws Parchment and Modern Tactical from
// runtime/vectorBasemapSource.js (Game/Map/*Style.js). Two other surfaces use
// OpenLayers instead of MapLibre: the scenario editor's drawing canvas and the
// country picker. Both used to paint ArcGIS raster tiles; this module gives them
// the same OpenMapTiles data in the same two palettes (Game/Map/vectorPalettes.js),
// so every map in the product shows the same drawn world and none of them calls
// a third-party raster service.
//
// It deliberately imports only leaf modules (vectorBasemapSource, vectorPalettes)
// so the lazily-loaded editor bundle stays free of runtime/assets.js and its
// pmtiles side effects.
import VectorTileLayer from "ol/layer/VectorTile";
import VectorTileSource from "ol/source/VectorTile";
import MVT from "ol/format/MVT";
import Style from "ol/style/Style";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Text from "ol/style/Text";
import {
  VECTOR_BASEMAP_ATTRIBUTION,
  VECTOR_BASEMAP_MAX_ZOOM,
  vectorTileTemplate,
} from "./vectorBasemapSource.js";
import { MODERN_TACTICAL_PALETTE, PARCHMENT_PALETTE } from "../Game/Map/vectorPalettes.js";

export const VECTOR_OL_MAX_ZOOM = VECTOR_BASEMAP_MAX_ZOOM;
export const VECTOR_OL_THEMES = Object.freeze(["parchment", "modern"]);

const PALETTES = {
  parchment: PARCHMENT_PALETTE,
  modern: MODERN_TACTICAL_PALETTE,
};

// EPSG:3857 resolution at zoom 0. A style function only receives `resolution`,
// so zoom is recovered from it the way the projection defines it.
const ZOOM_ZERO_RESOLUTION = 156543.03392804097;
const zoomForResolution = (resolution) => Math.log2(ZOOM_ZERO_RESOLUTION / Math.max(resolution, 1e-9));

const classOf = (feature) => String(feature.get("class") || feature.get("subclass") || "");
const adminLevelOf = (feature) => Number(feature.get("admin_level"));
const placeName = (feature) =>
  feature.get("name:en") || feature.get("name:latin") || feature.get("name") || "";

const ROAD_MAJOR = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);
const ROAD_MINOR = new Set(["minor", "service", "track", "path", "street"]);
const CITY_CLASSES = new Set(["city", "town"]);
const VILLAGE_CLASSES = new Set(["village", "hamlet", "suburb", "quarter", "neighbourhood"]);
// OpenMapTiles landcover classes on the left, palette keys on the right.
const COVER_COLOR = {
  wood: "forest",
  grass: "grass",
  farmland: "grass",
  ice: "ice",
  sand: "sand",
  rock: "rock",
  wetland: "wetland",
  park: "park",
};
const coverColor = (palette, cls) => palette[COVER_COLOR[cls]]
  || palette.grass
  || palette.paperShade
  || palette.groundShade;

// One style function per theme. Styles are memoised: OpenLayers calls this per
// feature per frame, and a place label would otherwise allocate a Text/Fill/
// Stroke every time.
const makeStyleFunction = (theme) => {
  const p = PALETTES[theme] || PALETTES.parchment;
  const modern = theme === "modern";
  const textColor = modern ? p.text : p.ink;
  const softText = modern ? p.textSoft : p.inkSoft;
  const halo = p.halo;
  const cache = new Map();
  const remember = (key, build) => {
    let style = cache.get(key);
    if (!style) {
      style = build();
      cache.set(key, style);
    }
    return style;
  };

  const textStyle = (size, { color = textColor, bold = false, italic = false } = {}) => {
    const key = `t:${size}:${color}:${bold}:${italic}`;
    return remember(key, () => new Style({
      text: new Text({
        font: `${italic ? "italic " : ""}${bold ? "700 " : "400 "}${size}px "Noto Sans", system-ui, sans-serif`,
        fill: new Fill({ color }),
        stroke: new Stroke({ color: halo, width: modern ? 1.4 : 1.6 }),
        overflow: true,
      }),
    }));
  };

  return (feature, resolution) => {
    const layer = feature.get("layer");
    const zoom = zoomForResolution(resolution);

    if (layer === "water") {
      return remember("water", () => new Style({ fill: new Fill({ color: p.water }) }));
    }
    if (layer === "waterway") {
      return remember("waterway", () => new Style({
        stroke: new Stroke({ color: p.waterLine, width: 1 }),
      }));
    }
    if (layer === "landcover" || layer === "landuse" || layer === "park") {
      const color = coverColor(p, classOf(feature));
      if (!color) return null;
      return remember(`cover:${color}`, () => new Style({ fill: new Fill({ color }) }));
    }
    if (layer === "building") {
      if (zoom < 13) return null;
      return remember("building", () => new Style({
        fill: new Fill({ color: p.building }),
        stroke: new Stroke({ color: modern ? "rgba(77,113,134,0.25)" : "rgba(120,100,70,0.35)", width: 0.4 }),
      }));
    }
    if (layer === "boundary") {
      const admin = adminLevelOf(feature);
      if (admin !== 2 && admin !== 3 && admin !== 4) return null;
      if (admin === 2) {
        return remember("boundary:2", () => new Style({
          stroke: new Stroke({ color: p.boundary, width: zoom >= 6 ? 1.2 : 0.8, lineDash: [6, 3] }),
        }));
      }
      if (zoom < 5) return null;
      return remember("boundary:4", () => new Style({
        stroke: new Stroke({ color: p.boundary, width: 0.6, lineDash: [4, 3] }),
      }));
    }
    if (layer === "transportation") {
      const cls = classOf(feature);
      const major = ROAD_MAJOR.has(cls);
      const minor = ROAD_MINOR.has(cls);
      if (!major && !minor) return null;
      if (minor && zoom < 9) return null;
      if (major && zoom < 5) return null;
      if (major) {
        return remember("road:major", () => new Style({
          stroke: new Stroke({ color: p.roadMajor, width: zoom >= 10 ? 2 : 1.2 }),
        }));
      }
      return remember("road:minor", () => new Style({
        stroke: new Stroke({ color: p.roadMinor, width: 0.8 }),
      }));
    }
    if (layer === "water_name") {
      if (!placeName(feature) || zoom < 1) return null;
      return textStyle(zoom >= 8 ? 15 : 12, { color: p.waterLabel, italic: true });
    }
    if (layer === "mountain_peak") {
      if (zoom < 8 || !placeName(feature)) return null;
      return textStyle(10, { color: softText });
    }
    if (layer === "place") {
      const cls = classOf(feature);
      if (!placeName(feature)) return null;
      if (cls === "country") {
        if (zoom > 10) return null;
        return textStyle(zoom >= 5 ? 16 : 12, { bold: true, color: textColor });
      }
      if (CITY_CLASSES.has(cls)) {
        if (zoom < 4) return null;
        return textStyle(zoom >= 10 ? 14 : 11, { color: textColor });
      }
      if (VILLAGE_CLASSES.has(cls)) {
        if (zoom < 8) return null;
        return textStyle(zoom >= 13 ? 12 : 10, { color: softText });
      }
      return null;
    }
    return null;
  };
};

const styleFunctionCache = new Map();
export const vectorOlStyle = (theme) => {
  const key = PALETTES[theme] ? theme : "parchment";
  let fn = styleFunctionCache.get(key);
  if (!fn) {
    fn = makeStyleFunction(key);
    styleFunctionCache.set(key, fn);
  }
  return fn;
};

// A single VectorTile source reused across theme switches so a basemap change
// does not drop tiles the browser already holds.
let sharedSource = null;
export const vectorOlSource = () => {
  if (!sharedSource) {
    sharedSource = new VectorTileSource({
      format: new MVT({ layerName: "layer" }),
      url: vectorTileTemplate(),
      maxZoom: VECTOR_OL_MAX_ZOOM,
      crossOrigin: "anonymous",
      attributions: VECTOR_BASEMAP_ATTRIBUTION,
    });
  }
  return sharedSource;
};

// The reference layer itself. `theme` selects the palette; `opacity` lets a
// caller dim it further when its own data must read on top.
export const vectorOlLayer = ({ theme = "parchment", opacity = 1 } = {}) => new VectorTileLayer({
  source: vectorOlSource(),
  style: vectorOlStyle(theme),
  opacity,
  declutter: true,
  updateWhileAnimating: false,
  updateWhileInteracting: false,
  zIndex: 0,
});
