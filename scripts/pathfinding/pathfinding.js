/* globals
canvas,
CanvasQuadtree,
Delaunator,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { BorderTriangle } from "./BorderTriangle.js";
import { PriorityQueueArray } from "./PriorityQueueArray.js";
// import { PriorityQueue } from "./PriorityQueue.js";
import { boundsForPoint } from "../util.js";
import { Draw } from "../geometry/Draw.js";


/* Testing

Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevationruler").api
Pathfinder = api.pathfinding.Pathfinder
Pathfinder.initialize()

endPoint = _token.center

token = _token
startPoint = _token.center;

pf = new Pathfinder(token);
path = pf.breadthFirstPath(startPoint, endPoint)
pathPoints = pf.getPathPoints(path);
pf.drawPath(pathPoints, { color: Draw.COLORS.red })

path = pf.uniformCostPath(startPoint, endPoint)
pathPoints = pf.getPathPoints(path);
pf.drawPath(pathPoints, { color: Draw.COLORS.blue })

*/

// Pathfinder.initialize();
//
// Draw = CONFIG.GeometryLib.Draw;
//
// measureInitWalls = performance.measure("measureInitWalls", "Pathfinder|Initialize Walls", "Pathfinder|Initialize Delauney")
// measureInitDelaunay = performance.measure("measureInitDelaunay", "Pathfinder|Initialize Delauney", "Pathfinder|Initialize Triangles")
// measureInitTriangles = performance.measure("measureInitTriangles", "Pathfinder|Initialize Triangles", "Pathfinder|Finished Initialization")
// console.table([measureInitWalls, measureInitDelaunay,measureInitTriangles ])
//
//
//
// // Triangulate
// /*
// Take the 4 corners plus coordinates of each wall endpoint.
// (TODO: Use wall edges to capture overlapping walls)
//
// Triangulate.
//
// Can traverse using the half-edge structure.
//
// Start in a triangle. For now, traverse between triangles at midpoints.
// Triangle coords correspond to a wall. Each triangle edge may or may not block.
// Can either look up the wall or just run collision between the two triangle midpoints (probably the latter).
// This handles doors, one-way walls, etc., and limits when the triangulation must be re-done.
//
// Each triangle can represent terrain. Triangle terrain is then used to affect the distance value.
// Goal heuristic based on distance (modified by terrain?).
// Alternatively, apply terrain only when moving. But should still triangulate terrain so can move around it.
//
// Ultimately traverse by choosing midpoint or points 1 grid square from each endpoint on the edge.
//
// */
//
//
// // Draw each endpoint
// for ( const key of endpointKeys ) {
//   const pt = PIXI.Point.invertKey(key);
//   Draw.point(pt, { color: Draw.COLORS.blue })
// }
//
// // Draw each triangle
// triangles = [];
// for (let i = 0; i < delaunay.triangles.length; i += 3) {
//   const j = delaunay.triangles[i] * 2;
//   const k = delaunay.triangles[i + 1] * 2;
//   const l = delaunay.triangles[i + 2] * 2;
//   triangles.push(new PIXI.Polygon(
//     delaunay.coords[j], delaunay.coords[j + 1],
//     delaunay.coords[k], delaunay.coords[k + 1],
//     delaunay.coords[l], delaunay.coords[l + 1]
//   ));
// }
//
// for ( const tri of triangles ) Draw.shape(tri);
//
//
//
//
// borderTriangles.forEach(tri => tri.drawEdges());
// borderTriangles.forEach(tri => tri.drawLinks())
//
//
// // Use Quadtree to locate starting triangle for a point.
//
// // quadtree.clear()
// // quadtree.update({r: bounds, t: this})
// // quadtree.remove(this)
// // quadtree.update(this)
//
//
// quadtreeBT = new CanvasQuadtree()
// borderTriangles.forEach(tri => quadtreeBT.insert({r: tri.bounds, t: tri}))
//
//
// token = _token
// startPoint = _token.center;
// endPoint = _token.center
//
// // Find the strat and end triangles
// collisionTest = (o, _rect) => o.t.contains(startPoint);
// startTri = quadtreeBT.getObjects(boundsForPoint(startPoint), { collisionTest }).first();
//
// collisionTest = (o, _rect) => o.t.contains(endPoint);
// endTri = quadtreeBT.getObjects(boundsForPoint(endPoint), { collisionTest }).first();
//
// startTri.drawEdges();
// endTri.drawEdges();
//
// // Locate valid destinations
// destinations = startTri.getValidDestinations(startPoint, null, token.w * 0.5);
// destinations.forEach(d => Draw.point(d.entryPoint, { color: Draw.COLORS.yellow }))
// destinations.sort((a, b) => a.distance - b.distance);
//
//
// // Pick direction, repeat.
// chosenDestination = destinations[0];
// Draw.segment({ A: startPoint, B: chosenDestination.entryPoint }, { color: Draw.COLORS.yellow })
// nextTri = chosenDestination.triangle;
// destinations = nextTri.getValidDestinations(startPoint, null, token.w * 0.5);
// destinations.forEach(d => Draw.point(d.entryPoint, { color: Draw.COLORS.yellow }))
// destinations.sort((a, b) => a.distance - b.distance);
//

