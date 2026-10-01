/*! Open Historia - deterministic economy: the period digest for the prompt (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the model is told about the period the engine just ran. It is given as
// fact so the narrator describes the engine's numbers rather than inventing its
// own, and it is capped so a campaign with hundreds of polities cannot inflate
// every prompt. The one import is the pure effects label; otherwise the digest
// is a string transform.

import { researchEffectTotalsLabel } from "../engine/researchEffects.js";

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

const thousands = (value) => Math.max(0, Math.round(number(value))).toLocaleString("en-US");

// What the army could not pay last month. It is the engine's own number and the
// reason stability is slipping, so it is named only when it exists; manpower is
// grouped like the pool line above and materiel keeps its two decimals.
const shortfallClauseFor = (shortfall) => {
  if (!shortfall || typeof shortfall !== "object") return "";
  const parts = [];
  if (number(shortfall.manpower) > 0) parts.push(`${thousands(shortfall.manpower)} manpower`);
  if (number(shortfall.materiel) > 0) parts.push(`${number(shortfall.materiel).toFixed(2)} materiel`);
  return parts.length ? ` Upkeep shortfall last month: ${parts.join(", ")}.` : "";
};

const poolLineFor = ({ playerPolity, playerPools, playerPosture, postureChanged, playerShortfall }) => {
  if (!playerPolity || !playerPools) return "";
  const posture = String(playerPosture ?? "").trim() || "peacetime";
  const clause = postureChanged ? " (changed this period)" : "";
  return `Your reserves: manpower ${thousands(playerPools.manpower)}, `
    + `materiel ${number(playerPools.materiel).toFixed(2)}. Mobilization: ${posture}${clause}.`
    + shortfallClauseFor(playerShortfall);
};

// What the line is building: the active item with its remaining months, then the
// waiting ones in order. Every number is the engine's own, read off the line it
// persisted, so the digest imports nothing to state a duration.
const productionClauseFor = (line) => {
  if (!line || typeof line !== "object") return "";
  const active = line.active;
  const parts = [];
  if (active) {
    const left = Math.max(0, number(active.monthsTotal) - number(active.monthsDone));
    parts.push(`${number(active.count, 1)}x ${String(active.type ?? "").trim()} (${left} month${left === 1 ? "" : "s"} left)`);
  }
  for (const item of Array.isArray(line.queue) ? line.queue : []) {
    const months = Math.max(0, number(item.monthsTotal));
    parts.push(`${number(item.count, 1)}x ${String(item.type ?? "").trim()} (${months} month${months === 1 ? "" : "s"})`);
  }
  return parts.length ? `Production line: ${parts.join(", then ")}.` : "";
};

// What the country is researching: the rate, the programme at the head of the
// queue and how far it has got, and how many wait behind it. Player-only, like
// the production line: an enemy's research rate is intelligence, not a digest.
const researchClauseFor = (research) => {
  if (!research || !Array.isArray(research.programmes) || !research.programmes.length) return "";
  const head = research.programmes[0];
  const pct = head.cost > 0 ? Math.min(100, Math.floor((100 * head.accumulated) / head.cost)) : 0;
  const behind = research.programmes.length - 1;
  const queue = behind > 0 ? `, ${behind} queued` : "";
  return `Research: ${research.points}/month on ${head.name} (${pct}%${queue}).`;
};

// The player's completed-research totals, rendered as one line. Only the targets
// a polity actually holds appear, so a country that has finished no programme
// pays nothing for the feature. Player-only, like the research line.
const researchEffectsClauseFor = (totals) => {
  const summary = researchEffectTotalsLabel(totals);
  return summary ? `Research effects: ${summary}` : "";
};

export const buildEconomyDigest = ({
  deltas,
  playerPolity = "",
  tracked = [],
  shocks = [],
  playerPools = null,
  playerPosture = "",
  postureChanged = false,
  playerShortfall = null,
  playerProduction = null,
  research = null,
  playerResearchEffects = null,
} = {}) => {
  const list = (Array.isArray(deltas) ? deltas : []).filter((d) => d && typeof d === "object" && d.polity);
  const player = String(playerPolity ?? "");
  const poolLine = poolLineFor({ playerPolity: player, playerPools, playerPosture, postureChanged, playerShortfall });
  const productionLine = productionClauseFor(playerProduction);
  const researchLine = researchClauseFor(research);
  const researchEffectsLine = researchEffectsClauseFor(playerResearchEffects);
  const reserveBlock = [poolLine, productionLine, researchLine, researchEffectsLine].filter(Boolean).join("\n");
  if (!list.length) return reserveBlock;

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
  // Reserve the header + pool line separators so the pool line always survives.
  let used = header.length + (reserveBlock ? reserveBlock.length + 1 : 0);
  for (const delta of ordered.slice(0, DIGEST_POLITY_CAP)) {
    const line = lineFor(delta, String(delta.polity) === player);
    // A line that would overflow is dropped whole. Truncating mid sentence
    // invites the model to complete a number that was never written.
    if (used + line.length + 1 > DIGEST_CHAR_CAP) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (!lines.length) return reserveBlock;

  const shockLines = (Array.isArray(shocks) ? shocks : [])
    .filter((s) => s && s.kind)
    .map(
      (s) =>
        `- A ${String(s.kind)} shock (severity ${number(s.severity, 1)}) has about ${Math.max(0, Math.round(number(s.monthsLeft)))} month(s) left.`,
    );

  return [header, reserveBlock, ...lines, ...shockLines].filter(Boolean).join("\n");
};
