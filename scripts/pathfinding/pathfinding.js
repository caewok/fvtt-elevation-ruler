/* globals
canvas
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { BorderTriangle, BorderEdge } from "./BorderTriangle.js";


Draw = CONFIG.GeometryLib.Draw;




// Triangulate
/*
Take the 4 corners plus coordinates of each wall endpoint.
(TODO: Use wall edges to capture overlapping walls)

Triangulate.

Can traverse using the half-edge structure.

Start in a triangle. For now, traverse between triangles at midpoints.
Triangle coords correspond to a wall. Each triangle edge may or may not block.
Can either look up the wall or just run collision between the two triangle midpoints (probably the latter).
This handles doors, one-way walls, etc., and limits when the triangulation must be re-done.

Each triangle can represent terrain. Triangle terrain is then used to affect the distance value.
Goal heuristic based on distance (modified by terrain?).
Alternatively, apply terrain only when moving. But should still triangulate terrain so can move around it.

Ultimately traverse by choosing midpoint or points 1 grid square from each endpoint on the edge.

*/


// Draw each endpoint
for ( const key of endpointKeys ) {
  const pt = PIXI.Point.invertKey(key);
  Draw.point(pt, { color: Draw.COLORS.blue })
}

// Draw each triangle
triangles = [];
for (let i = 0; i < delaunay.triangles.length; i += 3) {
  const j = delaunay.triangles[i] * 2;
  const k = delaunay.triangles[i + 1] * 2;
  const l = delaunay.triangles[i + 2] * 2;
  triangles.push(new PIXI.Polygon(
    delaunay.coords[j], delaunay.coords[j + 1],
    delaunay.coords[k], delaunay.coords[k + 1],
    delaunay.coords[l], delaunay.coords[l + 1]
  ));
}

for ( const tri of triangles ) Draw.shape(tri);




borderTriangles.forEach(tri => tri.drawEdges());
borderTriangles.forEach(tri => tri.drawLinks())


// Use Quadtree to locate starting triangle for a point.

// quadtree.clear()
// quadtree.update({r: bounds, t: this})
// quadtree.remove(this)
// quadtree.update(this)


quadtreeBT = new CanvasQuadtree()
borderTriangles.forEach(tri => quadtreeBT.insert({r: tri.bounds, t: tri}))


token = _token
startPoint = _token.center;
endPoint = _token.center

// Find the strat and end triangles
collisionTest = (o, _rect) => o.t.contains(startPoint);
startTri = quadtreeBT.getObjects(boundsForPoint(startPoint), { collisionTest }).first();

collisionTest = (o, _rect) => o.t.contains(endPoint);
endTri = quadtreeBT.getObjects(boundsForPoint(endPoint), { collisionTest }).first();

startTri.drawEdges();
endTri.drawEdges();

// Locate valid destinations
destinations = startTri.getValidDestinations(startPoint, null, token.w * 0.5);
destinations.forEach(d => Draw.point(d.entryPoint, { color: Draw.COLORS.yellow }))
destinations.sort((a, b) => a.distance - b.distance);


// Pick direction, repeat.
chosenDestination = destinations[0];
Draw.segment({ A: startPoint, B: chosenDestination.entryPoint }, { color: Draw.COLORS.yellow })
nextTri = chosenDestination.triangle;
destinations = nextTri.getValidDestinations(startPoint, null, token.w * 0.5);
destinations.forEach(d => Draw.point(d.entryPoint, { color: Draw.COLORS.yellow }))
destinations.sort((a, b) => a.distance - b.distance);


function boundsForPoint(pt) {
  return new PIXI.Rectangle(pt.x - 1, pt.y - 1, 3, 3);
}


/* For the triangles, need:
√ Contains test. Could use PIXI.Polygon, but a custom contains will be faster.
  --> Used to find where a start/end point is located.
  --> Needs to also handle when on a line. PIXI.Polygon contains returns true if on top or left but not right or bottom.
- Look up wall for each edge.
√ Link to adjacent triangle via half-edge
- Provide 2x corner + median pass-through points
*/

class Pathfinder {
  /** @type {CanvasQuadTree} */
  static quadtree = new CanvasQuadtree();

  /** @type {Set<number>} */
  static endpointKeys = new Set();

