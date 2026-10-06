// Run: node --test src/engine/strategicIntent.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_CLAIMS,
  MAX_DECLARATIONS,
  MAX_PEACE_SEEKS,
  WAR_GOALS,
  deriveIntentMenu,
  warIdFor,
} from "./strategicIntent.js";

const targets = (names) => names.map((polity) => ({ polity }));

test("a menu is deterministic: equal facts give an equal menu", () => {
  const input = {
    actor: { polity: "Ruritania", existingWarIds: ["war-old"] },
    targets: [
      { polity: "Syldavia", holdsActorClaim: true },
      { polity: "Borduria", breachedActor: true },
      { polity: "Ruritania" },
    ],
    regions: [
      { regionId: "r1", owner: "Syldavia" },
      { regionId: "r2", owner: "Borduria", claimedByActor: true },
    ],
  };
  assert.deepEqual(deriveIntentMenu(input), deriveIntentMenu(input));
});

test("warIdFor is stable and steps past an id already spoken for", () => {
  assert.equal(warIdFor("Ruritania", "Syldavia"), "war-ruritania-syldavia");
  assert.equal(warIdFor("Ruritania", "Syldavia"), warIdFor("Ruritania", "Syldavia"));
  assert.equal(
    warIdFor("Ruritania", "Syldavia", ["war-ruritania-syldavia", "war-ruritania-syldavia-2"]),
    "war-ruritania-syldavia-3",
  );
});

test("the actor is never a target of its own menu", () => {
  const menu = deriveIntentMenu({ actor: { polity: "Ruritania" }, targets: targets(["Ruritania", "Syldavia"]) });
  assert.deepEqual(menu.declareWar.map((entry) => entry.target), ["Syldavia"]);
});

test("a polity already at war is not offered again", () => {
  const menu = deriveIntentMenu({
    actor: { polity: "Ruritania" },
    targets: [{ polity: "Syldavia", atWar: true }, { polity: "Borduria" }],
  });
  assert.deepEqual(menu.declareWar.map((entry) => entry.target), ["Borduria"]);
});

test("a standing claim or a recorded breach makes a declaration justified", () => {
  const menu = deriveIntentMenu({
    actor: { polity: "Ruritania" },
    targets: [
      { polity: "Syldavia", holdsActorClaim: true },
      { polity: "Borduria", breachedActor: true },
      { polity: "Nowhere" },
    ],
  });
  const byTarget = Object.fromEntries(menu.declareWar.map((entry) => [entry.target, entry]));
  assert.equal(byTarget.Syldavia.justified, true);
  assert.deepEqual(byTarget.Syldavia.reasons, ["standing claim"]);
  assert.equal(byTarget.Borduria.justified, true);
  assert.deepEqual(byTarget.Borduria.reasons, ["recorded breach"]);
  assert.equal(byTarget.Nowhere.justified, false, "no recorded cause is unjust, not illegal");
  assert.deepEqual(byTarget.Nowhere.goals, WAR_GOALS);
});

test("declarations are capped", () => {
  const names = Array.from({ length: MAX_DECLARATIONS + 4 }, (_, index) => `P${index}`);
  const menu = deriveIntentMenu({ actor: { polity: "Ruritania" }, targets: targets(names) });
  assert.equal(menu.declareWar.length, MAX_DECLARATIONS);
});

test("a claim on a region the actor already owns or claims is not offered", () => {
  const menu = deriveIntentMenu({
    actor: { polity: "Ruritania" },
    regions: [
      { regionId: "r1", owner: "Syldavia" },
      { regionId: "r2", owner: "Ruritania" },
      { regionId: "r3", owner: "Syldavia", claimedByActor: true },
      { regionId: "", owner: "Syldavia" },
      { regionId: "r4", owner: "" },
    ],
  });
  assert.deepEqual(menu.pressClaim.map((entry) => entry.regionId), ["r1"]);
  assert.equal(menu.pressClaim[0].owner, "Syldavia");
});

test("claims are capped and a repeated region is offered once", () => {
  const regions = Array.from({ length: MAX_CLAIMS + 3 }, (_, index) => ({ regionId: `r${index}`, owner: "Syldavia" }));
  regions.push({ regionId: "r0", owner: "Syldavia" });
  const menu = deriveIntentMenu({ actor: { polity: "Ruritania" }, regions });
  assert.equal(menu.pressClaim.length, MAX_CLAIMS);
  assert.equal(new Set(menu.pressClaim.map((entry) => entry.regionId)).size, MAX_CLAIMS);
});

test("a nameless actor or an empty fact set yields an empty menu", () => {
  assert.deepEqual(deriveIntentMenu({}), { polity: "", declareWar: [], pressClaim: [], seekPeace: [] });
  assert.deepEqual(
    deriveIntentMenu({ actor: { polity: "Ruritania" } }),
    { polity: "Ruritania", declareWar: [], pressClaim: [], seekPeace: [] },
  );
});

test("a weary, not-ahead war is offered to sue for peace", () => {
  const menu = deriveIntentMenu({
    actor: { polity: "Ruritania" },
    wars: [
      { warId: "war-ruritania-syldavia", opponent: "Syldavia", weariness: 0.62, ahead: false, party: false },
      { warId: "war-fresh", opponent: "Borduria", weariness: 0.1, ahead: false, party: false },
      { warId: "war-won", opponent: "Genovia", weariness: 0.7, ahead: true, party: false },
    ],
  });
  assert.deepEqual(menu.seekPeace, [
    { warId: "war-ruritania-syldavia", opponent: "Syldavia", weariness: 0.62, party: false },
  ]);
});

test("a non-player actor may seek on a war the player is in, and says so", () => {
  const menu = deriveIntentMenu({
    actor: { polity: "Syldavia" },
    playerPolity: "Ruritania",
    wars: [{ warId: "war-ruritania-syldavia", opponent: "Ruritania", weariness: 0.66, ahead: false, party: true }],
  });
  assert.deepEqual(menu.seekPeace, [
    { warId: "war-ruritania-syldavia", opponent: "Ruritania", weariness: 0.66, party: true },
  ]);
});

test("the player's own menu never offers a seek, however weary its wars", () => {
  const menu = deriveIntentMenu({
    actor: { polity: "Ruritania" },
    playerPolity: "Ruritania",
    wars: [{ warId: "war-ruritania-syldavia", opponent: "Syldavia", weariness: 0.95, ahead: false, party: true }],
  });
  assert.deepEqual(menu.seekPeace, []);
});

test("the peace seeks are bounded and a repeated war is offered once", () => {
  const wars = Array.from({ length: MAX_PEACE_SEEKS + 3 }, (_, index) => ({
    warId: `war-${index}`,
    opponent: `Power ${index}`,
    weariness: 0.8,
    ahead: false,
  }));
  wars.push({ warId: "war-0", opponent: "Power 0", weariness: 0.8, ahead: false });
  const menu = deriveIntentMenu({ actor: { polity: "Ruritania" }, wars });
  assert.equal(menu.seekPeace.length, MAX_PEACE_SEEKS);
  assert.equal(new Set(menu.seekPeace.map((entry) => entry.warId)).size, MAX_PEACE_SEEKS);
});
