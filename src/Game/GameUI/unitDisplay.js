/*! Open Historia — how a unit's strength and intent read on screen © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Two small readouts the forces panel and the unit popup (Selection/Units.jsx)
// both draw — a strength band and the player's word for a posture. They used to
// be exported from forces.jsx, which meant the unit popup, on the boot path with
// the map, carried the whole panel to call two one-line functions.

// Strength is a percentage of the formation's established strength, so the bands
// are readable: near full, worn down, or a shell of itself.
export const strengthColor = (strength) =>
  strength > 60 ? "#4ade80" : strength > 25 ? "#fbbf24" : "#f87171";

// Intent, in the player's language rather than the schema's. One copy on purpose:
// the two callers must not disagree about what "massing" is called.
export const POSTURE_LABEL = {
  holding: "Holding position",
  massing: "Massing",
  patrol: "Patrolling",
  transit: "In transit",
  exercise: "On exercise",
  blockade: "Blockading",
  withdrawing: "Withdrawing",
  assaulting: "Assaulting",
};
