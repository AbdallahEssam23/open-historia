/*! Open Historia Map Editor — drawn basemap presets © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The basemaps the scenario editor offers behind the regions.
//
// These are the game's drawn, free-vector basemaps (Parchment and Modern
// Tactical), not the ArcGIS raster presets the editor used to list. An author
// now draws on the same map the game will show, and the editor never calls a
// third-party tile service. Kept local (it does not import runtime/assets.js)
// so the lazily-loaded editor bundle stays free of the game's pmtiles side
// effects. The ids match the game's builtin vector basemaps so a saved
// metadata.basemap round-trips.
export const EDITOR_BASEMAPS = [
  {
    id: "parchment",
    label: "Parchment (historical)",
    theme: "parchment",
    // Two-stop swatch for the picker card: paper over sepia ink.
    swatch: ["#efe3c8", "#6b5a41"],
    ink: "#4a3c29",
  },
  {
    id: "modern-tactical",
    label: "Modern Tactical",
    theme: "modern",
    swatch: ["#0b1017", "#4d7186"],
    ink: "#c2d0dc",
  },
];

// The editor opens on the historical canvas, which suits the scenarios the
// editor is mostly used to draw.
export const DEFAULT_EDITOR_BASEMAP_ID = "parchment";

export const editorBasemapById = (id) => EDITOR_BASEMAPS.find((b) => b.id === id) || null;

// An old document may still name an ESRI raster id the editor no longer offers.
// Painting the historical canvas for it keeps the map usable until the author
// picks a drawn basemap; the game still renders the authored raster until then.
export const editorThemeForBasemap = (id) => editorBasemapById(id)?.theme || "parchment";
