/* globals
canvas,
CanvasQuadtree,
CONFIG,
Delaunator,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { BorderTriangle } from "./BorderTriangle.js";
import { boundsForPoint } from "../util.js";
import { Draw } from "../geometry/Draw.js";
import { BreadthFirstPathSearch, UniformCostPathSearch, GreedyPathSearch, AStarPathSearch } from "./algorithms.js";
import { SCENE_GRAPH } from "./WallTracer.js";

/* Testing

Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevationruler").api
Pathfinder = api.pathfinding.Pathfinder
SCENE_GRAPH = api.pathfinding.SCENE_GRAPH
PriorityQueueArray = api.pathfinding.PriorityQueueArray;
PriorityQueue = api.pathfinding.PriorityQueue;

// Test queue (PQ takes only objects, not strings or numbers)
pq = new PriorityQueueArray("high")
pq.enqueue({"D": 4}, 4)
pq.enqueue({"A": 1}, 1);
pq.enqueue({"C": 3}, 3);
pq.enqueue({"B": 2}, 2);
pq.data

pq = new PriorityQueueArray("low")
pq.enqueue({"D": 4}, 4)
pq.enqueue({"A": 1}, 1);
pq.enqueue({"C": 3}, 3);
pq.enqueue({"B": 2}, 2);
pq.data

// Test pathfinding
Pathfinder.initialize()
Pathfinder.drawTriangles();


endPoint = _token.center

token = _token
startPoint = _token.center;

pf = new Pathfinder(token);


path = pf.runPath(startPoint, endPoint, "breadth")
pathPoints = pf.getPathPoints(path);
pf.drawPath(pathPoints, { color: Draw.COLORS.orange })

path = pf.runPath(startPoint, endPoint, "uniform")
pathPoints = pf.getPathPoints(path);
pf.drawPath(pathPoints, { color: Draw.COLORS.yellow })

path = pf.runPath(startPoint, endPoint, "greedy")
pathPoints = pf.getPathPoints(path);
pf.drawPath(pathPoints, { color: Draw.COLORS.green })

pf.algorithm.greedy.debug = true


path = pf.runPath(startPoint, endPoint, "astar")
pathPoints = pf.getPathPoints(path);
pf.drawPath(pathPoints, { color: Draw.COLORS.white })

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

  /** @type {Delaunator} */
  static delaunay;

  /** @type {BorderTriangle[]} */
  static borderTriangles = [];

  /** @type {Set<BorderEdge>} */
  static triangleEdges = new Set();

  /** @type {object<boolean>} */
  static #dirty = {
    delauney: true,
    triangles: true
  }

  static get dirty() { return this.#dirty.delauney || this.#dirty.triangles; }

  static set dirty(value) {
    this.#dirty.delauney ||= value;
    this.#dirty.triangles ||= value;
  }

  /**
   * Initialize properties used for pathfinding related to the scene walls.
   */
  static initialize() {
    this.clear();
    this.initializeDelauney();
    this.initializeTriangles();
  }

  static clear() {
    this.borderTriangles.length = 0;
    this.triangleEdges.clear();
    this.quadtree.clear();
    this.#dirty.delauney ||= true;
    this.#dirty.triangles ||= true;
  }

  /**
   * Build a set of Delaunay triangles from the walls in the scene.
   */
  static initializeDelauney() {
    this.clear();
    const coords = new Uint32Array(SCENE_GRAPH.vertices.size * 2);
    let i = 0;
    const coordKeys = new Map();
    for ( const vertex of SCENE_GRAPH.vertices.values() ) {
      coords[i] = vertex.x;
      coords[i + 1] = vertex.y;
      coordKeys.set(vertex.key, i);
      i += 2;
    }
    this.delaunay = new Delaunator(coords);
    this.delaunay.coordKeys = coordKeys
    this.#dirty.delauney &&= false;
  }



//   static _constrainDelauney() {
//     // https://github.com/kninnug/Constrainautor
//
//     // Build the points to be constrained.
//     // Array of array of indices into the Delaunator points array.
//     // Treat each edge in the SCENE_GRAPH as constraining.
//     delaunay = Pathfinder.delaunay;
//     coordKeys = delaunay.coordKeys;
//     edges = new Array(SCENE_GRAPH.edges.size);
//     let i = 0;
//     for ( const edge of SCENE_GRAPH.edges.values() ) {
//       const iA = delaunay.coordKeys.get(edge.A.key);
//       const iB = delaunay.coordKeys.get(edge.B.key);
//       edges[i] = [iA, iB];
//       i += 1;
//     }
//     con = new Constrainautor(delaunay);
//
//     sceneEdges = [...SCENE_GRAPH.edges.values()]
//
//
//     for ( let i = 0; i < SCENE_GRAPH.edges.size; i += 1) {
//       edge = edges[i]
//       try {
//         con.constrainOne(edge[0], edge[1])
//       } catch(err) {
//         console.debug(`Error constraining edge ${i}.`)
//       }
//     }
//
//     i = 0
//
//     edge = edges[i]
//     Draw.segment(sceneEdges[i], { color: Draw.COLORS.red })
//     con.constrainOne(edge[0], edge[1])
//
//
//   }

  /**
   * Build the triangle objects used to represent the Delauney objects for pathfinding.
   * Must first run initializeDelauney and initializeWalls.
   */
  static initializeTriangles() {
    const { borderTriangles, triangleEdges, delaunay, quadtree } = this;
    if ( this.#dirty.delauney ) this.initializeDelauney();

    triangleEdges.clear();
    quadtree.clear();

    // Build array of border triangles
    borderTriangles.length = delaunay.triangles.length / 3;
    forEachTriangle(delaunay, (i, pts) => {
       const tri = BorderTriangle.fromPoints(pts[0], pts[1], pts[2]);
       tri.id = i;
       borderTriangles[i] = tri;

       // Add to the quadtree
       quadtree.insert({ r: tri.bounds, t: tri });
    });


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
    const aWalls = new Set();
    const bWalls = new Set();
    for ( const edge of triangleEdges.values() ) {
      const aKey = edge.a.key;
      const bKey = edge.b.key;
      const aVertex = SCENE_GRAPH.vertices.get(aKey);
      const bVertex = SCENE_GRAPH.vertices.get(bKey);
      if ( aVertex ) aVertex._edgeSet.forEach(e => aWalls.add(e.wall));
      if ( bVertex ) bVertex._edgeSet.forEach(e => bWalls.add(e.wall));
      edge.wall = aWalls.intersection(bWalls).first(); // May be undefined.
      aWalls.clear();
      bWalls.clear();
    }

    this.#dirty.triangles &&= false;
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

  /** @enum {BreadthFirstPathSearch} */
  static ALGORITHMS = {
    breadth: BreadthFirstPathSearch,
    uniform: UniformCostPathSearch,
    greedy: GreedyPathSearch,
    astar: AStarPathSearch
  };

  /** @enum {string} */
  static COST_METHOD = {
    breadth: "_identifyDestinations",
    uniform: "_identifyDestinationsWithCost",
    greedy: "_identifyDestinations",
    astar: "_identifyDestinationsWithCost"
  };

  /** @type {object{BreadthFirstPathSearch}} */
  algorithm = {};

  /**
   * Find the path between startPoint and endPoint using the chosen algorithm.
   * @param {Point} startPoint      Start point for the graph
   * @param {Point} endPoint        End point for the graph
   * @returns {Map<PathNode.key, PathNode>}
   */
  runPath(startPoint, endPoint, type = "astar") {
    // Initialize the algorithm if not already.
    if ( !this.algorithm[type] ) {
      const alg = this.algorithm[type] = new this.constructor.ALGORITHMS[type]();
      const costMethod = this.constructor.COST_METHOD[type];
      alg.getNeighbors = this[costMethod];
      alg.heuristic = this._heuristic;
    }

    // Make sure pathfinder triangles are up-to-date.
    if ( this.constructor.dirty ) this.constructor.initializeTriangles();

    // Run the algorithm.
    const { start, end } = this._initializeStartEndNodes(startPoint, endPoint);
    return this.algorithm[type].run(start, end);
  }


  /**
   * Heuristic that takes a goal node and a current node and returns a priority based on
   * the canvas distance between two points.
   * @param {PathNode} goal
   * @param {PathNode} current
   */
  // TODO: Handle 3d points?
  _heuristic(goal, current) {
    return CONFIG.GeometryLib.utils.gridUnitsToPixels(canvas.grid.measureDistance(goal.entryPoint, current.entryPoint));
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

    const start = { key: startPoint.key, entryTriangle: startTri, entryPoint: PIXI.Point.fromObject(startPoint) };
    const end = { key: endPoint.key, entryTriangle: endTri, entryPoint: endPoint };

    return { start, end };
  }

  /**
   * Get destinations for a given path node
   * @param {PathNode} pathObject
   * @returns {PathNode[]} Array of destination nodes
   */
  _identifyDestinations(pathNode, goal) {
    // If the goal node is reached, return the goal with the cost.
    if ( pathNode.entryTriangle === goal.entryTriangle ) return [goal];
    return pathNode.entryTriangle.getValidDestinations(pathNode.priorTriangle, this.spacer);
  }

  /**
   * Get destinations with cost calculated for a given path node.
    * @param {PathNode} pathObject
   * @returns {PathNode[]} Array of destination nodes
   */
  _identifyDestinationsWithCost(pathNode, goal) {
    // If the goal node is reached, return the goal with the cost.
    if ( pathNode.entryTriangle === goal.entryTriangle ) {
      // Need a copy so we can modify cost for this goal node only.
      const newNode = {...goal};
      newNode.cost = goal.entryTriangle._calculateMovementCost(pathNode.entryPoint, goal.entryPoint);
      newNode.priorTriangle = pathNode.priorTriangle;
      return [newNode];
    }
    return pathNode.entryTriangle.getValidDestinationsWithCost(pathNode.priorTriangle, this.spacer, pathNode.entryPoint);
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

  /**
   * Debugging. Draw the triangle graph.
   */
  static drawTriangles() {
    if ( this.dirty ) this.initializeTriangles();
    this.borderTriangles.forEach(tri => tri.drawEdges());
  }
}


// NOTE: Helper functions to handle Delaunay coordinates.
// See https://mapbox.github.io/delaunator/

/**
 * Get the three vertex coordinates (edges) for a delaunay triangle.
 * @param {number} t    Triangle index
 * @returns {number[3]}
 */
function edgesOfTriangle(t) { return [3 * t, 3 * t + 1, 3 * t + 2]; }

/**
 * Get the points of a delaunay triangle.
 * @param {Delaunator} delaunay     The triangulation to use
 * @param {number} t                Triangle index
 * @returns {PIXI.Point[3]}
 */
function pointsOfTriangle(delaunay, t) {
  const points = delaunay.coords;
  return edgesOfTriangle(t)
        .map(e => delaunay.triangles[e])
        .map(p => new PIXI.Point(points[2 * p], points[(2 * p) + 1]));
}

/**
 * Apply a function to each triangle in the triangulation.
 * @param {Delaunator} delaunay     The triangulation to use
 * @param {function} callback       Function to apply, which is given the triangle id and array of 3 points
 */
function forEachTriangle(delaunay, callback) {
  const nTriangles = delaunay.triangles.length / 3;
  for ( let t = 0; t < nTriangles; t += 1 ) callback(t, pointsOfTriangle(delaunay, t));
}

/**
 * Get index of triangle for a given edge.
 * @param {number} e      Edge index
 * @returns {number} Triangle index
 */
function triangleOfEdge(e)  { return Math.floor(e / 3); }

/**
 * For a given half-edge index, go to the next half-edge for the triangle.
 * @param {number} e    Edge index
 * @returns {number} Edge index.
 */
function nextHalfedge(e) { return (e % 3 === 2) ? e - 2 : e + 1; }

/**
 * For a given half-edge index, go to the previous half-edge for the triangle.
 * @param {number} e    Edge index
 * @returns {number} Edge index.
 */
function prevHalfedge(e) { return (e % 3 === 0) ? e + 2 : e - 1; }

/**
 * Apply a function for each triangle edge in the triangulation.
 * @param {Delaunator} delaunay     The triangulation to use
 * @param {function} callback       Function to call, passing the edge index and points of the edge.
 */
function forEachTriangleEdge(delaunay, callback) {
  const points = delaunay.coords;
    for (let e = 0; e < delaunay.triangles.length; e++) {
      if (e > delaunay.halfedges[e]) {
        const ip = delaunay.triangles[e];
        const p = new PIXI.Point(points[2 * ip], points[(2 * ip) + 1])

        const iq = delaunay.triangles[nextHalfedge(e)];
        const q = new PIXI.Point(points[2 * iq], points[(2 * iq) + 1])
        callback(e, p, q);
      }
    }
}

/**
 * Identify triangle indices corresponding to triangles adjacent to the one provided.
 * @param {Delaunator} delaunay     The triangulation to use
 * @param {number} t    Triangle index
 * @returns {number[]}
 */
function trianglesAdjacentToTriangle(delaunay, t) {
  const adjacentTriangles = [];
  for ( const e of edgesOfTriangle(t) ) {
    const opposite = delaunay.halfedges[e];
    if (opposite >= 0) adjacentTriangles.push(triangleOfEdge(opposite));
  }
  return adjacentTriangles;
}




