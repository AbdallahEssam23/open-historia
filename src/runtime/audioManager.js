/*! Open Historia - the Web Audio host (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/audioManager.test.js
//
// One AudioContext, one master gain, one place sound is silenced. The cue and
// music shapes live in the pure engine catalog (src/engine/audioCues.js); this
// module only turns them into oscillator graphs and follows the player's settings.
//
// Browser-only, but guarded and injectable: with no window or no AudioContext the
// whole manager no-ops, and the tests drive it with a fake context and a fake
// settings port, so nothing here needs a DOM or a device to be verified.
import { MUSIC_STATES, resolveCue, resolveMusic, volumeGain } from "../engine/audioCues.js";
import { deriveMusicState } from "../engine/warMood.js";
import { MAP_SETTING_KEYS, getMapSetting, getMapSettingValue, setMapSetting, setMapSettingValue } from "./mapSettings.js";
import { getRuntimeValue } from "./runtimeStore.js";

// The commands a cue's oscillator graph is built from. A tiny helper keeps the
// three ramp calls that shape every voice out of the loop below.
const startVoice = (ctx, destination, spec, at, peakScale) => {
  const start = at + spec.startOffset;
  const stop = start + spec.duration;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = spec.type;
  osc.frequency.setValueAtTime(spec.frequency, start);
  const peak = Math.max(0.0001, spec.peak * peakScale);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, stop);
  osc.connect(gain);
  gain.connect(destination);
  osc.start(start);
  osc.stop(stop + 0.01);
};

const clampLevel = (level) => {
  const numeric = Number(level);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(1, Math.max(0, numeric));
};

const browserAudioContextFactory = () => {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
};

const defaultSettings = {
  isMuted: () => getMapSetting(MAP_SETTING_KEYS.audioMuted),
  volume: () => getMapSettingValue(MAP_SETTING_KEYS.audioVolume, "0.7"),
  isMusicEnabled: () => getMapSetting(MAP_SETTING_KEYS.audioMusic),
  setMuted: (value) => setMapSetting(MAP_SETTING_KEYS.audioMuted, value),
  setVolume: (level) => setMapSettingValue(MAP_SETTING_KEYS.audioVolume, String(clampLevel(level))),
  setMusicEnabled: (value) => setMapSetting(MAP_SETTING_KEYS.audioMusic, value),
};

const defaultSubscribe = (onChange) => {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {};
  window.addEventListener("mapSettings:updated", onChange);
  return () => window.removeEventListener("mapSettings:updated", onChange);
};

export const createAudioManager = ({
  audioContextFactory = browserAudioContextFactory,
  settings = defaultSettings,
  subscribe = defaultSubscribe,
} = {}) => {
  let ctx = null;
  let master = null;
  let bedGain = null;
  let bedVoices = [];
  let musicState = "idle";
  let disposed = false;

  const isMuted = () => settings.isMuted() === true;
  const musicEnabled = () => settings.isMusicEnabled() === true;
  const volume = () => volumeGain(settings.volume());

  const ensureContext = () => {
    if (disposed) return null;
    if (ctx && ctx.state !== "closed") return ctx;
    ctx = audioContextFactory() || null;
    if (!ctx) return null;
    master = ctx.createGain();
    master.gain.value = isMuted() ? 0 : volume();
    master.connect(ctx.destination);
    return ctx;
  };

  const resume = () => {
    if (ctx && ctx.state === "suspended" && typeof ctx.resume === "function") {
      try {
        const pending = ctx.resume();
        if (pending && typeof pending.catch === "function") pending.catch(() => {});
      } catch {
        // A context that refuses to resume is the browser's autoplay policy; the
        // next gesture calls warmUp again.
      }
    }
  };

  const applyMaster = () => {
    if (!master) return;
    master.gain.value = isMuted() ? 0 : volume();
  };

  const applyMusic = () => {
    if (!master) return;
    const active = musicEnabled() && !isMuted() ? musicState : null;
    if (!active) {
      if (bedGain) bedGain.gain.value = 0;
      return;
    }
    const specs = resolveMusic(musicState) || resolveMusic("idle");
    if (bedVoices.length !== specs.length) {
      for (const voice of bedVoices) {
        try {
          voice.osc.stop();
          voice.osc.disconnect();
        } catch {
          // Already stopped; nothing to undo.
        }
      }
      if (!bedGain) {
        bedGain = ctx.createGain();
        bedGain.connect(master);
      }
      bedVoices = specs.map(() => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(bedGain);
        osc.start();
        return { osc, gain };
      });
    }
    bedGain.gain.value = 1;
    specs.forEach((spec, index) => {
      const voice = bedVoices[index];
      voice.osc.type = spec.type;
      voice.osc.frequency.value = spec.frequency;
      voice.gain.gain.value = spec.peak;
    });
  };

  const unsubscribe = subscribe(() => {
    applyMaster();
    applyMusic();
  });

  const warmUp = () => {
    const context = ensureContext();
    if (!context) return null;
    resume();
    applyMaster();
    applyMusic();
    return context;
  };

  const playCue = (name) => {
    if (disposed || isMuted()) return false;
    const specs = resolveCue(name);
    if (!specs) return false;
    const context = ensureContext();
    if (!context) return false;
    if (context.state !== "running") {
      resume();
      if (context.state !== "running") return false;
    }
    const at = context.currentTime;
    for (const spec of specs) startVoice(context, master, spec, at, 1);
    return true;
  };

  const setMusicState = (state) => {
    if (!MUSIC_STATES.includes(state)) return;
    musicState = state;
    applyMusic();
  };

  const setMuted = (value) => {
    settings.setMuted(value === true);
    applyMaster();
    applyMusic();
  };

  const setVolume = (level) => {
    settings.setVolume(clampLevel(level));
    applyMaster();
  };

  const setMusicEnabled = (value) => {
    settings.setMusicEnabled(value === true);
    applyMusic();
  };

  const diagnostics = () => ({
    contextState: ctx && ctx.state !== "closed" ? ctx.state : "none",
    muted: isMuted(),
    volume: settings.volume(),
    musicState,
    masterGain: master ? master.gain.value : null,
    musicGain: bedGain ? bedGain.gain.value : null,
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (typeof unsubscribe === "function") unsubscribe();
    for (const voice of bedVoices) {
      try {
        voice.osc.stop();
      } catch {
        // Already stopped.
      }
    }
    bedVoices = [];
    bedGain = null;
    master = null;
    if (ctx && typeof ctx.close === "function") {
      try {
        const pending = ctx.close();
        if (pending && typeof pending.catch === "function") pending.catch(() => {});
      } catch {
        // A context that refuses to close is already gone.
      }
    }
    ctx = null;
  };

  return {
    playCue,
    warmUp,
    setMusicState,
    setMuted,
    setVolume,
    setMusicEnabled,
    diagnostics,
    dispose,
  };
};

// The app shares one manager. Built lazily so importing this module (the server,
// a test) never constructs an AudioContext.
let shared = null;

// Which bed the world is in, from the normalized runtime documents. The ledger's
// status and the game's country are the same facts the war rules already read.
const defaultMood = () => {
  const game = getRuntimeValue("game") || null;
  const world = getRuntimeValue("world") || null;
  return deriveMusicState({ wars: world?.wars, playerName: game?.country });
};

// Map the coarse app signals to cues and keep the bed in step. Kept out of
// createAudioManager so the host stays a plain, testable device wrapper.
export const installAudioEvents = (
  manager,
  {
    target = typeof window !== "undefined" ? window : null,
    doc = typeof document !== "undefined" ? document : null,
    mood = defaultMood,
  } = {},
) => {
  if (!target || typeof target.addEventListener !== "function") return () => {};
  const applyMood = () => {
    try {
      manager.setMusicState(mood());
    } catch {
      // A mood that cannot be read leaves the bed where it was.
    }
  };
  const onTurn = () => {
    manager.playCue("turn");
    applyMood();
  };
  const onClick = (event) => {
    const el = event?.target;
    if (el && typeof el.closest === "function" && el.closest('button,[role="button"],.oh-tap-row')) {
      manager.playCue("click");
    }
  };
  target.addEventListener("oh:turn-complete", onTurn);
  target.addEventListener("oh:runtime-json-updated", applyMood);
  target.addEventListener("oh:active-game-changed", applyMood);
  if (doc && typeof doc.addEventListener === "function") doc.addEventListener("pointerdown", onClick, true);
  applyMood();
  return () => {
    target.removeEventListener("oh:turn-complete", onTurn);
    target.removeEventListener("oh:runtime-json-updated", applyMood);
    target.removeEventListener("oh:active-game-changed", applyMood);
    if (doc && typeof doc.removeEventListener === "function") doc.removeEventListener("pointerdown", onClick, true);
  };
};

export const audioManager = () => {
  if (!shared) {
    shared = createAudioManager();
    installAudioEvents(shared);
  }
  return shared;
};
export const playCue = (name) => audioManager().playCue(name);
export const warmUpAudio = () => audioManager().warmUp();
