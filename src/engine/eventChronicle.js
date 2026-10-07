/*! Open Historia - read-only chronicle: a campaign's recorded deltas, turn by turn (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/engine/eventChronicle.test.js
//
// The campaign's turn ledger (world.simulationHistory) already records what each
// turn did: the engine's application receipt counts the operations that actually
// landed (runtime/applicationReceipt.js), beside each turn's dates, source and
// summary. Nothing reads that ledger as a whole; this module does, purely, so
// the Stats panel can show a read-only chronicle without touching state or
// re-simulating anything. It is import-free, so enginePurity.test.js covers it.

// The one player-facing grouping of impact keys, shared with the Events panel's
// event card (Game/GameUI/eventImpacts.js): a territory change is a transfer, a
// control flip or a raised claim; the rest map one to one. The keys are the
// receipt's applied keys and an event's impacts keys alike.
export const PLAYER_IMPACT_FAMILIES = Object.freeze([
  Object.freeze({ key: "regions", impacts: Object.freeze(["regionTransfers", "regionControlOps", "regionClaims"]) }),
  Object.freeze({ key: "polities", impacts: Object.freeze(["polityChanges"]) }),
  Object.freeze({ key: "forces", impacts: Object.freeze(["unitOps"]) }),
  Object.freeze({ key: "structures", impacts: Object.freeze(["markerOps"]) }),
  Object.freeze({ key: "projects", impacts: Object.freeze(["projectOps"]) }),
]);

export const CHRONICLE_DEFAULT_LIMIT = 240;

const asList = (value) => (Array.isArray(value) ? value : []);
const text = (value) => String(value ?? "").trim();
const positiveCount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
};

// One turn's change counts by the words a player reads, read from the receipt's
// `applied` map. A missing or malformed receipt is all zeros, never a throw.
export const receiptFamilyCounts = (receipt) => {
  const applied = receipt?.applied && typeof receipt.applied === "object" ? receipt.applied : {};
  const counts = {};
  let total = 0;
  for (const family of PLAYER_IMPACT_FAMILIES) {
    const count = family.impacts.reduce((sum, key) => sum + positiveCount(applied[key]), 0);
    counts[family.key] = count;
    total += count;
  }
  counts.events = positiveCount(applied.events);
  counts.total = total;
  return counts;
};

// The first non-empty line of a summary, so a row's title stays one line. Never
// generated: the summary is the model's own words.
const firstLine = (value) => text(value).split(/\r?\n/).map(text).find(Boolean) ?? "";

// One row per recorded turn, newest first (the ledger's own order), bounded by
// `limit` so a long campaign cannot make the render unbounded. Dates are kept as
// the stored strings; the caller formats them.
export const chronicleTurnRows = (history, { limit = CHRONICLE_DEFAULT_LIMIT } = {}) => {
  const cap = Math.max(1, Math.trunc(Number(limit) || 0) || CHRONICLE_DEFAULT_LIMIT);
  const rows = [];
  for (const entry of asList(history)) {
    if (!entry || typeof entry !== "object") continue;
    const counts = receiptFamilyCounts(entry.receipt);
    const toDate = text(entry.toDate) || text(entry.date);
    const round = positiveCount(entry.round);
    rows.push({
      id: text(entry.id) || `${toDate || "turn"}:${round || rows.length}`,
      round,
      mode: text(entry.mode) || "jump",
      source: text(entry.source) || "ai",
      fallback: text(entry.source).toLowerCase() === "fallback",
      fromDate: text(entry.fromDate),
      toDate,
      date: text(entry.date) || toDate,
      title: firstLine(entry.summary) || (round ? `Round ${round}` : "Turn"),
      summary: text(entry.summary),
      eventCount: counts.events || asList(entry.eventIds).length,
      regions: counts.regions,
      polities: counts.polities,
      forces: counts.forces,
      structures: counts.structures,
      projects: counts.projects,
      totalChanges: counts.total,
      strategicMoves: asList(entry.strategicMoves).length,
      tradeClimate: text(entry.tradeClimate),
    });
    if (rows.length >= cap) break;
  }
  return rows;
};

// The campaign rollup: how many turns were recorded, how many were jumps, how
// many fell back, the total events and changes, and the date span. Whole-ledger
// and unbounded on purpose: it is a handful of counters, not a list.
export const chronicleStats = (history) => {
  const stats = {
    turns: 0, jumps: 0, fallbackTurns: 0, events: 0,
    regions: 0, polities: 0, forces: 0, structures: 0, projects: 0,
    totalChanges: 0, firstDate: "", lastDate: "",
  };
  for (const entry of asList(history)) {
    if (!entry || typeof entry !== "object") continue;
    stats.turns += 1;
    const mode = text(entry.mode).toLowerCase();
    if (mode === "jump" || mode === "auto") stats.jumps += 1;
    if (text(entry.source).toLowerCase() === "fallback") stats.fallbackTurns += 1;
    const counts = receiptFamilyCounts(entry.receipt);
    stats.events += counts.events || asList(entry.eventIds).length;
    for (const family of PLAYER_IMPACT_FAMILIES) stats[family.key] += counts[family.key];
    stats.totalChanges += counts.total;
    const date = text(entry.toDate) || text(entry.date) || text(entry.fromDate);
    if (!date) continue;
    // Dates are stored ISO (YYYY-MM-DD), so a lexical compare is chronological.
    if (!stats.firstDate || date < stats.firstDate) stats.firstDate = date;
    if (!stats.lastDate || date > stats.lastDate) stats.lastDate = date;
  }
  return stats;
};