/* For the triangles, need:
√ Contains test. Could use PIXI.Polygon, but a custom contains will be faster.
  --> Used to find where a start/end point is located.
  --> Needs to also handle when on a line. PIXI.Polygon contains returns true if on top or left but not right or bottom.
- Look up wall for each edge.
√ Link to adjacent triangle via half-edge
- Provide 2x corner + median pass-through points
*/

/**
 * @typedef {object} PathNode
 * @property {BorderTriangle} key     The destination triangle
 * @property {PIXI.Point} entryPoint  The point on the edge of or within the destination triangle
 *                                    where the path will enter the triangle
 * @property {number} cost            Cost of the path from the last entryPoint to this entryPoint.
 * @property {PathNode[]} neighbors   Neighbors of this path node
 */

export class Pathfinder {
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
    this.clear();

    performance.mark("Pathfinder|Initialize Walls");
    this.initializeWalls();

    performance.mark("Pathfinder|Initialize Delauney");
    this.initializeDelauney();

    performance.mark("Pathfinder|Initialize Triangles");
    this.initializeTriangles();

    performance.mark("Pathfinder|Finished Initialization");
  }

  static clear() {
    this.borderTriangles.length = 0;
    this.triangleEdges.clear();
    this.wallKeys.clear();
    this.quadtree.clear();
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
    const endpointKeys = this.endpointKeys;
    for ( const wall of [...canvas.walls.placeables, ...canvas.walls.outerBounds] ) {
      endpointKeys.add(wall.vertices.a.key);
      endpointKeys.add(wall.vertices.b.key);
    }

    const coords = new Uint32Array(endpointKeys.size * 2);
    let i = 0;
    for ( const key of endpointKeys ) {
      const pt = PIXI.Point.invertKey(key);
      coords[i] = pt.x;
      coords[i + 1] = pt.y;
      i += 2;
    }

    this.delaunay = new Delaunator(coords);
  }

  /**
   * Build the triangle objects used to represent the Delauney objects for pathfinding.
   * Must first run initializeDelauney and initializeWalls.
   */
  static initializeTriangles() {
    const { borderTriangles, triangleEdges, delaunay, wallKeys, quadtree } = this;

    // Build array of border triangles
    const nTriangles = delaunay.triangles.length / 3;
    borderTriangles.length = nTriangles;
    for (let i = 0, ii = 0; i < delaunay.triangles.length; i += 3, ii += 1) {
      const j = delaunay.triangles[i] * 2;
      const k = delaunay.triangles[i + 1] * 2;
      const l = delaunay.triangles[i + 2] * 2;

      const a = { x: delaunay.coords[j], y: delaunay.coords[j + 1] };
      const b = { x: delaunay.coords[k], y: delaunay.coords[k + 1] };
      const c = { x: delaunay.coords[l], y: delaunay.coords[l + 1] };
      const tri = BorderTriangle.fromPoints(a, b, c);
      borderTriangles[ii] = tri;
      tri.id = ii; // Mostly for debugging at this point.

      // Add to the quadtree
      quadtree.insert({ r: tri.bounds, t: tri });
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
    const nullSet = new Set();
    for ( const edge of triangleEdges.values() ) {
      const aKey = edge.a.key;
      const bKey = edge.b.key;
      const aWalls = wallKeys.get(aKey) || nullSet;
      const bWalls = wallKeys.get(bKey) || nullSet;
      edge.wall = aWalls.intersection(bWalls).first(); // May be undefined.
    }
  }

  /** @type {Token} token */
  token;

  /**
   * Optional token to associate with this path.
   * Used for path spacing near obstacles.
   * @param {Token} token
   */
  constructor(token) {
    this.token = token;
  }

  /** @type {number} */
  _spacer = 0;

  get spacer() {
    return this._spacer || (this.token.w * 0.5) || (canvas.dimensions.size * 0.5);
  }

  /**
   * Run a breadth first, early exit search of the border triangles.
   * @param {Point} startPoint      Start point for the graph
   * @param {Point} endPoint        End point for the graph
   * @returns {Map<PathNode.key, PathNode>}
   */
  _breadthFirstPF;

  breadthFirstPath(startPoint, endPoint) {
    const { start, end } = this._initializeStartEndNodes(startPoint, endPoint);
    if ( !this._breadthFirstPF ) {
       this._breadthFirstPF = new BreadthFirstPathSearch();
       this._breadthFirstPF.getNeighbors = this.identifyDestinations.bind(this);
    }
    return this._breadthFirstPF.run(start, end);
  }

  /**
   * Run a uniform cost search (Dijkstra's).
   * @param {Point} startPoint      Start point for the graph
   * @param {Point} endPoint        End point for the graph
   * @returns {Map<PathNode.key, PathNode>}
   */
  _uniformCostPF;

  uniformCostPath(startPoint, endPoint) {
    const { start, end } = this._initializeStartEndNodes(startPoint, endPoint);
    if ( !this._uniformCostPF ) {
       this._uniformCostPF = new UniformCostPathSearch();
       this._uniformCostPF.getNeighbors = this.identifyDestinations.bind(this);
    }
    return this._uniformCostPF.run(start, end);
  }

  /**
   * Locate start and end triangles for the start and end points and
   * return the corresponding path nodes.
   * @param {Point} startPoint      Start point for the graph
   * @param {Point} endPoint        End point for the graph
   * @returns {object}
   *   - {PathNode} start
   *   - {PathNode} end
   */
  _initializeStartEndNodes(startPoint, endPoint) {
    // Locate start and end triangles.
    // TODO: Handle 3d
    const quadtree = this.constructor.quadtree;
    startPoint = PIXI.Point.fromObject(startPoint);
    endPoint = PIXI.Point.fromObject(endPoint);

    let collisionTest = (o, _rect) => o.t.contains(startPoint);
    const startTri = quadtree.getObjects(boundsForPoint(startPoint), { collisionTest }).first();

    collisionTest = (o, _rect) => o.t.contains(endPoint);
    const endTri = quadtree.getObjects(boundsForPoint(endPoint), { collisionTest }).first();

    const start = { key: startTri, entryPoint: PIXI.Point.fromObject(startPoint) };
    const end = { key: endTri, entryPoint: endPoint };

    return { start, end };
  }


  /**
   * Get destinations for a given pathfinding object, which is a triangle plus an entryPoint.
   * @param {PathNode} pathObject
   * @returns {PathNode[]} Array of destination nodes
   */
  identifyDestinations(pathNode) {
    return pathNode.key.getValidDestinations(pathNode.entryPoint, pathNode.key, this.spacer);
  }

  /**
   * Identify path points, in order from start to finish, for a cameFrom path map.
   * @returns {PIXI.Point[]}
   */
  getPathPoints(pathMap) {
    let current = pathMap.goal;
    const pts = [current.entryPoint];
    while ( current.key !== pathMap.start.key ) {
      current = pathMap.get(current.key);
      pts.push(current.entryPoint);
    }
    return pts;
  }

  drawPath(pathPoints, opts) {
    const nPts = pathPoints.length;
    let prior = pathPoints[0];
    Draw.point(prior);
    for ( let i = 1; i < nPts; i += 1 ) {
      const curr = pathPoints[i];
      Draw.segment({A: prior, B: curr}, opts);
      Draw.point(curr, opts);
      prior = curr;
    }
  }

}

