/*! Open Historia - pure polity analytics (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/engine/polityAnalytics.test.js
//
// The arithmetic behind the World analytics tab: turn a map of polity sheets
// into a ranked list. Import-free and pure, like every engine module, so the
// ranking is deterministic and tested with plain objects. A metric is data
// (a path into the sheet, or an index key), never a function, so the catalog is
// easy to read and every entry can be checked against a full sheet.

const text = (value) => String(value ?? "").trim();

// The stock, sheet-level metrics. `additive` marks a metric whose values can be
// summed into a meaningful world total - and so can carry a share-of-world - as
// opposed to an average, a percentage or an index.
export const POLITY_METRICS = Object.freeze([
  Object.freeze({ key: "gdp", label: "GDP", group: "economy", unit: "currency", additive: true, path: ["economy", "gdp"] }),
  Object.freeze({ key: "gdpPerCapita", label: "GDP per capita", group: "economy", unit: "currency", additive: false, path: ["economy", "gdpPerCapita"] }),
  Object.freeze({ key: "population", label: "Population", group: "economy", unit: "population", additive: true, path: ["population", "total"] }),
  Object.freeze({ key: "gdpGrowth", label: "GDP growth", group: "conditions", unit: "percent", additive: false, path: ["economy", "gdpGrowth"] }),
  Object.freeze({ key: "inflation", label: "Inflation", group: "conditions", unit: "percent", additive: false, path: ["economy", "inflation"] }),
  Object.freeze({ key: "unemployment", label: "Unemployment", group: "conditions", unit: "percent", additive: false, path: ["economy", "unemployment"] }),
  Object.freeze({ key: "publicDebt", label: "Public debt", group: "conditions", unit: "percent", additive: false, path: ["economy", "publicDebt"] }),
  Object.freeze({ key: "budgetBalance", label: "Budget balance", group: "conditions", unit: "percent", additive: false, path: ["economy", "budgetBalance"] }),
  Object.freeze({ key: "stability", label: "National stability", group: "conditions", unit: "index", additive: false, path: ["stability"] }),
]);

const GROUPS = Object.freeze([
  Object.freeze({ key: "economy", label: "Economy", icon: "◈" }),
  Object.freeze({ key: "conditions", label: "Conditions", icon: "↗" }),
  Object.freeze({ key: "strategic", label: "Strategic indices", icon: "⚑" }),
]);

// One metric's value on one sheet: the index when the metric names one, else
// the walked path. A missing or non-finite value is null, so a half-assessed
// sheet is skipped rather than ranked as zero.
export const metricValueFor = (sheet, metric) => {
  if (!sheet || !metric) return null;
  let value;
  if (metric.index) {
    value = sheet?.indices?.[metric.index];
  } else if (Array.isArray(metric.path)) {
    value = metric.path.reduce((node, step) => (node == null ? node : node[step]), sheet);
  } else {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

// The metric picker's groups: the stock metrics, plus one index metric per row
// the scenario defines (the same rows the line chart builds from). Unknown
// groups fall back to the stock groups, so the picker is never empty.
export const polityMetricCatalog = (indexRows = []) => {
  const byGroup = new Map();
  for (const metric of POLITY_METRICS) {
    if (!byGroup.has(metric.group)) byGroup.set(metric.group, []);
    byGroup.get(metric.group).push(metric);
  }
  const strategic = (Array.isArray(indexRows) ? indexRows : [])
    .filter((row) => row && text(row.key))
    .map((row) => Object.freeze({
      key: text(row.key),
      label: text(row.label) || text(row.key),
      group: "strategic",
      unit: "index",
      additive: false,
      index: text(row.key),
      color: row.color,
    }));
  if (strategic.length) byGroup.set("strategic", strategic);
  return GROUPS
    .filter((group) => byGroup.has(group.key))
    .map((group) => ({ ...group, metrics: byGroup.get(group.key) }));
};

// A ranked list of every polity with a finite value for the metric. The sort is
// by value descending, ties broken by the key compared by code unit, so the
// order is the same on every render and in every locale.
export const rankPolities = ({ sheets, metric, limit = 12 } = {}) => {
  const rows = [];
  if (sheets && typeof sheets === "object" && metric) {
    for (const [polity, sheet] of Object.entries(sheets)) {
      const value = metricValueFor(sheet, metric);
      if (value !== null) rows.push({ polity, value });
    }
  }
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  rows.sort((a, b) => (b.value - a.value) || (a.polity < b.polity ? -1 : a.polity > b.polity ? 1 : 0));
  const cap = Math.max(1, Math.trunc(Number(limit) || 12));
  const limited = rows.slice(0, cap).map((row) => ({
    ...row,
    share: total > 0 ? row.value / total : 0,
  }));
  return {
    metric: metric?.key ?? "",
    additive: Boolean(metric?.additive),
    total,
    rows: limited,
  };
};
