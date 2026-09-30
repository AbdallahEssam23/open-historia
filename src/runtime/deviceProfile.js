// Open Historia — should this device trade a little speed for memory?
//
// A phone's WebView gets a fraction of the memory a desktop tab does, and a few
// of the map's costs land all at once: the regions file parsed by two readers,
// a burst of tile workers, the globe's lighting redrawn on every frame of a
// drag. On a constrained device those are staggered or throttled (Nations.jsx,
// Map/mapLibreSetup.js, GlobeEffects.jsx); everywhere else they run flat out.
//
// Constrained is any of: the Android app; a touch-only screen (nothing can
// hover and the pointer is a finger: a phone or a tablet, in any browser); a
// browser that reports 4 GB of memory or less. navigator.deviceMemory is capped
// at 8 by the spec, so it can say "small" but never "big": a phone with 12 GB
// reports what a 64 GB desktop does, which is why it is not the only signal.
//
// localStorage "oh_device_profile" = "constrained" or "full" overrides the
// guess: for trying the phone path on a desktop, or giving a strong tablet the
// fast one. Decided once per page load, so every caller agrees.
import { isNativeBuild } from "./native/bridge.js";

export const DEVICE_PROFILE_OVERRIDE_KEY = "oh_device_profile";
const LOW_DEVICE_MEMORY_GB = 4;
// 8 is the ceiling navigator.deviceMemory ever reports (the spec rounds down to
// a power of two), so "8" reads as "8 GB or more" — the only value that can mean
// real headroom on a phone. Cores guard a big-memory, weak-CPU device.
const HIGH_DEVICE_MEMORY_GB = 8;
const HIGH_DEVICE_CORES = 8;

export const classifyDevice = ({ native = false, touchOnly = false, deviceMemoryGb = null, override = "" } = {}) => {
  if (override === "constrained") return true;
  if (override === "full") return false;
  if (native || touchOnly) return true;
  const memory = Number(deviceMemoryGb);
  return deviceMemoryGb != null && Number.isFinite(memory) && memory > 0 && memory <= LOW_DEVICE_MEMORY_GB;
};

// A finer reading than "constrained or not", for the things that can safely be
// scaled up. A flagship phone was classified constrained like a budget one, so
// it decoded tiles with two workers. `isConstrainedDevice` deliberately keeps
// its old meaning — it guards memory decisions, and those must not change — and
// only the map runtime limits read the tier.
//
//   low    — 4 GB or less, or the stored "constrained" override
//   full   — not a native/touch device, or the stored "full" override
//   high   — native/touch with 8 GB (the spec ceiling) and 8+ cores
//   mid    — every other native/touch device
//
// Promotion is only ever granted on positive evidence, so a phone that reports
// no memory (or reports 4, which is what a 6 GB phone reports) keeps the profile
// it already had.
export const DEVICE_TIERS = Object.freeze(["low", "mid", "high", "full"]);

export const classifyDeviceTier = ({
  native = false,
  touchOnly = false,
  deviceMemoryGb = null,
  hardwareThreads = 0,
  override = "",
} = {}) => {
  if (override === "constrained") return "low";
  if (override === "full") return "full";
  const memory = Number(deviceMemoryGb);
  const hasMemory = deviceMemoryGb != null && Number.isFinite(memory) && memory > 0;
  const cores = Number(hardwareThreads) > 0 ? Number(hardwareThreads) : 0;
  // Little memory is the one signal always believed, phone or desktop.
  if (hasMemory && memory <= LOW_DEVICE_MEMORY_GB) return "low";
  // A desktop takes the unrestricted path it always had: this profile exists to
  // stop treating a strong phone like a weak one, not to retune desktops.
  if (!native && !touchOnly) return "full";
  if (hasMemory && memory >= HIGH_DEVICE_MEMORY_GB && cores >= HIGH_DEVICE_CORES) return "high";
  return "mid";
};

const readSignals = () => {
  let override = "";
  try {
    override = String(globalThis.localStorage?.getItem(DEVICE_PROFILE_OVERRIDE_KEY) ?? "");
  } catch {
    // Storage blocked: no override.
  }
  let touchOnly = false;
  try {
    touchOnly = Boolean(globalThis.matchMedia?.("(hover: none) and (pointer: coarse)")?.matches);
  } catch {
    // No media queries (a worker, or a test): not a touch screen.
  }
  return {
    native: isNativeBuild(),
    touchOnly,
    deviceMemoryGb: globalThis.navigator?.deviceMemory ?? null,
    hardwareThreads: globalThis.navigator?.hardwareConcurrency ?? 0,
    override,
  };
};

let constrained = null;

export const isConstrainedDevice = () => {
  if (constrained === null) constrained = classifyDevice(readSignals());
  return constrained;
};

let tier = null;

export const deviceTier = () => {
  if (tier === null) tier = classifyDeviceTier(readSignals());
  return tier;
};

// MapLibre's worker pool and how many tiles and images it fetches and decodes at
// once (Map/mapLibreSetup.js). Elsewhere: half the cores (2 to 6 workers) and
// twice as many requests (16 to 24). A phone gets 2 and 8: every worker is a
// JavaScript heap of its own with its own copy of the style, and that many
// decodes landing together on entering the map is what tipped weak phones over.
// Every tile still loads, fewer at a time.
const FALLBACK_THREADS = 4;

const TIER_LIMITS = {
  low: { workerCount: 2, parallelImageRequests: 8 },
  mid: { workerCount: 3, parallelImageRequests: 12 },
  high: { workerCount: 4, parallelImageRequests: 16 },
};

export const mapRuntimeLimits = ({ hardwareThreads, constrained = false, tier = null } = {}) => {
  const resolved = tier ?? (constrained ? "low" : null);
  if (resolved && TIER_LIMITS[resolved]) return { ...TIER_LIMITS[resolved] };
  // No tier (the caller only knows constrained vs not): the original formula.
  const threads = Number(hardwareThreads) > 0 ? Number(hardwareThreads) : FALLBACK_THREADS;
  return {
    workerCount: Math.min(6, Math.max(2, Math.ceil(threads / 2))),
    parallelImageRequests: Math.min(24, Math.max(16, threads * 2)),
  };
};

// The map's two large archives, regions (~101 MB) and countries (~60 MB), are
// downloaded whole in the background at startup, hashed against the signed
// content manifest and kept in memory, so every later tile is a memory read
// (runtime/preload.js). A browser on a phone does not do that: the downloads
// land, and are hashed (a second copy each), just as the loading screen hands
// over to the map, which is when the tile workers and the regions parse peak
// too. That was the moment iOS Safari killed the tab ("A problem repeatedly
// occurred"). There the map reads the archives over HTTP range requests, a
// tile at a time, as it does anyway until a warm finishes; the opening screen
// needs one 40 KB tile of each. The Android app still loads them whole: its
// APK assets cannot be range-read (wholeFileSource.js), and it ships the
// trimmed z8 archives.
export const warmsWholeMapArchives = ({ native = isNativeBuild(), constrained = isConstrainedDevice() } = {}) =>
  native || !constrained;
