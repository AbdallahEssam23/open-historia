/*! Open Historia - deterministic economy: the period digest for the prompt (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the model is told about the period the engine just ran. It is given as
// fact so the narrator describes the engine's numbers rather than inventing its
// own, and it is capped so a campaign with hundreds of polities cannot inflate
// every prompt. Import-free: the digest is a string transform.

export const DIGEST_POLITY_CAP = 6;
export const DIGEST_CHAR_CAP = 900;

const number = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const signed = (value) => `${number(value) >= 0 ? "+" : ""}${number(value).toFixed(1)}`;

const lineFor = (delta, isPlayer) => {
  const who = isPlayer ? `${delta.polity} (yours)` : delta.polity;
  const fields = [
    `output ${signed(delta.gdpGrowth)}%`,
    `inflation ${number(delta.inflation).toFixed(1)}%`,
    `unemployment ${number(delta.unemployment).toFixed(1)}%`,
    `public debt ${Math.round(number(delta.publicDebt))}% of output`,
    `budget ${signed(delta.budgetBalance)}%`,
  ].join(", ");
  return `- ${who}: ${fields}${delta.estimated ? " (estimated)" : ""}.`;
};

export const buildEconomyDigest = ({ deltas, playerPolity = "", tracked = [], shocks = [] } = {}) => {
  const list = (Array.isArray(deltas) ? deltas : []).filter((d) => d && typeof d === "object" && d.polity);
  if (!list.length) return "";

  const player = String(playerPolity ?? "");
  const wanted = new Set((Array.isArray(tracked) ? tracked : []).map((name) => String(name ?? "")));
  const byName = new Map(list.map((d) => [String(d.polity), d]));

  const ordered = [];
  if (player && byName.has(player)) ordered.push(byName.get(player));
  for (const name of wanted) {
    if (name && name !== player && byName.has(name)) ordered.push(byName.get(name));
  }
  for (const delta of list) {
    if (String(delta.polity) !== player && !wanted.has(String(delta.polity))) ordered.push(delta);
  }

  const lines = [];
  const header = "Economy this period, computed locally (treat these as fact, do not restate them with different numbers):";
  let used = header.length;
  for (const delta of ordered.slice(0, DIGEST_POLITY_CAP)) {
    const line = lineFor(delta, String(delta.polity) === player);
    // A line that would overflow is dropped whole. Truncating mid sentence
    // invites the model to complete a number that was never written.
    if (used + line.length + 1 > DIGEST_CHAR_CAP) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (!lines.length) return "";

  const shockLines = (Array.isArray(shocks) ? shocks : [])
    .filter((s) => s && s.kind)
    .map(
      (s) =>
        `- A ${String(s.kind)} shock (severity ${number(s.severity, 1)}) has about ${Math.max(0, Math.round(number(s.monthsLeft)))} month(s) left.`,
    );

  return [header, ...lines, ...shockLines].join("\n");
};