// See https://www.redblobgames.com/pathfinding/a-star/introduction.html


/**
 * Pathfinding objects used here must have the following properties:
 * - {object} key   Unique object, string, or number that can be used in a Set or as a Map key.
 * - {number} cost  For algorithms that measure value, the cost of this move.
 * Objects can have any other properties needed.
 */
export class BreadthFirstPathSearch {
  /** @type {PathNode[]} */
  frontier = [];

  /** @type {Map<PathNode.key, PathNode>} */
  cameFrom = new Map(); // Path a -> b stored as cameFrom[b] = a

  /**
   * Run the breadth first search on the graph.
   * Each object must have a unique key property used for comparison.
   * @param {PathNode} start    Path node representing start
   * @param {PathNode} goal     Path node representing end
   * @returns {Map<PathNode>} Path as the cameFrom map. Note that rerunning will change this return.
   */
  run(start, goal) {
    this.clear();
    const { cameFrom, frontier } = this;
    frontier.unshift(start);

    while ( frontier.length ) {
      const current = frontier.pop();
      if ( current.key === goal.key ) break;

      // Get each neighbor destination in turn.
      for ( const next of this.getNeighbors(current) ) {
        if ( !cameFrom.has(next.key) ) {
          frontier.unshift(next);
          cameFrom.set(next.key, current);
        }
      }
    }

    cameFrom.goal = goal;
    cameFrom.start = start;
    return cameFrom;
  }

