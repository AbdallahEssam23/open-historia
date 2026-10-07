// The colours of the two drawn basemaps, kept apart from their style code.
//
// Both palettes are plain frozen constants with no imports, so the scenario
// editor (which must not pull runtime/assets.js and its pmtiles side effects)
// can paint its OpenLayers backdrop in exactly the game's colours. The style
// modules own the layer recipes; this module owns the ink.

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
  ice: "#e9eef0",
  wetland: "#c4d2c2",
  park: "#ced6a6",
  building: "#ddcda8",
  boundary: "#8a734f",
  roadCasing: "#b39a6d",
  roadMajor: "#cbae7c",
  roadMinor: "#d9c69c",
});

// Cool dark ground, cyan-slate ink.
export const MODERN_TACTICAL_PALETTE = Object.freeze({
  ground: "#0b1017",
  groundShade: "#111a24",
  groundEdge: "#16212c",
  text: "#c2d0dc",
  textSoft: "#8ea3b3",
  halo: "#04080c",
  water: "#0d1c28",
  waterLine: "#1f3a4a",
  waterLabel: "#7ba3b8",
  forest: "#12241d",
  grass: "#16241a",
  sand: "#2a2620",
  rock: "#1b242c",
  ice: "#243039",
  wetland: "#12241f",
  park: "#15251d",
  building: "#1a2632",
  boundary: "#4d7186",
  roadCasing: "#0a0f15",
  roadMajor: "#31485a",
  roadMinor: "#22323f",
});
