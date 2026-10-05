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

const SCENE_FRAMING = "These are the engine's facts as they stand at the start of this scene. "
  + "Keep the narration consistent with them: do not conclude, close, leave or cease fire a war the engine holds "
  + "for the player's decision, do not deny a standing obligation or a recorded breach, and do not write a war "
  + "as just when the engine has marked it unjust.";

const GAME_MASTER_FRAMING = "These are the engine's facts as they stand before this transaction. "
  + "Keep the event and every warUpdates record consistent with them: do not conclude, close, leave or cease fire "
  + "a war the engine holds for the player's decision; the engine will withhold such a record. Do not deny a standing "
  + "obligation or a recorded breach, and do not write a war as just when the engine has marked it unjust.";

// The block, or "" when the world has no war facts to state. The order is the
// order the jump's [Wars] ledger already prints them in. The audience changes
// only the closing instruction: a scene narrates, a GM transaction writes a
// warUpdates record the engine may refuse.
export const buildWarFactsDirective = (variables = {}, { audience = "scene" } = {}) => {
  const { treatyObligations, treatyBreach, warCasus, peaceOffer } = variables ?? {};
  const lines = [treatyObligations, treatyBreach, warCasus, peaceOffer]
    .map(text)
    .filter(Boolean);
  if (!lines.length) return "";
  const framing = audience === "gameMaster" ? GAME_MASTER_FRAMING : SCENE_FRAMING;
  return `[Standing War Facts]\n${lines.join("\n")}\n${framing}`;
};
