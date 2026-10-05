// Run: node --test src/Game/GameUI/warHoldNoticeArchitecture.test.js
//
// gameplay.js imports main.jsx and cannot be imported by node --test, so its
// wiring is pinned by reading the source. This is the house pattern for the
// other wiring architecture guards.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const gameplay = read("../../Game/AI/gameplay.js");

test("the turn announces a held war once, before the peace offer is kept", () => {
  assert.match(gameplay, /import \{ buildWarHoldNotice, WAR_HELD_EVENT \} from "\.\.\/\.\.\/runtime\/warHoldNotice\.js"/);
  const call = "dispatchEvent(new CustomEvent(WAR_HELD_EVENT";
  assert.equal(gameplay.split(call).length - 1, 1, "the held-war notice is dispatched exactly once");
  const applyAt = gameplay.indexOf("const applySimulationResult =");
  const keepAt = gameplay.indexOf("const peaceOffer = keepHeldPeaceOffer");
  const callAt = gameplay.indexOf(call);
  assert.ok(applyAt > 0 && keepAt > applyAt, "the apply span is missing");
  assert.ok(callAt > applyAt && callAt < keepAt, "the notice must fire on the turn that withheld the record");
  assert.match(gameplay, /buildWarHoldNotice\(\{ warIds: heldWarIds \}\)/);
});

test("the shell mounts the held-war notice", () => {
  const shell = read("./main.jsx");
  assert.match(shell, /import \{ WarHoldNotice \} from "\.\/warHoldNotice\.jsx"/);
  assert.match(shell, /<WarHoldNotice \/>/);
});

test("the held-war notice listens for the event and dismisses itself", () => {
  const view = read("./warHoldNotice.jsx");
  assert.match(view, /import \{ WAR_HELD_EVENT \} from "\.\.\/\.\.\/runtime\/warHoldNotice\.js"/);
  assert.match(view, /addEventListener\(WAR_HELD_EVENT/);
  assert.match(view, /removeEventListener\(WAR_HELD_EVENT/);
  assert.match(view, /event\.detail\?\.message/);
  assert.match(view, /const SHOW_MS = \d+/);
  assert.match(view, /setTimeout\(/);
});
