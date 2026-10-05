/*! Open Historia - the engine's war facts as one scene directive (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/runtime/warFacts.test.js
//
// An interactive event runs the same turn as a time skip and narrates the same
// world, but it is a scene that writes no ledger records: its resolved event
// carries empty impacts. So it is told the facts it must not contradict, not
// the war-updates contract it cannot use. This module renders the four digests
// the skip already carries into one block. It imports nothing, so it runs
// under node --test.

const text = (value) => String(value ?? "").trim();

// The block, or "" when the world has no war facts to state. The order is the
// order the jump's [Wars] ledger already prints them in.
export const buildWarFactsDirective = ({
  treatyObligations,
  treatyBreach,
  warCasus,
  peaceOffer,
} = {}) => {
  const lines = [treatyObligations, treatyBreach, warCasus, peaceOffer]
    .map(text)
    .filter(Boolean);
  if (!lines.length) return "";
  return `[Standing War Facts]
${lines.join("\n")}
These are the engine's facts as they stand at the start of this scene. Keep the narration consistent with them: do not conclude, close, leave or cease fire a war the engine holds for the player's decision, do not deny a standing obligation or a recorded breach, and do not write a war as just when the engine has marked it unjust.`;
};
