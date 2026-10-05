// Run: node --test src/runtime/warHoldNotice.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { WAR_HELD_EVENT, buildWarHoldNotice } from "./warHoldNotice.js";

test("no ids is no notice", () => {
  assert.equal(buildWarHoldNotice(), "");
  assert.equal(buildWarHoldNotice({}), "");
  assert.equal(buildWarHoldNotice({ warIds: [] }), "");
  assert.equal(buildWarHoldNotice({ warIds: ["  ", "", null] }), "");
  assert.equal(buildWarHoldNotice({ warIds: "not-an-array" }), "");
});

test("one held war reads in the singular", () => {
  const notice = buildWarHoldNotice({ warIds: ["war-france-1914"] });
  assert.match(notice, /^The war war-france-1914 stays open:/);
  assert.match(notice, /until you decide the pending peace offer\.$/);
});

test("several held wars read in the plural and keep their order", () => {
  const notice = buildWarHoldNotice({ warIds: ["war-a", " war-b ", ""] });
  assert.match(notice, /^The wars war-a, war-b stay open:/);
  assert.match(notice, /pending peace offers\.$/);
});

test("the event name is the exact contract string", () => {
  assert.equal(WAR_HELD_EVENT, "oh:war-held");
  const notice = buildWarHoldNotice({ warIds: ["war-a"] });
  assert.equal(/[^\x00-\x7F]/.test(notice), false, "the notice is ASCII only");
});
