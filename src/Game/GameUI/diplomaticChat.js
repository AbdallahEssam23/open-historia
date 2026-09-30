/*! Open Historia — asking the chat panel for a diplomatic thread © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The map's country popup, its region cards and the advisor all open a
// diplomatic thread by name, and none of them should carry the chat panel to do
// it — chat.jsx brings the diplomacy feed, the spy tab, the markdown renderer and
// the place geocoder with it, and the region cards are on the boot path (the map
// and the HUD both use them). So the request travels through this leaf instead:
// the panel subscribes while it is mounted, callers just announce.
//
// Nothing here sends anything: `draft` is text the panel puts in its composer
// for the player to read over and send themselves.
const listeners = new Set();

export const subscribeDiplomaticChat = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const requestDiplomaticChat = (country, { draft = "" } = {}) => {
  if (!country || !country.name) return;
  listeners.forEach((listener) => {
    try { listener(country, draft); } catch { /* one panel failing must not stop the rest */ }
  });
};
