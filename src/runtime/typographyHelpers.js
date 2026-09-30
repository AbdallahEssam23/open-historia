/*! Open Historia — map-label typography, shared by both renderers © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// How a country or polity name is measured and spaced when it is drawn on the
// map canvas. Two renderers build those labels — the classic country atlas
// (runtime/countryLabels.js) and the vnext polity renderer
// (Game/Map/vnext/polityLabels.js) — and they agreed on all of this except the
// line-mode calibration, which each tuned against its own output. The
// measurement and the Arabic rule are identical, so they live here; the one
// table that genuinely differs is passed in by the caller.
//
// DOM-free and dependency-free beyond the Arabic-script test, because one caller
// (polityLabels.js) runs inside the political-cartography worker.

import { containsArabicScript } from "./fontStacks.js";

// Per-glyph width in em, for the upper-case Latin names these labels carry.
const nameGlyphWidthEm = (glyph) => {
  if (glyph === " ") return 0.34;
  if ("MW@%".includes(glyph)) return 0.82;
  if ("IJLT1".includes(glyph)) return 0.40;
  if ("ABCDEFGHKNOPQRSTUVXYZ023456789".includes(glyph)) return 0.60;
  return 0.56;
};

export const textBaseWidthEm = (name) => Array.from(String(name ?? "").toUpperCase())
  .reduce((sum, glyph) => sum + nameGlyphWidthEm(glyph), 0);

export const textGapCount = (name) => Math.max(0, Array.from(String(name ?? "")).length - 1);

export const estimatedTextWidthEm = (name, letterSpacing = 0) =>
  textBaseWidthEm(name) + textGapCount(name) * Math.max(0, Number(letterSpacing) || 0);

// A table is [maxLetterCount, spacing] pairs plus a tail for anything longer.
const pickSpacing = (letters, table, tail) => {
  for (const [limit, value] of table) {
    if (letters <= limit) return value;
  }
  return tail;
};

const lettersOf = (name) => Math.max(1, String(name ?? "").replace(/\s+/g, "").length);

// The point-mode tables are the same for every renderer: an atlas-style point
// label spends territory on larger glyphs first and on tracking second.
const POINT_PREFERRED = [[5, 0.36], [7, 0.28], [10, 0.20], [14, 0.14], [20, 0.10]];
const POINT_PREFERRED_TAIL = 0.07;
const POINT_MAX = [[5, 0.62], [7, 0.48], [10, 0.34], [14, 0.24], [20, 0.15]];
const POINT_MAX_TAIL = 0.10;
// Giant continental names get atlas-style tracking to span a continent, and only
// short names receive it; normal states stay typographically cohesive.
const CONTINENTAL_SCALE = 170000;
const CONTINENTAL_MAX = [[5, 1.15], [7, 1.00], [10, 0.72], [14, 0.42]];
const CONTINENTAL_MAX_TAIL = 0.20;

// Builds the three spacing lookups for one renderer, calibrated by the
// line-mode tables it passes in (linePreferred/lineMax and their tails).
export const createLabelSpacing = ({ linePreferred, linePreferredTail, lineMax, lineMaxTail }) => {
  const preferredLetterSpacing = (name, mode = "point") => {
    // Arabic joins its letters into one cursive run: any tracking at all pulls
    // the joins apart and reads as a rendering fault. Fitting still measures the
    // name — it just spends the territory on glyph size instead of on air.
    if (containsArabicScript(name)) return 0;
    const letters = lettersOf(name);
    return mode === "line"
      ? pickSpacing(letters, linePreferred, linePreferredTail)
      : pickSpacing(letters, POINT_PREFERRED, POINT_PREFERRED_TAIL);
  };

  const maxLetterSpacing = (name, mode = "point") => {
    if (containsArabicScript(name)) return 0;
    const letters = lettersOf(name);
    return mode === "line"
      ? pickSpacing(letters, lineMax, lineMaxTail)
      : pickSpacing(letters, POINT_MAX, POINT_MAX_TAIL);
  };

  const pointMaxLetterSpacing = (name, priorityScale) => {
    if (containsArabicScript(name)) return 0;
    const letters = lettersOf(name);
    if (priorityScale >= CONTINENTAL_SCALE) {
      return pickSpacing(letters, CONTINENTAL_MAX, CONTINENTAL_MAX_TAIL);
    }
    return maxLetterSpacing(name, "point");
  };

  return { preferredLetterSpacing, maxLetterSpacing, pointMaxLetterSpacing };
};
