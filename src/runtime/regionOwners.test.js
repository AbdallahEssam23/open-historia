// Run: node --test src/runtime/regionOwners.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { regionOwnerName } from "./regionOwners.js";

const CATALOG = [
  { id: "FRA.1_1", name: "Bourgogne", country: "France", countryCode: "FRA" },
  { id: "DEU.1_1", name: "Bayern", country: "Germany", countryCode: "DEU" },
];

test("an override wins over the base country, as the full name", () => {
  assert.equal(regionOwnerName(CATALOG[1], { "DEU.1_1": "FRA" }), "France");
});

test("with no override the base country name is used", () => {
  assert.equal(regionOwnerName(CATALOG[0], {}), "France");
});

test("a missing country falls back to the country code name", () => {
  assert.equal(regionOwnerName({ id: "X", name: "X", countryCode: "ESP" }, {}), "Spain");
});

test("a region with no owner resolves to empty, never a throw", () => {
  assert.equal(regionOwnerName(undefined, {}), "");
  assert.equal(regionOwnerName({ id: "O", name: "Ocean" }, null), "");
});
