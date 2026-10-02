// Run: node --test src/Game/AI/combatRegionResolution.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { buildRegionResolver, resolveCombatRegionIds } from "./combatRegionResolution.js";

const catalog = () => [{ id: "ALSACE", name: "Alsace" }];

test("buildRegionResolver resolves an exact id", () => {
  const { resolve } = buildRegionResolver(catalog());
  assert.equal(resolve("ALSACE"), "ALSACE");
});

test("buildRegionResolver folds a friendly name to its id", () => {
  const { resolve, size } = buildRegionResolver(catalog());
  assert.equal(resolve("alsace"), "ALSACE");
  assert.equal(size, 1);
});

test("buildRegionResolver returns an empty string for an unknown value", () => {
  const { resolve } = buildRegionResolver(catalog());
  assert.equal(resolve("Atlantis"), "");
  assert.equal(resolve(""), "");
});

test("a combatRegion that is already a known id is kept", () => {
  const containers = [{ event: { combatRegion: "ALSACE" } }];
  const out = resolveCombatRegionIds(containers, catalog());
  assert.equal(containers[0].event.combatRegion, "ALSACE");
  assert.equal(out.resolved, 1);
  assert.equal(out.dropped, 0);
});

test("a combatRegion that matches a name resolves to its id", () => {
  const containers = [{ event: { combatRegion: "alsace" } }];
  const out = resolveCombatRegionIds(containers, catalog());
  assert.equal(containers[0].event.combatRegion, "ALSACE");
  assert.equal(out.resolved, 1);
});

test("a combatRegion that matches nothing is dropped to an empty string", () => {
  const containers = [{ event: { combatRegion: "Atlantis" } }];
  const out = resolveCombatRegionIds(containers, catalog());
  assert.equal(containers[0].event.combatRegion, "");
  assert.equal(out.dropped, 1);
});