  /**
   * Neighbor method that can be overriden to handle different objects.
   * @param {PathNode} pathNode   Object representing a graph node
   * @returns {Array[PathNode]} Array of neighboring objects to the node.
   */
  getNeighbors(pathNode) { return pathNode.neighbors; }

  /**
   * Clear the path properties.
   */
  clear() {
    this.frontier.length = 0;
    this.cameFrom.clear();
  }
}

/**
 * Dijkstra's Algorithm, or uniform cost path search.
 */
export class UniformCostPathSearch extends BreadthFirstPathSearch {
  frontier = new PriorityQueueArray([], { comparator: (a, b) => a.cost - b.cost });

  /** @type {Map<PathNode.key, number>} */
  costSoFar = new Map();

  clear() {
    this.frontier.clear();
    this.costSoFar.clear();
    this.cameFrom.clear();
  }

  /**
   * Run the cost search on the graph.
   * Each PathNode must have a unique key property used for comparison
   * and cost property used to value cost so far.
   * @param {PathNode} start    Path node representing start
   * @param {PathNode} goal     Path node representing end
   * @returns {Map<PathNode>} Path as the cameFrom map. Note that rerunning will change this return.
   */
  run(start, goal) {
    this.clear();
    const { cameFrom, costSoFar, frontier } = this;

    frontier.enqueue(start, 0);
    costSoFar.set(start.key, 0);

    while ( frontier.length ) {
      const current = frontier.dequeue();
      if ( current.key === goal.key ) break;

      // Get each neighbor destination in turn.
      for ( const next of this.getNeighbors(current) ) {
        const newCost = costSoFar.get(current.key) + next.cost;
        if ( !costSoFar.has(next.key) || newCost < costSoFar.get(next.key) ) {
          frontier.enqueue(next, newCost); // Priority is newCost
          cameFrom.set(next.key, current);
        }
      }
    }

    cameFrom.goal = goal;
    cameFrom.start = start;
    return cameFrom;
  }
}

export class AStarPathSearch {
  /** @type {PriorityQueueArray} */
  frontier = new PriorityQueueArray([], { comparator: (a, b) => a.distance - b.distance });

  /** @type {Map<BorderTriangle>} */
  cameFrom = new Map(); // path a -> b stored as cameFrom[b] = a

}
