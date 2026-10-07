/*! Open Historia - pure audio cue catalog (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/engine/audioCues.test.js
//
// What a cue sounds like, as plain data. The runtime host (src/runtime/
// audioManager.js) turns a voice list into OscillatorNode/GainNode graphs; this
// module only says which notes, how loud and when. It is import-free and pure so
// it lives under the engine purity rules: no clock, no entropy, no browser.
//
// A voice is { type, frequency, startOffset, duration, peak }, all seconds
// relative to the cue's start except frequency in hertz and peak in 0..1. The
// runtime scales peak by the master volume, so a cue's shape is independent of
// the player's level.

const voice = (type, frequency, startOffset, duration, peak) =>
  Object.freeze({ type, frequency, startOffset, duration, peak });

// Small, deterministic synth patches. Frequencies are plain notes, not samples:
// notification is the two-note chime the chat panel already played, click is a
// single dry tick, war is a low double thud and turn a soft rising cadence.
const CUES = Object.freeze({
  click: Object.freeze([voice("square", 1180, 0, 0.03, 0.18)]),
  notification: Object.freeze([
    voice("sine", 740, 0, 0.115, 0.7),
    voice("sine", 988, 0.082, 0.145, 0.7),
  ]),
  war: Object.freeze([
    voice("sine", 92, 0, 0.22, 0.9),
    voice("triangle", 138, 0.18, 0.26, 0.6),
  ]),
  turn: Object.freeze([
    voice("sine", 523.25, 0, 0.18, 0.5),
    voice("sine", 659.25, 0.1, 0.18, 0.5),
    voice("sine", 783.99, 0.2, 0.3, 0.55),
  ]),
});

export const CUE_NAMES = Object.freeze(Object.keys(CUES));

// An unknown name is null, never an empty list: the caller plays nothing, the
// same as a missing sound effect, rather than building an empty node graph.
export const resolveCue = (name) =>
  Object.prototype.hasOwnProperty.call(CUES, name) ? CUES[name] : null;

// The music bed is three states of one sustained chord, not a cue: the runtime
// keeps the oscillators running and retunes them, so every state carries the
// same number of voices (a pinned test keeps it that way). A state's peak is the
// voice's share of the bed; the bed's own gain and the master volume sit above it.
const bedVoice = (type, frequency, peak) => Object.freeze({ type, frequency, peak });

const MUSIC = Object.freeze({
  idle: Object.freeze([
    bedVoice("sine", 110, 0.1),
    bedVoice("sine", 164.81, 0.07),
    bedVoice("triangle", 220, 0.05),
  ]),
  tension: Object.freeze([
    bedVoice("sine", 110, 0.11),
    bedVoice("sine", 155.56, 0.09),
    bedVoice("triangle", 207.65, 0.05),
  ]),
  war: Object.freeze([
    bedVoice("sine", 82.41, 0.13),
    bedVoice("sine", 123.47, 0.1),
    bedVoice("triangle", 164.81, 0.06),
  ]),
});

export const MUSIC_STATES = Object.freeze(Object.keys(MUSIC));

export const resolveMusic = (state) =>
  Object.prototype.hasOwnProperty.call(MUSIC, state) ? MUSIC[state] : null;

// The slider's 0..1 level to a gain, clamped, with a square curve so the middle
// of the slider is actually a middle loudness rather than near-full volume. A
// non-finite or non-numeric level silences rather than throwing.
export const volumeGain = (level) => {
  const numeric = Number(level);
  if (!Number.isFinite(numeric)) return 0;
  const clamped = Math.min(1, Math.max(0, numeric));
  return clamped * clamped;
};
