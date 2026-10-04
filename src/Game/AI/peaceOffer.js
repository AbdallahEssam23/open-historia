/*! Open Historia - apply the player's accepted peace through the normal doors (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/peaceOffer.test.js
//
// The accepted terms are applied exactly where an AI settlement's are: a
// narrated event through applyEventImpactsToWorld (region transfers), the
// reparations transfer, and the war ledger's end. Lives in Game/AI because the
// ledger is here; src/runtime may not import this layer.
import { applyEventImpactsToWorld } from "../../runtime/gameState.js";
import { applyWarReparations, buildSettlementEvent } from "../../runtime/warSettlement.js";
import { applyWarUpdates } from "./nativeWarLedger.js";

export const applyPeaceOffer = ({ world, offer, date = "", round = 0 } = {}) => {
  if (!offer || !offer.warId) return null;
  const event = buildSettlementEvent(offer, { date, round });
  const applied = applyEventImpactsToWorld({
    colors: {},
    events: [event],
    world,
    motion: { originDate: date, round },
  });
  const paid = applyWarReparations(applied.world, [offer]);
  const merge = applyWarUpdates({
    world: paid,
    updates: [{ eventIds: [event.id], id: offer.warId, op: "end" }],
    events: [event],
    stopDate: date,
    round,
  });
  return { event, world: { ...merge.world, peaceOffer: null } };
};
