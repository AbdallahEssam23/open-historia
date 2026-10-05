/*! Open Historia - the notice that the engine held a war open (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/runtime/warHoldNotice.test.js
//
// When the model writes a record that would close the player's offered war, the
// turn validator refuses it and applyWarUpdates withholds it (withheldIds). The
// receipt records that for the model; this renders the same fact for the player
// as one short sentence. It imports nothing, so it runs under node --test.

// The emitter (Game/AI) and the listener (GameUI) share this one name.
export const WAR_HELD_EVENT = "oh:war-held";

export const buildWarHoldNotice = ({ warIds = [] } = {}) => {
  const ids = (Array.isArray(warIds) ? warIds : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (!ids.length) return "";
  const list = ids.join(", ");
  if (ids.length === 1) {
    return `The war ${list} stays open: the engine is holding back a record that would close it until you decide the pending peace offer.`;
  }
  return `The wars ${list} stay open: the engine is holding back records that would close them until you decide the pending peace offers.`;
};
