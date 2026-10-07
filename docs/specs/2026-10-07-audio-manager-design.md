# Audio Manager: One Web Audio Host, One Cue Catalog

> Status: design for review before implementation. Wave 1, item 2 of
> `docs/specs/2026-10-07-grand-strategy-roadmap-design.md`.

## Problem

The game has no audio layer. The only sound anywhere is a two-note diplomatic
notification buried in `src/Game/GameUI/chat.jsx`: its own module-level
`AudioContext`, its own storage key (`oh:chat-notification-sound-v1`), and its
own on/off switch inside the chat panel. Nothing else can play a sound, that
context cannot be muted globally, it has no volume, there is no UI or paper
click, no cue when a war opens on the map, and no music.

Adding a second sound means copying that whole block, which is how an app ends up
with several `AudioContext`s, several mute flags that disagree, and no single
place a player can silence the game.

## Goal

One runtime host owns the audio device, and one pure engine catalog owns what a
cue sounds like. The host exposes `playCue(name)`, a global mute and a master
volume that live in Settings, a state-driven music bed, and a `warmUp()` the UI
can call from a first user gesture to satisfy the browser autoplay policy. The
chat notification becomes one cue through that host instead of its own context.

No new dependency. The cues are synthesised with `OscillatorNode` and
`GainNode`, exactly the technique the chat notification already proves works.

## Non-goals

- No Howler, Tone.js or any audio dependency.
- No recorded audio assets in this increment, so the bundle does not grow. A
  later increment may add looping asset beds behind the same interface; the
  synthesised bed is the baseline, not a placeholder that blocks it.
- No spatial or 3D audio, no positional panning.
- Audio never touches the simulation. The manager reads game state and Settings;
  it never writes world state, and no engine decision depends on it. The tick
  stays exactly as deterministic as it is today.
- No change to mobile autoplay beyond the same `warmUp()` gesture path.

## Architecture

### Pure core: `src/engine/audioCues.js`

Import-free and pure, like every other engine module, so it falls under
`src/engine/enginePurity.test.js`: no clock, no entropy, no browser global. It
knows cue names and note shapes, nothing about `AudioContext` or the DOM.

```
volumeGain(level) -> number            // 0..1 level -> 0..1 gain, clamped

CUES = {
  click,           // UI and paper: one short, dry tick
  notification,    // the diplomatic two-note chime chat.jsx already plays
  war,             // war stamp: a low, blunt thud with a second strike
  turn,            // turn resolved: a soft resolving cadence
}

resolveCue(name) -> [{ type, frequency, startOffset, duration, peak }] | null
```

A cue is a list of voices, each a plain object: oscillator `type`, a `frequency`
in hertz, a `startOffset` and `duration` in seconds relative to the cue start,
and a `peak` gain. Identical name returns an identical list, so a snapshot test
pins the sound and a future change to it is a reviewable diff, not a mystery.
An unknown name resolves to `null`, and callers treat that as nothing to play.

### Runtime host: `src/runtime/audioManager.js`

Binds the catalog to a single `AudioContext`. Browser-only, but guarded so
`node --test` can import it without a DOM: with no `window` or no
`AudioContext`/`webkitAudioContext`, every method no-ops and `playCue` returns
`false`. It takes its environment by injection (an audio factory and a storage
handle, defaulting to the browser ones), the same way `unseenEvents.js` takes its
storage, so the tests drive a fake context headless.

```
createAudioManager({ audioContextFactory, storage, setTimer } = {}) -> {
  playCue(name) -> boolean,     // false when muted, unsupported or unknown
  warmUp(),                     // create/resume the context on a user gesture
  setMusicState(state),         // "idle" | "tension" | "war", crossfaded
  setMuted(boolean),
  setVolume(level),             // 0..1
  isMuted() -> boolean,
  volume() -> number,
  dispose(),                    // close the context, drop listeners (tests)
}
```

One `AudioContext` is created lazily on first `warmUp()` or `playCue`, never at
import time, so a headless import and the server tests never build one. A single
master `GainNode` sits between every voice and the destination; mute drives that
gain to zero and volume sets its level, so there is one place sound is silenced.
The manager subscribes to `mapSettings:updated` and re-reads mute and volume, so
the Settings panel and the host can never disagree.

### Settings

