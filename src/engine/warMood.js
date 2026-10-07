/*! Open Historia - war mood from the ledger (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/engine/warMood.test.js
//
// One pure question the audio host asks: which bed should play? "idle" when no
// war is active, "war" when the player is a belligerent, "tension" when wars are
// running that the player is not in. Import-free, so it obeys the engine purity
// rules and is tested with plain objects.

const asList = (value) => (Array.isArray(value) ? value : []);
const text = (value) => String(value ?? "").trim().toLowerCase();

// A side is a list of polities; each is a name string, or an object carrying one
// under a name-ish field (the ledger's own shape is not pinned here).
const partyName = (party) => {
  if (typeof party === "string") return party;
  if (!party || typeof party !== "object") return "";
  return party.name ?? party.polity ?? party.id ?? "";
};

export const deriveMusicState = ({ wars = [], playerName = "" } = {}) => {
  const active = asList(wars).filter((war) => text(war?.status) === "active");
  if (!active.length) return "idle";
  const player = text(playerName);
  if (!player) return "tension";
  const belligerent = active.some((war) =>
    [...asList(war?.sideA), ...asList(war?.sideB)].some((party) => text(partyName(party)) === player));
  return belligerent ? "war" : "tension";
};
