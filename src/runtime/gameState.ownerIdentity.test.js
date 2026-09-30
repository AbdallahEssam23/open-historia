/*! Open Historia — owner identity (rename / annexation) tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/gameState.ownerIdentity.test.js
//
// A polity is identified by its owner TOKEN, and a rename changes only the label
// hung on that token (polityOverrides[token].name). The turn after a rename the
// model reads back the story it just wrote and answers with the NEW name, so
// unless every inbound owner is folded to the token, one country splits into two
// owners — half of them with none of its colour, tags, reputation or stats.

import test from "node:test";
import assert from "node:assert/strict";
import { applyEventImpactsToWorld, isPolityLandless, normalizeWorldState, polityLandlessIndex } from "./gameState.js";
import { buildOwnerAliasMap, canonicalOwnerName } from "./ownerNames.js";

const RENAMED = { Germany: { code: "Germany", name: "Third Reich", aliases: ["the Reich"] } };

const event = (impacts) => ({ date: "1936-03-07", title: "Test", description: "test", impacts });

// ---- Group A: the alias map ------------------------------------------------

test("a renamed polity's display name and aliases resolve to its token", () => {
  const aliases = buildOwnerAliasMap(RENAMED);
  assert.equal(canonicalOwnerName("Third Reich", aliases), "Germany");
  assert.equal(canonicalOwnerName("the reich", aliases), "Germany");
  assert.equal(canonicalOwnerName("Germany", aliases), "Germany");
});

test("punctuation and diacritics do not hide an identity", () => {
  // The model spells a name back the way it remembers it — an accent dropped or
  // an apostrophe added must not mint a second country.
  const aliases = buildOwnerAliasMap({
    "Roman Empire": { code: "Roman Empire", name: "Imperium Rōmānum", aliases: ["S.P.Q.R."] },
  });

  assert.equal(canonicalOwnerName("imperium romanum", aliases), "Roman Empire");
  assert.equal(canonicalOwnerName("SPQR", aliases), "Roman Empire");
});

test("a GADM code still canonicalises to its country name", () => {
  assert.equal(canonicalOwnerName("ESP", buildOwnerAliasMap({})), "Spain");
});

test("an unknown polity is returned untouched", () => {
  assert.equal(canonicalOwnerName("Roman Empire", buildOwnerAliasMap(RENAMED)), "Roman Empire");
});

test("a real country's name is never redirected to another polity", () => {
  // The disputed-territory case: a scenario polity NAMED "India" must not
  // swallow the actual India's territory.
  const aliases = buildOwnerAliasMap({ Z01: { code: "Z01", name: "India" } });
  assert.equal(canonicalOwnerName("India", aliases), "India");
});

test("a name another polity already answers to is never redirected", () => {
  const aliases = buildOwnerAliasMap({
    "Roman Empire": { code: "Roman Empire", name: "Byzantium" },
    Byzantium: { code: "Byzantium", name: "Eastern Rome" },
  });
  assert.equal(canonicalOwnerName("Byzantium", aliases), "Byzantium");
  assert.equal(canonicalOwnerName("Eastern Rome", aliases), "Byzantium");
});

test("a name two polities both answer to identifies neither", () => {
  const aliases = buildOwnerAliasMap({
    North: { code: "North", aliases: ["the Union"] },
    South: { code: "South", aliases: ["the Union"] },
  });
  assert.equal(canonicalOwnerName("the Union", aliases), "the Union");
});

// ---- Group B: the read path repairs saves already split ---------------------

test("ownership already stored under an era name folds back to the token", () => {
  const world = normalizeWorldState({
    polityOverrides: RENAMED,
    regionOwnershipOverrides: { "DEU.1_1": "Germany", "POL.11_1": "Third Reich", "FRA.1_1": "the Reich" },
  });

  assert.deepEqual(world.regionOwnershipOverrides, {
    "DEU.1_1": "Germany",
    "POL.11_1": "Germany",
    "FRA.1_1": "Germany",
  });
});

test("claimants share the owner namespace and fold with it", () => {
  const world = normalizeWorldState({
    polityOverrides: RENAMED,
    regionClaimants: { "POL.11_1": ["Third Reich", "Poland"] },
  });

  assert.deepEqual(world.regionClaimants["POL.11_1"], ["Germany", "Poland"]);
});

// ---- Group C: the write path never splits a polity in two ------------------

test("a transfer to the new name lands on the renamed polity, not beside it", () => {
  const { world } = applyEventImpactsToWorld({
    world: { polityOverrides: RENAMED, regionOwnershipOverrides: {} },
    events: [event({ regionTransfers: [{ regionId: "AUT.9_1", toCode: "Third Reich" }] })],
  });

  assert.equal(world.regionOwnershipOverrides["AUT.9_1"], "Third Reich");
});

test("a rename and a conquest under the new name in the same turn agree", () => {
  const { world } = applyEventImpactsToWorld({
    world: { polityOverrides: {}, regionOwnershipOverrides: { "DEU.1_1": "Germany" } },
    events: [
      event({ polityChanges: [{ code: "Germany", name: "Third Reich" }] }),
      event({ regionTransfers: [{ regionId: "AUT.9_1", toCode: "Third Reich" }] }),
    ],
  });

  assert.deepEqual(Object.keys(world.polityOverrides), ["Third Reich"]);
  assert.equal(world.regionOwnershipOverrides["AUT.9_1"], "Third Reich");
  assert.equal(world.regionOwnershipOverrides["DEU.1_1"], "Third Reich");
});

test("a rename and the conquest it names, in ONE event, agree", () => {
  // The transfers of an event are applied before its polity changes, so the new
  // name has to be known before the transfers are read.
  const { world } = applyEventImpactsToWorld({
    world: { polityOverrides: {}, regionOwnershipOverrides: { "DEU.1_1": "Germany" } },
    events: [event({
      polityChanges: [{ code: "Germany", name: "Third Reich" }],
      regionTransfers: [{ regionId: "AUT.9_1", fromCode: "Austria", toCode: "Third Reich" }],
    })],
  });

  assert.deepEqual(Object.keys(world.polityOverrides), ["Third Reich"]);
  assert.equal(world.regionOwnershipOverrides["AUT.9_1"], "Third Reich");
});

test("a polity created and given land in ONE event keeps its own identity", () => {
  const { world } = applyEventImpactsToWorld({
    world: { polityOverrides: {}, regionOwnershipOverrides: { "DEU.2_1": "Germany" } },
    events: [event({
      polityChanges: [{ code: "Free Bavaria", name: "Free Bavaria" }],
      regionTransfers: [{ regionId: "DEU.2_1", fromCode: "Germany", toCode: "Free Bavaria" }],
    })],
  });

  assert.equal(world.regionOwnershipOverrides["DEU.2_1"], "Free Bavaria");
  assert.deepEqual(Object.keys(world.polityOverrides), ["Free Bavaria"]);
});

test("a later change addressed to the display name updates the same polity", () => {
  const { colors, world } = applyEventImpactsToWorld({
    colors: {},
    world: { polityOverrides: RENAMED },
    events: [event({
      polityChanges: [{
        code: "Third Reich",
        color: "#804040",
        reputation: 12,
        tags: ["authoritarian"],
        stats: { leader: "A. N. Other" },
      }],
    })],
  });

  assert.deepEqual(Object.keys(world.polityOverrides), ["Third Reich"]);
  assert.equal(world.polityOverrides["Third Reich"].name, "Third Reich");
  assert.deepEqual(world.polityOverrides["Third Reich"].formerNames, ["Germany"]);
  assert.equal(world.internationalReputation["Third Reich"], 12);
  assert.deepEqual(world.countryTags["Third Reich"], ["authoritarian"]);
  assert.equal(world.countryStats["Third Reich"].leader, "A. N. Other");
  assert.deepEqual(colors["Third Reich"], [128, 64, 64]);
  assert.equal("Germany" in world.countryTags, false);
});

test("a battalion raised under the new name flies the right country's flag", () => {
  const { world } = applyEventImpactsToWorld({
    world: { polityOverrides: RENAMED },
    events: [event({
      unitOps: [{
        op: "spawn",
        unit: { name: "1st Army", type: "infantry", ownerCode: "Third Reich", strength: 100, lng: 13.4, lat: 52.5 },
      }],
    })],
  });

  assert.equal(world.units.length, 1);
  assert.equal(world.units[0].ownerCode, "Third Reich");
});

test("a structure built under the new name belongs to the same polity", () => {
  const { world } = applyEventImpactsToWorld({
    world: { polityOverrides: RENAMED },
    events: [event({
      markerOps: [{ op: "build", marker: { name: "Westwall", kind: "fortification", ownerCode: "Third Reich", lng: 7.1, lat: 49.2 } }],
    })],
  });

  assert.equal(world.markers[0].ownerCode, "Third Reich");
});

test("a genuinely new polity is still created, not folded into an existing one", () => {
  const { world } = applyEventImpactsToWorld({
    world: { polityOverrides: RENAMED },
    events: [event({ polityChanges: [{ code: "Free Bavaria", name: "Free Bavaria" }] })],
  });

  assert.deepEqual(Object.keys(world.polityOverrides).sort(), ["Free Bavaria", "Third Reich"]);
});

// ---- Group D: annexation ---------------------------------------------------

test("annexation moves every region and leaves the loser landless, not deleted", () => {
  const { world } = applyEventImpactsToWorld({
    world: {
      polityOverrides: { Belgium: { code: "Belgium", name: "Kingdom of Belgium" } },
      countryTags: { Belgium: ["neutral"] },
      regionOwnershipOverrides: { "BEL.1_1": "Belgium", "BEL.2_1": "Belgium" },
    },
    events: [event({
      regionTransfers: [
        { regionId: "BEL.1_1", fromCode: "Belgium", toCode: "Germany" },
        { regionId: "BEL.2_1", fromCode: "Kingdom of Belgium", toCode: "Germany" },
      ],
    })],
  });

  assert.deepEqual(Object.values(world.regionOwnershipOverrides), ["Germany", "Germany"]);
  // The polity survives as a stateless actor (isPolityLandless), keeping its
  // registry entry and everything keyed to it.
  // A record whose display name differed from its key is keyed by that name
  // from now on; the old key stays as a former name.
  assert.equal(world.polityOverrides["Kingdom of Belgium"].name, "Kingdom of Belgium");
  assert.deepEqual(world.polityOverrides["Kingdom of Belgium"].formerNames, ["Belgium"]);
  assert.deepEqual(world.countryTags["Kingdom of Belgium"], ["neutral"]);
});

// The Stats panel asks this about every tracked and every declared polity in one
// pass, so it derives the ownership index once (polityLandlessIndex) instead of
// re-normalizing the campaign per name. The indexed answer must be the plain
// answer for every case, including the two that are easy to get wrong: a
// case-different spelling, and a world with no ownership ledger at all.
test("the landless index answers exactly as the unindexed check", () => {
  const annexed = {
    polityOverrides: {
      Belgium: { code: "Belgium" },
      Germany: { code: "Germany" },
      "Free Bavaria": { code: "Free Bavaria" },
    },
    regionOwnershipOverrides: { "BEL.1_1": "Germany", "DEU.1_1": "Germany" },
    regionSovereigntyOverrides: { "DEU.2_1": "Free Bavaria" },
  };
  // No ledger at all: every polity owns through the stock map's base tiles.
  const stock = { polityOverrides: { Japan: { code: "Japan" } } };
  const empty = {};

  for (const world of [annexed, stock, empty]) {
    const normalized = normalizeWorldState(world);
    const index = polityLandlessIndex(world);
    for (const code of ["Germany", "Belgium", "Free Bavaria", "Japan", "Nowhere", "germany", "FREE BAVARIA", ""]) {
      assert.equal(
        isPolityLandless(world, code, index),
        isPolityLandless(normalized, code),
        `landless("${code}") answered differently through the index`,
      );
    }
  }

  // And the answers themselves, so a change to BOTH paths together is still
  // caught. The two asymmetries here are the existing contract, preserved:
  // a world with no ownership ledger falls back to the stock map's baked tiles
  // for names it does not declare, but a name it DOES declare has no region to
  // own in that world and is landless.
  assert.equal(isPolityLandless(annexed, "Germany"), false, "an administering polity holds land");
  assert.equal(isPolityLandless(annexed, "Free Bavaria"), false, "a lawful sovereign holds land even with none administered");
  assert.equal(isPolityLandless(annexed, "Belgium"), true, "an annexed polity is landless, not deleted");
  assert.equal(isPolityLandless(annexed, "Nowhere"), true, "a ledger exists and does not list this name: landless");
  assert.equal(isPolityLandless(stock, "Japan"), true, "declared but holding nothing in a ledger-less world: landless");
  assert.equal(isPolityLandless(stock, "Nowhere"), false, "undeclared in a ledger-less world: a stock map country, not landless");
});
