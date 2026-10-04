// Run: node --test src/Game/AI/peaceOffer.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { applyPeaceOffer } from "./peaceOffer.js";

const baseWorld = () => ({
  wars: [{
    id: "war-1",
    status: "active",
    sideA: ["Prussia"],
    sideB: ["France"],
    startedDate: "1870-01-01",
    goals: {
      a: { kind: "annex", targetRegionIds: ["R"], note: "" },
      b: { kind: "status_quo", targetRegionIds: [], note: "" },
    },
    weariness: { a: 0.9, b: 0.2, throughDate: "1870-03-01" },
  }],
  regionOwnershipOverrides: { R: "France" },
  regionSovereigntyOverrides: { R: "France" },
  economyEngine: { pools: { Prussia: { manpower: 0, materiel: 0 }, France: { manpower: 0, materiel: 0 } } },
  peaceOffer: { warId: "war-1", round: 4, side: "a", pressure: 0.9 },
});

const offer = (over = {}) => ({
  warId: "war-1",
  round: 4,
  side: "a",
  pressure: 0.9,
  victor: "a",
  loser: "b",
  capitulation: true,
  white: false,
  punitive: false,
  transfers: [{ regionId: "R", fromCode: "France", toCode: "Prussia" }],
  reparations: { fromCode: "France", toCode: "Prussia", manpower: 0, materiel: 0 },
  belligerents: ["Prussia", "France"],
  ...over,
});

test("accepting applies the transfers, ends the war and clears the offer", () => {
  const out = applyPeaceOffer({ world: baseWorld(), offer: offer(), date: "1870-04-01", round: 5 });
  assert.ok(out);
  assert.equal(out.world.regionOwnershipOverrides.R, "Prussia");
  assert.equal(out.world.wars.find((war) => war.id === "war-1").status, "ended");
  assert.equal(out.world.peaceOffer, null);
  assert.equal(out.event.impacts.regionTransfers[0].regionId, "R");
});

test("no offer is nothing to apply", () => {
  assert.equal(applyPeaceOffer({ world: baseWorld(), offer: null, date: "1870-04-01", round: 5 }), null);
});
