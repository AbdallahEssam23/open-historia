// Run: node --test src/engine/casusBelli.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_CASUS_AGGRESSORS, deriveWarCasus } from "./casusBelli.js";

const claim = (over = {}) => ({ regionId: "alsace", claimant: "France", holder: "Germany", ...over });
const breach = (over = {}) => ({ agreementId: "pact", breachedBy: "Germany", parties: ["Germany", "France"], ...over });

test("a claim on land a defender holds is a just cause", () => {
  const out = deriveWarCasus({ aggressors: ["France"], defenders: ["Germany"], claims: [claim()] });
  assert.deepEqual(out.aggressors, [{ polity: "France", justified: true, kind: "claim", target: "alsace" }]);
  assert.deepEqual(out.summary, { judged: 1, justified: 1, unjust: 0 });
});

test("a claim on land a third power holds is not a just cause", () => {
  const out = deriveWarCasus({ aggressors: ["France"], defenders: ["Germany"], claims: [claim({ holder: "Italy" })] });
  assert.deepEqual(out.aggressors, [{ polity: "France", justified: false, kind: "", target: "" }]);
  assert.equal(out.summary.unjust, 1);
});

test("a recorded breach by a defender against a party is a just cause", () => {
  const out = deriveWarCasus({ aggressors: ["France"], defenders: ["Germany"], breaches: [breach()] });
  assert.deepEqual(out.aggressors, [{ polity: "France", justified: true, kind: "breach", target: "pact" }]);
});

test("a breach by the aggressor itself is not a warrant for its own war", () => {
  const out = deriveWarCasus({
    aggressors: ["France"],
    defenders: ["Germany"],
    breaches: [breach({ breachedBy: "France", parties: ["France", "Germany"] })],
  });
  assert.deepEqual(out.aggressors, [{ polity: "France", justified: false, kind: "", target: "" }]);
});

test("a breach the aggressor is not a party to is not a warrant", () => {
  const out = deriveWarCasus({
    aggressors: ["France"],
    defenders: ["Germany"],
    breaches: [breach({ parties: ["Germany", "Italy"] })],
  });
  assert.deepEqual(out.aggressors, [{ polity: "France", justified: false, kind: "", target: "" }]);
});

test("a claim decides before a breach when both exist", () => {
  const out = deriveWarCasus({ aggressors: ["France"], defenders: ["Germany"], claims: [claim()], breaches: [breach()] });
  assert.deepEqual(out.aggressors, [{ polity: "France", justified: true, kind: "claim", target: "alsace" }]);
});

test("a coalition's justified member is spared while its causeless member is not", () => {
  const out = deriveWarCasus({ aggressors: ["Italy", "France"], defenders: ["Germany"], claims: [claim()] });
  assert.deepEqual(out.aggressors, [
    { polity: "France", justified: true, kind: "claim", target: "alsace" },
    { polity: "Italy", justified: false, kind: "", target: "" },
  ]);
  assert.deepEqual(out.summary, { judged: 2, justified: 1, unjust: 1 });
});

test("the verdict is a function of the sets, not the input order", () => {
  const base = {
    aggressors: ["Italy", "France"],
    defenders: ["Germany"],
    claims: [claim({ regionId: "lorraine" }), claim({ regionId: "alsace" })],
    breaches: [breach({ agreementId: "b" }), breach({ agreementId: "a", breachedBy: "Italy" })],
  };
  const reordered = {
    aggressors: [...base.aggressors].reverse(),
    defenders: [...base.defenders].reverse(),
    claims: [...base.claims].reverse(),
    breaches: [...base.breaches].reverse(),
  };
  assert.deepEqual(deriveWarCasus(reordered), deriveWarCasus(base));
});

test("conflicting claim rows with the same key cannot change the verdict", () => {
  const claims = [claim({ holder: "Italy" }), claim({ holder: "Germany" })];
  const forward = deriveWarCasus({ aggressors: ["France"], defenders: ["Germany"], claims });
  const backward = deriveWarCasus({ aggressors: ["France"], defenders: ["Germany"], claims: [...claims].reverse() });
  assert.deepEqual(forward, backward);
  assert.deepEqual(forward.aggressors, [{ polity: "France", justified: true, kind: "claim", target: "alsace" }]);
});

test("conflicting breach rows with the same key cannot change the verdict", () => {
  const breaches = [
    breach({ parties: ["Germany", "Italy"] }),
    breach({ parties: ["Germany", "France"] }),
  ];
  const forward = deriveWarCasus({ aggressors: ["France"], defenders: ["Germany"], breaches });
  const backward = deriveWarCasus({ aggressors: ["France"], defenders: ["Germany"], breaches: [...breaches].reverse() });
  assert.deepEqual(forward, backward);
  assert.deepEqual(forward.aggressors, [{ polity: "France", justified: true, kind: "breach", target: "pact" }]);
});

test("an aggressor written in two cases dedupes to one deterministic spelling", () => {
  const forward = deriveWarCasus({ aggressors: ["France", "france"], defenders: ["Germany"] });
  const backward = deriveWarCasus({ aggressors: ["france", "France"], defenders: ["Germany"] });
  assert.deepEqual(forward, backward);
  assert.deepEqual(forward.aggressors, [{ polity: "France", justified: false, kind: "", target: "" }]);
});

test("the returned aggressors are capped", () => {
  const aggressors = Array.from({ length: MAX_CASUS_AGGRESSORS + 3 }, (_, i) => `P${String(i).padStart(2, "0")}`);
  const out = deriveWarCasus({ aggressors, defenders: ["Germany"] });
  assert.equal(out.aggressors.length, MAX_CASUS_AGGRESSORS);
  assert.equal(out.summary.judged, MAX_CASUS_AGGRESSORS);
});
