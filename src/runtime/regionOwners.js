// Open Historia - effective region control (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// One definition of who actually controls a region, shared by the prompt
// vocabulary and the derived front-line layer so the two can never disagree.
// It lives in runtime rather than Game/AI because runtime modules must not
// import the AI layer.

import { toCountryName } from "./ownerNames.js";

const norm = (value) => String(value ?? "").trim();

// The in-game owner of a region, ALWAYS as the full country name ("Spain"): an
// explicit override wins, else the base country from the catalog (so stock maps
// report real ownership, not ""). A legacy override still holding a code is
// canonicalised here rather than handed on.
export const regionOwnerName = (region, overrides) => {
  const override = norm(overrides?.[region?.id]);
  if (override) return toCountryName(override);
  return norm(region?.country) || toCountryName(norm(region?.countryCode));
};
