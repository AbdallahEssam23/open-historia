// Run: node --test src/engine/polityAnalytics.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  POLITY_METRICS,
  metricValueFor,
  polityMetricCatalog,
  rankPolities,
} from "./polityAnalytics.js";

const sheet = ({
  gdp = 10,
  gdpPerCapita = 1,
  population = 100,
  stability = 50,
  gdpGrowth = 2,
  inflation = 3,
  unemployment = 4,
  publicDebt = 5,
  budgetBalance = -1,
  indices = {},
} = {}) => ({
  economy: { gdp, gdpPerCapita, gdpGrowth, inflation, unemployment, publicDebt, budgetBalance },
  population: { total: population },
  stability,
  indices,
});

const metricByKey = (key) => POLITY_METRICS.find((metric) => metric.key === key);

test("the stock catalog has unique keys and every path resolves on a full sheet", () => {
  const keys = POLITY_METRICS.map((metric) => metric.key);
  assert.equal(new Set(keys).size, keys.length, "no duplicate keys");
  const full = sheet({ indices: { sovereignty: 70 } });
  for (const metric of POLITY_METRICS) {
    assert.equal(typeof metric.label, "string");
    assert.ok(metric.label.length > 0);
    if (metric.index) {
      assert.equal(metricValueFor(full, metric), 70, `${metric.key} reads its index`);
    } else {
      assert.ok(Number.isFinite(metricValueFor(full, metric)), `${metric.key} resolves a number`);
    }
  }
});

test("metricValueFor reads economy, population and indices, and nulls a missing value", () => {
  const full = sheet({ gdp: 42, population: 7, indices: { sovereignty: 33 } });
  assert.equal(metricValueFor(full, metricByKey("gdp")), 42);
  assert.equal(metricValueFor(full, metricByKey("population")), 7);
  assert.equal(metricValueFor(full, { key: "sovereignty", index: "sovereignty" }), 33);
  assert.equal(metricValueFor(null, metricByKey("gdp")), null);
  assert.equal(metricValueFor({}, metricByKey("gdp")), null);
  assert.equal(metricValueFor({ economy: { gdp: "nonsense" } }, metricByKey("gdp")), null);
  assert.equal(metricValueFor({ indices: {} }, { key: "missing", index: "missing" }), null);
});

test("rankPolities orders descending and breaks ties by key, deterministically", () => {
  const sheets = {
    Zeta: sheet({ gdp: 30 }),
    Alpha: sheet({ gdp: 30 }),
    Beta: sheet({ gdp: 50 }),
  };
  const result = rankPolities({ sheets, metric: metricByKey("gdp") });
  assert.equal(result.metric, "gdp");
  assert.equal(result.additive, true);
  assert.equal(result.total, 110);
  assert.deepEqual(result.rows.map((row) => row.polity), ["Beta", "Alpha", "Zeta"]);
  assert.deepEqual(result.rows.map((row) => row.value), [50, 30, 30]);
  assert.deepEqual(rankPolities({ sheets, metric: metricByKey("gdp") }), result);
});

test("rankPolities drops missing values, clamps the limit, and computes share", () => {
  const sheets = {
    A: sheet({ gdp: 50 }),
    B: sheet({ gdp: 50 }),
    C: { economy: {} },
    D: sheet({ gdp: 0 }),
  };
  const result = rankPolities({ sheets, metric: metricByKey("gdp"), limit: 2 });
  assert.equal(result.rows.length, 2, "the limit is applied");
  assert.equal(result.total, 100, "the total is over every finite row");
  assert.deepEqual(result.rows.map((row) => row.share), [0.5, 0.5]);
  assert.equal(rankPolities({ sheets, metric: metricByKey("gdp"), limit: -3 }).rows.length, 1, "a bad limit is clamped to one");
});

test("a zero total yields zero shares rather than a division", () => {
  const result = rankPolities({ sheets: { A: sheet({ gdp: 0 }) }, metric: metricByKey("gdp") });
  assert.equal(result.total, 0);
  assert.deepEqual(result.rows.map((row) => row.share), [0]);
});

test("an empty or unknown metric is an empty result, not a throw", () => {
  assert.deepEqual(rankPolities({ sheets: {}, metric: metricByKey("gdp") }).rows, []);
  assert.deepEqual(rankPolities({ metric: metricByKey("gdp") }).rows, []);
  const unknown = rankPolities({ sheets: { A: sheet() }, metric: { key: "nope", path: ["missing"] } });
  assert.deepEqual(unknown.rows, []);
});

test("an average metric is not additive and still ranks", () => {
  const sheets = { A: sheet({ gdpPerCapita: 5 }), B: sheet({ gdpPerCapita: 9 }) };
  const result = rankPolities({ sheets, metric: metricByKey("gdpPerCapita") });
  assert.equal(result.additive, false);
  assert.deepEqual(result.rows.map((row) => row.polity), ["B", "A"]);
});

test("the catalog adds a strategic group from the scenario's index rows", () => {
  const groups = polityMetricCatalog([{ key: "sovereignty", label: "Sovereignty", color: "#fff" }]);
  const strategic = groups.find((group) => group.key === "strategic");
  assert.ok(strategic, "a strategic group exists");
  const metric = strategic.metrics.find((item) => item.key === "sovereignty");
  assert.ok(metric, "the index row appears as a metric");
  assert.equal(metric.index, "sovereignty");
  assert.equal(metric.additive, false);
  // With no index rows, the stock groups are still present.
  assert.ok(polityMetricCatalog([]).length >= 2);
});
