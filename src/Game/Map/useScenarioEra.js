// The active campaign's year, for the era-driven basemap.
//
// The world store the map already reads (useWorldState) carries the authored
// world, not the clock, so the year comes from the game document through the
// shared runtime store. The selector returns a plain number, so a turn that
// only advances gameDate does not re-render the map: the era is anchored at the
// scenario's start date (see mapEraTheme.scenarioYear).
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { scenarioYear } from "../../runtime/mapEraTheme.js";

export const useScenarioEra = () => useRuntimeState("game", scenarioYear, "scenario-era");
