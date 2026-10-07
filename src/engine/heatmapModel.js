/*! Open Historia - deterministic heatmap: engine data as weighted map points (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/engine/heatmapModel.test.js
//
// The map's gradient is a pure function of the data. This module turns compact
// engine inputs - the region point list, the per-polity country sheets, the
// planner's plans and the derived front lines - into one GeoJSON FeatureCollection
// with a normalized weight per point, so the same data always draws the same map.
// It knows points and numbers, nothing about MapLibre or React, so it runs under
// bare node --test and enginePurity.test.js covers it automatically.

import { clamp, roundTo } from "./economyMath.js";

export const HEATMAP_MODES = Object.freeze(["wealth", "strategy", "tension"]);
export const DEFAULT_HEATMAP_MODE = "tension";

// A region with both roles takes the higher one. Contested is a region where the
// two sides of a war are actually present; a front is the edge between them.
export const HEATMAP_ROLE_WEIGHTS = Object.freeze({ contested: 1, front: 0.7 });

const asList = (value) => (Array.isArray(value) ? value : []);

// The point a region is drawn at: its own coordinate when it has one, else the
// centre of its bounding box. A region with neither returns null and is skipped,
// never pinned at null island. An antimeridian box (an east value past 180) is
// left as measured, matching how the camera frames it.
export const regionPoint = (region) => {
  const lng = Number(region?.lng);
  const lat = Number(region?.lat);
  if (Number.isFinite(lng) && Number.isFinite(lat)) return { lng, lat };
  const bounds = region?.bounds;
  if (Array.isArray(bounds) && bounds.length === 2) {
    const [west, south] = asList(bounds[0]);
    const [east, north] = asList(bounds[1]);
    const corners = [Number(west), Number(south), Number(east), Number(north)];
    if (corners.every(Number.isFinite)) return { lng: (corners[0] + corners[2]) / 2, lat: (corners[1] + corners[3]) / 2 };
  }
  return null;
};

const sheetFor = (countryStats, owner) => {
  if (!owner) return null;
  const direct = countryStats?.[owner];
  return direct && typeof direct === "object" ? direct : null;
};

// The raw, un-normalized weight of one region under a mode. Deterministic and
// non-negative; a missing sheet, plan or role contributes zero rather than a
// guess.
export const heatmapWeightFor = (mode, { regionId = "", owner = "", countryStats = {}, plans = {}, frontLines = null } = {}) => {
  if (mode === "wealth") {
    const value = Number(sheetFor(countryStats, owner)?.economy?.gdp);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  if (mode === "strategy") {
    const value = Number(plans?.[owner]?.score);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  const roles = asList(frontLines?.regions?.[regionId]?.roles);
  let weight = 0;
  for (const role of roles) {
    const value = HEATMAP_ROLE_WEIGHTS[role] ?? 0;
    if (value > weight) weight = value;
  }
  return weight;
};

// The whole overlay as one FeatureCollection. Each point carries its normalized
// weight in [0, 1] (the maximum is 1) plus the raw value for tooltips or a
// legend. With no usable weight anywhere, every normalized weight is 0 and no
// division happens.
export const buildHeatmapModel = ({ mode, regions = [], countryStats = {}, plans = {}, frontLines = null } = {}) => {
  const resolved = HEATMAP_MODES.includes(String(mode)) ? String(mode) : DEFAULT_HEATMAP_MODE;
  const points = [];
  let max = 0;
  for (const region of asList(regions)) {
    const regionId = String(region?.id ?? "").trim();
    if (!regionId) continue;
    const point = regionPoint(region);
    if (!point) continue;
    const owner = String(region?.owner ?? "").trim();
    const raw = heatmapWeightFor(resolved, { regionId, owner, countryStats, plans, frontLines });
    if (raw > max) max = raw;
    points.push({ regionId, owner, lng: point.lng, lat: point.lat, raw });
  }
  const features = points.map((point) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [point.lng, point.lat] },
    properties: {
      regionId: point.regionId,
      owner: point.owner,
      weight: max > 0 ? roundTo(clamp(point.raw / max, 0, 1), 6) : 0,
      raw: point.raw,
    },
  }));
  return {
    mode: resolved,
    pointCount: features.length,
    max: roundTo(max, 6),
    features: { type: "FeatureCollection", features },
  };
};
