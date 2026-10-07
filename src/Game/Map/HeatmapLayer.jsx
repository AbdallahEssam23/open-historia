/*! Open Historia - strategic heatmap map overlay (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React from "react";
import { Source, Layer, useMap } from "react-map-gl/maplibre";
import { getPrimedScenarioRegionCatalog, loadScenarioRegionCatalog } from "../../runtime/assets.js";
import { buildHeatmapData } from "../../runtime/heatmapData.js";
import { MAP_SETTING_KEYS, useMapSetting, useMapSettingValue } from "../../runtime/mapSettings.js";
import { useWorldState } from "./useWorldState.js";
import { getPlayerCode } from "./unitsController.js";
import { enforceMapLayerOrder } from "./mapLayerOrder.js";

export const HEATMAP_LAYER_ID = "conflict-heatmap";
export const HEATMAP_SOURCE_ID = "heatmap-source";

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

// A native MapLibre heatmap over the scenario's region points: wealth, strategic
// plans or front-line tension, chosen in Settings. The point weights come from
// the pure engine model through the runtime adapter; this component only reads
// them and draws. It reads the geometry catalog the map already primed, so a
// stock world with no primed catalog simply draws nothing.
const HeatmapLayer = () => {
  const enabled = useMapSetting(MAP_SETTING_KEYS.heatmap);
  const mode = useMapSettingValue(MAP_SETTING_KEYS.heatmapMode, "tension") || "tension";
  const { worldState } = useWorldState();
  const [catalog, setCatalog] = React.useState(() => getPrimedScenarioRegionCatalog() ?? []);

  // The catalog is primed by Nations; a cold open fetches the scenario geometry
  // once, and the priming event fills it in if that lands first.
  React.useEffect(() => {
    const read = () => getPrimedScenarioRegionCatalog() ?? null;
    const bump = () => {
      const primed = read();
      if (primed) setCatalog(primed);
    };
    window.addEventListener("oh:region-catalog-primed", bump);
    let cancelled = false;
    if (!read()) {
      loadScenarioRegionCatalog()
        .then((rows) => { if (!cancelled && Array.isArray(rows) && rows.length) setCatalog(rows); })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      window.removeEventListener("oh:region-catalog-primed", bump);
    };
  }, []);

  const data = React.useMemo(() => {
    if (!enabled) return EMPTY_FEATURE_COLLECTION;
    return buildHeatmapData(worldState, catalog, { mode, playerPolity: getPlayerCode() }).features;
  }, [enabled, mode, worldState, catalog]);

  // react-map-gl appends a late layer on top; the canonical order moves it back
  // under the readable content. Applied once the map has actually added it.
  const { current: map } = useMap();
  React.useEffect(() => {
    if (!enabled || !map?.getLayer) return undefined;
    const apply = () => {
      if (map.getLayer(HEATMAP_LAYER_ID)) enforceMapLayerOrder(map);
    };
    apply();
    map.on?.("idle", apply);
    return () => map.off?.("idle", apply);
  }, [enabled, mode, data, map]);

  if (!enabled) return null;

  return (
    <Source id={HEATMAP_SOURCE_ID} type="geojson" data={data}>
      <Layer
        id={HEATMAP_LAYER_ID}
        type="heatmap"
        paint={{
          "heatmap-weight": ["get", "weight"],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 6, 1.2],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 12, 6, 30],
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(0, 0, 0, 0)",
            0.2, "rgba(0, 80, 200, 0.55)",
            0.45, "rgba(0, 190, 230, 0.7)",
            0.65, "rgba(70, 220, 120, 0.75)",
            0.8, "rgba(255, 210, 60, 0.85)",
            0.92, "rgba(255, 110, 40, 0.92)",
            1, "rgba(200, 0, 0, 1)",
          ],
          "heatmap-opacity": 0.72,
        }}
      />
    </Source>
  );
};

export default HeatmapLayer;
