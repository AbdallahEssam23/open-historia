// Open Historia - the region contiguity graph (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// One definition of "these two regions border each other", shared by the map
// lookup layer and the war engines. It imports nothing and knows regions only by
// id and geometry: ownership and names belong to the caller. The rule is the one
// the AI lookup tools used to carry alone - a region's own declared adjacencies
// win, and a region that declares none falls back to a bounding-box touch, which
// is a cheap over-approximation that only ever adds a diagonal neighbour.

// Two bounding boxes within this many degrees count as touching. Kept as the
// single source of the fallback tolerance.
export const ADJACENCY_GAP_DEGREES = 0.05;

const name = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);

// The bounding box of any GeoJSON Polygon/MultiPolygon, or null when there is no
// geometry to measure. Walks the coordinates rather than assuming a nesting
// depth, so a Point, a LineString or a malformed shape degrades to null or to the
// extent of whatever numbers it does hold.
export const geometryBounds = (geometry) => {
  if (!geometry) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (coords) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number") {
      const x = coords[0];
      const y = coords[1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      return;
    }
    for (const entry of coords) visit(entry);
  };
  visit(geometry.coordinates);
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
};

export const bboxesTouch = (a, b) =>
  Boolean(a && b)
  && a[0] <= b[2] + ADJACENCY_GAP_DEGREES && b[0] <= a[2] + ADJACENCY_GAP_DEGREES
  && a[1] <= b[3] + ADJACENCY_GAP_DEGREES && b[1] <= a[3] + ADJACENCY_GAP_DEGREES;

const clampSteps = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 1000);
};

// Build the graph once and query it many times. A row is
// { id, adjacencies?: string[], geometry?: object, bbox?: number[] }; its bbox is
// its own when given, else read from its geometry. A duplicate id keeps its first
// row, so a catalog that repeats a region cannot shift the answer.
export const buildRegionAdjacency = (rows) => {
  const ids = [];
  const bboxById = new Map();
  const firstRow = new Map();
  for (const row of list(rows)) {
    const id = name(row?.id);
    if (!id || firstRow.has(id)) continue;
    firstRow.set(id, row);
    ids.push(id);
    const bbox = Array.isArray(row?.bbox) && row.bbox.length === 4 ? row.bbox : geometryBounds(row?.geometry);
    bboxById.set(id, bbox ?? null);
  }
  const known = new Set(ids);

  // Declared adjacency is bidirectional, counts only between regions the catalog
  // actually holds, and never links a region to itself. Insertion order is kept,
  // so a declared list reads back the way the map author wrote it.
  const declared = new Map();
  const declare = (from, to) => {
    if (!declared.has(from)) declared.set(from, new Set());
    declared.get(from).add(to);
  };
  for (const id of ids) {
    for (const raw of list(firstRow.get(id)?.adjacencies)) {
      const other = name(raw);
      if (!known.has(other) || other === id) continue;
      declare(id, other);
      declare(other, id);
    }
  }

  const cache = new Map();
  const neighborsOf = (value) => {
    const id = name(value);
    if (!known.has(id)) return [];
    if (cache.has(id)) return cache.get(id);
    const declaredSet = declared.get(id);
    let found;
    if (declaredSet) {
      // A region that declares any neighbour uses only its declared set: the
      // declaration is a claim of authorship, so its bbox is not consulted.
      found = [...declaredSet];
    } else {
      const bbox = bboxById.get(id);
      found = bbox
        ? ids.filter((other) => other !== id && bboxById.get(other) && bboxesTouch(bbox, bboxById.get(other)))
        : [];
    }
    cache.set(id, found);
    return found;
  };

  // Either direction counts, because one side declaring a neighbour is enough to
  // make them border each other for a caller asking "who touches whom".
  const areNeighbors = (a, b) => {
    const x = name(a);
    const y = name(b);
    if (x === y || !known.has(x) || !known.has(y)) return false;
    return neighborsOf(x).includes(y) || neighborsOf(y).includes(x);
  };

  // Breadth-first, nearest ring first, never repeating a region and never
  // returning the start. A step count of zero or less is no walk at all.
  const neighborsWithin = (value, steps) => {
    const start = name(value);
    const depth = clampSteps(steps);
    if (depth === 0 || !known.has(start)) return [];
    const out = [];
    const visited = new Set([start]);
    let frontier = [start];
    for (let ring = 0; ring < depth && frontier.length; ring += 1) {
      const next = [];
      for (const id of frontier) {
        for (const neighbour of neighborsOf(id)) {
          if (visited.has(neighbour)) continue;
          visited.add(neighbour);
          out.push(neighbour);
          next.push(neighbour);
        }
      }
      frontier = next;
    }
    return out;
  };

  return {
    size: ids.length,
    has: (id) => known.has(name(id)),
    neighborsOf,
    areNeighbors,
    neighborsWithin,
  };
};
