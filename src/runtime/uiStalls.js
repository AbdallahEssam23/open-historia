/*! Open Historia — main-thread stall recorder © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What a player calls "it froze": the main thread blocked long enough that the
// interface stopped responding. The browser already measures it — a long task is
// any main-thread block over ~50 ms — so this observes those passively (no
// requestAnimationFrame loop, no work per frame) and keeps a small ring for the
// Diagnostics Log to print. A country-selection stall is exactly this: the label
// rebuild or the panel's geometry work running synchronously in the click's turn.
//
// Passive and Chromium-only (Chrome/Android WebView/Electron). Other engines
// simply record nothing, and the report section stays absent.

const LIMIT = 40;
// An interaction is worth attributing a stall to for a few seconds after it: the
// rebuild it triggers runs on a debounce (translator.js) and a frame or two later.
const ATTRIBUTION_WINDOW_MS = 8000;

let observer = null;
let installed = false;
const stalls = [];
const interactions = [];

const round = (value) => Math.round(Number(value) || 0);

const stallSource = (entry) => {
  const attribution = Array.isArray(entry?.attribution) ? entry.attribution[0] : null;
  const label = attribution?.containerName || attribution?.containerType || entry?.name || "self";
  return String(label);
};

const phaseAt = (at) => {
  for (let index = interactions.length - 1; index >= 0; index -= 1) {
    if (at - interactions[index].at <= ATTRIBUTION_WINDOW_MS) return interactions[index].label;
  }
  return "";
};

const record = (entry) => {
  const ms = round(entry?.duration);
  if (ms <= 0) return;
  const at = Date.now();
  stalls.push({ at, ms, phase: phaseAt(at), source: stallSource(entry) });
  if (stalls.length > LIMIT) stalls.splice(0, stalls.length - LIMIT);
  try {
    globalThis.__OH_UI_STALLS__ = stalls;
  } catch {
    // No globalThis (tests, workers): the ring is enough.
  }
};

// Idempotent; called once from the app entry. A browser without the Long Tasks
// API (Firefox, Safari, an old WebView) just gets nothing.
export const installUiStallObserver = () => {
  if (installed || typeof PerformanceObserver === "undefined") return;
  installed = true;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) record(entry);
    });
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    // "longtask" unsupported: leave observation off rather than throw at boot.
    observer = null;
  }
};

// Marks a UI action so a stall in the next few seconds can be named in the log
// ("during country pick"). Cheap enough to call from a click handler.
export const markUiInteraction = (label) => {
  const value = String(label ?? "").trim();
  if (!value) return;
  const at = Date.now();
  interactions.push({ at, label: value });
  if (interactions.length > 20) interactions.splice(0, interactions.length - 20);
};

export const getUiStalls = () => stalls.slice();

// What the Diagnostics Log prints, or null when nothing stalled.
export const summarizeUiStalls = () => {
  if (!stalls.length) return null;
  let worst = stalls[0];
  let total = 0;
  for (const stall of stalls) {
    total += stall.ms;
    if (stall.ms > worst.ms) worst = stall;
  }
  return {
    count: stalls.length,
    totalMs: total,
    worstMs: worst.ms,
    worstPhase: worst.phase,
    recent: stalls.slice(-8),
  };
};

export const __resetUiStallsForTests = () => {
  stalls.length = 0;
  interactions.length = 0;
};
