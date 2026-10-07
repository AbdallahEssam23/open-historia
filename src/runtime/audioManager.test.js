// Run: node --test src/runtime/audioManager.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { createAudioManager, installAudioEvents } from "./audioManager.js";

// A minimal stand-in for AudioContext. It records the nodes it is asked to build
// and the parameter writes it receives, which is everything the manager promises
// a player: nodes get created, started and retuned, and the master gain follows
// mute and volume.
const makeFakeContext = () => {
  const created = { gains: [], oscillators: [] };
  const param = () => ({
    value: 0,
    setValueAtTime(value) { this.value = value; },
    linearRampToValueAtTime(value) { this.value = value; },
    exponentialRampToValueAtTime(value) { this.value = value; },
    setTargetAtTime(value) { this.value = value; },
  });
  const ctx = {
    state: "running",
    currentTime: 0,
    destination: { name: "destination" },
    createGain() {
      const node = {
        gain: param(),
        connect(target) { this.target = target; return target; },
        disconnect() { this.disconnected = true; },
      };
      created.gains.push(node);
      return node;
    },
    createOscillator() {
      const node = {
        type: "sine",
        frequency: param(),
        connect(target) { this.target = target; return target; },
        start(at) { this.started = at; },
        stop(at) { this.stopped = at; },
      };
      created.oscillators.push(node);
      return node;
    },
    resume() { this.resumed = true; this.state = "running"; return Promise.resolve(); },
    close() { this.closed = true; this.state = "closed"; return Promise.resolve(); },
  };
  return { ctx, created };
};

const makeSettings = (overrides = {}) => ({
  isMuted: () => false,
  volume: () => 0.7,
  isMusicEnabled: () => false,
  ...overrides,
});

const makeManager = (overrides = {}) => {
  const { ctx, created } = makeFakeContext();
  const settings = makeSettings(overrides.settings);
  let handler = null;
  const manager = createAudioManager({
    audioContextFactory: overrides.audioContextFactory || (() => ctx),
    settings,
    subscribe: overrides.subscribe || ((onChange) => { handler = onChange; return () => { handler = null; }; }),
  });
  return { manager, ctx, created, settings, fireChange: () => handler && handler() };
};

test("playing a cue builds and starts one voice's worth of nodes", () => {
  const { manager, created } = makeManager();
  assert.equal(manager.playCue("notification"), true);
  assert.ok(created.oscillators.length >= 1, "an oscillator was created");
  assert.ok(created.oscillators.every((osc) => typeof osc.started === "number"), "every oscillator started");
  assert.equal(created.gains.length >= 1, true);
});

test("an unknown cue is a no-op", () => {
  const { manager, created } = makeManager();
  assert.equal(manager.playCue("nonsense"), false);
  assert.equal(created.oscillators.length, 0);
});

test("muting silences cues and pins the master gain to zero", () => {
  const { manager, created } = makeManager({ settings: { isMuted: () => true } });
  manager.warmUp();
  assert.equal(manager.playCue("war"), false);
  assert.equal(created.oscillators.length, 0);
  assert.equal(manager.diagnostics().masterGain, 0);
});

test("an environment with no AudioContext no-ops instead of throwing", () => {
  const { manager } = makeManager({ audioContextFactory: () => null });
  assert.equal(manager.warmUp(), null);
  assert.equal(manager.playCue("click"), false);
  assert.equal(manager.diagnostics().contextState, "none");
});

test("volume and mute follow the settings store", () => {
  const { manager, fireChange, settings, created } = makeManager();
  manager.warmUp();
  assert.equal(manager.diagnostics().masterGain, 0.7 * 0.7, "0.7 squared");
  settings.isMuted = () => true;
  fireChange();
  assert.equal(created.gains[0].gain.value, 0, "the master gain drops to zero");
  settings.isMuted = () => false;
  settings.volume = () => 1;
  fireChange();
  assert.equal(created.gains[0].gain.value, 1, "unmuting restores the level");
});

test("setMuted and setVolume persist through the settings store", () => {
  const writes = [];
  const { manager } = makeManager({
    settings: {
      setMuted: (value) => writes.push(["muted", value]),
      setVolume: (value) => writes.push(["volume", value]),
    },
  });
  manager.setMuted(true);
  manager.setVolume(0.25);
  assert.deepEqual(writes, [["muted", true], ["volume", 0.25]]);
});

test("an enabled bed is built once and retuned as the state changes", () => {
  const { manager, created } = makeManager({ settings: { isMusicEnabled: () => true } });
  manager.warmUp();
  const afterWarmUp = created.oscillators.length;
  assert.ok(afterWarmUp > 0, "the bed is built at warm up when music is on");
  assert.equal(manager.diagnostics().musicState, "idle");
  manager.setMusicState("war");
  assert.equal(created.oscillators.length, afterWarmUp, "a state change retunes, it does not rebuild");
  assert.equal(manager.diagnostics().musicState, "war");
  assert.ok(created.oscillators.some((osc) => osc.frequency.value === 82.41), "a war frequency is applied");
});

test("music is off by default and a mute silences it", () => {
  const { manager, created, settings, fireChange } = makeManager();
  manager.warmUp();
  manager.setMusicState("war");
  assert.equal(created.oscillators.length, 0, "no bed while music is off");
  settings.isMusicEnabled = () => true;
  fireChange();
  assert.ok(created.oscillators.length > 0, "enabling music starts the remembered state");
  settings.isMuted = () => true;
  fireChange();
  assert.equal(manager.diagnostics().musicGain, 0);
});

test("dispose closes the context once and disables the manager", () => {
  const { manager, ctx } = makeManager();
  manager.warmUp();
  manager.dispose();
  manager.dispose();
  assert.equal(ctx.closed, true);
  assert.equal(manager.playCue("click"), false);
  assert.equal(manager.diagnostics().contextState, "none");
});

const makeEventTarget = () => {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    emit(type, event) {
      for (const handler of listeners.get(type) || []) handler(event);
    },
    count(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
};

test("a completed turn plays the turn cue and refreshes the bed", () => {
  const calls = [];
  const manager = { playCue: (name) => calls.push(["cue", name]), setMusicState: (state) => calls.push(["music", state]) };
  const target = makeEventTarget();
  installAudioEvents(manager, { target, doc: null, mood: () => "war" });
  target.emit("oh:turn-complete");
  assert.deepEqual(calls, [["music", "war"], ["cue", "turn"], ["music", "war"]]);
});

test("a click on a button plays the click cue and a click elsewhere does not", () => {
  const calls = [];
  const manager = { playCue: (name) => calls.push(name), setMusicState: () => {} };
  const target = makeEventTarget();
  const doc = makeEventTarget();
  installAudioEvents(manager, { target, doc, mood: () => "idle" });
  doc.emit("pointerdown", { target: { closest: (selector) => (selector.includes("button") ? {} : null) } });
  doc.emit("pointerdown", { target: { closest: () => null } });
  assert.deepEqual(calls, ["click"]);
});

test("the wiring removes every listener it added", () => {
  const manager = { playCue: () => {}, setMusicState: () => {} };
  const target = makeEventTarget();
  const doc = makeEventTarget();
  const off = installAudioEvents(manager, { target, doc, mood: () => "idle" });
  off();
  assert.equal(target.count("oh:turn-complete"), 0);
  assert.equal(target.count("oh:runtime-json-updated"), 0);
  assert.equal(doc.count("pointerdown"), 0);
});
