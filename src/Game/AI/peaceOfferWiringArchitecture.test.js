// Run: node --test src/Game/AI/peaceOfferWiringArchitecture.test.js
//
// gameplay.js imports main.jsx and cannot be imported by node --test, so its
// wiring is pinned by reading the source. This is the house pattern for the
// other wiring architecture guards.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const gameplay = read("./gameplay.js");
const lazy = read("./gameplayLazy.js");
const adapter = read("../../runtime/warSettlement.js");
const helper = read("../../runtime/peaceOffer.js");

test("the offer is chosen after the settlements are applied", () => {
  const applyAt = gameplay.indexOf("for (const settlement of dueSettlements)");
  const chooseAt = gameplay.indexOf("choosePeaceOffer({ offers: duePeaceOffers");
  assert.ok(applyAt > 0 && chooseAt > applyAt, "the offer is chosen after the settlements are applied");
});

test("the model's own peace is withheld from the offers too", () => {
  const offersAt = gameplay.indexOf("duePeaceOffers = settlementOutcome.offers");
  const filterAt = gameplay.indexOf(".filter((offer) => !modelClosedWarIds.has(normalizeString(offer.warId)))");
  assert.ok(offersAt > 0 && filterAt > offersAt, "the offers are filtered by the model-closed ids");
});

test("accepting routes through the helper", () => {
  const acceptAt = gameplay.indexOf("export const acceptPeaceOffer");
  const callAt = gameplay.indexOf("applyPeaceOffer({", acceptAt);
  assert.ok(acceptAt > 0 && callAt > acceptAt, "acceptPeaceOffer calls applyPeaceOffer");
});

test("accepting links the accepted event into the timeline", () => {
  const acceptAt = gameplay.indexOf("export const acceptPeaceOffer");
  const linkAt = gameplay.indexOf("withLatestTurnEventIds", acceptAt);
  assert.ok(linkAt > acceptAt, "acceptPeaceOffer links the accepted event into the latest turn");
});

test("accept and decline are lazy-wrapped", () => {
  assert.match(lazy, /export const acceptPeaceOffer/);
  assert.match(lazy, /export const declinePeaceOffer/);
});

test("the runtime peace modules import no Game/AI module", () => {
  assert.doesNotMatch(adapter, /from "\.\.\/Game\/AI\//);
  assert.doesNotMatch(helper, /from "\.\.\/Game\/AI\//);
  assert.doesNotMatch(helper, /^import /m);
});

test("the war directive prints the pending peace digest the jump prompt builds", () => {
  const start = gameplay.indexOf("const buildWarLedgerDirective = (variables) => {");
  assert.ok(start > 0, "the war directive builder is missing");
  const end = gameplay.indexOf("\n};", start);
  const body = gameplay.slice(start, end);
  assert.match(body, /\$\{peaceOffer \?/, "the directive does not print the pending peace digest");
  assert.ok(gameplay.indexOf("variables.peaceOffer =") > 0, "the jump prompt never sets variables.peaceOffer");
});

test("the legal digests are built before the projection gate", () => {
  const gateAt = gameplay.indexOf("if (projected.months > 0)");
  assert.ok(gateAt > 0, "the projection gate is missing");
  for (const name of [
    "variables.treatyObligations =",
    "variables.treatyBreach =",
    "variables.warCasus =",
    "variables.peaceOffer =",
  ]) {
    const at = gameplay.indexOf(name);
    assert.ok(at > 0 && at < gateAt, `${name} must be built before the projection gate`);
    assert.ok(gameplay.split(name).length - 1 === 1, `${name} must occur exactly once in gameplay.js`);
  }
});
