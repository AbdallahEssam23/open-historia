/*! Open Historia - the peace the engine offers the player on their own war (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/runtime/peaceOffer.test.js
//
// The engine settles every AI war on its own. A war the player is a party to is
// held back as an offer instead: the terms are the ones settleWar already
// derived, stored whole because re-deriving them later would need the turn's
// battle inputs. This module chooses the single most pressing offer and tidies
// what a save carries. It imports nothing, so it runs under node --test.

const text = (value) => String(value ?? "").trim();
const whole = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0);
const bound01 = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
};

const normalizeTransfers = (value) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    const regionId = text(entry?.regionId);
    if (!regionId) continue;
    out.push({ regionId, fromCode: text(entry?.fromCode), toCode: text(entry?.toCode) });
  }
  return out;
};

const normalizeReparations = (value) => ({
  fromCode: text(value?.fromCode),
  toCode: text(value?.toCode),
  manpower: Math.max(0, Number(value?.manpower) || 0),
  materiel: Math.max(0, Number(value?.materiel) || 0),
});

const normalizeBelligerents = (value) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const polity = text(raw);
    const key = polity.toLowerCase();
    if (!polity || seen.has(key)) continue;
    seen.add(key);
    out.push(polity);
    if (out.length >= 8) break;
  }
  return out;
};

// A stored offer, or null. A value with no war id is not an offer.
export const normalizePeaceOffer = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const warId = text(value.warId);
  if (!warId) return null;
  const side = text(value.side).toLowerCase();
  return {
    warId,
    round: whole(value.round),
    side: side === "a" || side === "b" ? side : "",
    pressure: bound01(value.pressure),
    victor: text(value.victor),
    loser: text(value.loser),
    capitulation: value.capitulation === true,
    white: value.white === true,
    punitive: value.punitive === true,
    transfers: normalizeTransfers(value.transfers),
    reparations: normalizeReparations(value.reparations),
    belligerents: normalizeBelligerents(value.belligerents),
  };
};

// The one offer worth showing: the most pressing, ties by the lowest war id, so
// the same turn always chooses the same offer whatever the array order.
export const choosePeaceOffer = ({ offers = [], round = 0 } = {}) => {
  const list = (Array.isArray(offers) ? offers : [])
    .map(normalizePeaceOffer)
    .filter(Boolean);
  if (!list.length) return null;
  list.sort((a, b) => {
    if (b.pressure !== a.pressure) return b.pressure - a.pressure;
    return a.warId < b.warId ? -1 : a.warId > b.warId ? 1 : 0;
  });
  return { ...list[0], round: whole(round) };
};

// The pending offer as one line for the war ledger the model reads, or "" when
// none is due. It exists so the model does not narrate a settlement the engine
// is still holding: the war is real, the terms are derived, and only the
// player's decision is outstanding.
export const buildPeaceOfferDigest = ({ offer } = {}) => {
  const pending = normalizePeaceOffer(offer);
  if (!pending) return "";
  return `[Peace Offer Pending, as simulated]
- ${pending.warId} is settled on the engine's terms and awaits the player's decision; do not narrate it as concluded, and do not close, leave or cease fire the war until the player accepts or declines.`;
};

// The offer the turn keeps. The turn filters its due offers by the model's own
// closing ids, so when applyWarUpdates withheld such a record the offered war is
// no longer among the due offers. The pending offer is carried forward instead,
// so a held operation never clears the player's decision; otherwise the freshly
// chosen offer stands.
export const keepHeldPeaceOffer = ({ carried, withheldIds, chosen } = {}) => {
  const pending = normalizePeaceOffer(carried);
  if (!pending) return normalizePeaceOffer(chosen);
  const heldIds = new Set(
    (Array.isArray(withheldIds) ? withheldIds : [])
      .map((id) => String(id ?? "").trim())
      .filter(Boolean),
  );
  return heldIds.has(pending.warId) ? pending : normalizePeaceOffer(chosen);
};

// The operations that end a war's life. A pending offer holds exactly these:
// a goal declaration or a joiner does not close the war, so neither is held.
export const PEACE_OFFER_HELD_OPS = Object.freeze(["end", "ceasefire", "leave"]);

// True when this war record would close, leave or cease fire the war the engine
// is holding open for the player's decision. The ledger trims an id and
// lower-cases an op, so this matches that normalisation and nothing more.
export const peaceOfferHoldsWarUpdate = ({ update, offer } = {}) => {
  const pending = normalizePeaceOffer(offer);
  if (!pending) return false;
  const warId = String(update?.id ?? "").trim();
  if (!warId || warId !== pending.warId) return false;
  return PEACE_OFFER_HELD_OPS.includes(String(update?.op ?? "").trim().toLowerCase());
};
