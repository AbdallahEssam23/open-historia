/*! Open Historia - the operations digest for the prompt (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the model is told about its own formations in the field: the supply
// state part two derives, the policy part three puts in force, and the ids it
// needs to name a rotation or a merge. Player-only and capped, so a large
// roster cannot inflate every prompt. A string transform with no imports.

export const OPERATIONS_ROW_CAP = 6;
export const OPERATIONS_CHAR_CAP = 360;

const number = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const name = (value) => String(value ?? "").trim();

// The engine's three supply states, read for the prompt: isolated is a pocket,
// strained is a formation only reached around the network, supplied is fed.
const STATE_LABEL = { supplied: "in supply", strained: "strained", isolated: "cut off" };
const SEVERITY = { isolated: 0, strained: 1, supplied: 2 };

const stateLabel = (state) => STATE_LABEL[name(state)] || name(state) || "unknown";

// A strength the engine never wrote is full, not zero: the roster prints the
// same default the core uses, so a blank field never reads as a broken unit.
const strengthOf = (row) => Math.max(0, Math.min(100, Math.round(number(row?.strength, 100))));

const needsAttention = (row) => name(row?.state) !== "supplied" || strengthOf(row) < 100;

const compareRows = (a, b) => {
  const sa = SEVERITY[name(a?.state)] ?? 3;
  const sb = SEVERITY[name(b?.state)] ?? 3;
  if (sa !== sb) return sa - sb;
  const wa = strengthOf(a);
  const wb = strengthOf(b);
  if (wa !== wb) return wa - wb;
  const ia = name(a?.id);
  const ib = name(b?.id);
  return ia < ib ? -1 : ia > ib ? 1 : 0;
};

const summaryLineFor = (rows) => {
  const supplied = rows.filter((row) => name(row.state) === "supplied").length;
  const strained = rows.filter((row) => name(row.state) === "strained").length;
  const isolated = rows.filter((row) => name(row.state) === "isolated").length;
  const weak = rows.filter((row) => strengthOf(row) < 100).length;
  let line = `${supplied} of ${rows.length} formations in supply`;
  const tail = [];
  if (strained > 0) tail.push(`${strained} strained`);
  if (isolated > 0) tail.push(`${isolated} cut off`);
  if (tail.length) line += `; ${tail.join(", ")}`;
  line += ".";
  if (weak > 0) line += ` ${weak} below full strength.`;
  return line;
};

const policyLineFor = (policyInForce, pendingPolicy) => {
  const inForce = name(policyInForce).toLowerCase();
  let line = inForce ? `Reinforcement policy: ${inForce} (in force)` : "Reinforcement policy: none in force";
  const pending = name(pendingPolicy).toLowerCase();
  if (pending && pending !== inForce) line += `; declared for next period: ${pending}`;
  return `${line}.`;
};

const rowLineFor = (row) =>
  `- ${name(row.name) || name(row.id)} [id ${name(row.id)}] ${strengthOf(row)}%, ${stateLabel(row.state)}.`;

export const buildOperationsDigest = ({
  formations = [],
  policyInForce = "",
  pendingPolicy = "",
  cap = OPERATIONS_ROW_CAP,
  charCap = OPERATIONS_CHAR_CAP,
} = {}) => {
  const rows = (Array.isArray(formations) ? formations : []).filter((row) => row && typeof row === "object" && name(row.id));
  if (!rows.length) return "";

  const limit = Math.max(0, Math.round(number(cap, OPERATIONS_ROW_CAP)));
  const budget = Math.max(0, Math.round(number(charCap, OPERATIONS_CHAR_CAP)));

  const ordered = rows.filter(needsAttention).sort(compareRows);
  const shown = ordered.slice(0, limit);
  // Only the rows left out that are out of supply are counted; a below-strength
  // row dropped by the cap is already in the summary's below-strength total.
  const overflow = ordered.slice(limit).filter((row) => name(row.state) !== "supplied").length;

  const fixed = [
    "[Your Forces in the Field, as simulated]",
    summaryLineFor(rows),
    policyLineFor(policyInForce, pendingPolicy),
  ].join("\n");

  const detail = shown.map(rowLineFor);
  const overflowLine = overflow > 0 ? `+${overflow} more out of supply.` : "";

  // A line that would overflow the cap is dropped whole rather than truncated,
  // so the model is never handed half a fact, like the economy digest.
  let used = fixed.length + (overflowLine ? overflowLine.length + 1 : 0);
  const kept = [];
  for (const line of detail) {
    if (used + line.length + 1 > budget) break;
    kept.push(line);
    used += line.length + 1;
  }
  return [fixed, ...kept, overflowLine].filter(Boolean).join("\n");
};
