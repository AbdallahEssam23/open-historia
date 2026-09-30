// Open Historia — how much optional per-frame work this device has earned.
//
// The map already measures itself: World.jsx samples a frame delta on every
// animation frame while the camera is moving, for __OH_LAST_MAP_PERF__. This
// module turns those same numbers into a quality level so the expensive
// optional work can step aside when frames are actually being missed, instead
// of being set once from a static guess about the device.
//
// Levels: 0 full, 1 reduced, 2 minimal. The controller only steps on a window
// of frames and only after a cooldown, so a single bad frame cannot flip it, and
// it empties the window after every change so a device that recovers is not held
// down by the samples that caused the downgrade.

export const QUALITY_FULL = 0;
export const QUALITY_REDUCED = 1;
export const QUALITY_MINIMAL = 2;
export const MAX_QUALITY_LEVEL = QUALITY_MINIMAL;

// ~42 fps: missing frames. ~58 fps: comfortable again. The gap between them is
// the hysteresis that stops the level oscillating at the threshold.
export const DEFAULT_QUALITY_TUNING = Object.freeze({
  windowSize: 30,
  evaluateEvery: 20,
  minSamples: 20,
  downgradeFrameMs: 24,
  upgradeFrameMs: 17,
});

const clampLevel = (value) => {
  const level = Math.round(Number(value));
  if (!Number.isFinite(level) || level < QUALITY_FULL) return QUALITY_FULL;
  return Math.min(MAX_QUALITY_LEVEL, level);
};

const p90Of = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.9))];
};

export const createQualityController = ({ tuning = {}, level = QUALITY_FULL } = {}) => {
  const config = { ...DEFAULT_QUALITY_TUNING, ...tuning };
  const samples = [];
  let current = clampLevel(level);
  let sinceEvaluate = 0;

  const evaluate = () => {
    if (samples.length < config.minSamples || sinceEvaluate < config.evaluateEvery) return current;
    sinceEvaluate = 0;
    const p90 = p90Of(samples);
    let next = current;
    if (p90 > config.downgradeFrameMs) next = Math.min(MAX_QUALITY_LEVEL, current + 1);
    else if (p90 < config.upgradeFrameMs) next = Math.max(QUALITY_FULL, current - 1);
    if (next === current) return current;
    current = next;
    // The samples that justified the old level must not justify the new one.
    samples.length = 0;
    return current;
  };

  return {
    observe: (deltaMs) => {
      const delta = Number(deltaMs);
      if (!Number.isFinite(delta) || delta <= 0) return current;
      samples.push(delta);
      if (samples.length > config.windowSize) samples.shift();
      sinceEvaluate += 1;
      return evaluate();
    },
    getLevel: () => current,
    reset: () => {
      samples.length = 0;
      sinceEvaluate = 0;
    },
  };
};

let controller = createQualityController();
const listeners = new Set();

// Called by the map's motion sampler. Notifies subscribers only on a change.
export const reportFrameDelta = (deltaMs) => {
  const before = controller.getLevel();
  const after = controller.observe(deltaMs);
  if (after !== before) {
    for (const listener of listeners) {
      try {
        listener(after);
      } catch {
        // A subscriber must never break the frame loop.
      }
    }
  }
  return after;
};

export const currentQualityLevel = () => controller.getLevel();

export const subscribeQuality = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Start of a drag: forget the previous gesture's frames, keep the level so it
// can be re-earned (or given back) within the new one.
export const resetQualitySamples = () => controller.reset();

export const __resetAdaptiveQualityForTests = () => {
  controller = createQualityController();
  listeners.clear();
};
