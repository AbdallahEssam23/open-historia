/*! Open Historia - scenario-owned Stats definition runtime tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, test } from "node:test";

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "libraryStore.js")).href;
const roots = [];

const run = (body) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-stats-owner-"));
  roots.push(root);
  const script = `
    const store = await import(${JSON.stringify(STORE_URL)});
    const fs = await import("node:fs");
    const path = await import("node:path");
    ${body}
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, OH_DATA_DIR: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out.slice(out.lastIndexOf("\n@@") + 3));
};

const report = (expr) => `process.stdout.write("\\n@@" + JSON.stringify(${expr}));`;
const sheet = (label, key) => ({
  version: 2,
  sections: [{
    key: "resources",
    label: "Resources",
    icon: "R",
    stats: [{ key, label, kind: "number", icon: "*", color: "#22c55e", decimals: 0, minimum: 0 }],
  }],
});

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("runtime Stats definition follows the linked scenario, not a stale game snapshot", () => {
  const scenarioA = sheet("Timber", "timber");
  const scenarioB = sheet("Hacksilver", "hacksilver");
  const staleGame = sheet("Modern GDP", "gdp");
  const result = run(`
    const a = ${JSON.stringify(scenarioA)};
    const b = ${JSON.stringify(scenarioB)};
    const stale = ${JSON.stringify(staleGame)};
    store.createScenario({ id: "vinland", name: "Vinland", setActive: true });
    store.uploadScenarioAsset("vinland", "stats", Buffer.from(JSON.stringify(a)), "application/json");
    store.createGame({ id: "campaign", name: "Campaign", scenarioId: "vinland", setActive: true });
    await store.writeRuntimeJsonAsset("stats", stale);
    const before = store.readRuntimeJsonAsset("stats").data;
    store.uploadScenarioAsset("vinland", "stats", Buffer.from(JSON.stringify(b)), "application/json");
    const after = store.readRuntimeJsonAsset("stats").data;
    const exported = store.exportGameBundle("campaign").data.stats;
    store.removeScenarioAsset("vinland", "stats");
    const cleared = store.readRuntimeJsonAsset("stats").data;
    ${report(`({ before, after, exported, cleared })`)}
  `);

  assert.deepEqual(result.before, scenarioA, "game-local stats.json must not shadow the linked scenario");
  assert.deepEqual(result.after, scenarioB, "Scenario Editor changes should be immediately canonical");
  assert.deepEqual(result.exported, scenarioB, "portable game export should snapshot the current canonical scenario definition");
  assert.deepEqual(result.cleared, {}, "clearing scenario Stats means the standard sheet, not stale game resurrection");
});

test("an orphaned imported campaign may fall back to its frozen game Stats definition", () => {
  const frozen = sheet("Timber", "timber");
  const result = run(`
    store.importGameBundle({
      schema: "open-historia-game-bundle/1",
      game: { name: "Orphan" },
      scenarioRef: { scenarioId: "missing-vinland", scenarioName: "Vinland", missing: true },
      data: { game: {}, world: {}, prompts: {}, actions: [], advisor: [], chat: [], events: [], stats: ${JSON.stringify(frozen)} },
    });
    const id = store.getGameCatalog().games.find((g) => g.name === "Orphan").id;
    store.setActiveGame(id);
    const runtime = store.readRuntimeJsonAsset("stats").data;
    ${report(`({ runtime })`)}
  `);
  assert.deepEqual(result.runtime, frozen);
});
