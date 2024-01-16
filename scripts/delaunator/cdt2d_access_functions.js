/* globals
cdt2d,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { BorderTriangle } from "../pathfinding/BorderTriangle.js";

// Functions to assist with cdt2d.

/**
 * Build a cdt2d constrained delaunay graph from the scene graph.
 * @param {WallTracer} sceneGraph
 */
export function cdt2dConstrainedGraph(sceneGraph) {
  const points = new Array(sceneGraph.vertices.size);
  const pointIndexMap = new Map();

  let i = 0;
  for ( const [key, vertex] of sceneGraph.vertices ) {
    pointIndexMap.set(key, i);
    points[i] = [vertex.x, vertex.y];  // Could use Uint32Array ?
    i += 1;
  }

  /* Testing
  points.forEach(ptArr => Draw.point({ x: ptArr[0], y: ptArr[1] }))
  */

  // Every edge must be constrained.
  const edges = new Array(sceneGraph.edges.size);
  i = 0;
  for ( const edge of sceneGraph.edges.values() ) {
    const iA = pointIndexMap.get(edge.A.key);
    const iB = pointIndexMap.get(edge.B.key);
    edges[i] = [iA, iB];
    i += 1;
  }

  /* Testing
  edges.forEach(edgeArr => {
    const arrA = points[edgeArr[0]];
    const arrB = points[edgeArr[1]];
    const A = new PIXI.Point(...arrA);
    const B = new PIXI.Point(...arrB);
    Draw.segment({ A, B });
  })
  */

  const triCoords = cdt2d(points, edges);
  triCoords.points = points;
  triCoords.edges = edges;
  return triCoords;
}

/**
 * Build border triangles from the cd2td graph
 * @param {cdt2d} triCoords   Nested array of triangle coordinate indices.
 * @returns {BorderTriangle[]}
 */
export function cdt2dToBorderTriangles(triCoords, borderTriangles) {
  borderTriangles ??= [];
  borderTriangles.length = triCoords.length;
  const points = triCoords.points;
  for ( let i = 0; i < triCoords.length; i += 1 ) {
    const triCoord = triCoords[i];
    const a = new PIXI.Point(...points[triCoord[0]]);
    const b = new PIXI.Point(...points[triCoord[1]]);
    const c = new PIXI.Point(...points[triCoord[2]]);
    const tri = BorderTriangle.fromPoints(a, b, c);
    tri.id = i;
    borderTriangles[i] = tri;
  }

  /* Testing
  borderTriangles.forEach(tri => tri.drawEdges())
  */

  return borderTriangles;
}
