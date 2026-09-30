# Mobile performance: tiered device profile + adaptive motion quality

Date: 2026-09-30
Status: approved for implementation

## Problem

On Android the game is slow to start and the world map stutters while the
player drags or zooms it. Two independent causes were confirmed by reading the
source:

1. **Every Android device is treated as the weakest device.** `navigator.deviceMemory`
   is capped at 8 and a touch screen is assumed to be a phone, so
   `deviceProfile.js` classifies *any* native build and *any* touch-only screen as
   "constrained". `mapRuntimeLimits()` then hands MapLibre two workers and eight
   parallel requests. A flagship phone with 12 GB of RAM decodes tiles with the
   same tiny pool as a 2 GB budget phone, so tiles arrive late while panning and
   the map stutters.

2. **The per-frame cost never adapts to what the device can actually do.** The
   globe's day/night lighting repaint is a ~48,000-pixel main-thread canvas draw
   on every render frame (throttled to a fixed 30 fps on a "constrained" device,
   `GlobeEffects.jsx`). The value is chosen once from a static guess and never
   changes, even when the device is visibly dropping frames.

## Goals

- A capable phone gets a larger MapLibre pool than a weak one, without putting
  more memory in front of a device that cannot afford it.
- When the device is measurably missing frames during camera motion, the game
  spends less main-thread time on optional per-frame work; when frames recover,
  quality comes back.
- Startup does not wait on optional network prefetch.
- No change to the memory-safety decisions that keep weak devices and iOS Safari
  alive (`isConstrainedDevice()`, whole-archive warm, the regions parse hold).

## Non-goals

- Retuning desktop browsers; they keep the behaviour they have.
- Rewriting the map, the AI, or the geometry workers.
- Changing how map archives are hashed, cached, or range-read.

## Design

### 1. Device tiers (`src/runtime/deviceProfile.js`)

Add `deviceTier()` returning `"low" | "mid" | "high" | "full"`, derived once per
page load from the existing signals plus `navigator.hardwareConcurrency`:

- `low` — 4 GB or less, or the stored `constrained` override.
- `full` — not a native/touch device (a desktop), or the stored `full` override.
- `high` — a native/touch device reporting 8 GB (the spec ceiling, so "8" means
  "8 or more") and at least 8 cores.
- `mid` — every other native/touch device.

`isConstrainedDevice()` is deliberately **unchanged**. It still means "trade
speed for memory", and it still gates the whole-archive warm and the regions
parse hold. Tiers only feed `mapRuntimeLimits()`:

| tier | workers | parallel image requests |
| --- | --- | --- |
| low | 2 | 8 |
| mid | 3 | 12 |
| high | 4 | 16 |
| full (or no tier) | existing formula (2-6, 16-24) | |

Promotion is only ever granted on positive evidence (`memory >= 8`), so a phone
that does not report its memory keeps the profile it has today.

### 2. Adaptive motion quality (`src/runtime/adaptiveQuality.js`)

A small, pure, testable controller plus a process-wide singleton.

- Pure core: `createQualityController({ tuning, level })` with `observe(deltaMs)`,
  `getLevel()`, `reset()`. It keeps a window of recent frame deltas, evaluates a
  p90 every N frames, and steps the level between `0` (full) and `2` (minimal):
  up when p90 is worse than `downgradeFrameMs`, down when it is better than
  `upgradeFrameMs`, and it clears the window after any change so the decision
  cannot ping-pong on stale samples.
- Singleton: `reportFrameDelta(ms)`, `currentQualityLevel()`,
  `subscribeQuality(fn)`, `resetQualitySamples()`.

Wiring:

- `World.jsx` already samples a frame delta on every animation frame during a
  camera drag (for `__OH_LAST_MAP_PERF__`). It feeds those deltas to
  `reportFrameDelta()` and calls `resetQualitySamples()` on drag start. This is
  the measurement, reused rather than reinvented.
- `GlobeEffects.jsx` subscribes and raises its lighting repaint interval as the
  level rises: level 1 → at most 20 fps, level 2 → the idle rate (15 fps). On a
  desktop this is what stops the every-frame repaint once a machine proves it
  cannot keep up; on a phone it thins an already-throttled repaint further.

The subscription API is the extension point for future consumers (label
density, tile cache); nothing else consumes it yet.

### 3. Startup: remote texture warm is not gating (`src/runtime/preload.js`)

The `textures` task fetches ~90 ESRI/terrain tiles over the network and holds
the startup screen while it does. It is, by the module's own definition, a
*warm*: "a background task may make the map faster later, but the map has to
render correctly without it." Marking it `background: true` keeps its
`deps: ["state"]` ordering (so a custom-background scenario still fires zero
ESRI requests) but stops the splash from waiting on the network. The map loads
the tiles it needs for the visible viewport itself, as it does today.

## Testing

- `src/runtime/deviceProfile.test.js`: tier classification and the tier-aware
  limits, keeping every existing assertion.
- `src/runtime/adaptiveQuality.test.js` (new): pure controller behaviour
  (downgrade, upgrade, window reset, invalid input, clamps).
- Existing `networkStatus.test.js` and the rest of the suite must stay green.

## Risks

- **Cannot measure on a physical phone from this environment.** Mitigations: the
  changes are bounded and reversible; promotion needs positive evidence; the
  adaptive level starts at full and only moves on measured frames.
- **More workers on a phone costs memory.** Guarded by the 8 GB requirement;
  every device with 4 GB or less is pinned to the old profile.
