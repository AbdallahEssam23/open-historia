import test from "node:test";
import assert from "node:assert/strict";

import {
  PLAYER_IMPACT_FAMILIES,
  chronicleStats,
  chronicleTurnRows,
  receiptFamilyCounts,
} from "./eventChronicle.js";

const turn = (overrides = {}) => ({
  date: "1936-06-01",
  fromDate: "1936-01-01",
  toDate: "1936-06-01",
  round: 2,
  mode: "jump",
  source: "ai",
  summary: "The border shifts.",
  eventIds: ["e1", "e2"],
  receipt: { applied: { events: 2, regionTransfers: 1, regionControlOps: 2, polityChanges: 1, unitOps: 3 } },
  ...overrides,
});

test("the shared family grouping stays the canonical five", () => {
  assert.deepEqual(PLAYER_IMPACT_FAMILIES.map((family) => family.key), ["regions", "polities", "forces", "structures", "projects"]);
});

test("receiptFamilyCounts reads the applied counts by family", () => {
  const counts = receiptFamilyCounts({ applied: { events: 4, regionTransfers: 1, regionControlOps: 2, regionClaims: 3, polityChanges: 1, unitOps: 2, markerOps: 5, projectOps: 1 } });
  assert.deepEqual(counts, { regions: 6, polities: 1, forces: 2, structures: 5, projects: 1, events: 4, total: 15 });
});

test("a missing or malformed receipt is all zeros, never a throw", () => {
  assert.deepEqual(receiptFamilyCounts(null), { regions: 0, polities: 0, forces: 0, structures: 0, projects: 0, events: 0, total: 0 });
  assert.deepEqual(receiptFamilyCounts({ applied: { unitOps: "many", markerOps: null, polityChanges: -3 } }), { regions: 0, polities: 0, forces: 0, structures: 0, projects: 0, events: 0, total: 0 });
});

test("rows keep the ledger order (newest first) and carry the turn's facts", () => {
  const rows = chronicleTurnRows([turn({ id: "new" }), turn({ id: "old", round: 1, source: "fallback", receipt: null })]);
  assert.deepEqual(rows.map((row) => row.id), ["new", "old"]);
  assert.equal(rows[0].regions, 3);
  assert.equal(rows[0].forces, 3);
  assert.equal(rows[0].title, "The border shifts.");
  assert.equal(rows[0].eventCount, 2);
  assert.equal(rows[1].fallback, true);
  assert.equal(rows[1].regions, 0);
});

test("eventCount falls back to eventIds when a turn predates receipts", () => {
  const rows = chronicleTurnRows([turn({ receipt: null, eventIds: ["a", "b", "c"] })]);
  assert.equal(rows[0].eventCount, 3);
});

test("a malformed entry is skipped and the cap bounds the list", () => {
  const history = [null, "nope", turn({ id: "a" }), turn({ id: "b" }), turn({ id: "c" })];
  const rows = chronicleTurnRows(history, { limit: 2 });
  assert.deepEqual(rows.map((row) => row.id), ["a", "b"]);
});

test("a title falls back to a round label when there is no summary", () => {
  const rows = chronicleTurnRows([turn({ summary: "", round: 7 })]);
  assert.equal(rows[0].title, "Round 7");
});

test("chronicleStats totals across the ledger and reports the span", () => {
  const stats = chronicleStats([
    turn({ toDate: "1936-06-01", receipt: { applied: { events: 2, regionTransfers: 2 } } }),
    turn({ toDate: "1936-01-01", mode: "auto", source: "fallback", round: 1, receipt: { applied: { events: 1, unitOps: 4 } } }),
  ]);
  assert.equal(stats.turns, 2);
  assert.equal(stats.jumps, 2);
  assert.equal(stats.fallbackTurns, 1);
  assert.equal(stats.events, 3);
  assert.equal(stats.regions, 2);
  assert.equal(stats.forces, 4);
  assert.equal(stats.totalChanges, 6);
  assert.equal(stats.firstDate, "1936-01-01");
  assert.equal(stats.lastDate, "1936-06-01");
});

test("an empty history is all zeros and no span", () => {
  assert.deepEqual(chronicleStats([]), {
    turns: 0, jumps: 0, fallbackTurns: 0, events: 0,
    regions: 0, polities: 0, forces: 0, structures: 0, projects: 0,
    totalChanges: 0, firstDate: "", lastDate: "",
  });
  assert.deepEqual(chronicleTurnRows([]), []);
});

test("the chronicle is deep-equal across two calls", () => {
  const history = [turn({ id: "x" }), turn({ id: "y" })];
  assert.deepEqual(chronicleTurnRows(history), chronicleTurnRows(history));
  assert.deepEqual(chronicleStats(history), chronicleStats(history));
});
