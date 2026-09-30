/*! Open Historia — when the map's labels must rebuild © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/translator.test.js
//
// The map bakes translated names into its label features, so a translation that
// lands after a label was drawn makes that label stale. The rule that keeps the
// rebuild from firing on EVERY content batch: only a batch that translated a
// name the map actually asked for (translateLabel) may announce it. These pin
// that rule, the drawn-name registration it depends on, and that fingerprinting
// a name does not itself count as drawing it.

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  LABEL_STRINGS_LIMIT,
  __resetTranslatorForTests,
  commitTranslationBatch,
  peekLabelTranslation,
  translateLabel,
} from "./translator.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// translator.js announces through window, which Node does not have. Record the
// event names instead, exactly as the map's listener would receive them.
let dispatched = [];
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: (event) => {
    dispatched.push(event.type);
    return true;
  },
};

afterEach(() => {
  __resetTranslatorForTests();
});

test("a translated name the map drew makes the label builders rebuild", async () => {
  dispatched = [];
  translateLabel("Egypt");
  assert.equal(commitTranslationBatch(["Egypt"], ["مصر"]), true);
  await delay(900);
  assert.deepEqual(dispatched, ["i18n:labels-updated"]);
});

test("a batch that translates no drawn name leaves the labels alone", async () => {
  dispatched = [];
  translateLabel("Egypt");
  // An empty answer changes nothing, and content that was never drawn is not a
  // label, so neither may announce a rebuild.
  assert.equal(commitTranslationBatch(["Egypt"], [""]), false);
  assert.equal(commitTranslationBatch(["Save game"], ["حفظ"]), false);
  await delay(900);
  assert.deepEqual(dispatched, []);
});

test("peeking a translation does not register the name as drawn", () => {
  assert.equal(peekLabelTranslation("Egypt"), "Egypt");
  // If peek had registered it, this batch would announce a rebuild.
  assert.equal(commitTranslationBatch(["Egypt"], ["مصر"]), false);
});

test("the drawn-name set is capped, and drops the oldest name", () => {
  for (let index = 0; index <= LABEL_STRINGS_LIMIT; index += 1) {
    translateLabel(`drawn-${index}`);
  }
  // One name past the cap pushed the first one out; the newest is still tracked.
  assert.equal(commitTranslationBatch(["drawn-0"], ["x"]), false);
  assert.equal(commitTranslationBatch([`drawn-${LABEL_STRINGS_LIMIT}`], ["x"]), true);
});
