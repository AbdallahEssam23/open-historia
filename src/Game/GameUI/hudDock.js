/*! Open Historia — the bottom-left launcher dock's geometry, in one place © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The dock is the rounded pill at the bottom left holding the launchers: Chat,
// Actions, Projects & Operations. Its width is a function of how many there
// are, and the Search control sits just to the right of it.
//
// That width used to be a literal in chat.jsx and a second literal in
// search.jsx, with a comment asking the next person to keep them in step. They
// drifted when Projects was added, and again when a Dossier launcher was (since
// removed: documents now reach the player through diplomacy, spies and events),
// and that time Search ended up sitting ON TOP of the new button. So the number
// lives here and both files derive from it: a launcher added or removed moves
// Search on its own.
import { SAFE_TOP } from "../../runtime/mobileUi.js";

// The pill itself.
export const DOCK_BOTTOM_REM = 0.5;
export const DOCK_LEFT_REM = 0.5;
export const DOCK_HEIGHT_REM = 4;
// One launcher, and the gap to the next.
export const DOCK_BUTTON_REM = 3.3;
export const DOCK_GAP_REM = 0.75;
// The pill's own slack around them.
const DOCK_SLACK_REM = 0.65;

export const DOCK_LAUNCHERS = ["chat", "actions", "projects"];

// Sums of tenths are not exact in floating point (0.65 + 3 × 4.05 is
// 12.799999999999999); the styles get them rounded to the thousandth.
const tidy = (value) => Math.round(value * 1000) / 1000;

export const dockWidthRem = (buttons = DOCK_LAUNCHERS.length) =>
    tidy(DOCK_SLACK_REM + buttons * (DOCK_BUTTON_REM + DOCK_GAP_REM));

export const DOCK_WIDTH_REM = dockWidthRem();
export const DOCK_WIDTH = `${DOCK_WIDTH_REM}rem`;

// Where anything beside the dock begins.
export const DOCK_RIGHT_EDGE_REM = tidy(DOCK_LEFT_REM + DOCK_WIDTH_REM);
export const BESIDE_DOCK_LEFT = `${tidy(DOCK_RIGHT_EDGE_REM + 0.5)}rem`;

// The bottom edge of the launcher BUTTONS, not of the pill: a smaller control
// beside them looks deliberate when it lines up with the buttons, and looks
// like a mistake when it lines up with nothing.
export const DOCK_BUTTON_BOTTOM_REM = tidy(DOCK_BOTTOM_REM + (DOCK_HEIGHT_REM - DOCK_BUTTON_REM) / 2);
export const DOCK_BUTTON_BOTTOM = `${DOCK_BUTTON_BOTTOM_REM}rem`;

// With the full-width in-game bar gone, top-anchored UI (settings ⋮, date widget,
// forces panel, editor drawer) starts at the screen edge, below a status bar or
// camera cutout the page is drawn under (Android Chrome in fullscreen, a
// home-screen app); the inset is 0 everywhere else. It lives here with the rest
// of the HUD's geometry: read from libraryBar.jsx, it was a static edge from the
// HUD shell to the whole library for the sake of one CSS length.
export const TOP_BAR_OFFSET = `calc(0.5rem + ${SAFE_TOP})`;
