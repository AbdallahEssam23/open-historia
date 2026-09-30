/*! Open Historia — the type stacks, in one place © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The DOM reads these as the --oh-font-* custom properties in styles.css. A
// canvas has no cascade to read them from — MapLibre's local glyph rasterizer,
// OpenLayers' labels, Chart.js' ticks and the loading screen's <canvas> all take
// a font string instead — so the same three stacks are spelled out here and
// imported where a `ctx.font` or a `text-font` needs one. Keep the two lists in
// step; typography.test.js fails if they drift.
//
// The Arabic faces (IBM Plex Sans Arabic, Amiri) are declared with an
// Arabic-only unicode-range, so naming them first changes nothing for Latin
// text: the browser skips a family whose range excludes the character and falls
// through to Segoe UI / Georgia exactly as before. Naming them at all is what
// stops Arabic from landing on whatever system font the device happens to own.
export const UI_FONT_STACK = '"IBM Plex Sans Arabic", "Segoe UI", system-ui, sans-serif';
export const DISPLAY_FONT_STACK = '"Amiri", "Cinzel", "EB Garamond", serif';
export const MONO_FONT_STACK = 'ui-monospace, Consolas, "IBM Plex Sans Arabic", monospace';

// The faces above, in the order they should be tried for Arabic text. A canvas
// stack ends in a generic family, so these have to be inserted BEFORE it: after
// `serif` they would never be reached.
export const ARABIC_LABEL_FONTS = ["IBM Plex Sans Arabic", "Amiri"];

const ARABIC_LETTER = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

// True when a string carries any Arabic-script character: the letters, the
// presentation forms, or the Arabic-script range of Latin Extended. Latin
// digits, punctuation and country names do not count.
export const containsArabicScript = (value) => ARABIC_LETTER.test(String(value ?? ""));
