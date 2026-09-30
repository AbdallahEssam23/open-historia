/*! Open Historia — the main menu's open state, out of the panel that draws it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Whether the main menu is showing, and the bridge that opens it on a library
// tab. Both used to live in libraryBar.jsx, and two things OUTSIDE the menu read
// them: the HUD shell (main.jsx) tells Discord which scene is up, and the date
// widget (time.jsx) holds its map cards back while the menu covers the world.
// Imported from there, those two lines kept the whole library — the game and
// scenario browser, the editors, JSZip — in the boot graph, so the menu could
// never be fetched on demand. Here it is a leaf that imports only React.
//
// Module scope, not per-component state: the whole UI tree remounts whenever the
// active game changes, and per-component state would reset to "open" mid
// game-start and the menu would pop back over the freshly activated game. The
// app boots into the menu.
import { useSyncExternalStore } from "react";

let menuOpen = true;
const listeners = new Set();

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const isMainMenuOpen = () => menuOpen;

// The reactive twin, for pieces that portal to document.body above the menu's
// own layer (the diplomatic bell and toasts): they follow this rather than
// juggling z-indexes against the menu. `subscribe` is a module constant, so
// useSyncExternalStore keeps the same subscription across renders.
export const useMainMenuOpen = () => useSyncExternalStore(subscribe, isMainMenuOpen, isMainMenuOpen);

// The module-level flag is the ONLY value that survives the keyed UI remount a
// game activation triggers, so every open/close writes it: flows that activate a
// game flip it BEFORE awaiting the request, and the new instance must mount
// closed.
export const setMainMenuOpen = (open) => {
  menuOpen = Boolean(open);
  listeners.forEach((listener) => listener());
};

// Set while the library bar is mounted. Lets outside callers (Settings → Game
// Management) open the main menu on a specific tab without importing the panel.
let openTab = null;

export const setOpenLibraryTabHandler = (handler) => {
  openTab = handler;
};

export const openLibraryTab = (tab) => {
  openTab?.(tab);
};
