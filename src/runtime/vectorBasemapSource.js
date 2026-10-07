// The one free vector base map source, shared by every draw-it style.
//
// Parchment and Modern Tactical (Game/Map/*Style.js) and the scenario editor's
// OpenLayers backdrop all read their tiles from here, so "the free map" is
// defined once and every surface agrees on it. The default host is OpenFreeMap:
// free, key-less, CORS-enabled, serving OpenMapTiles vector tiles with glyphs.
//
// A deployment can repoint it at a self-hosted stack (OpenMapTiles, Planetiler,
// or a Protomaps archive published through the pmtiles protocol) without
// touching a single style:
//   VITE_OH_VECTOR_SOURCE_URL   MapLibre TileJSON URL
//   VITE_OH_VECTOR_TILE_URL     explicit {z}/{x}/{y} vector tile template (OL)
//   VITE_OH_VECTOR_GLYPHS_URL   MapLibre glyph PBF template
// The older PARCHMENT-specific names are still honored as fallbacks.
export const DEFAULT_VECTOR_SOURCE_URL = "https://tiles.openfreemap.org/planet";
export const DEFAULT_VECTOR_TILE_TEMPLATE =
  "https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf";
export const DEFAULT_VECTOR_GLYPHS_URL =
  "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
// OpenFreeMap's planet extract is a z0-14 pyramid; deeper cameras overzoom.
export const VECTOR_BASEMAP_MAX_ZOOM = 14;
export const VECTOR_BASEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> ' +
  'Data <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
// Both styles point at this source id, so World.jsx can add/remove it without
// knowing which theme is active.
export const OPENMAPTILES_SOURCE_ID = "openmaptiles";

// import.meta.env is undefined under `node --test`; each variable is read as a
// static literal member so the bundler inlines it at build time.
const firstValue = (fallback, ...values) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
};

export const vectorSourceUrl = () => firstValue(
  DEFAULT_VECTOR_SOURCE_URL,
  import.meta.env?.VITE_OH_VECTOR_SOURCE_URL,
  import.meta.env?.VITE_OH_PARCHMENT_SOURCE_URL,
);

export const vectorTileTemplate = () => firstValue(
  DEFAULT_VECTOR_TILE_TEMPLATE,
  import.meta.env?.VITE_OH_VECTOR_TILE_URL,
);

export const vectorGlyphsUrl = () => firstValue(
  DEFAULT_VECTOR_GLYPHS_URL,
  import.meta.env?.VITE_OH_VECTOR_GLYPHS_URL,
  import.meta.env?.VITE_OH_PARCHMENT_GLYPHS_URL,
);

// A MapLibre vector source object for the shared tiles.
export const vectorBasemapSource = () => ({
  type: "vector",
  url: vectorSourceUrl(),
  attribution: VECTOR_BASEMAP_ATTRIBUTION,
});
