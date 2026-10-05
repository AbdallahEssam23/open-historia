// Run: node --test src/runtime/peaceOffer.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPeaceOfferDigest,
  choosePeaceOffer,
  keepHeldPeaceOffer,
  normalizePeaceOffer,
  PEACE_OFFER_HELD_OPS,
  peaceOfferHoldsWarUpdate,
} from "./peaceOffer.js";

const offer = (over = {}) => ({
  warId: "war-1",
  round: 4,
  side: "a",
  pressure: 0.6,
  victor: "a",
  loser: "b",
  capitulation: false,
  white: false,
  punitive: false,
  transfers: [],
  reparations: { fromCode: "B", toCode: "A", manpower: 0, materiel: 0 },
  belligerents: ["Prussia", "France"],
  ...over,
});

test("no offers is no offer", () => {
  assert.equal(choosePeaceOffer({ offers: [], round: 4 }), null);
  assert.equal(choosePeaceOffer({ offers: [{ pressure: 1 }], round: 4 }), null);
  assert.equal(choosePeaceOffer(), null);
});

test("the most pressing offer wins, ties by the lowest war id, order-independent", () => {
  const picked = choosePeaceOffer({
    offers: [offer({ warId: "war-b", pressure: 0.7 }), offer({ warId: "war-a", pressure: 0.9 })],
    round: 5,
  });
  assert.equal(picked.warId, "war-a");

  const tie = choosePeaceOffer({
    offers: [offer({ warId: "war-c", pressure: 0.5 }), offer({ warId: "war-b", pressure: 0.5 })],
    round: 5,
  });
  assert.equal(tie.warId, "war-b", "the lower war id breaks the tie");

  const reversed = choosePeaceOffer({
    offers: [offer({ warId: "war-b", pressure: 0.5 }), offer({ warId: "war-c", pressure: 0.5 })],
    round: 5,
  });
  assert.equal(reversed.warId, "war-b", "the choice never depends on array order");
});

test("the stored offer carries its round and bounded numbers", () => {
  const picked = choosePeaceOffer({ offers: [offer({ pressure: 4, round: -1 })], round: 7 });
  assert.equal(picked.round, 7, "the turn's round is stamped");
  assert.equal(picked.pressure, 1, "pressure is bounded to 0..1");
});

test("a held war keeps its pending offer instead of clearing it", () => {
  const carried = offer({ warId: "war-1", round: 3, pressure: 0.7 });
  const chosen = choosePeaceOffer({ offers: [offer({ warId: "war-2", pressure: 0.9 })], round: 9 });
  const kept = keepHeldPeaceOffer({ carried, withheldIds: ["war-1"], chosen });
  assert.equal(kept.warId, "war-1", "the carried offer survives a withheld close");
  assert.equal(kept.round, 3, "the carried offer is not re-stamped");
  assert.equal(kept.pressure, 0.7);
});

test("an offer whose war was not held defers to the fresh choice", () => {
  const carried = offer({ warId: "war-1" });
  const chosen = choosePeaceOffer({ offers: [offer({ warId: "war-2", pressure: 0.9 })], round: 9 });
  assert.equal(keepHeldPeaceOffer({ carried, withheldIds: ["war-2"], chosen }).warId, "war-2");
  assert.equal(keepHeldPeaceOffer({ carried, withheldIds: [], chosen }).warId, "war-2");
  assert.equal(keepHeldPeaceOffer({ carried, chosen }).warId, "war-2");
});

test("without a carried offer the fresh choice stands", () => {
  const chosen = choosePeaceOffer({ offers: [offer({ warId: "war-2" })], round: 9 });
  assert.equal(keepHeldPeaceOffer({ carried: null, withheldIds: ["war-2"], chosen }).warId, "war-2");
  assert.deepEqual(keepHeldPeaceOffer({ withheldIds: ["war-2"], chosen }), chosen);
  assert.equal(keepHeldPeaceOffer(), null);
});

test("normalize keeps a full offer and rejects an unusable one", () => {
  const kept = normalizePeaceOffer(offer({ warId: " war-1 " }));
  assert.equal(kept.warId, "war-1");
  assert.equal(kept.side, "a");
  assert.deepEqual(kept.transfers, []);
  assert.deepEqual(kept.reparations, { fromCode: "B", toCode: "A", manpower: 0, materiel: 0 });

  assert.equal(normalizePeaceOffer(null), null);
  assert.equal(normalizePeaceOffer({ warId: "" }), null);
  assert.equal(normalizePeaceOffer({ warId: "war-1" }).transfers.length, 0);
  assert.equal(normalizePeaceOffer({ warId: "war-1" }).side, "");
  assert.deepEqual(
    normalizePeaceOffer({ warId: "war-1" }).reparations,
    { fromCode: "", toCode: "", manpower: 0, materiel: 0 },
  );
});

test("the peace digest names the pending war and holds it open", () => {
  assert.equal(buildPeaceOfferDigest({}), "");
  assert.equal(buildPeaceOfferDigest(), "");
  assert.equal(buildPeaceOfferDigest({ offer: null }), "");
  assert.equal(buildPeaceOfferDigest({ offer: { warId: "" } }), "");
  const line = buildPeaceOfferDigest({ offer: offer({ warId: "war-7" }) });
  assert.match(line, /\[Peace Offer Pending/);
  assert.match(line, /war-7/);
  assert.match(line, /do not close/);
});

test("the held ops are the three that close the offered war", () => {
  assert.deepEqual([...PEACE_OFFER_HELD_OPS], ["end", "ceasefire", "leave"]);
});

test("a record that would close the offered war is held", () => {
  const held = { warId: "war-7" };
  for (const op of ["end", "ceasefire", "leave"]) {
    assert.equal(peaceOfferHoldsWarUpdate({ update: { id: "war-7", op }, offer: held }), true, op);
  }
  assert.equal(
    peaceOfferHoldsWarUpdate({ update: { id: "war-7", op: " END " }, offer: held }),
    true,
    "the op is trimmed and lower-cased like the ledger does",
  );
});

test("a record the offered war survives is not held", () => {
  const held = { warId: "war-7" };
  for (const op of ["join-a", "join-b", "resume", "goals", "start"]) {
    assert.equal(peaceOfferHoldsWarUpdate({ update: { id: "war-7", op }, offer: held }), false, op);
  }
  assert.equal(
    peaceOfferHoldsWarUpdate({ update: { id: "war-8", op: "end" }, offer: held }),
    false,
    "another war is untouched",
  );
  assert.equal(peaceOfferHoldsWarUpdate({ update: { id: "war-7", op: "" }, offer: held }), false);
});

test("no offer holds nothing", () => {
  assert.equal(peaceOfferHoldsWarUpdate({ update: { id: "war-7", op: "end" }, offer: null }), false);
  assert.equal(peaceOfferHoldsWarUpdate({ update: { id: "war-7", op: "end" }, offer: { warId: "" } }), false);
  assert.equal(peaceOfferHoldsWarUpdate({ update: { id: "war-7", op: "end" } }), false);
  assert.equal(peaceOfferHoldsWarUpdate(), false);
});
