// Open Historia — how long a start took, in numbers a bug report can carry.
//
// Observational only: nothing in the game reads any of this back. It answers the
// one question the turn profiler cannot — how long the page needed to reach the
// moment the HUD is ready to draw — and files it beside the device's own class,
// so "it starts slowly" on a phone is a measurement rather than an impression.
//
// The last start's summary lives on window.__OH_LAST_STARTUP_PERF__ and is shown
// in Settings > Advanced > Diagnostics, next to the log the player is about to
// paste into a report.
import { deviceTier, isConstrainedDevice } from "./deviceProfile.js";

const perfNow = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const round1 = (value) => Math.round(Number(value) * 10) / 10;
const millis = (value) => (Number.isFinite(Number(value)) ? round1(value) : null);

// Boot is measured from performance.now()'s own origin, which is the start of the
// navigation: everything the page parsed and fetched is inside bootMs, which is
// what a player means by "how long it takes to start".
let hudReadyMs = null;

// Called with the promise the HUD's own dynamic import returns (App.jsx). The
// module promise is shared with React.lazy, so this is the moment the shell chunk
// is in hand and can be parsed — the mark that says whether the split worked.
export const noteHudReady = () => {
  if (hudReadyMs === null) hudReadyMs = round1(perfNow());
};

const seconds = (value) =>
  value === null || value === undefined
    ? "n/a"
    : value >= 1000
    ? `${(value / 1000).toFixed(2)}s`
    : `${Math.round(value)}ms`;

export const formatStartupPerf = (summary) => {
  if (!summary) return "";
  return [
    `[OH STARTUP PERF] ready in ${seconds(summary.bootMs)} (${summary.deviceTier} device${summary.constrained ? ", constrained" : ""})`,
    `HUD shell in hand ${seconds(summary.hudReadyMs)} · preload loop ${seconds(summary.preloadMs)} · budget ${seconds(summary.timeBudgetMs)}`,
    "Full object: window.__OH_LAST_STARTUP_PERF__",
  ].join("\n");
};

export const recordStartupPerf = ({ preloadMs = null, timeBudgetMs = null } = {}) => {
  if (typeof window === "undefined") return null;
  const summary = {
    bootMs: round1(perfNow()),
    hudReadyMs,
    preloadMs: millis(preloadMs),
    timeBudgetMs: millis(timeBudgetMs),
    deviceTier: deviceTier(),
    constrained: isConstrainedDevice(),
    at: new Date().toISOString(),
  };
  window.__OH_LAST_STARTUP_PERF__ = summary;
  console.info(formatStartupPerf(summary));
  return summary;
};

export const lastStartupPerf = () =>
  (typeof window !== "undefined" && window.__OH_LAST_STARTUP_PERF__) || null;

// The one-liner Settings shows, beside the log: the same numbers as the console
// line above, said the way a player reads a stopwatch.
export const describeStartupPerf = (summary) => {
  if (!summary) return "";
  const parts = [`Started up in ${seconds(summary.bootMs)}`];
  if (summary.hudReadyMs !== null) parts.push(`HUD shell at ${seconds(summary.hudReadyMs)}`);
  parts.push(`${summary.deviceTier} device`);
  if (summary.constrained) parts.push("constrained profile");
  return parts.join(" · ");
};