  /** @type {Delaunator} */
  static delaunay;

  /** @type {Map<key, Set<Wall>>} */
  static wallKeys = new Map();

  /** @type {BorderTriangle[]} */
  static borderTriangles = [];

  /** @type {Set<BorderEdge>} */
  static triangleEdges = new Set();

  /**
   * Initialize properties used for pathfinding related to the scene walls.
   */
  static initialize() {
    this.initializeWalls();
    this.initializeDelauney();
    this.initializeTriangles();
  }

  /**
   * Build a map of wall keys to walls.
   * Each key points to a set of walls whose endpoint matches the key.
   */
  static initializeWalls() {
    const wallKeys = this.wallKeys;
    for ( const wall of [...canvas.walls.placeables, ...canvas.walls.outerBounds] ) {
      const aKey = wall.vertices.a.key;
      const bKey = wall.vertices.b.key;
      if ( wallKeys.has(aKey) ) wallKeys.get(aKey).add(wall);
      else wallKeys.set(aKey, new Set([wall]));

      if ( wallKeys.has(bKey) ) wallKeys.get(bKey).add(wall);
      else wallKeys.set(bKey, new Set([wall]));
    }
  }

  /**
   * Build a set of Delaunay triangles from the walls in the scene.
   * TODO: Use wall segments instead of walls to handle overlapping walls.
   */
  static initializeDelauney() {
    const { delauney, endpointKeys } = this;
    for ( const wall of [...canvas.walls.placeables, ...canvas.walls.outerBounds] ) {
      endpointKeys.add(wall.vertices.a.key);
      endpointKeys.add(wall.vertices.b.key);
    }

    coords = new Uint32Array(endpointKeys.size * 2);
    let i = 0;
    for ( const key of endpointKeys ) {
      const pt = PIXI.Point.invertKey(key);
      coords[i] = pt.x;
      coords[i + 1] = pt.y;
      i += 2;
    }

    delaunay = new Delaunator(coords);
  }

  /**
   * Build the triangle objects used to represent the Delauney objects for pathfinding.
   * Must first run initializeDelauney and initializeWalls.
   */
  static initializeTriangles() {
    const { borderTriangles, triangleEdges, delaunay, wallKeys } = this;

    // Build array of border triangles
    for (let i = 0, ii = 0; i < delaunay.triangles.length; i += 3, ii += 1) {
      const j = delaunay.triangles[i] * 2;
      const k = delaunay.triangles[i + 1] * 2;
      const l = delaunay.triangles[i + 2] * 2;

      const a = { x: delaunay.coords[j], y: delaunay.coords[j + 1] };
      const b = { x: delaunay.coords[k], y: delaunay.coords[k + 1] };
      const c = { x: delaunay.coords[l], y: delaunay.coords[l + 1] };
      const tri = BorderTriangle.fromPoints(a, b, c);
      borderTriangles.push(tri);
      tri.id = ii; // Mostly for debugging at this point.
    }

    // Set the half-edges
    const EDGE_NAMES = BorderTriangle.EDGE_NAMES;
    for ( let i = 0; i < delaunay.halfedges.length; i += 1 ) {
      const halfEdgeIndex = delaunay.halfedges[i];
      if ( !~halfEdgeIndex ) continue;
      const triFrom = borderTriangles[Math.floor(i / 3)];
      const triTo = borderTriangles[Math.floor(halfEdgeIndex / 3)];

      // Always a, b, c in order (b/c ccw)
      const fromEdge = EDGE_NAMES[i % 3];
      const toEdge = EDGE_NAMES[halfEdgeIndex % 3];

      // Need to pick one; keep the fromEdge
      const edgeToKeep = triFrom.edges[fromEdge];
      triTo.setEdge(toEdge, edgeToKeep);

      // Track edge set to link walls.
      triangleEdges.add(edgeToKeep);
    }

    // Set the wall, if any, for each triangle edge
    nullSet = new Set();
    for ( const edge of triangleEdges.values() ) {
      const aKey = edge.a.key;
      const bKey = edge.b.key;
      const aWalls = wallKeys.get(aKey) || nullSet;
      const bWalls = wallKeys.get(bKey) || nullSet;
      edge.wall = aWalls.intersection(bWalls).first(); // May be undefined.
    }
  }


}