Three keys join `MAP_SETTING_KEYS` in `src/runtime/mapSettings.js`, reusing the
existing local-settings mechanism (the same one the AI toggles already use, so
the module's map-flavoured name is not a new coupling):

- `audioMuted` - boolean, absent reads as not muted. A player can always silence
  the game.
- `audioVolume` - value setting `"0"`..`"1"`, absent reads as `"0.7"`.
- `audioMusic` - boolean, absent reads as off. The music bed is opt-in; cues
  ship on, music does not.

The Settings panel gains an Audio section in the existing `Game` group: the mute
toggle, a volume slider, a music toggle, and a Test button that plays the
`notification` cue so the level is set by ear. The section only calls
`setMapSetting` / `setMapSettingValue`; the host reacts through the existing
`mapSettings:updated` event.

### Event wiring

The host maps a small, explicit set of app signals to cues, plus the manual
`playCue` call sites:

- `oh:turn-complete` -> `turn` cue.
- `oh:gm-transaction-applied` -> a coarse refresh of the music state (a war that
  opened or closed this transaction can change the bed).
- `oh:war-held` -> the `war` cue is not driven from here; a held war is a notice,
  not a declaration. The declaration cue is fired where the map reveals a
  war-start event, keeping the cue beside the moment the player sees it.
- UI clicks: one shared handler (`playCue("click")`) on the primary button and
  paper surfaces, not a listener on every element.

The music bed is `setMusicState(state)` with three states, driven by the world's
war state already on hand: `idle` in peace, `tension` when a war the player is in
is unresolved or a ceasefire is pending, `war` while the player is a belligerent.
Transitions are gain ramps on a small set of oscillators, so there is no asset and
no decoder. The exact progression is part of the pure catalog so it is testable.
The bed only sounds when `audioMusic` is on; `setMusicState` still records the
state when it is off, so turning music on mid-game starts the bed at the current
state rather than at `idle`.

## Data flow

```
game events (oh:*) --+
Settings panel ------+--> audioManager --> master gain --> AudioContext --> device
manual playCue ------+          |
                                +-- reads mute/volume from mapSettings
```

Audio is a leaf: it consumes events and settings and produces sound, and nothing
reads back from it.

## Migration

`chat.jsx` keeps its per-thread sound toggle, but its switch now calls the host
instead of owning a context: the two-note `playDiplomaticNotificationSound`
body is deleted and replaced with `playCue("notification")`, and
`ensureNotificationAudioContext` / `notificationAudioContext` go away. The old
`oh:chat-notification-sound-v1` key is left as the chat panel's own gate - it
still decides whether that cue plays - and is deliberately not seeded into the
global `audioMuted`. A chat-specific preference should not silence the new UI and
paper clicks the player never turned off; the global mute is the one switch for
"silence everything", and it starts off.

## Testing

- `src/engine/audioCues.test.js`: every listed cue resolves to a non-empty voice
  list; an unknown name is `null`; the same name is byte-identical twice;
  `volumeGain` clamps below 0, above 1 and handles the non-finite case. The
  existing purity test covers the new engine file automatically.
- `src/runtime/audioManager.test.js`: with an injected fake context, a cue
  creates nodes and starts them; mute makes `playCue` return `false` and leaves
  the master gain at zero; `setVolume` sets the master gain; an unknown cue is a
  no-op; with no factory available every method no-ops and `playCue` is `false`;
  a `mapSettings:updated` for the mute or volume key is re-read; `dispose` closes
  the context and is idempotent.
- `chat.jsx`'s notification tests, if any, are updated to assert the host is
  called rather than a local context built.

No existing test is edited to make a change pass; a test that pins old behavior
and now fails is a signal the behavior change needs its own decision.

## Files

- New: `src/engine/audioCues.js`, `src/engine/audioCues.test.js`.
- New: `src/runtime/audioManager.js`, `src/runtime/audioManager.test.js`.
- Edit: `src/runtime/mapSettings.js` (three keys and their labels).
- Edit: `src/Game/GameUI/settings.jsx` (Audio section).
- Edit: `src/Game/GameUI/chat.jsx` (use the host; delete the local context and
  the old key's writer).
- Edit: the one bootstrap that calls `warmUp()` on the first user gesture.

## Decisions

1. Cues ship on, the music bed ships off behind its own `audioMusic` toggle. The
   mute switch silences everything including a bed the player turned on.
2. The bed is synthesised with oscillators. No audio asset is added in this
   increment; an asset bed can later sit behind the same `setMusicState`
   interface without changing a caller.

## TODO

- [ ] Implement `audioCues.js` + tests, then `audioManager.js` + tests (TDD).
- [ ] Wire the Settings Audio section and the `chat.jsx` migration.
