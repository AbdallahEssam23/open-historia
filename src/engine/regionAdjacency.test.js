// Run: node --test src/engine/regionAdjacency.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  ADJACENCY_GAP_DEGREES,
  bboxesTouch,
  buildRegionAdjacency,
  geometryBounds,
} from "./regionAdjacency.js";

test("geometryBounds reads a Polygon and a MultiPolygon, and null for nothing", () => {
  assert.deepEqual(
    geometryBounds({ type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]]] }),
    [0, 0, 2, 1],
  );
  assert.deepEqual(
    geometryBounds({
      type: "MultiPolygon",
      coordinates: [
        [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        [[[5, 5], [7, 5], [7, 6], [5, 6], [5, 5]]],
      ],
    }),
    [0, 0, 7, 6],
  );
  assert.equal(geometryBounds(null), null);
  assert.equal(geometryBounds({ type: "Point", coordinates: [] }), null);
});

test("bboxesTouch is inclusive at the gap and rejects a wider separation", () => {
  assert.equal(ADJACENCY_GAP_DEGREES, 0.05);
  assert.equal(bboxesTouch([0, 0, 1, 1], [1.04, 0, 2, 1]), true);
  assert.equal(bboxesTouch([0, 0, 1, 1], [1.1, 0, 2, 1]), false);
  assert.equal(bboxesTouch(null, [1, 0, 2, 1]), false);
});

test("a declared adjacency is bidirectional and keeps declaration order", () => {
  const graph = buildRegionAdjacency([
    { id: "A", adjacencies: ["C", "B"] },
    { id: "B" },
    { id: "C" },
  ]);
  assert.deepEqual(graph.neighborsOf("A"), ["C", "B"]);
  assert.deepEqual(graph.neighborsOf("B"), ["A"]);
  assert.deepEqual(graph.neighborsOf("C"), ["A"]);
  assert.equal(graph.size, 3);
  assert.equal(graph.has("A"), true);
  assert.equal(graph.has("Z"), false);
});

test("a declaration wins over a touching bbox and suppresses the fallback", () => {
  const rows = [
    { id: "A", adjacencies: ["B"] },
    { id: "B", bbox: [1, 0, 2, 1] },
    // C touches B, but B declared through A, so B does not fall back to C.
    { id: "C", bbox: [2.01, 0, 3, 1] },
  ];
  const graph = buildRegionAdjacency(rows);
  assert.deepEqual(graph.neighborsOf("A"), ["B"]);
  assert.deepEqual(graph.neighborsOf("B"), ["A"]);
  // C carries no declaration, so its bbox fallback still finds B.
  assert.deepEqual(graph.neighborsOf("C"), ["B"]);
  // areNeighbors is symmetric: C lists B even though B does not list C.
  assert.equal(graph.areNeighbors("B", "C"), true);
  assert.equal(graph.areNeighbors("C", "B"), true);
  assert.equal(graph.areNeighbors("A", "C"), false);
});

test("the bbox fallback returns touching regions in catalog order and skips the far ones", () => {
  const graph = buildRegionAdjacency([
    { id: "A", bbox: [0, 0, 1, 1] },
    { id: "B", bbox: [1, 0, 2, 1] },
    { id: "C", bbox: [-1, 0, 0, 1] },
    { id: "D", bbox: [10, 10, 11, 11] },
  ]);
  assert.deepEqual(graph.neighborsOf("A"), ["B", "C"]);
  assert.deepEqual(graph.neighborsOf("D"), []);
});

test("unknown ids, a self declaration and a dangling declaration are ignored", () => {
  const graph = buildRegionAdjacency([
    { id: "A", adjacencies: ["A", "ZZZ", "B"] },
    { id: "B" },
  ]);
  assert.deepEqual(graph.neighborsOf("A"), ["B"]);
  assert.deepEqual(graph.neighborsOf("ZZZ"), []);
  assert.equal(graph.areNeighbors("A", "A"), false);
  assert.equal(graph.areNeighbors("A", "ZZZ"), false);
});

test("a bbox-only row whose bbox comes from geometry still borders", () => {
  const geometry = (minX) => ({
    type: "Polygon",
    coordinates: [[[minX, 0], [minX + 1, 0], [minX + 1, 1], [minX, 1], [minX, 0]]],
  });
  const graph = buildRegionAdjacency([
    { id: "A", geometry: geometry(0) },
    { id: "B", geometry: geometry(1) },
    { id: "C", geometry: geometry(5) },
  ]);
  assert.deepEqual(graph.neighborsOf("A"), ["B"]);
  assert.deepEqual(graph.neighborsOf("C"), []);
});

test("neighborsWithin walks breadth-first, nearest first, excluding the start", () => {
  const graph = buildRegionAdjacency([
    { id: "A", adjacencies: ["B"] },
    { id: "B", adjacencies: ["A", "C"] },
    { id: "C", adjacencies: ["B", "D"] },
    { id: "D", adjacencies: ["C"] },
  ]);
  assert.deepEqual(graph.neighborsWithin("A", 1), ["B"]);
  assert.deepEqual(graph.neighborsWithin("A", 2), ["B", "C"]);
  assert.deepEqual(graph.neighborsWithin("A", 10), ["B", "C", "D"]);
  assert.deepEqual(graph.neighborsWithin("A", 0), []);
  assert.deepEqual(graph.neighborsWithin("A", -1), []);
  assert.deepEqual(graph.neighborsWithin("A", "nope"), []);
  assert.deepEqual(graph.neighborsWithin("ZZZ", 3), []);
});

test("an empty or malformed catalog builds an empty graph", () => {
  for (const rows of [[], null, undefined, "nope", [null, {}, { id: "  " }]]) {
    const graph = buildRegionAdjacency(rows);
    assert.equal(graph.size, 0);
    assert.deepEqual(graph.neighborsOf("A"), []);
    assert.deepEqual(graph.neighborsWithin("A", 3), []);
  }
});

test("a duplicate id keeps the first row", () => {
  const graph = buildRegionAdjacency([
    { id: "A", adjacencies: ["B"] },
    { id: "A", adjacencies: ["C"] },
    { id: "B" },
    { id: "C" },
  ]);
  assert.equal(graph.size, 3);
  assert.deepEqual(graph.neighborsOf("A"), ["B"]);
});
